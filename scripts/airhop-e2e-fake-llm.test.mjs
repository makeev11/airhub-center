import assert from "node:assert/strict";
import test from "node:test";

import { fakeResponse } from "./airhop-e2e-fake-llm.mjs";

const channelId = "bed3a8cf-35df-4ebc-be4d-476a5ec64ab1";

test("restart probe acknowledges the new event rather than prior history", () => {
  const previous = "a".repeat(64);
  const current = "b".repeat(64);
  const result = fakeResponse({ messages: [{ role: "user", content:
    `Channel: Welcome (#${channelId})\nEvent ID: ${previous}\nContent: Проверка связи без упоминания\nEvent ID: ${current}\nContent: Проверка связи после перезапуска\nTags: []`,
  }] });
  const args = JSON.parse(result.choices[0].message.tool_calls[0].function.arguments);
  assert.deepEqual(args.respondsTo, [current]);
  assert.deepEqual(args.messages, ["На связи после перезапуска. Продолжаем Welcome."]);
});

test("ordinary owner message gets an explicit acknowledgement without a kickoff receipt", () => {
  const id = "a".repeat(64);
  const result = fakeResponse({ messages: [{ role: "user", content:
    `[Context]\nScope: Airhop Welcome\nChannel: Welcome (#${channelId})\n[Buzz event: message]\nEvent ID: ${id}\nChannel: Welcome (#${channelId})\nKind: 9\nContent: Проверка связи без упоминания\nTags: []`,
  }] });
  const args = JSON.parse(result.choices[0].message.tool_calls[0].function.arguments);
  assert.deepEqual(args.respondsTo, [id]);
  assert.equal(args.channelId, channelId);
  assert.equal(args.kickoffStage, undefined);
});

test("a new Fizz task is not mistaken for the prior tool result", () => {
  const response = fakeResponse({
    messages: [
      {
        role: "user",
        content: `airhop-welcome:${channelId}:fizz_intro`,
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-fizz_intro" }],
      },
      {
        role: "tool",
        content: '{"eventIds":["intro-event"]}',
      },
      {
        role: "assistant",
        content: "Готово.",
      },
      {
        role: "user",
        content: `airhop-welcome:${channelId}:fizz_first_question`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "airhop-agent-mcp__airhop_send_messages",
        },
      },
    ],
  });

  const toolCall = response.choices[0].message.tool_calls[0];
  const args = JSON.parse(toolCall.function.arguments);
  assert.equal(toolCall.function.name, "airhop-agent-mcp__airhop_send_messages");
  assert.deepEqual(args, {
    channelId,
    messages: ["Вижу центр «AirHop E2E Center». Начнём с филиалов?"],
    expectsReply: true,
    kickoffStage: "fizz_first_question",
  });
});
