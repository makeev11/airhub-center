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
import { getWhatsAppOwnMetaSetupCopy } from "./whatsappOwnMetaSetupCopy";

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
  const copy = getWhatsAppOwnMetaSetupCopy(locale);
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
      setValidationError(copy.invalidFields);
      return;
    }
    setValidationError(undefined);
    setPending(true);
    try {
      const connected = await onConnect({ ...normalized, routing });
      setResult(connected);
      setFields(EMPTY_FIELDS);
      setStep(3);
      toast.success(copy.credentialsReady);
    } catch {
      toast.error(copy.connectFailed);
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
      toast.success(copy.activated);
    } catch {
      toast.error(copy.subscriptionFailed);
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
            <DialogTitle>{copy.title}</DialogTitle>
          </div>
          <DialogDescription>{copy.description}</DialogDescription>
          <StepProgress className="pt-2" currentStep={step} totalSteps={3} />
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-5">
            <Alert>
              <ShieldCheck className="mb-2 size-5 text-emerald-600" />
              <AlertTitle>{copy.numberOwnership}</AlertTitle>
              <AlertDescription>
                {copy.numberOwnershipDescription}
              </AlertDescription>
            </Alert>

            <ol className="space-y-4">
              <NumberedStep number={1} title={copy.createApp}>
                {copy.createAppDescription}
                <div className="mt-1">
                  <SetupLink href={META_APPS_URL}>{copy.openMeta}</SetupLink>
                </div>
              </NumberedStep>
              <NumberedStep number={2} title={copy.addNumber}>
                {copy.numberDescription}
              </NumberedStep>
              <NumberedStep number={3} title={copy.createToken}>
                {copy.createTokenDescription}
                <div className="mt-1">
                  <SetupLink href={META_SYSTEM_USERS_URL}>
                    {copy.openSystemUsers}
                  </SetupLink>
                </div>
              </NumberedStep>
            </ol>

            <div className="rounded-xl border p-4 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">
                {copy.importantNumber}
              </p>
              <p className="mt-1">{copy.coexistenceDescription}</p>
              <p className="mt-2">{copy.partnerNumberDescription}</p>
              <div className="mt-2">
                <SetupLink href={META_CLOUD_API_URL}>
                  {copy.cloudApiDocumentation}
                </SetupLink>
              </div>
              <p className="mt-3">{copy.pricingDescription}</p>
              <div className="mt-1">
                <SetupLink href={META_PRICING_URL}>
                  {copy.currentPricing}
                </SetupLink>
              </div>
            </div>

            {!available ? (
              <Alert variant="destructive">
                <AlertTitle>{copy.unavailableTitle}</AlertTitle>
                <AlertDescription>
                  {copy.unavailableDescription}
                </AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                {copy.close}
              </Button>
              <Button
                disabled={!available}
                onClick={() => setStep(2)}
                type="button"
              >
                {copy.haveCredentials}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === 2 ? (
          <form className="space-y-5" onSubmit={submit}>
            <ConnectionRoutingFields
              disabled={pending}
              locale={locale}
              onChange={setRouting}
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
                hint={copy.phoneNumberHint}
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
              hint={copy.accessTokenHint}
              id="airhop-whatsapp-access-token"
              label="System User Access Token"
              maxLength={4096}
              onChange={(value) => updateField("accessToken", value)}
              placeholder="••••••••••••••••"
              value={fields.accessToken}
            />
            <Alert>
              <KeyRound className="mb-2 size-5 text-primary" />
              <AlertTitle>{copy.secretTitle}</AlertTitle>
              <AlertDescription>{copy.secretDescription}</AlertDescription>
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
                {copy.back}
              </Button>
              <Button disabled={pending} type="submit">
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ShieldCheck />
                )}
                {pending ? copy.checkingCredentials : copy.verifyAndSave}
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {step === 3 && result ? (
          <div className="space-y-5">
            <Alert>
              <AlertTitle>
                {copy.metaConfirmed(result.meta.displayPhoneNumber)}
              </AlertTitle>
              <AlertDescription>{copy.webhookDescription}</AlertDescription>
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
              {copy.webhookSteps.map((instruction) => (
                <li key={instruction}>{instruction}</li>
              ))}
            </ol>
            {activated ? (
              <Alert>
                <Check className="mb-2 size-5 text-emerald-600" />
                <AlertTitle>{copy.connectionCreated}</AlertTitle>
                <AlertDescription>
                  {copy.connectionCreatedDescription}
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
                {copy.close}
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
                  {pending ? copy.checkingSubscription : copy.webhookSaved}
                </Button>
              ) : (
                <Button onClick={() => onOpenChange(false)} type="button">
                  {copy.done}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
