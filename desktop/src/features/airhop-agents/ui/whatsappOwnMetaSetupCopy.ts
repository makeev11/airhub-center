import type { AirHopLocale } from "@/shared/locale/airhopLocale";

export type WhatsAppOwnMetaSetupCopy = {
  accessTokenHint: string;
  addNumber: string;
  activated: string;
  back: string;
  checkingCredentials: string;
  checkingSubscription: string;
  close: string;
  cloudApiDocumentation: string;
  coexistenceDescription: string;
  connectFailed: string;
  connectionCreated: string;
  connectionCreatedDescription: string;
  createApp: string;
  createAppDescription: string;
  createToken: string;
  createTokenDescription: string;
  credentialsReady: string;
  currentPricing: string;
  description: string;
  done: string;
  haveCredentials: string;
  importantNumber: string;
  invalidFields: string;
  metaConfirmed: (phoneNumber: string) => string;
  numberDescription: string;
  numberOwnership: string;
  numberOwnershipDescription: string;
  openMeta: string;
  openSystemUsers: string;
  partnerNumberDescription: string;
  phoneNumberHint: string;
  pricingDescription: string;
  secretDescription: string;
  secretTitle: string;
  subscriptionFailed: string;
  title: string;
  unavailableDescription: string;
  unavailableTitle: string;
  verifyAndSave: string;
  webhookDescription: string;
  webhookSaved: string;
  webhookSteps: readonly [string, string, string, string];
};

const RU: WhatsAppOwnMetaSetupCopy = {
  accessTokenHint:
    "Используйте System User Token с двумя WhatsApp-разрешениями, а не временный токен из API Setup.",
  addNumber: "Добавьте и подтвердите номер",
  activated:
    "Приложение подписано. Отправьте тестовое сообщение на номер центра.",
  back: "Назад",
  checkingCredentials: "Проверяем в Meta…",
  checkingSubscription: "Проверяем подписку…",
  close: "Закрыть",
  cloudApiDocumentation: "Официальная документация Cloud API",
  coexistenceDescription:
    "Если Meta не предлагает официальный coexistence, номер нужно удалить из мобильного WhatsApp перед регистрацией в Cloud API. Не используйте неофициальное QR-подключение.",
  connectFailed:
    "Не удалось проверить реквизиты в Meta. Проверьте токен, разрешения и ID.",
  connectionCreated: "Подключение создано",
  connectionCreatedDescription:
    "Напишите на номер центра с другого WhatsApp. Карточка станет «Работает» после первого успешного heartbeat адаптера.",
  createApp: "Создайте приложение Meta",
  createAppDescription:
    "Выберите сценарий WhatsApp Business Messaging и Business Portfolio этого центра.",
  createToken: "Создайте постоянный System User Token",
  createTokenDescription:
    "Назначьте системному пользователю приложение и WABA. Добавьте whatsapp_business_management и whatsapp_business_messaging.",
  credentialsReady: "Meta подтвердила номер. Осталось сохранить webhook.",
  currentPricing: "Актуальные тарифы Meta",
  description:
    "Официальный WhatsApp Cloud API через собственное Meta-приложение центра.",
  done: "Готово",
  haveCredentials: "У меня есть реквизиты",
  importantNumber: "Важно про номер",
  invalidFields:
    "Проверьте все пять значений. App ID, WABA ID и Phone Number ID состоят только из цифр.",
  metaConfirmed: (phoneNumber) => `Meta подтвердила ${phoneNumber}`,
  numberDescription:
    "В WhatsApp → API Setup создайте или выберите WABA, добавьте номер и пройдите SMS или голосовую проверку. Сохраните WABA ID и Phone Number ID.",
  numberOwnership: "Приложение и номер принадлежат вашему центру",
  numberOwnershipDescription:
    "Для этого режима не нужен App Review приложения AirHop. Meta всё равно может запросить проверку бизнеса, имени и способ оплаты.",
  openMeta: "Открыть Meta for Developers",
  openSystemUsers: "Открыть System Users",
  partnerNumberDescription:
    "Для каждого номера партнёрского центра создавайте отдельное Meta-приложение. Номер поддержки AirHub HQ остаётся в своём подключении и здесь не меняется.",
  phoneNumberHint:
    "Не сам номер +55…, а цифровой Phone Number ID из API Setup.",
  pricingDescription:
    "У подтверждённого номера нет пробного срока. Service-ответы внутри 24-часового окна бесплатны; остальные сообщения могут тарифицироваться Meta по рынку и категории.",
  secretDescription:
    "AirHop проверит номер через Meta и сохранит App Secret и токен в зашифрованном хранилище. Они не появятся в сообщениях, логах или карточке канала.",
  secretTitle: "Секреты передаются один раз",
  subscriptionFailed:
    "Meta не подтвердила подписку. Проверьте, что Callback URL сохранён и поле messages включено.",
  title: "Подключить WhatsApp",
  unavailableDescription:
    "Инструкцию уже можно выполнить до получения ID и токена. Продолжение станет доступно после настройки официального WhatsApp Gateway.",
  unavailableTitle: "Приём реквизитов ещё не включён на этом сервере",
  verifyAndSave: "Проверить и сохранить",
  webhookDescription:
    "Теперь сохраните webhook в WhatsApp → Configuration этого же Meta-приложения.",
  webhookSaved: "Я сохранил webhook",
  webhookSteps: [
    "Откройте WhatsApp → Configuration и нажмите Edit в блоке webhook.",
    "Вставьте оба значения, нажмите Verify and save.",
    "В Manage включите поле messages.",
    "Вернитесь сюда и подтвердите сохранение.",
  ],
};

const EN: WhatsAppOwnMetaSetupCopy = {
  accessTokenHint:
    "Use a System User Token with both WhatsApp permissions, not the temporary API Setup token.",
  addNumber: "Add and verify the number",
  activated: "The app is subscribed. Send a test message to the center number.",
  back: "Back",
  checkingCredentials: "Checking Meta…",
  checkingSubscription: "Checking subscription…",
  close: "Close",
  cloudApiDocumentation: "Cloud API documentation",
  coexistenceDescription:
    "If Meta does not offer official coexistence, remove the number from mobile WhatsApp before Cloud API registration. Do not use unofficial QR integrations.",
  connectFailed:
    "Meta credentials could not be verified. Check the token, permissions, and IDs.",
  connectionCreated: "Connection created",
  connectionCreatedDescription:
    "Message the center number from another WhatsApp account. The card becomes Working after the adapter's first successful heartbeat.",
  createApp: "Create a Meta app",
  createAppDescription:
    "Choose the WhatsApp Business Messaging use case and this center's Business Portfolio.",
  createToken: "Create a permanent System User Token",
  createTokenDescription:
    "Assign the app and WABA to a system user. Add whatsapp_business_management and whatsapp_business_messaging.",
  credentialsReady: "Meta confirmed the number. Save the webhook to finish.",
  currentPricing: "Current Meta pricing",
  description: "Official WhatsApp Cloud API through the center's own Meta app.",
  done: "Done",
  haveCredentials: "I have the credentials",
  importantNumber: "Important number note",
  invalidFields:
    "Check all five values. App ID, WABA ID, and Phone Number ID contain digits only.",
  metaConfirmed: (phoneNumber) => `Meta confirmed ${phoneNumber}`,
  numberDescription:
    "In WhatsApp → API Setup choose a WABA, add the number, complete SMS or voice verification, and save the WABA ID and Phone Number ID.",
  numberOwnership: "The app and number belong to your center",
  numberOwnershipDescription:
    "This mode does not require AirHop App Review. Meta may still require business, display-name, and billing checks.",
  openMeta: "Open Meta for Developers",
  openSystemUsers: "Open System Users",
  partnerNumberDescription:
    "Create a separate Meta app for every partner-center number. The AirHub HQ support number stays in its own connection and is not changed here.",
  phoneNumberHint:
    "Use the numeric Phone Number ID from API Setup, not the +55… phone number.",
  pricingDescription:
    "A verified number has no trial cutoff. Service replies in the 24-hour window are free; other messages may be charged by Meta based on market and category.",
  secretDescription:
    "AirHop verifies the number through Meta and stores the App Secret and token encrypted. They do not appear in messages, logs, or the channel card.",
  secretTitle: "Secrets are sent once",
  subscriptionFailed:
    "Meta did not confirm the subscription. Check the Callback URL and messages field.",
  title: "Connect WhatsApp",
  unavailableDescription:
    "You can complete the Meta steps now. The form will unlock when the official WhatsApp Gateway is configured.",
  unavailableTitle: "Credential intake is not enabled on this server",
  verifyAndSave: "Verify and save",
  webhookDescription:
    "Now save the webhook under WhatsApp → Configuration in the same Meta app.",
  webhookSaved: "I saved the webhook",
  webhookSteps: [
    "Open WhatsApp → Configuration and click Edit in the webhook block.",
    "Paste both values and click Verify and save.",
    "Enable the messages field under Manage.",
    "Return here and confirm that you saved it.",
  ],
};

const PT_BR: WhatsAppOwnMetaSetupCopy = {
  accessTokenHint:
    "Use um System User Token com as duas permissões do WhatsApp, não o token temporário de API Setup.",
  addNumber: "Adicione e confirme o número",
  activated:
    "O aplicativo foi vinculado. Envie uma mensagem de teste para o número do centro.",
  back: "Voltar",
  checkingCredentials: "Verificando na Meta…",
  checkingSubscription: "Verificando a assinatura…",
  close: "Fechar",
  cloudApiDocumentation: "Documentação oficial da Cloud API",
  coexistenceDescription:
    "Se a Meta não oferecer a coexistência oficial, remova o número do WhatsApp no celular antes de registrá-lo na Cloud API. Não use integrações não oficiais por QR code.",
  connectFailed:
    "Não foi possível verificar as credenciais na Meta. Confira o token, as permissões e os IDs.",
  connectionCreated: "Conexão criada",
  connectionCreatedDescription:
    "Envie uma mensagem para o número do centro usando outro WhatsApp. O cartão mudará para “Funcionando” após o primeiro heartbeat bem-sucedido do adaptador.",
  createApp: "Crie um aplicativo na Meta",
  createAppDescription:
    "Escolha o caso de uso WhatsApp Business Messaging e o Business Portfolio deste centro.",
  createToken: "Crie um System User Token permanente",
  createTokenDescription:
    "Atribua o aplicativo e a WABA ao usuário do sistema. Adicione whatsapp_business_management e whatsapp_business_messaging.",
  credentialsReady: "A Meta confirmou o número. Falta salvar o webhook.",
  currentPricing: "Preços atuais da Meta",
  description:
    "API oficial do WhatsApp Cloud pelo próprio aplicativo da Meta do centro.",
  done: "Concluir",
  haveCredentials: "Já tenho as credenciais",
  importantNumber: "Informação importante sobre o número",
  invalidFields:
    "Confira os cinco valores. App ID, WABA ID e Phone Number ID contêm apenas números.",
  metaConfirmed: (phoneNumber) => `A Meta confirmou ${phoneNumber}`,
  numberDescription:
    "Em WhatsApp → API Setup, crie ou escolha uma WABA, adicione o número e conclua a verificação por SMS ou ligação. Guarde o WABA ID e o Phone Number ID.",
  numberOwnership: "O aplicativo e o número pertencem ao seu centro",
  numberOwnershipDescription:
    "Este modo não exige a revisão do aplicativo da AirHop. A Meta ainda pode solicitar a verificação da empresa, do nome de exibição e da forma de pagamento.",
  openMeta: "Abrir Meta for Developers",
  openSystemUsers: "Abrir System Users",
  partnerNumberDescription:
    "Crie um aplicativo Meta separado para o número de cada centro parceiro. O número de suporte do AirHub HQ permanece na própria conexão e não é alterado aqui.",
  phoneNumberHint:
    "Use o Phone Number ID numérico exibido em API Setup, não o próprio número +55….",
  pricingDescription:
    "Um número verificado não tem prazo de teste. As respostas de atendimento dentro da janela de 24 horas são gratuitas; outras mensagens podem ser cobradas pela Meta conforme o mercado e a categoria.",
  secretDescription:
    "A AirHop verificará o número na Meta e armazenará o App Secret e o token de forma criptografada. Eles não aparecerão nas mensagens, nos logs nem no cartão do canal.",
  secretTitle: "Os segredos são enviados uma única vez",
  subscriptionFailed:
    "A Meta não confirmou a assinatura. Confira se a Callback URL foi salva e se a assinatura do campo messages está ativa.",
  title: "Conectar WhatsApp",
  unavailableDescription:
    "Você já pode concluir as etapas na Meta até obter os IDs e o token. O formulário será liberado quando o WhatsApp Gateway oficial estiver configurado.",
  unavailableTitle:
    "O recebimento de credenciais ainda não está ativo neste servidor",
  verifyAndSave: "Verificar e salvar",
  webhookDescription:
    "Agora salve o webhook em WhatsApp → Configuration no mesmo aplicativo da Meta.",
  webhookSaved: "Salvei o webhook",
  webhookSteps: [
    "Abra WhatsApp → Configuration e clique em Edit no bloco do webhook.",
    "Cole os dois valores e clique em Verify and save.",
    "Em Manage, assine o campo messages.",
    "Volte aqui e confirme que salvou.",
  ],
};

export function getWhatsAppOwnMetaSetupCopy(
  locale: AirHopLocale,
): WhatsAppOwnMetaSetupCopy {
  if (locale === "ru-RU") return RU;
  if (locale === "pt-BR") return PT_BR;
  return EN;
}
