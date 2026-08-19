import assert from "node:assert/strict";
import test from "node:test";

import { fakeResponse } from "./airhop-e2e-fake-llm.mjs";

const channelId = "bed3a8cf-35df-4ebc-be4d-476a5ec64ab1";

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
    messages: ["Как называется ваш центр?"],
    expectsReply: true,
    kickoffStage: "fizz_first_question",
  });
});
