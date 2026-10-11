# Assinaturas nativas: configuração das lojas

Atualizado em 11/10/2026. Aplicativo Expo SDK 54, identificador iOS e Android `br.com.classfy.mobile`. Integração direta com `expo-iap`, StoreKit e Google Play Billing; não depende de RevenueCat. Este checklist distingue preparação de código, testes locais e ativação real.

## Estado verificado no Mac

- Xcode 26.6 instalado em `/Applications/Xcode.app`; há runtime iOS 26.5 e simuladores CREATOR e VISITANTE iniciados.
- O developer directory global aponta para Command Line Tools. Comandos locais podem usar `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`, sem alterar a configuração do Mac.
- Fabio confirmou que ainda não possui conta Apple Developer nem Play Console. O proprietário Expo no app é uma configuração de projeto, não comprovação dessas contas.
- O checkout isolado de assinatura foi compilado para simulador iOS, incluindo ExpoIap/OpenIAP em arm64 e x86_64. O development build avançado usado no iPhone recebeu a interface, mas ainda precisa de uma nova instalação com o módulo IAP para testar compras.
- Nenhuma conta foi criada, inscrição comprada ou compra real executada durante esta preparação.

## Catálogo a cadastrar

| Plano Classfy | App Store: product ID | Google Play: subscription ID | Base plan Google | Duração | Preço Brasil pretendido |
| --- | --- | --- | --- | --- | --- |
| Pro | `br.com.classfy.pro.monthly` | `classfy_pro` | `monthly` | 1 mês, renovação automática | R$ 29,90 |
| Premium | `br.com.classfy.premium.monthly` | `classfy_premium` | `monthly` | 1 mês, renovação automática | R$ 49,90 |

Esses IDs precisam coincidir com o catálogo permitido no servidor e no aplicativo. A interface usa o preço localizado retornado pela loja; o valor pretendido deve ser configurado no painel e confirmado no dispositivo.

## Apple: ativação e sandbox real

- [ ] Conta Apple Developer Program da empresa ativa. A inscrição custa US$ 99/ano, com preço local exibido pela Apple; criação e pagamento dependem de Fabio. Organização exige identidade legal e D-U-N-S quando aplicável. [Inscrição Apple](https://developer.apple.com/help/account/membership/program-enrollment/).
- [ ] Registrar o identificador `br.com.classfy.mobile`, habilitar In-App Purchase e criar o aplicativo correspondente no App Store Connect.
- [ ] Account Holder aceitar o Paid Applications Agreement; completar os dados bancários e fiscais exigidos no painel.
- [ ] Criar um único grupo de assinatura Classfy. Colocar Premium no nível 1 e Pro no nível 2 para a loja entender upgrade/downgrade dentro do mesmo serviço.
- [ ] Cadastrar os dois produtos acima como auto-renewable subscriptions, duração mensal, nomes/descrições localizados, disponibilidade Brasil e preços.
- [ ] Completar metadados e imagem de revisão, vincular a primeira assinatura à versão submetida e disponibilizar credenciais de revisão do aplicativo.
- [ ] Gerar uma chave **In-App Purchase** em Users and Access → Integrations → In-App Purchase; instalar `.p8`, Key ID e Issuer ID apenas como secrets do backend. Esta chave é distinta de uma chave genérica App Store Connect para upload. [Chaves IAP](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/generate-keys-for-in-app-purchases/), [autenticação de requests](https://developer.apple.com/documentation/StoreKit/generating-jws-to-sign-app-store-requests).
- [ ] Configurar App Store Server Notifications **V2** para sandbox e produção no endpoint HTTPS `/functions/v1/app-store-notifications`. Pode ser o mesmo endpoint, desde que o servidor valide e diferencie o ambiente.
- [ ] Criar Sandbox Apple Accounts, gerar um development build assinado e testar em dispositivo real. TestFlight também usa sandbox; exige App Store Connect e inscrição ativa. Testes nesse ambiente não cobram dinheiro. [Sandbox Apple](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox).
- [ ] Enviar e conferir `TEST` via App Store Server API; testar renovação, expiração, cancelamento, reembolso e revogação com notificações verificadas. [Notifications V2](https://developer.apple.com/documentation/appstoreservernotifications/enabling-app-store-server-notifications).

### O que pode ser testado sem inscrição paga

StoreKit Testing em Xcode permite criar catálogo local e simular compras, restaurações, renovação e erros, em simulador ou dispositivo. Não exige produtos no App Store Connect e pode funcionar offline. As transações são assinadas pelo Xcode, **não pela App Store**. Isso não comprova comunicação com a Apple, sandbox real, notificações de servidor ou disponibilidade na loja. Não aceitar essas transações para liberar plano em produção. [Comparação oficial de ambientes](https://developer.apple.com/documentation/storekit/testing-at-all-stages-of-development-with-xcode-and-the-sandbox).

## Google Play: ativação e testes

- [ ] Conta Play Console da empresa criada/verificada e contrato aceito. O registro tem taxa única de US$ 25; não foi contratado nesta tarefa. [Inscrição Google](https://support.google.com/googleplay/android-developer/answer/6112435).
- [ ] Configurar perfil de pagamentos e dados fiscais/bancários solicitados para monetização.
- [ ] Criar o app `br.com.classfy.mobile`, configurar Play App Signing e publicar build AAB com a integração Billing na faixa interna.
- [ ] Criar `classfy_pro` e `classfy_premium`, cada um com base plan `monthly`, auto-renewing, disponibilidade Brasil, preço e base plan ativo.
- [ ] Habilitar Google Play Android Developer API em um projeto Google Cloud. Criar service account e convidar seu e-mail em Users & Permissions do Play Console, limitado ao app, com **View financial data, orders, and cancellation survey responses** e **Manage orders and subscriptions**.
- [ ] Instalar a credencial JSON da service account somente nos secrets do servidor; nunca no app. Vincular a conta Play a um projeto Cloud não é mais um pré-requisito da API. [Google Play Developer API](https://developers.google.com/android-publisher/getting_started).
- [ ] Configurar tópico Pub/Sub para RTDN; conceder Pub/Sub Publisher a `google-play-developer-notifications@system.gserviceaccount.com` nesse tópico. Cadastrar o nome completo do tópico nas configurações de monetização do app. [Configuração RTDN](https://developer.android.com/google/play/billing/getting-ready).
- [ ] Criar subscription Pub/Sub push **autenticada por OIDC** para `/functions/v1/google-play-notifications`; configurar service account emissora, audiência esperada e permissões para o Pub/Sub emitir o token.
- [ ] Enviar a notificação de teste do Play Console e confirmar entrega autenticada. O servidor consulta `purchases.subscriptionsv2.get` para obter o estado completo; RTDN isolado não prova o direito de acesso. [Referência RTDN](https://developer.android.com/google/play/billing/rtdn-reference).
- [ ] Configurar license testers e colocá-los também na faixa de teste. Conferir a identificação de compra de teste antes de confirmar: usuário de test track que não é license tester pode ser cobrado de verdade.
- [ ] Testar aprovação, recusa, pendência, acknowledgment, renovação, restauração, cancelamento, grace period/account hold e reembolso. License testers podem testar APK debug instalado manualmente quando package e cadastro Play coincidem. [Testes Billing](https://developer.android.com/google/play/billing/test).

## Build e backend Classfy

- [x] Integrar `expo-iap` 6.0.0 e compilar o cliente isolado no simulador iOS. Expo Go e atualização apenas JavaScript não incluem o módulo nativo de compras. [Guia Expo](https://docs.expo.dev/guides/in-app-purchases/).
- [ ] Gerar e instalar um **novo development build do Studio completo** com o módulo IAP; compilar Android nativamente após preparar seu ambiente. [SDK 54](https://docs.expo.dev/versions/v54.0.0/), [setup expo-iap](https://www.openiap.dev/docs/setup/expo).
- [x] Publicar `mobile-subscription` com JWT de usuário Classfy; compra e restauração passam por verificação de servidor antes de liberar Pro/Premium. Catálogo permanece desabilitado.
- [x] Publicar `app-store-notifications` com verificação criptográfica Apple e `google-play-notifications` com verificação OIDC Google. Callbacks permanecem desabilitados até a ativação das lojas.
- [ ] Instalar credenciais nos secrets com controle de acesso; registrar neste documento somente nomes das variáveis e IDs públicos.
- [x] Vincular cada compra verificada a uma conta Classfy, impedir reutilização em outra conta e processar eventos repetidos de forma idempotente. Validado por testes locais e concorrência em PostgreSQL real.
- [x] Testar localmente pendência, cancelamento, reembolso/revogação e preservação de outro plano pago ainda vigente. Repetir com transações reais de sandbox/licença antes da ativação.
- [x] Conservar assinaturas Stripe existentes e bloquear nova contratação enquanto outro provedor já está ativo. A concorrência entre pagamentos ainda pendentes requer validação adicional antes da ativação.
- [x] Exibir links de termos/privacidade, preço da loja, periodicidade, renovação automática, restauração de compras e gestão nativa da assinatura.

### Evidências desta preparação

- 23 testes do cliente; 96 testes Deno de assinatura/verificação/checkout; tipos do mobile e build web aprovados.
- Migração `20261011210000_mobile_store_subscriptions.sql` aplicada em produção. Nenhum produto, credencial de loja ou flag de ativação foi configurado.
- Migração validada em PGlite, incluindo permissões, replay, troca de titular, cancelamento, revogação, troca de token Google e fallback de Premium vencido para Pro ainda válido. Corrida entre titulares validada em PostgreSQL 18 real.
- Exportação JavaScript iOS e Android aprovada; isso não comprova compilação nativa Android nem paridade do Studio.
- Build iOS de simulador aprovado com `DEBUG_INFORMATION_FORMAT=dwarf`, após falta de espaço na geração de dSYM. Artefato local: `/tmp/classfy-iap-simulator/Build/Products/Debug-iphonesimulator/Classfy.app`.

### Android e requisitos de publicação restantes

O aplicativo compartilha React Native/Expo, autenticação, telas, dados e backend. Cada plataforma tem um binário, catálogo de loja e integração nativa próprios. No checkout avançado `mobile-dev-iphone`, `classfy-studio-media` registra apenas a plataforma Apple e implementa captura/edição/processamento em Swift. As rotas do Studio bloqueiam Android explicitamente. É preciso implementar os recursos nativos Android e validar dispositivos antes de oferecer a mesma experiência.

O Mac ainda não possui JDK, Android SDK, `adb`, emulador ou Android Studio disponíveis na inspeção de 11/10. Não foi gerado APK/AAB nativo nesta tarefa. Novas contas pessoais Play Console precisam de teste fechado com 12 testadores inscritos continuamente por 14 dias antes de solicitar acesso a produção; não confundir isso com teste interno. [Requisitos Google](https://support.google.com/googleplay/android-developer/answer/14151465).

O fluxo `mobile/app/purchase/[id].tsx` de compra **avulsa de conteúdo digital** ainda usa Stripe; esta entrega trata somente assinaturas. Adequar ou retirar esse checkout do aplicativo para as lojas pretendidas é um requisito separado antes da submissão. Não declarar conformidade integral do aplicativo apenas porque a assinatura agora usa IAP.

### Variáveis do servidor implementadas

| Variável | Configuração |
| --- | --- |
| `MOBILE_APPLE_BILLING_ENABLED` | `true` somente depois de produtos e sandbox verificados; desativado por padrão |
| `MOBILE_APPLE_KEY_ID` | Identificador da chave In-App Purchase |
| `MOBILE_APPLE_ISSUER_ID` | Issuer ID do App Store Connect |
| `MOBILE_APPLE_PRIVATE_KEY` | Conteúdo PEM da chave `.p8`; secret |
| `MOBILE_APPLE_APP_ID` | ID numérico do aplicativo no App Store Connect, obrigatório em Production |
| `MOBILE_APPLE_ENVIRONMENT` | `Production` por padrão; `Sandbox` apenas para testes controlados |
| `MOBILE_GOOGLE_BILLING_ENABLED` | `true` somente depois de produtos e licença verificados; desativado por padrão |
| `MOBILE_GOOGLE_SERVICE_ACCOUNT_JSON` | Credencial JSON da service account; secret |
| `MOBILE_GOOGLE_OIDC_AUDIENCE` | Audiência configurada na subscription Pub/Sub push; deve coincidir exatamente |
| `MOBILE_GOOGLE_OIDC_SERVICE_EMAIL` | E-mail da service account que assina o OIDC da subscription push |
| `MOBILE_SANDBOX_USER_IDS` | UUIDs Classfy de testes permitidos, separados por vírgula; obrigatório para aceitar Apple Sandbox e compras de licença Google |

Preferir projeto Supabase de desenvolvimento para sandbox. A allowlist nunca deve conter todos os usuários. Xcode/StoreKit local não é aceito no backend. Apple usa o SDK oficial para verificar a cadeia de certificados, assinatura, ambiente e bundle; anchors Apple Root CA G2/G3 estão fixados no código. Google usa OAuth service account para verificar o estado e OIDC para autenticar RTDN. Nenhum segredo é enviado ao aplicativo.

O backend reconhece (`acknowledge`) uma compra Google pendente somente depois da gravação verificada do acesso. Isso cobre o caso de o app fechar antes de finalizar a compra. O cliente recebe `storeAcknowledged: true` e pode evitar reconhecimento duplicado. Apple ainda exige `finishTransaction` no cliente após a confirmação do servidor.

O catálogo consulta o perfil protegido e bloqueia compra por loja quando há assinatura ativa de outro provedor; o RPC também rejeita o conflito. Antes de habilitar produção, validar concorrência entre um checkout web já preparado/pendente e a compra nativa: a autorização de pagamento ocorre fora do banco Classfy, portanto um catálogo consultado antes de outro checkout iniciar não é uma reserva global de compra.

## Critério de conclusão

Código e testes locais permitem preparar o fluxo, mas **ativação completa** exige produtos disponíveis, credenciais válidas, build nativo e teste real de sandbox/licença com verificação do backend. Só declarar apto a produção após compra, renovação, restauração e cancelamento aprovados em ambas as lojas pretendidas. A publicação final ainda depende da revisão App Store/Google Play.
