import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";

const copy = {
  "ru-RU": {
    loading: "Проверяем подключение Гермеса…",
    error:
      "Не удалось проверить подключение Гермеса. Знакомство продолжится после восстановления связи.",
    missing:
      "Гермес ещё не подключён. Подключите его в разделе «AI-агенты», чтобы завершить знакомство с командой.",
    paused:
      "Гермес выключен или приостановлен. Включите его в разделе «AI-агенты», чтобы продолжить знакомство.",
    waiting:
      "Ждём представления Гермеса. Если ответа нет, проверьте его подключение в разделе «AI-агенты». Уже пройденные шаги сохранены.",
    retry: "Проверить снова",
  },
  "en-US": {
    loading: "Checking the Hermes connection…",
    error:
      "Could not check the Hermes connection. Introductions will resume when the connection is restored.",
    missing:
      "Hermes is not connected yet. Connect him in AI agents to finish meeting the team.",
    paused:
      "Hermes is disabled or paused. Enable him in AI agents to continue introductions.",
    waiting:
      "Waiting for Hermes to introduce himself. If there is no reply, check his connection in AI agents. Completed steps are saved.",
    retry: "Check again",
  },
  "pt-BR": {
    loading: "Verificando a conexão do Hermes…",
    error:
      "Não foi possível verificar a conexão do Hermes. As apresentações continuarão quando a conexão for restabelecida.",
    missing:
      "O Hermes ainda não está conectado. Conecte-o em Agentes de IA para concluir as apresentações.",
    paused:
      "O Hermes está desativado ou pausado. Ative-o em Agentes de IA para continuar.",
    waiting:
      "Aguardando a apresentação do Hermes. Se não houver resposta, verifique a conexão em Agentes de IA. As etapas concluídas estão salvas.",
    retry: "Verificar novamente",
  },
  "tr-TR": {
    loading: "Hermes bağlantısı kontrol ediliyor…",
    error:
      "Hermes bağlantısı kontrol edilemedi. Bağlantı yeniden kurulduğunda tanışma devam edecek.",
    missing:
      "Hermes henüz bağlı değil. Ekiple tanışmayı tamamlamak için Yapay zekâ ajanları bölümünden bağlayın.",
    paused:
      "Hermes devre dışı veya duraklatılmış. Tanışmaya devam etmek için Yapay zekâ ajanları bölümünden etkinleştirin.",
    waiting:
      "Hermes'in kendini tanıtması bekleniyor. Yanıt gelmezse Yapay zekâ ajanları bölümünde bağlantısını kontrol edin. Tamamlanan adımlar kaydedildi.",
    retry: "Tekrar kontrol et",
  },
};

/** Connection state belongs to the UI, never to the customer's conversation. */
export function WelcomeGuestStatus({
  status,
  onRetry,
}: {
  status: "loading" | "error" | "missing" | "paused" | "waiting" | null;
  onRetry: () => void;
}) {
  const locale = useAirHopLocale();
  const text = copy[locale as keyof typeof copy] ?? copy["en-US"];
  if (!status) return null;
  return (
    <div
      role="status"
      className="mx-4 my-2 rounded-lg border border-border p-3 text-sm"
    >
      <p>{text[status]}</p>
      {status !== "loading" && (
        <button
          type="button"
          className="mt-2 underline underline-offset-4"
          onClick={onRetry}
        >
          {text.retry}
        </button>
      )}
    </div>
  );
}
