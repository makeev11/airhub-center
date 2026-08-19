#!/usr/bin/env node

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const port = Number.parseInt(
  process.env.AIRHOP_E2E_FAKE_LLM_PORT ?? "45781",
  10,
);
const host = "127.0.0.1";

const diagnostics = {
  requestCount: 0,
  lastMethod: null,
  lastUrl: null,
};

const kickoffMessages = {
  fizz_intro: {
    messages: ["Привет! Я Физ, руководитель вашей команды Airhop."],
    expectsReply: false,
  },
  fizz_invite_administrator: {
    messages: ["Администратор, представься, пожалуйста."],
    expectsReply: false,
  },
  administrator_intro: {
    messages: [
      "Я Администратор. Помогаю с расписанием, детьми, родителями и оплатами.",
    ],
    expectsReply: false,
  },
  fizz_invite_analyst: {
    messages: ["Аналитик, теперь расскажи коротко о себе."],
    expectsReply: false,
  },
  analyst_intro: {
    messages: ["Я Аналитик. Готовлю короткие отчёты по данным центра."],
    expectsReply: false,
  },
  fizz_invite_content_marketer: {
    messages: ["Контент-маркетолог, присоединяйся и представься."],
    expectsReply: false,
  },
  content_marketer_intro: {
    messages: ["Я Контент-маркетолог. Помогаю готовить публичные материалы."],
    expectsReply: false,
  },
  fizz_explain_team: {
    messages: [
      "Можно писать мне или сразу нужному специалисту. Доступ сотрудников настраивается отдельно.",
    ],
    expectsReply: false,
  },
  fizz_first_question: {
    messages: ["Как называется ваш центр?"],
    expectsReply: true,
  },
};

function textResponse(content) {
  return {
    id: "airhop-e2e-text",
    object: "chat.completion",
    model: "fake-airhop-e2e",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function toolResponse(channelId, stage, toolName) {
  const kickoff = kickoffMessages[stage];
  return {
    id: `airhop-e2e-${stage}`,
    object: "chat.completion",
    model: "fake-airhop-e2e",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call-${stage}`,
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify({
                  channelId,
                  messages: kickoff.messages,
                  expectsReply: kickoff.expectsReply,
                  kickoffStage: stage,
                }),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function requestMessages(payload) {
  return Array.isArray(payload?.messages) ? payload.messages : [];
}

function lastText(messages, role) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role && typeof message.content === "string") {
      return message.content;
    }
  }
  return "";
}

export function fakeResponse(payload) {
  const messages = requestMessages(payload);
  if (messages.at(-1)?.role === "tool") {
    return textResponse("Готово.");
  }

  const instruction = lastText(messages, "user");
  const taskMatch = instruction.match(
    /airhop-welcome:([0-9a-f-]{36}):(fizz_intro|fizz_invite_administrator|administrator_intro|fizz_invite_analyst|analyst_intro|fizz_invite_content_marketer|content_marketer_intro|fizz_explain_team|fizz_first_question)/i,
  );
  const stageMatch = instruction.match(
    /kickoff_stage="(fizz_intro|fizz_invite_administrator|administrator_intro|fizz_invite_analyst|analyst_intro|fizz_invite_content_marketer|content_marketer_intro|fizz_explain_team|fizz_first_question)"/i,
  );
  const channelMatch = instruction.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  const stage = taskMatch?.[2] ?? stageMatch?.[1];
  const channelId = taskMatch?.[1] ?? channelMatch?.[1];
  const sendMessagesToolName = Array.isArray(payload?.tools)
    ? payload.tools
        .map((tool) => tool?.function?.name)
        .find(
          (name) =>
            typeof name === "string" && name.endsWith("__airhop_send_messages"),
        )
    : undefined;
  const toolName =
    sendMessagesToolName ?? "airhop-agent-mcp__airhop_send_messages";
  if (stage && channelId && kickoffMessages[stage]) {
    return toolResponse(channelId, stage, toolName);
  }
  return textResponse(
    "Детерминированный E2E-провайдер не получил Welcome-задачу.",
  );
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  diagnostics.lastMethod = request.method ?? null;
  diagnostics.lastUrl = request.url ?? null;

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  if (request.method === "GET" && request.url === "/debug") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, ...diagnostics }));
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    diagnostics.requestCount += 1;
    process.stdout.write(
      `Airhop E2E fake LLM request #${diagnostics.requestCount} ${request.url}\n`,
    );

    const payload = await readJson(request);
    const body = JSON.stringify(fakeResponse(payload));
    response.writeHead(200, {
      "content-length": Buffer.byteLength(body),
      "content-type": "application/json",
    });
    response.end(body);
  } catch (error) {
    const body = JSON.stringify({ error: String(error) });
    response.writeHead(400, {
      "content-length": Buffer.byteLength(body),
      "content-type": "application/json",
    });
    response.end(body);
  }
});

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  server.listen(port, host, () => {
    process.stdout.write(
      `Airhop E2E fake LLM listening on http://${host}:${port}\n`,
    );
  });
}
