# Como conectar a própria WhatsApp Cloud API ao AirHop Center

[Русская версия](AIRHOP_WHATSAPP_OWN_META_APP_SETUP.md)

Status: a documentação, o assistente de configuração e o adaptador hospedado
da WhatsApp Cloud API estão prontos. Os campos de credenciais só ficam ativos
em instalações com o Channel Gateway e uma URL pública HTTPS de callback. Antes
disso, o assistente continua disponível como guia, mas não recebe segredos.
Cada instalação deve passar por um teste real de ponta a ponta antes de ser
considerada pronta para produção.

Este guia é destinado ao proprietário ou administrador do centro. Ele conecta
a **WhatsApp Business Platform Cloud API oficial** por meio de um aplicativo da
Meta pertencente ao próprio centro.

O AirHop não pede acesso ao Meta Business de terceiros por meio de um aplicativo
compartilhado. Esse modelo permite os primeiros onboardings sem depender do App
Review de um aplicativo central do AirHop. A Meta ainda pode exigir verificação
da empresa, aprovação do nome de exibição, forma de pagamento e cumprimento das
políticas do WhatsApp.

O número de suporte do AirHub HQ e os números dos parceiros do AirHop Center são
conexões independentes. Cada centro usa seu próprio Portfólio Empresarial,
aplicativo da Meta, WABA e número. O número existente do AirHub HQ não é movido
nem alterado.

## Resultado esperado

Depois da configuração:

- responsáveis escrevem para o número de WhatsApp do centro;
- as mensagens aparecem no atendimento compartilhado do AirHop Center;
- a equipe e o Hermes respondem pelo AirHop Center;
- o computador do centro não precisa receber webhooks nem ter IP público;
- o token e o App Secret ficam criptografados e não são exibidos novamente.

Pontos de partida oficiais:

- [aplicativos no Meta for Developers](https://developers.facebook.com/apps/);
- [usuários do sistema no Meta Business Settings](https://business.facebook.com/settings/system-users/);
- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/);
- [preços atuais da WhatsApp Business Platform](https://whatsappbusiness.com/products/platform-pricing/);
- [coleção oficial da WhatsApp Cloud API](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api).

Os nomes dos menus da Meta mudam com frequência. Procure por **WhatsApp**,
**API Setup**, **Configuration**, **System Users** e **WhatsApp Accounts**.

## Antes de começar

Você precisará de:

1. Acesso de proprietário ou administrador ao AirHop Center.
2. Portfólio Empresarial da Meta do centro e controle total sobre ele.
3. Conta Meta for Developers da pessoa que fará a configuração.
4. Um número capaz de receber o código da Meta por SMS ou ligação.
5. Cerca de 20 a 40 minutos sem fechar as abas da Meta.

Na primeira versão do AirHop, use um aplicativo da Meta separado para cada
número de WhatsApp conectado. A Callback URL é configurada no nível do
aplicativo; reutilizar o mesmo aplicativo em outra conexão pode substituir o
webhook que já estava funcionando.

Se o número já estiver no WhatsApp ou no WhatsApp Business de um celular, use o
modo oficial de coexistência quando ele for oferecido. Se essa opção não
aparecer, remova o número do aplicativo móvel antes de registrá-lo na Cloud API.
Uma conta recém-criada e sem histórico não precisa de migração.

Não conecte por QR code usando bibliotecas não oficiais do WhatsApp Web. Isso
não é Cloud API, depende de uma sessão ativa no celular e aumenta o risco de
bloqueio do número.

## Etapa 1. Criar o aplicativo da Meta

1. Abra o [Meta for Developers](https://developers.facebook.com/apps/).
2. Clique em **Create app**.
3. Escolha o caso de uso relacionado a WhatsApp Business Messaging. Na interface
   atual, ele pode aparecer como **Connect with customers through WhatsApp**.
4. Selecione o Portfólio Empresarial deste centro.
5. Termine a criação e abra o produto **WhatsApp**.

Anote o **App ID**. Não envie o App Secret por chat.

## Etapa 2. Adicionar o número de WhatsApp

1. No aplicativo da Meta, abra **WhatsApp → API Setup**.
2. Crie ou selecione a conta do WhatsApp Business (WABA) do centro.
3. Clique em **Add phone number** e informe o nome público, a categoria e o
   número do centro.
4. Confirme o número por SMS ou ligação.
5. Se a Meta solicitar um PIN de verificação em duas etapas, crie-o e guarde-o
   no gerenciador de senhas do centro.

Na página API Setup, anote:

- **WhatsApp Business Account ID (WABA ID)**;
- **Phone Number ID** — não é o número de telefone;
- **App ID**.

Os três valores são numéricos. Um telefone no formato `+55…` não pode ser usado
no campo Phone Number ID.

## Etapa 3. Criar um System User Token permanente

O token temporário da página API Setup serve apenas para testes curtos e expira.
Para operação contínua, crie um System User Token.

1. Abra **Business Settings → Users → System Users**.
2. Crie um usuário do sistema, por exemplo `AirHop WhatsApp Gateway`, com função
   administrativa.
3. Em **Assign assets**, conceda acesso ao aplicativo da Meta e à WABA do centro.
4. Clique em **Generate new token** e selecione o aplicativo do centro.
5. Escolha a maior validade disponível, de preferência permanente.
6. Inclua as permissões:
   - `whatsapp_business_management`;
   - `whatsapp_business_messaging`.
7. Copie o token imediatamente; a Meta não o mostrará inteiro outra vez.

Não envie esse token por mensageiros. Cole-o somente no campo protegido do
assistente do AirHop Center.

## Etapa 4. Informar as credenciais ao AirHop

No AirHop Center, abra:

**Configurações → Canais de comunicação → Adicionar canal → WhatsApp → Meu
próprio aplicativo da Meta**.

Informe:

- App ID;
- App Secret em **App settings → Basic**;
- WABA ID;
- Phone Number ID;
- System User Token permanente.

Escolha o canal central de atendimento ou uma unidade. O AirHop valida o token
com a Meta, confirma que o Phone Number ID pertence à WABA selecionada e guarda
os segredos de forma criptografada. Eles não entram no histórico de mensagens
nem são retornados pelas APIs comuns de configuração.

## Etapa 5. Conectar o webhook

Após a validação, o AirHop exibirá:

- **Callback URL**;
- **Verify Token**.

1. Volte ao aplicativo da Meta.
2. Abra **WhatsApp → Configuration**.
3. No bloco de webhook, clique em **Edit**.
4. Cole a Callback URL e o Verify Token sem espaços extras.
5. Clique em **Verify and save**.
6. Na lista de campos do webhook, assine pelo menos **messages**.
7. Volte ao AirHop e clique em **Salvei o webhook**.

A Callback URL já contém o identificador da conexão. Não a substitua por um
endereço local e não remova o trecho final da URL.

## Etapa 6. Testar uma mensagem

1. Envie uma mensagem para o número do centro usando outro WhatsApp pessoal.
2. Não teste com o próprio número empresarial conectado.
3. Aguarde a mensagem aparecer no atendimento do AirHop Center.
4. Responda pelo AirHop Center.

Cada mensagem do usuário abre ou renova uma janela de atendimento de 24 horas.
Dentro dela, o centro pode enviar mensagens de serviço sem template. Para
iniciar uma conversa ou enviar algo depois dessa janela, use um template
aprovado pela Meta.

## Testes, validade e cobrança

Um número próprio e confirmado não possui um “período de teste” após o qual a
integração para sozinha. Para funcionar continuamente, ele precisa de um System
User Token válido, WABA ativa, forma de pagamento correta, boa qualidade do
número e AirHop WhatsApp Gateway operacional. O token temporário da API Setup
não serve para produção.

A Meta cobra por mensagem entregue, de acordo com o mercado do destinatário e
a categoria. Mensagens de serviço dentro da janela de 24 horas não são
cobradas; mensagens de marketing, autenticação e determinadas mensagens de
utilidade podem ser cobradas. As tarifas mudam. Antes de lançar, consulte a
[página oficial de preços](https://whatsappbusiness.com/products/platform-pricing/)
e selecione Brasil e a moeda desejada. Uma eventual cobrança futura do gateway
hospedado do AirHop deverá aparecer separadamente da fatura da Meta.

## Consentimento e regras de mensagens

Antes do primeiro contato iniciado pelo centro, obtenha consentimento explícito
do responsável para receber mensagens no WhatsApp e registre a origem desse
consentimento. Identifique claramente o centro e ofereça uma forma simples de
falar com uma pessoa. Solicitações para parar devem ser atendidas imediatamente.
Não faça disparos sem consentimento nem automação em massa não oficial. Consulte
a [Política de Mensagens do WhatsApp Business](https://business.whatsapp.com/policy/preview?lang=pt_BR).

A conexão só está pronta quando o cartão do AirHop mostra **Funcionando** e uma
data recente da última verificação.

## Problemas comuns

### O SMS não chega

- confira o código do país e o número;
- confirme com a operadora se SMS de serviço está bloqueado;
- tente receber o código por ligação;
- não solicite muitos códigos em sequência: a Meta aplica cooldown temporário;
- se a coexistência não foi oferecida, confirme que o número saiu do WhatsApp
  móvel.

### O AirHop informa que o token é inválido

- não use o token temporário de uma aba antiga da API Setup;
- confirme as duas permissões do usuário do sistema;
- atribua novamente o aplicativo e a WABA em **Assign assets**;
- gere um token novo e tente de novo.

### O Phone Number ID não pertence à WABA

Provavelmente os IDs vieram de contas diferentes, ou o telefone foi colado no
lugar do Phone Number ID. Copie WABA ID e Phone Number ID da mesma API Setup.

### A Meta não aceita a Callback URL ou o Verify Token

- copie os dois valores novamente da mesma conexão do AirHop;
- remova espaços no começo e no fim;
- não use o Verify Token de outro número ou de uma tentativa antiga;
- confirme que a conexão não foi excluída e recriada;
- se nenhum GET de verificação chega ao ingress público, verifique DNS, TLS,
  IPv4/IPv6 e acesso externo. Na produção brasileira, use o ingress regional
  `hooks.airhop.com.br`;
- não desative `X-Hub-Signature-256` e não exponha diretamente a porta local do
  gateway para fazer a validação passar.

### O webhook foi salvo, mas as mensagens não chegam

- assine o campo **messages** na Meta;
- envie a mensagem de outro número;
- verifique o erro do adaptador e o horário do heartbeat no cartão do AirHop;
- não configure uma segunda Callback URL no mesmo aplicativo da Meta.

### As mensagens chegam, mas a resposta não sai

- confirme que a janela de 24 horas ainda está aberta;
- para uma conversa nova, use um template aprovado;
- verifique forma de pagamento, qualidade do número e status do template no
  WhatsApp Manager.

## Manutenção da conexão

- Antes da primeira rotação, atualize o Channel Gateway para uma versão com
  `credentialVersion`; depois atualize Relay/UI e use **Atualizar acesso**.
- Para uma rotação planejada, gere um novo System User Token permanente e
  substitua o App Secret na Meta. No cartão da conexão, clique em **Atualizar
  acesso**, informe os dois valores e aguarde a validação.
- O AirHop preserva o connection ID, o roteamento e o histórico. Somente o
  runtime dessa conexão é reiniciado.
- Depois da troca, o AirHop fornece novos Callback URL e Verify Token. Salve-os
  em **WhatsApp → Configuration**, confirme a assinatura de **messages** e
  aguarde o cartão voltar de **Conectando** para **Funcionando**.
- Não exclua aplicativo, WABA ou usuário do sistema enquanto o canal estiver
  ativo.
- Ao transferir a administração do centro, transfira o Portfólio Empresarial e
  rotacione o App Secret e o System User Token.
- Para desativar o número, pause primeiro o canal no AirHop, aguarde as saídas
  pendentes e só então remova o número na Meta.

## Checklist de produção

- [ ] O aplicativo pertence ao Portfólio Empresarial do centro.
- [ ] O número está confirmado e aparece no WhatsApp Manager.
- [ ] O System User possui o aplicativo e a WABA em Assign assets.
- [ ] O token inclui `whatsapp_business_management` e
      `whatsapp_business_messaging`.
- [ ] O AirHop validou WABA ID e Phone Number ID.
- [ ] Callback URL e Verify Token foram salvos na Meta.
- [ ] O campo de webhook `messages` está assinado.
- [ ] O cartão do AirHop mostra **Funcionando**.
- [ ] A entrada e a resposta foram testadas com dois números diferentes.
