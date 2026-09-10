import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { browser } from "@wdio/globals";

type Event = {
  id: string;
  pubkey: string;
  content: string;
  kind: number;
  created_at: number;
  tags: string[][];
};

let welcomeChannelId: string | undefined;
let lastEvents: Event[] = [];

async function events(): Promise<Event[]> {
  const result = await browser.execute(async (knownChannelId?: string) => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__.invoke;
    let channelId = knownChannelId;
    if (!channelId) {
      const channels = (await invoke("get_channels")) as {
        id: string;
        name: string;
      }[];
      channelId = channels.find((channel) => channel.name === "Welcome")?.id;
    }
    if (!channelId) throw new Error("Welcome missing");
    const page = (await invoke("get_channel_messages_before", {
      channelId,
      before: Math.floor(Date.now() / 1000) + 10,
      limit: 200,
    })) as { events: Event[] };
    return { channelId, events: page.events };
  }, welcomeChannelId);
  welcomeChannelId = result.channelId;
  lastEvents = result.events;
  return lastEvents;
}

async function ask(text: string, immediate = false) {
  if (immediate) {
    assert(welcomeChannelId);
    // Native WebDriver typing can take longer than the whole kickoff. Use the
    // same signed command as the composer for this timing-sensitive probe only.
    await browser.execute(
      async (channelId: string, content: string) => {
        const invoke = (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (
                command: string,
                args: Record<string, unknown>,
              ) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__.invoke;
        await invoke("send_channel_message", {
          channelId,
          content,
          parentEventId: null,
          mediaTags: null,
          emojiTags: null,
          mentionTags: null,
          mentionPubkeys: null,
          kind: 9,
        });
      },
      welcomeChannelId,
      text,
    );
  } else {
    const input = await browser.$('[data-testid="message-input"]');
    await input.setValue(text);
    await browser.$('[data-testid="send-message"]').click();
  }
  let answer: Event | undefined;
  await browser.waitUntil(
    async () => {
      const history = await events();
      const question = history.find(
        (event) =>
          event.content === text &&
          !event.tags.some((tag) => tag[0] === "airhop-agent-turn"),
      );
      if (!question) return false;
      assert(
        !question.tags.some((tag) => tag[0] === "p"),
        "probe must not mention an agent",
      );
      answer = history.find(
        (event) =>
          event.tags.some(
            (tag) => tag[0] === "airhop-responds-to" && tag[1] === question.id,
          ) &&
          event.tags.some(
            (tag) => tag[0] === "airhop-agent-turn" && tag[1] === "fizz",
          ),
      );
      return !!answer;
    },
    {
      timeout: 180_000,
      interval: 5000,
      timeoutMsg: `Fizz did not acknowledge: ${text}`,
    },
  );
  assert(answer?.content.trim(), "live response must contain text");
  return answer;
}

function branchCount(): number {
  return Number(
    execFileSync(
      "docker",
      [
        "compose",
        "-p",
        "buzz-harness",
        "-f",
        "../docker-compose.harness.yml",
        "exec",
        "-T",
        "postgres",
        "psql",
        "-X",
        "-U",
        "buzz",
        "-d",
        "buzz",
        "-Atc",
        "SELECT count(*) FROM airhop_branches b JOIN airhop_organizations o ON o.community_id=b.community_id WHERE o.name='AirHop E2E Center' AND b.name='Проверочный филиал';",
      ],
      { encoding: "utf8" },
    ).trim(),
  );
}

async function confirmedSetupProbe() {
  assert.equal(branchCount(), 0);
  const input = await browser.$('[data-testid="message-input"]');
  await input.setValue(
    "Вернёмся к филиалам. Создай филиал «Проверочный филиал», адрес: Тестовая улица, 10. Сначала покажи предпросмотр, без моего подтверждения ничего не сохраняй.",
  );
  await browser.$('[data-testid="send-message"]').click();
  let preview: Event | undefined;
  await browser.waitUntil(
    async () => {
      preview = (await events()).find(
        (event) =>
          event.content.includes("Проверочный филиал") &&
          event.tags.some((tag) => tag[0] === "airhop-action"),
      );
      return !!preview;
    },
    {
      timeout: 180_000,
      interval: 5000,
      timeoutMsg: "Administrator did not publish a typed preview",
    },
  );
  assert(preview);
  assert.match(preview.content, /Тестовая улица, 10/);
  const serviceName = await browser.execute(async (pubkey: string) => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__.invoke;
    const result = (await invoke("get_users_batch", { pubkeys: [pubkey] })) as {
      profiles: Record<string, { display_name?: string }>;
    };
    return result.profiles[pubkey]?.display_name;
  }, preview.pubkey);
  assert.equal(
    serviceName,
    "AirHop Center",
    "preview author must have a signed service profile",
  );
  assert.equal(branchCount(), 0, "preview must not commit the branch");
  await browser.execute(async (eventId: string) => {
    const invoke = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__.invoke;
    await invoke("add_reaction", { eventId, emoji: "✅", emojiUrl: null });
  }, preview.id);
  await browser.waitUntil(async () => branchCount() === 1, {
    timeout: 45_000,
    interval: 3000,
    timeoutMsg: "Owner confirmation did not commit the branch",
  });
}

/** Live provider acceptance; no production data or connection is used. */
export async function runLiveWelcomeProbe(resume: boolean) {
  const stages = [
    "fizz_intro",
    "administrator_intro",
    "analyst_intro",
    "content_marketer_intro",
    "hermes_guest_intro",
    "fizz_first_question",
  ];
  try {
    let interruptionAnswer: Event | undefined;
    if (!resume && process.env.AIRHOP_E2E_INTERRUPT_PROBE === "1") {
      await browser.waitUntil(
        async () =>
          (await events()).some((event) =>
            event.tags.some(
              (tag) =>
                tag[0] === "airhop-kickoff-stage" && tag[1] === "fizz_intro",
            ),
          ),
        { timeout: 120_000, interval: 1000 },
      );
      assert(
        !lastEvents.some((event) =>
          event.tags.some(
            (tag) =>
              tag[0] === "airhop-kickoff-stage" &&
              tag[1] === "fizz_first_question",
          ),
        ),
        "interruption must occur during introductions, not after setup starts",
      );
      interruptionAnswer = await ask("Кто ты?", true);
    }
    await browser.waitUntil(
      async () => {
        const history = await events();
        return stages.every((stage) =>
          history.some((event) =>
            event.tags.some(
              (tag) => tag[0] === "airhop-kickoff-stage" && tag[1] === stage,
            ),
          ),
        );
      },
      {
        timeout: 240_000,
        interval: 5000,
        timeoutMsg: "Live model did not finish Welcome introductions",
      },
    );
    const introductions = lastEvents;
    const firstQuestion = introductions.find((event) =>
      event.tags.some(
        (tag) =>
          tag[0] === "airhop-kickoff-stage" && tag[1] === "fizz_first_question",
      ),
    );
    assert(
      firstQuestion &&
        /[?？؟]/u.test(firstQuestion.content) &&
        firstQuestion.tags.some((tag) => tag[0] === "airhop-question"),
      "first setup stage must actually ask the owner a question",
    );
    if (interruptionAnswer) {
      const interruption = introductions.find(
        (event) => event.content === "Кто ты?",
      );
      const guest = introductions.find((event) =>
        event.tags.some(
          (tag) =>
            tag[0] === "airhop-kickoff-stage" &&
            tag[1] === "hermes_guest_intro",
        ),
      );
      assert(
        interruption && guest && interruption.created_at < guest.created_at,
        "probe must actually interrupt before the introductions finish",
      );
      const setup = introductions.find((event) =>
        event.tags.some(
          (tag) =>
            tag[0] === "airhop-kickoff-stage" &&
            tag[1] === "fizz_first_question",
        ),
      );
      assert(
        setup && setup.created_at > interruptionAnswer.created_at,
        "Welcome must answer the interruption before continuing into setup",
      );
    }
    for (const stage of stages) {
      assert.equal(
        introductions.filter((event) =>
          event.tags.some(
            (tag) => tag[0] === "airhop-kickoff-stage" && tag[1] === stage,
          ),
        ).length,
        1,
      );
    }
    if (resume) {
      const answer = await ask(
        "Продолжим. На чём мы остановились, какой следующий шаг? Пока ничего не меняй.",
      );
      if (process.env.AIRHOP_E2E_SETUP_PROBE === "1")
        await confirmedSetupProbe();
      assert.match(
        answer.content,
        /преподавател|педагог|учител/i,
        "resume should advance to teachers, not re-ask branches",
      );
    } else {
      await ask(
        "Какие данные центра уже заполнены? Прочитай текущие данные, пока ничего не меняй.",
      );
      const answer = await ask(
        "Филиалы пока пропустим. Перейдём к следующему шагу, ничего пока не сохраняй.",
      );
      assert.match(
        answer.content,
        /преподавател|педагог|учител/i,
        "ordered setup should advance to teachers",
      );
      await ask("Сделаем паузу. Не продолжай настройку, пока я не попрошу.");
      const count = (await events()).filter((event) => event.kind === 9).length;
      await browser.pause(2500);
      assert.equal(
        (await events()).filter((event) => event.kind === 9).length,
        count,
        "pause must not trigger unsolicited setup messages",
      );
    }
  } finally {
    // Synthetic organization and test messages only. Provider credentials are
    // neither in relay events nor in this diagnostic artifact.
    writeFileSync(
      `/private/tmp/airhop-welcome-live-${resume ? "resumed" : "initial"}.json`,
      JSON.stringify(lastEvents, null, 2),
      { mode: 0o600 },
    );
  }
}
