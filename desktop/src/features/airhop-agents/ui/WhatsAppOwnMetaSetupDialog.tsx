import {
  ArrowLeft,
  Check,
  ClipboardCopy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import type {
  AirhopWhatsAppCloudConnection,
  ConnectAirhopWhatsAppCloud,
  ConnectionRouting,
} from "@/features/airhop-agents/data/airhopControlPlane";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { StepProgress } from "@/shared/ui/step-progress";

import { ConnectionRoutingFields } from "./ConnectionRoutingFields";

type Props = {
  available: boolean;
  onActivate: (connectionId: string) => Promise<void>;
  onConnect: (
    input: ConnectAirhopWhatsAppCloud,
  ) => Promise<AirhopWhatsAppCloudConnection>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const META_APPS_URL = "https://developers.facebook.com/apps/";
const META_SYSTEM_USERS_URL =
  "https://business.facebook.com/settings/system-users/";
const META_CLOUD_API_URL =
  "https://developers.facebook.com/docs/whatsapp/cloud-api/";
const META_PRICING_URL =
  "https://whatsappbusiness.com/products/platform-pricing/";

type SecretFields = {
  accessToken: string;
  appId: string;
  appSecret: string;
  phoneNumberId: string;
  wabaId: string;
};

const EMPTY_FIELDS: SecretFields = {
  accessToken: "",
  appId: "",
  appSecret: "",
  phoneNumberId: "",
  wabaId: "",
};

function SetupLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
      <ExternalLink className="size-3.5" />
    </a>
  );
}

function NumberedStep({
  children,
  number,
  title,
}: {
  children: React.ReactNode;
  number: number;
  title: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {number}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">
          {children}
        </div>
      </div>
    </li>
  );
}

function SecretField({
  autoFocus,
  disabled,
  hint,
  id,
  label,
  maxLength,
  onChange,
  placeholder,
  secret = true,
  value,
}: {
  autoFocus?: boolean;
  disabled: boolean;
  hint?: string;
  id: string;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  placeholder: string;
  secret?: boolean;
  value: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium" htmlFor={id}>
      {label}
      <Input
        autoCapitalize="none"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        id={id}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        type={secret ? "password" : "text"}
        value={value}
      />
      {hint ? (
        <span className="text-xs font-normal leading-5 text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
        <code className="min-w-0 flex-1 select-all break-all text-xs">
          {value}
        </code>
        <Button
          aria-label={`${label}: copy`}
          onClick={() => void copy()}
          size="icon"
          type="button"
          variant="outline"
        >
          {copied ? <Check /> : <ClipboardCopy />}
        </Button>
      </div>
    </div>
  );
}

export function WhatsAppOwnMetaSetupDialog({
  available,
  onActivate,
  onConnect,
  onOpenChange,
  open,
}: Props) {
  const locale = useAirHopLocale();
  const ru = locale.startsWith("ru");
  const [step, setStep] = React.useState(1);
  const [fields, setFields] = React.useState<SecretFields>(EMPTY_FIELDS);
  const [routing, setRouting] = React.useState<ConnectionRouting>({
    branchId: null,
    buzzChannelId: null,
  });
  const [result, setResult] = React.useState<AirhopWhatsAppCloudConnection>();
  const [pending, setPending] = React.useState(false);
  const [activated, setActivated] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string>();

  React.useEffect(() => {
    if (open) return;
    setStep(1);
    setFields(EMPTY_FIELDS);
    setRouting({ branchId: null, buzzChannelId: null });
    setResult(undefined);
    setPending(false);
    setActivated(false);
    setValidationError(undefined);
  }, [open]);

  const updateField = (key: keyof SecretFields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value.trim()]),
    ) as SecretFields;
    if (
      !/^\d{5,40}$/.test(normalized.appId) ||
      !/^\d{5,40}$/.test(normalized.wabaId) ||
      !/^\d{5,40}$/.test(normalized.phoneNumberId) ||
      normalized.appSecret.length < 16 ||
      normalized.accessToken.length < 16
    ) {
      setValidationError(
        ru
          ? "Проверьте все пять значений. App ID, WABA ID и Phone Number ID состоят только из цифр."
          : "Check all five values. App ID, WABA ID, and Phone Number ID contain digits only.",
      );
      return;
    }
    setValidationError(undefined);
    setPending(true);
    try {
      const connected = await onConnect({ ...normalized, routing });
      setResult(connected);
      setFields(EMPTY_FIELDS);
      setStep(3);
      toast.success(
        ru
          ? "Meta подтвердила номер. Осталось сохранить webhook."
          : "Meta confirmed the number. Save the webhook to finish.",
      );
    } catch {
      toast.error(
        ru
          ? "Не удалось проверить реквизиты в Meta. Проверьте токен, разрешения и ID."
          : "Meta credentials could not be verified. Check the token, permissions, and IDs.",
      );
    } finally {
      setPending(false);
    }
  };

  const activate = async () => {
    if (!result) return;
    setPending(true);
    try {
      await onActivate(result.connection.id);
      setActivated(true);
      toast.success(
        ru
          ? "Приложение подписано. Отправьте тестовое сообщение на номер центра."
          : "The app is subscribed. Send a test message to the center number.",
      );
    } catch {
      toast.error(
        ru
          ? "Meta не подтвердила подписку. Проверьте, что Callback URL сохранён и поле messages включено."
          : "Meta did not confirm the subscription. Check the Callback URL and messages field.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto"
        data-testid="airhop-add-whatsapp-dialog"
      >
        <DialogHeader>
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <MessageCircle className="size-5" />
            <DialogTitle>
              {ru ? "Подключить WhatsApp" : "Connect WhatsApp"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {ru
              ? "Официальный WhatsApp Cloud API через собственное Meta-приложение центра."
              : "Official WhatsApp Cloud API through the center's own Meta app."}
          </DialogDescription>
          <StepProgress className="pt-2" currentStep={step} totalSteps={3} />
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-5">
            <Alert>
              <ShieldCheck className="mb-2 size-5 text-emerald-600" />
              <AlertTitle>
                {ru
                  ? "Приложение и номер принадлежат вашему центру"
                  : "The app and number belong to your center"}
              </AlertTitle>
              <AlertDescription>
                {ru
                  ? "Для этого режима не нужен App Review приложения AirHop. Meta всё равно может запросить проверку бизнеса, имени и способ оплаты."
                  : "This mode does not require AirHop App Review. Meta may still require business, display-name, and billing checks."}
              </AlertDescription>
            </Alert>

            <ol className="space-y-4">
              <NumberedStep
                number={1}
                title={ru ? "Создайте приложение Meta" : "Create a Meta app"}
              >
                {ru
                  ? "Выберите сценарий WhatsApp Business Messaging и Business Portfolio этого центра."
                  : "Choose the WhatsApp Business Messaging use case and this center's Business Portfolio."}
                <div className="mt-1">
                  <SetupLink href={META_APPS_URL}>
                    {ru
                      ? "Открыть Meta for Developers"
                      : "Open Meta for Developers"}
                  </SetupLink>
                </div>
              </NumberedStep>
              <NumberedStep
                number={2}
                title={
                  ru
                    ? "Добавьте и подтвердите номер"
                    : "Add and verify the number"
                }
              >
                {ru
                  ? "В WhatsApp → API Setup создайте или выберите WABA, добавьте номер и пройдите SMS или голосовую проверку. Сохраните WABA ID и Phone Number ID."
                  : "In WhatsApp → API Setup choose a WABA, add the number, complete SMS or voice verification, and save the WABA ID and Phone Number ID."}
              </NumberedStep>
              <NumberedStep
                number={3}
                title={
                  ru
                    ? "Создайте постоянный System User Token"
                    : "Create a permanent System User Token"
                }
              >
                {ru
                  ? "Назначьте системному пользователю приложение и WABA. Добавьте whatsapp_business_management и whatsapp_business_messaging."
                  : "Assign the app and WABA to a system user. Add whatsapp_business_management and whatsapp_business_messaging."}
                <div className="mt-1">
                  <SetupLink href={META_SYSTEM_USERS_URL}>
                    {ru ? "Открыть System Users" : "Open System Users"}
                  </SetupLink>
                </div>
              </NumberedStep>
            </ol>

            <div className="rounded-xl border p-4 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">
                {ru ? "Важно про номер" : "Important number note"}
              </p>
              <p className="mt-1">
                {ru
                  ? "Если Meta не предлагает официальный coexistence, номер нужно удалить из мобильного WhatsApp перед регистрацией в Cloud API. Не используйте неофициальное QR-подключение."
                  : "If Meta does not offer official coexistence, remove the number from mobile WhatsApp before Cloud API registration. Do not use unofficial QR integrations."}
              </p>
              <p className="mt-2">
                {ru
                  ? "Для каждого номера партнёрского центра создавайте отдельное Meta-приложение. Номер поддержки AirHub HQ остаётся в своём подключении и здесь не меняется."
                  : "Create a separate Meta app for every partner-center number. The AirHub HQ support number stays in its own connection and is not changed here."}
              </p>
              <div className="mt-2">
                <SetupLink href={META_CLOUD_API_URL}>
                  {ru
                    ? "Официальная документация Cloud API"
                    : "Cloud API documentation"}
                </SetupLink>
              </div>
              <p className="mt-3">
                {ru
                  ? "У подтверждённого номера нет пробного срока. Service-ответы внутри 24-часового окна бесплатны; остальные сообщения могут тарифицироваться Meta по рынку и категории."
                  : "A verified number has no trial cutoff. Service replies in the 24-hour window are free; other messages may be charged by Meta based on market and category."}
              </p>
              <div className="mt-1">
                <SetupLink href={META_PRICING_URL}>
                  {ru ? "Актуальные тарифы Meta" : "Current Meta pricing"}
                </SetupLink>
              </div>
            </div>

            {!available ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {ru
                    ? "Приём реквизитов ещё не включён на этом сервере"
                    : "Credential intake is not enabled on this server"}
                </AlertTitle>
                <AlertDescription>
                  {ru
                    ? "Инструкцию уже можно выполнить до получения ID и токена. Продолжение станет доступно после настройки официального WhatsApp Gateway."
                    : "You can complete the Meta steps now. The form will unlock when the official WhatsApp Gateway is configured."}
                </AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                {ru ? "Закрыть" : "Close"}
              </Button>
              <Button
                disabled={!available}
                onClick={() => setStep(2)}
                type="button"
              >
                {ru ? "У меня есть реквизиты" : "I have the credentials"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === 2 ? (
          <form className="space-y-5" onSubmit={submit}>
            <ConnectionRoutingFields
              disabled={pending}
              onChange={setRouting}
              ru={ru}
              value={routing}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SecretField
                autoFocus
                disabled={pending}
                id="airhop-whatsapp-app-id"
                label="App ID"
                maxLength={40}
                onChange={(value) => updateField("appId", value)}
                placeholder="123456789012345"
                secret={false}
                value={fields.appId}
              />
              <SecretField
                disabled={pending}
                id="airhop-whatsapp-app-secret"
                label="App Secret"
                maxLength={512}
                onChange={(value) => updateField("appSecret", value)}
                placeholder="••••••••••••••••"
                value={fields.appSecret}
              />
              <SecretField
                disabled={pending}
                id="airhop-whatsapp-waba-id"
                label="WhatsApp Business Account ID"
                maxLength={40}
                onChange={(value) => updateField("wabaId", value)}
                placeholder="123456789012345"
                secret={false}
                value={fields.wabaId}
              />
              <SecretField
                disabled={pending}
                hint={
                  ru
                    ? "Не сам номер +55…, а цифровой Phone Number ID из API Setup."
                    : "Use the numeric Phone Number ID from API Setup, not the +55… phone number."
                }
                id="airhop-whatsapp-phone-number-id"
                label="Phone Number ID"
                maxLength={40}
                onChange={(value) => updateField("phoneNumberId", value)}
                placeholder="123456789012345"
                secret={false}
                value={fields.phoneNumberId}
              />
            </div>
            <SecretField
              disabled={pending}
              hint={
                ru
                  ? "Используйте System User Token с двумя WhatsApp-разрешениями, а не временный токен из API Setup."
                  : "Use a System User Token with both WhatsApp permissions, not the temporary API Setup token."
              }
              id="airhop-whatsapp-access-token"
              label="System User Access Token"
              maxLength={4096}
              onChange={(value) => updateField("accessToken", value)}
              placeholder="••••••••••••••••"
              value={fields.accessToken}
            />
            <Alert>
              <KeyRound className="mb-2 size-5 text-primary" />
              <AlertTitle>
                {ru ? "Секреты передаются один раз" : "Secrets are sent once"}
              </AlertTitle>
              <AlertDescription>
                {ru
                  ? "AirHop проверит номер через Meta и сохранит App Secret и токен в зашифрованном хранилище. Они не появятся в сообщениях, логах или карточке канала."
                  : "AirHop verifies the number through Meta and stores the App Secret and token encrypted. They do not appear in messages, logs, or the channel card."}
              </AlertDescription>
            </Alert>
            {validationError ? (
              <p className="text-xs text-destructive">{validationError}</p>
            ) : null}
            <DialogFooter>
              <Button
                disabled={pending}
                onClick={() => setStep(1)}
                type="button"
                variant="outline"
              >
                <ArrowLeft />
                {ru ? "Назад" : "Back"}
              </Button>
              <Button disabled={pending} type="submit">
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ShieldCheck />
                )}
                {pending
                  ? ru
                    ? "Проверяем в Meta…"
                    : "Checking Meta…"
                  : ru
                    ? "Проверить и сохранить"
                    : "Verify and save"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {step === 3 && result ? (
          <div className="space-y-5">
            <Alert>
              <AlertTitle>
                {ru
                  ? `Meta подтвердила ${result.meta.displayPhoneNumber}`
                  : `Meta confirmed ${result.meta.displayPhoneNumber}`}
              </AlertTitle>
              <AlertDescription>
                {ru
                  ? "Теперь сохраните webhook в WhatsApp → Configuration этого же Meta-приложения."
                  : "Now save the webhook under WhatsApp → Configuration in the same Meta app."}
              </AlertDescription>
            </Alert>
            <CopyValue
              label="Callback URL"
              value={result.webhook.callbackUrl}
            />
            <CopyValue
              label="Verify Token"
              value={result.webhook.verifyToken}
            />
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              <li>
                {ru
                  ? "Откройте WhatsApp → Configuration и нажмите Edit в блоке webhook."
                  : "Open WhatsApp → Configuration and click Edit in the webhook block."}
              </li>
              <li>
                {ru
                  ? "Вставьте оба значения, нажмите Verify and save."
                  : "Paste both values and click Verify and save."}
              </li>
              <li>
                {ru
                  ? "В Manage включите поле messages."
                  : "Enable the messages field under Manage."}
              </li>
              <li>
                {ru
                  ? "Вернитесь сюда и подтвердите сохранение."
                  : "Return here and confirm that you saved it."}
              </li>
            </ol>
            {activated ? (
              <Alert>
                <Check className="mb-2 size-5 text-emerald-600" />
                <AlertTitle>
                  {ru ? "Подключение создано" : "Connection created"}
                </AlertTitle>
                <AlertDescription>
                  {ru
                    ? "Напишите на номер центра с другого WhatsApp. Карточка станет «Работает» после первого успешного heartbeat адаптера."
                    : "Message the center number from another WhatsApp account. The card becomes Working after the adapter's first successful heartbeat."}
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button
                disabled={pending}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                {ru ? "Закрыть" : "Close"}
              </Button>
              {!activated ? (
                <Button
                  disabled={pending}
                  onClick={() => void activate()}
                  type="button"
                >
                  {pending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  {pending
                    ? ru
                      ? "Проверяем подписку…"
                      : "Checking subscription…"
                    : ru
                      ? "Я сохранил webhook"
                      : "I saved the webhook"}
                </Button>
              ) : (
                <Button onClick={() => onOpenChange(false)} type="button">
                  {ru ? "Готово" : "Done"}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
