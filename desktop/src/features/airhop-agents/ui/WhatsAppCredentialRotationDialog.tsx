import { Check, ClipboardCopy, KeyRound, LoaderCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import type {
  AirhopChannelConnection,
  AirhopWhatsAppCloudCredentialRotation,
  RotateAirhopWhatsAppCloudCredential,
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

type Props = {
  connection: AirhopChannelConnection | null;
  onOpenChange: (open: boolean) => void;
  onRotate: (
    input: RotateAirhopWhatsAppCloudCredential,
  ) => Promise<AirhopWhatsAppCloudCredentialRotation>;
  open: boolean;
};

const COPY = {
  "ru-RU": {
    title: "Обновить доступ WhatsApp",
    description:
      "Замените App Secret, System User Token и Verify Token без удаления канала и истории.",
    app: "Meta App ID",
    appSecret: "Новый App Secret",
    accessToken: "Новый System User Token",
    hint: "Сначала выпустите новые значения в Meta. AirHop проверит токен и зашифрует замену; старые секреты больше не будут выдаваться gateway.",
    cancel: "Отмена",
    submit: "Проверить и заменить",
    pending: "Проверяем в Meta…",
    invalid: "Введите новый App Secret и постоянный System User Token.",
    failed:
      "Не удалось обновить доступ. Проверьте токен, права и актуальность карточки.",
    ready: "Реквизиты заменены",
    next: "Gateway автоматически перезапускает только это подключение. Теперь замените Callback URL и Verify Token в WhatsApp → Configuration, нажмите Verify and save и оставьте поле messages включённым.",
    close: "Готово",
  },
  "en-US": {
    title: "Update WhatsApp access",
    description:
      "Replace the App Secret, System User Token, and Verify Token without deleting the channel or its history.",
    app: "Meta App ID",
    appSecret: "New App Secret",
    accessToken: "New System User Token",
    hint: "Issue the replacements in Meta first. AirHop validates the token and encrypts the update; the old secrets are no longer served to the gateway.",
    cancel: "Cancel",
    submit: "Verify and replace",
    pending: "Checking Meta…",
    invalid: "Enter the new App Secret and permanent System User Token.",
    failed:
      "Access could not be updated. Check the token, permissions, and current card version.",
    ready: "Credentials replaced",
    next: "The gateway automatically restarts only this connection. Replace the Callback URL and Verify Token under WhatsApp → Configuration, click Verify and save, and keep the messages field subscribed.",
    close: "Done",
  },
  "pt-BR": {
    title: "Atualizar acesso do WhatsApp",
    description:
      "Substitua o App Secret, o System User Token e o Verify Token sem excluir o canal ou o histórico.",
    app: "Meta App ID",
    appSecret: "Novo App Secret",
    accessToken: "Novo System User Token",
    hint: "Gere os novos valores primeiro na Meta. O AirHop valida o token e criptografa a substituição; os segredos antigos deixam de ser enviados ao gateway.",
    cancel: "Cancelar",
    submit: "Verificar e substituir",
    pending: "Verificando na Meta…",
    invalid: "Informe o novo App Secret e o System User Token permanente.",
    failed:
      "Não foi possível atualizar o acesso. Verifique o token, as permissões e a versão atual do cartão.",
    ready: "Credenciais substituídas",
    next: "O gateway reinicia automaticamente apenas esta conexão. Substitua a Callback URL e o Verify Token em WhatsApp → Configuration, clique em Verify and save e mantenha o campo messages assinado.",
    close: "Concluir",
  },
  "tr-TR": {
    title: "WhatsApp erişimini güncelle",
    description:
      "Kanalı ve geçmişini silmeden App Secret, System User Token ve Verify Token değerlerini değiştirin.",
    app: "Meta App ID",
    appSecret: "Yeni App Secret",
    accessToken: "Yeni System User Token",
    hint: "Önce Meta'da yeni değerleri üretin. AirHop tokenı doğrular ve değişikliği şifreler; eski sırlar gateway'e artık verilmez.",
    cancel: "İptal",
    submit: "Doğrula ve değiştir",
    pending: "Meta kontrol ediliyor…",
    invalid: "Yeni App Secret ve kalıcı System User Token değerlerini girin.",
    failed:
      "Erişim güncellenemedi. Tokenı, izinleri ve kartın güncel sürümünü kontrol edin.",
    ready: "Kimlik bilgileri değiştirildi",
    next: "Gateway yalnızca bu bağlantıyı otomatik olarak yeniden başlatır. WhatsApp → Configuration altında Callback URL ve Verify Token değerlerini değiştirin, Verify and save'e tıklayın ve messages alanı aboneliğini açık bırakın.",
    close: "Bitti",
  },
} as const;

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

export function WhatsAppCredentialRotationDialog({
  connection,
  onOpenChange,
  onRotate,
  open,
}: Props) {
  const locale = useAirHopLocale();
  const copy = COPY[locale];
  const [appSecret, setAppSecret] = React.useState("");
  const [accessToken, setAccessToken] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [result, setResult] =
    React.useState<AirhopWhatsAppCloudCredentialRotation>();
  const appId =
    typeof connection?.capabilities.appId === "string"
      ? connection.capabilities.appId
      : "";

  React.useEffect(() => {
    if (open) return;
    setAppSecret("");
    setAccessToken("");
    setPending(false);
    setResult(undefined);
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !connection ||
      !/^\d{5,40}$/.test(appId) ||
      appSecret.trim().length < 16 ||
      accessToken.trim().length < 16
    ) {
      toast.error(copy.invalid);
      return;
    }
    setPending(true);
    try {
      const rotated = await onRotate({
        connectionId: connection.id,
        appId,
        appSecret: appSecret.trim(),
        accessToken: accessToken.trim(),
        expectedVersion: connection.version,
      });
      setAppSecret("");
      setAccessToken("");
      setResult(rotated);
      toast.success(copy.ready);
    } catch {
      toast.error(copy.failed);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto"
        data-testid="airhop-rotate-whatsapp-dialog"
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-5">
            <Alert>
              <Check className="mb-2 size-5 text-emerald-600" />
              <AlertTitle>{copy.ready}</AlertTitle>
              <AlertDescription>{copy.next}</AlertDescription>
            </Alert>
            <CopyValue
              label="Callback URL"
              value={result.webhook.callbackUrl}
            />
            <CopyValue
              label="Verify Token"
              value={result.webhook.verifyToken}
            />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)} type="button">
                {copy.close}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submit}>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="airhop-rotate-whatsapp-app-id"
            >
              {copy.app}
              <Input
                disabled
                id="airhop-rotate-whatsapp-app-id"
                value={appId}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="airhop-rotate-whatsapp-app-secret"
            >
              {copy.appSecret}
              <Input
                autoCapitalize="none"
                autoComplete="off"
                autoFocus
                disabled={pending}
                id="airhop-rotate-whatsapp-app-secret"
                maxLength={512}
                onChange={(event) => setAppSecret(event.target.value)}
                spellCheck={false}
                type="password"
                value={appSecret}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor="airhop-rotate-whatsapp-access-token"
            >
              {copy.accessToken}
              <Input
                autoCapitalize="none"
                autoComplete="off"
                disabled={pending}
                id="airhop-rotate-whatsapp-access-token"
                maxLength={4096}
                onChange={(event) => setAccessToken(event.target.value)}
                spellCheck={false}
                type="password"
                value={accessToken}
              />
            </label>
            <Alert>
              <KeyRound className="mb-2 size-5 text-primary" />
              <AlertDescription>{copy.hint}</AlertDescription>
            </Alert>
            <DialogFooter>
              <Button
                disabled={pending}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                {copy.cancel}
              </Button>
              <Button disabled={pending || !appId} type="submit">
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <KeyRound />
                )}
                {pending ? copy.pending : copy.submit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
