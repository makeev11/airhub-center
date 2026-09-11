import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChannelsQuery } from "@/features/channels/hooks";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { AirhopControlPlaneClient } from "../data/airhopControlPlane";
import {
  analyticsSectionSchema,
  type AgentPolicy,
  type AgentPolicyEntry,
} from "../model/agentPolicy";
import { agentProcedureCopy } from "./agentProcedureCopy";

const COPY = {
  "ru-RU": {
    title: "Обязанности и расписание",
    save: "Сохранить",
    saved: "Сохранено",
    reset: "Загрузить актуальные настройки",
    error:
      "Не удалось сохранить. Проверьте настройки или загрузите актуальную версию.",
    enabled: "Разрешить работу агента",
    birthdays: "Напоминать о днях рождения",
    today: "В день рождения",
    advance: "За сколько дней предупредить заранее",
    time: "Время отправки",
    destination: "Куда отправлять",
    branches: "В канал каждого филиала",
    unavailableChannel: "Канал недоступен — выберите другой",
    analyticsDefault: "Канал аналитики центра",
    reports: "Регулярная аналитика",
    cadence: "Как часто",
    daily: "Каждый день",
    weekly: "По понедельникам",
    website: "Разрешить изменения контента сайта",
    confirmation:
      "Агент готовит предложение. Публикация требует подтверждения сотрудником с соответствующими правами.",
    readonly:
      "Сотрудники могут обращаться к агенту. Менять обязанности могут владелец и администраторы.",
    sections: {
      bookings: "Записи и результаты обращений",
      payments: "Оплаты и задолженность",
      attendance: "Посещаемость",
      capacity: "Заполняемость занятий",
      acquisition: "Источники новых обращений",
    },
    birthdayExample:
      "Пример: «Через два дня у Анны день рождения — 7 лет. Сегодня поздравляем Платона — 6 лет». В сообщение попадут только актуальные данные детей этого филиала.",
    leap: "Для 29 февраля в невисокосный год используется 28 февраля.",
    learning: "Улучшение рабочих навыков",
    off: "Выключено",
    observe: "Собирать опыт для рассмотрения",
    validated: "Использовать подтверждённые варианты",
    learningHelp:
      "Версии навыков и результаты проверок сохраняются. Обучение не изменяет права доступа и настройки центра.",
  },
  "en-US": {
    title: "Duties and schedule",
    save: "Save",
    saved: "Saved",
    reset: "Load current settings",
    error: "Could not save. Check the settings or load the current version.",
    enabled: "Allow this agent to work",
    birthdays: "Birthday reminders",
    today: "On the birthday",
    advance: "Days of advance notice",
    time: "Delivery time",
    destination: "Destination",
    branches: "Each branch's staff channel",
    unavailableChannel: "Channel unavailable — choose another",
    analyticsDefault: "Center analytics channel",
    reports: "Regular analytics",
    cadence: "Frequency",
    daily: "Every day",
    weekly: "On Mondays",
    website: "Allow website content changes",
    confirmation:
      "The agent prepares a proposal. Publication requires confirmation by authorized staff.",
    readonly:
      "Staff can talk to the agent. Owners and administrators manage its duties.",
    sections: {
      bookings: "Bookings and enquiry outcomes",
      payments: "Payments and outstanding balances",
      attendance: "Attendance",
      capacity: "Class occupancy",
      acquisition: "Acquisition sources",
    },
    birthdayExample:
      "Example: “Anna turns 7 in two days. Today Plato turns 6.” Messages use current records for children in this branch.",
    leap: "February 29 birthdays use February 28 in non-leap years.",
    learning: "Improve working skills",
    off: "Off",
    observe: "Collect experience and evaluate proposals",
    validated: "Use administrator-reviewed procedures",
    learningHelp:
      "Skill versions and evaluations are retained. Learning cannot change permissions or center settings.",
  },
  "pt-BR": {
    title: "Funções e horários",
    save: "Salvar",
    saved: "Salvo",
    reset: "Carregar configurações atuais",
    error:
      "Não foi possível salvar. Confira as configurações ou carregue a versão atual.",
    enabled: "Permitir que o agente trabalhe",
    birthdays: "Lembretes de aniversário",
    today: "No dia do aniversário",
    advance: "Dias de antecedência",
    time: "Horário de envio",
    destination: "Destino",
    branches: "Canal da equipe de cada unidade",
    unavailableChannel: "Canal indisponível — escolha outro",
    analyticsDefault: "Canal de análise do centro",
    reports: "Análises regulares",
    cadence: "Frequência",
    daily: "Todos os dias",
    weekly: "Às segundas-feiras",
    website: "Permitir alterações no conteúdo do site",
    confirmation:
      "O agente prepara uma proposta. A publicação exige confirmação de um funcionário autorizado.",
    readonly:
      "A equipe pode conversar com o agente. Proprietários e administradores gerenciam suas funções.",
    sections: {
      bookings: "Reservas e resultados dos contatos",
      payments: "Pagamentos e valores em aberto",
      attendance: "Presença",
      capacity: "Ocupação das aulas",
      acquisition: "Origens dos contatos",
    },
    birthdayExample:
      "Exemplo: “Ana fará 7 anos em dois dias. Hoje Platão faz 6.” As mensagens usam os dados atuais das crianças desta unidade.",
    leap: "Aniversários de 29 de fevereiro usam 28 de fevereiro nos anos não bissextos.",
    learning: "Melhorar habilidades de trabalho",
    off: "Desativado",
    observe: "Coletar experiência e avaliar propostas",
    validated: "Usar procedimentos aprovados",
    learningHelp:
      "Versões e avaliações são preservadas. O aprendizado não altera permissões nem configurações do centro.",
  },
  "tr-TR": {
    title: "Görevler ve zamanlama",
    save: "Kaydet",
    saved: "Kaydedildi",
    reset: "Güncel ayarları yükle",
    error: "Kaydedilemedi. Ayarları kontrol edin veya güncel sürümü yükleyin.",
    enabled: "Temsilcinin çalışmasına izin ver",
    birthdays: "Doğum günü hatırlatmaları",
    today: "Doğum gününde",
    advance: "Kaç gün önceden bildirilsin",
    time: "Gönderim saati",
    destination: "Hedef",
    branches: "Her şubenin personel kanalı",
    unavailableChannel: "Kanal kullanılamıyor — başka kanal seçin",
    analyticsDefault: "Merkezin analiz kanalı",
    reports: "Düzenli analiz",
    cadence: "Sıklık",
    daily: "Her gün",
    weekly: "Pazartesi günleri",
    website: "Site içeriği değişikliklerine izin ver",
    confirmation:
      "Temsilci bir öneri hazırlar. Yayın için yetkili personelin onayı gerekir.",
    readonly:
      "Personel temsilciyle konuşabilir. Görevleri sahip ve yöneticiler düzenler.",
    sections: {
      bookings: "Kayıtlar ve başvuru sonuçları",
      payments: "Ödemeler ve borçlar",
      attendance: "Katılım",
      capacity: "Ders doluluk oranı",
      acquisition: "Başvuru kaynakları",
    },
    birthdayExample:
      "Örnek: “Anna iki gün sonra 7 yaşına giriyor. Platon bugün 6 yaşına giriyor.” Mesajlarda bu şubenin güncel çocuk kayıtları kullanılır.",
    leap: "Artık olmayan yıllarda 29 Şubat doğum günleri 28 Şubat olarak alınır.",
    learning: "Çalışma becerilerini geliştir",
    off: "Kapalı",
    observe: "Deneyim topla ve önerileri değerlendir",
    validated: "Onaylanmış yöntemleri kullan",
    learningHelp:
      "Beceri sürümleri ve değerlendirmeler saklanır. Öğrenme izinleri veya merkez ayarlarını değiştirmez.",
  },
};

const fieldClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

export function AgentDutySettings({
  entry,
  canManage,
  communityId,
  relayUrl,
  timeZone,
  showMaster = true,
}: {
  entry: AgentPolicyEntry;
  canManage: boolean;
  communityId: string;
  relayUrl: string;
  timeZone: string | null;
  showMaster?: boolean;
}) {
  const locale = useAirHopLocale();
  const copy = COPY[locale];
  const procedureCopy = agentProcedureCopy[locale];
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [baseline, setBaseline] = React.useState(entry);
  const [draft, setDraft] = React.useState(entry.policy);
  const [pending, setPending] = React.useState(false);
  const [status, setStatus] = React.useState<"saved" | "error" | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline.policy);
  React.useEffect(() => {
    if (
      !dirty &&
      !pending &&
      entry.version >= baseline.version &&
      JSON.stringify(entry) !== JSON.stringify(baseline)
    ) {
      setBaseline(entry);
      setDraft(entry.policy);
    }
  }, [entry, baseline, dirty, pending]);
  const channels = useChannelsQuery({ enabled: open });
  const choices = (channels.data ?? []).filter(
    (channel) =>
      channel.channelType === "stream" &&
      channel.visibility === "private" &&
      !channel.archivedAt,
  );
  const client = React.useMemo(() => {
    const url = new URL(relayUrl);
    url.protocol =
      url.protocol === "wss:"
        ? "https:"
        : url.protocol === "ws:"
          ? "http:"
          : url.protocol;
    return new AirhopControlPlaneClient({
      relayHttpUrl: async () => url.origin,
    });
  }, [relayUrl]);
  function change(next: AgentPolicy) {
    setDraft(next);
    setStatus(null);
  }
  async function save() {
    setPending(true);
    setStatus(null);
    try {
      const result = await client.saveAgentPolicy(communityId, {
        ...baseline,
        policy: draft,
      });
      setBaseline(result);
      setDraft(result.policy);
      setStatus("saved");
      await queryClient.invalidateQueries({
        queryKey: ["airhop-principal-directory"],
      });
    } catch {
      setStatus("error");
    } finally {
      setPending(false);
    }
  }
  async function activateProcedure(id: string | null) {
    setPending(true);
    setStatus(null);
    try {
      await client.activateAgentProcedure(
        communityId,
        entry.role,
        id,
        entry.procedures?.version ?? 0,
      );
      await queryClient.invalidateQueries({
        queryKey: ["airhop-principal-directory"],
      });
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setPending(false);
    }
  }
  const birthday = draft.birthdays;
  const analytics = draft.analytics;
  const schedule = birthday ?? analytics;
  const channel = birthday
    ? birthday.destination.mode === "channel"
      ? birthday.destination.channelId
      : "default"
    : (analytics?.channelId ?? "default");
  function setChannel(value: string) {
    if (birthday)
      change({
        ...draft,
        birthdays: {
          ...birthday,
          destination:
            value === "default"
              ? { mode: "branches" }
              : { mode: "channel", channelId: value },
        },
      });
    if (analytics)
      change({
        ...draft,
        analytics: {
          ...analytics,
          channelId: value === "default" ? null : value,
        },
      });
  }
  return (
    <details
      className="mt-5 border-t border-border/60 pt-4"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-testid={`agent-duty-settings-${entry.role}`}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {copy.title}
      </summary>
      <fieldset disabled={!canManage || pending} className="mt-4 space-y-4">
        {showMaster && (
          <Toggle
            label={copy.enabled}
            checked={draft.enabled}
            onChange={(enabled) => change({ ...draft, enabled })}
          />
        )}
        {birthday && (
          <>
            <Toggle
              label={copy.birthdays}
              checked={birthday.enabled}
              onChange={(enabled) =>
                change({ ...draft, birthdays: { ...birthday, enabled } })
              }
            />
            <Toggle
              label={copy.today}
              checked={birthday.today}
              onChange={(today) =>
                change({ ...draft, birthdays: { ...birthday, today } })
              }
            />
            <label className="block space-y-1 text-sm">
              <span>{copy.advance}</span>
              <input
                className={fieldClass}
                type="number"
                min={0}
                max={30}
                value={birthday.advanceDays}
                onChange={(event) =>
                  change({
                    ...draft,
                    birthdays: {
                      ...birthday,
                      advanceDays: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              {copy.birthdayExample} {copy.leap}
            </p>
          </>
        )}
        {analytics && (
          <>
            <Toggle
              label={copy.reports}
              checked={analytics.enabled}
              onChange={(enabled) =>
                change({ ...draft, analytics: { ...analytics, enabled } })
              }
            />
            {analyticsSectionSchema.options.map((section) => (
              <Toggle
                key={section}
                label={copy.sections[section]}
                checked={analytics.sections.includes(section)}
                onChange={(checked) =>
                  change({
                    ...draft,
                    analytics: {
                      ...analytics,
                      sections: checked
                        ? [...analytics.sections, section]
                        : analytics.sections.filter(
                            (value) => value !== section,
                          ),
                    },
                  })
                }
              />
            ))}
            <label className="block space-y-1 text-sm">
              <span>{copy.cadence}</span>
              <select
                className={fieldClass}
                value={
                  analytics.weekday === null
                    ? "daily"
                    : String(analytics.weekday)
                }
                onChange={(event) =>
                  change({
                    ...draft,
                    analytics: {
                      ...analytics,
                      weekday:
                        event.target.value === "daily"
                          ? null
                          : Number(event.target.value),
                    },
                  })
                }
              >
                <option value="daily">{copy.daily}</option>
                <option value="1">{copy.weekly}</option>
                {analytics.weekday !== null && analytics.weekday !== 1 && (
                  <option value={analytics.weekday}>{analytics.weekday}</option>
                )}
              </select>
            </label>
          </>
        )}
        {schedule && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>
                {copy.time}
                {timeZone ? ` · ${timeZone}` : ""}
              </span>
              <input
                className={fieldClass}
                type="time"
                value={`${String(schedule.time.hour).padStart(2, "0")}:${String(schedule.time.minute).padStart(2, "0")}`}
                onChange={(event) => {
                  const [hour, minute] = event.target.value
                    .split(":")
                    .map(Number);
                  if (!Number.isInteger(hour) || !Number.isInteger(minute))
                    return;
                  if (birthday)
                    change({
                      ...draft,
                      birthdays: { ...birthday, time: { hour, minute } },
                    });
                  if (analytics)
                    change({
                      ...draft,
                      analytics: { ...analytics, time: { hour, minute } },
                    });
                }}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{copy.destination}</span>
              <select
                className={fieldClass}
                value={channel}
                disabled={channels.isLoading || channels.isError}
                onChange={(event) => setChannel(event.target.value)}
              >
                <option value="default">
                  {birthday ? copy.branches : copy.analyticsDefault}
                </option>
                {choices.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name}
                  </option>
                ))}
                {channel !== "default" &&
                  !choices.some((value) => value.id === channel) && (
                    <option value={channel}>{copy.unavailableChannel}</option>
                  )}
              </select>
            </label>
          </div>
        )}
        {draft.content && (
          <>
            <Toggle
              label={copy.website}
              checked={draft.content.websiteEditing}
              onChange={(websiteEditing) =>
                change({ ...draft, content: { websiteEditing } })
              }
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {copy.confirmation}
            </p>
          </>
        )}
        <label className="block space-y-1 text-sm">
          <span>{copy.learning}</span>
          <select
            className={fieldClass}
            value={draft.learning}
            onChange={(event) =>
              change({
                ...draft,
                learning: event.target.value as AgentPolicy["learning"],
              })
            }
          >
            <option value="off">{copy.off}</option>
            <option value="observe">{copy.observe}</option>
            <option value="validated">{copy.validated}</option>
          </select>
        </label>
        <p className="text-xs leading-5 text-muted-foreground">
          {procedureCopy.help}
        </p>
        {entry.procedures && (
          <div className="space-y-2 text-sm">
            {entry.procedures.candidates.length > 0 && (
              <p className="font-medium">{procedureCopy.title}</p>
            )}
            {entry.procedures.candidates.map((candidate) => (
              <div
                key={candidate.id}
                className="rounded-lg border border-border/60 p-3"
              >
                <p>
                  {candidate.plan.sources
                    .map((source) => procedureCopy.sources[source])
                    .join(" → ")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {candidate.observations} {procedureCopy.observations}
                </p>
                {canManage && (
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    disabled={
                      dirty ||
                      draft.learning !== "validated" ||
                      candidate.observations < 3 ||
                      candidate.id === entry.procedures?.activeId
                    }
                    onClick={() => void activateProcedure(candidate.id)}
                  >
                    {candidate.id === entry.procedures?.activeId
                      ? procedureCopy.active
                      : procedureCopy.apply}
                  </Button>
                )}
              </div>
            ))}
            {entry.procedures.activeId && canManage && (
              <Button
                size="sm"
                variant="outline"
                disabled={dirty}
                onClick={() => void activateProcedure(null)}
              >
                {procedureCopy.rollback}
              </Button>
            )}
          </div>
        )}
        {canManage && (
          <Button
            size="sm"
            disabled={!dirty || pending}
            onClick={() => void save()}
          >
            {copy.save}
          </Button>
        )}
      </fieldset>
      {!canManage && (
        <p className="mt-3 text-xs text-muted-foreground">{copy.readonly}</p>
      )}
      {status && (
        <p
          role={status === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {copy[status]}
        </p>
      )}
      {status === "error" && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => {
            setBaseline(entry);
            setDraft(entry.policy);
            setStatus(null);
            void queryClient.invalidateQueries({
              queryKey: ["airhop-principal-directory"],
            });
          }}
        >
          {copy.reset}
        </Button>
      )}
    </details>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = React.useId();
  return (
    <label
      htmlFor={id}
      className="flex items-center justify-between gap-4 text-sm"
    >
      <span>{label}</span>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </label>
  );
}
