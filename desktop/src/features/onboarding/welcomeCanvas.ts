import { getCanvas, setCanvas } from "@/shared/api/tauri";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";

const CONTENT: Record<AirHopLocale, string> = {
  "ru-RU": `# Welcome

Это приватное рабочее пространство владельца центра.

- Пишите Физу — он подключит нужного специалиста.
- Или обращайтесь сразу к Администратору, Аналитику или Контент-маркетологу.
- В Welcome общение идёт обычными сообщениями, без обязательных тредов.
`,
  "en-US": `# Welcome

This is the center owner's private workspace.

- Ask Fizz and he will involve the right specialist.
- Or address the Administrator, Analyst, or Content Marketer directly.
- Welcome uses ordinary top-level messages; threads are not required here.
`,
  "tr-TR": `# Welcome

Burası merkez sahibinin özel çalışma alanıdır.

- Fizz'e yazın; doğru uzmanı görevlendirsin.
- Ya da doğrudan Yönetici, Analist veya İçerik Pazarlamacısı'na yazın.
- Welcome kanalında zorunlu konu dizileri olmadan normal mesajlar kullanılır.
`,
  "pt-BR": `# Welcome

Este é o espaço de trabalho privado do proprietário do centro.

- Fale com Fizz e ele envolverá o especialista certo.
- Ou fale diretamente com o Administrador, Analista ou Especialista de Conteúdo.
- No Welcome, use mensagens normais; tópicos não são obrigatórios.
`,
};

export function welcomeCanvasContent(locale: string | null | undefined) {
  const normalized = locale?.trim().toLowerCase() ?? "";
  if (normalized === "ru" || normalized.startsWith("ru-")) {
    return CONTENT["ru-RU"];
  }
  if (normalized === "tr" || normalized.startsWith("tr-")) {
    return CONTENT["tr-TR"];
  }
  if (normalized === "pt" || normalized.startsWith("pt-")) {
    return CONTENT["pt-BR"];
  }
  return CONTENT["en-US"];
}

type WelcomeCanvasClient = {
  getCanvas: typeof getCanvas;
  setCanvas: typeof setCanvas;
};

/** Seed localized Welcome notes without overwriting anything the owner wrote. */
export async function ensureWelcomeCanvas(
  channelId: string,
  locale: string | null | undefined,
  client: WelcomeCanvasClient = { getCanvas, setCanvas },
) {
  const existing = await client.getCanvas(channelId);
  if (existing.updatedAt != null || existing.author != null) return false;

  await client.setCanvas({
    channelId,
    content: welcomeCanvasContent(locale),
  });
  return true;
}
