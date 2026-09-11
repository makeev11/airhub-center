import { AlertTriangle } from "lucide-react";

import {
  agentRequestStatusAction,
  type AgentRequestStatusPayload,
} from "@/shared/lib/agentRequestStatus";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";
import { AIRHOP_AGENT_CATALOG } from "@/features/airhop-agents/model/airhopAgentCatalog";
import {
  Attachment,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/shared/ui/attachment";

type Copy = { action: string; description: string; title: string };

export function agentRequestStatusCopy(
  status: AgentRequestStatusPayload,
  locale: AirHopLocale,
): Copy {
  const agent = AIRHOP_AGENT_CATALOG.find(
    (candidate) => candidate.role === status.target_role,
  );
  const name = agent?.name[locale] ?? status.target_role;
  const action =
    agentRequestStatusAction(status.reason) === "channel_members"
      ? {
          "en-US": "Review members →",
          "pt-BR": "Revisar membros →",
          "ru-RU": "Проверить участников →",
          "tr-TR": "Üyeleri kontrol et →",
        }[locale]
      : {
          "en-US": "Open agent settings →",
          "pt-BR": "Abrir configurações →",
          "ru-RU": "Открыть настройки →",
          "tr-TR": "Aracı ayarlarını aç →",
        }[locale];
  const descriptions: Record<
    AgentRequestStatusPayload["reason"],
    Record<AirHopLocale, string>
  > = {
    agent_disabled: {
      "en-US": "The agent is disabled. Enable it before trying again.",
      "pt-BR": "O agente está desativado. Ative-o antes de tentar novamente.",
      "ru-RU": "Агент выключен. Включите его и повторите запрос.",
      "tr-TR": "Aracı devre dışı. Yeniden denemeden önce etkinleştirin.",
    },
    agent_not_in_channel: {
      "en-US": "Add the agent to the channel or message it directly.",
      "pt-BR": "Adicione o agente ao canal ou envie uma mensagem direta.",
      "ru-RU": "Добавьте агента в канал или напишите ему в личные сообщения.",
      "tr-TR": "Aracıyı kanala ekleyin veya doğrudan mesaj gönderin.",
    },
    external_readers: {
      "en-US":
        "An external participant can read the channel. Review its members or use a direct message.",
      "pt-BR":
        "Um participante externo pode ler o canal. Revise os membros ou use uma mensagem direta.",
      "ru-RU":
        "Канал доступен внешнему участнику. Проверьте участников или используйте личные сообщения.",
      "tr-TR":
        "Harici bir katılımcı kanalı okuyabilir. Üyeleri kontrol edin veya doğrudan mesaj kullanın.",
    },
    policy_denied: {
      "en-US": "Current settings do not allow replies on this surface.",
      "pt-BR": "As configurações atuais não permitem respostas neste canal.",
      "ru-RU": "Текущие настройки не разрешают ответы в этом канале.",
      "tr-TR": "Mevcut ayarlar bu kanalda yanıta izin vermiyor.",
    },
  };
  const title = {
    "en-US": `${name} could not reply`,
    "pt-BR": `${name} não pôde responder`,
    "ru-RU": `${name} не смог ответить`,
    "tr-TR": `${name} yanıt veremedi`,
  }[locale];
  return { action, description: descriptions[status.reason][locale], title };
}

export function AgentRequestStatusCard({
  locale,
  onOpenAgentSettings,
  onOpenChannelMembers,
  status,
}: {
  locale: AirHopLocale;
  onOpenAgentSettings: () => void;
  onOpenChannelMembers: (channelId: string) => void;
  status: AgentRequestStatusPayload;
}) {
  const copy = agentRequestStatusCopy(status, locale);
  const handleOpen = () => {
    if (agentRequestStatusAction(status.reason) === "channel_members") {
      onOpenChannelMembers(status.source_channel_id);
    } else {
      onOpenAgentSettings();
    }
  };
  return (
    <Attachment
      className="max-w-[min(100%,32rem)] shrink-0 cursor-pointer shadow-none hover:shadow-sm"
      orientation="horizontal"
      state="error"
    >
      <AttachmentMedia className="text-destructive">
        <AlertTriangle aria-hidden="true" />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle className="whitespace-normal text-destructive">
          {copy.title}
        </AttachmentTitle>
        <AttachmentDescription className="whitespace-normal">
          {copy.description}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions className="items-end self-end">
        <span className="text-xs text-muted-foreground">{copy.action}</span>
      </AttachmentActions>
      <AttachmentTrigger aria-label={copy.action} onClick={handleOpen} />
    </Attachment>
  );
}
