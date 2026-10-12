# Classfy Mobile

App mobile nativo da Classfy criado com Expo React Native, TypeScript e Expo Router.

## Objetivo

Este app nao espelha a web. Ele e um cliente mobile para consumir o mesmo Supabase, dados e modelo de negocio da Classfy, com experiencia de conteudo, watch, perfil e recompensas.

## Estrutura

- `app/`: rotas Expo Router
- `src/lib/supabase.ts`: client Supabase mobile
- `src/features/`: dominios futuros por feature
- `src/components/`: componentes compartilhados
- `src/theme/`: tokens visuais

## Ambiente

Crie um `.env` local baseado em `.env.example`:

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://jeqezibfollsvdknfebj.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
   ```

## Desenvolvimento

   ```bash
   npm ci
   npm run start
   ```

Comandos uteis:

- `npm run ios`
- `npm run ios:device`
- `npm run ios:device:personal` (Classfy Dev para equipe Apple pessoal, sem push remoto)
- `npm run android`
- `npm run web`
- `npm run typecheck`
- `npm run check:dependencies`
- `npm run lint`

O servidor usa uma development build com `expo-dev-client`. `ios` e `android`
compilam e instalam o app; `start` conecta uma build já instalada ao Metro para
atualização ao vivo. Consulte [DEVELOPMENT.md](./DEVELOPMENT.md) para simulador,
iPhone conectado e a variante para equipe Apple pessoal.

A reconstrução da experiência e os gaps de paridade estão em [REBUILD.md](./REBUILD.md).

O motor nativo do Studio, a edição em camadas, os perfis de saída e os comandos
de validação estão em [STUDIO_PREMIUM.md](./STUDIO_PREMIUM.md).

Os gestos obrigatórios, a matriz de recursos comparados com Edits/CapCut e os
critérios de aceite estão em [STUDIO_EDITOR_INTERACTIONS.md](./STUDIO_EDITOR_INTERACTIONS.md).

### Resolução e controles físicos da câmera

Na captura iOS, o botão da resolução alterna com um toque entre 720p, 1080p, 2K e 4K **disponíveis na câmera/FPS atuais**. Segurar o botão ou abrir os controles da câmera exibe as combinações. 2K usa aquisição 4K real e redução para 2560×1440 (1440×2560 em retrato) ao finalizar; se essa finalização falhar, o original 4K continua recuperável pelo journal. Câmeras limitadas a 1080p não recebem uma opção 2K/4K artificial.

Os controles PRO usam a mesma sessão AVFoundation: ISO, obturador limitado pelos FPS, foco relativo da lente e balanço de branco com temperatura/matiz. A faixa 2000–10000 K é uma janela de ajuste do produto; a conversão é limitada aos ganhos RGB aceitos pelo dispositivo e a interface mostra a temperatura efetivamente aplicada. Os ganhos RGB ficam em ajustes avançados. Alterar resolução/FPS retorna os controles para automático; mudar somente a orientação preserva os ajustes e o microfone. REC aguarda confirmação dos ajustes; uma confirmação interrompida exige tentar novamente ou retornar ao automático.

Os novos controles e a captura 2K requerem uma nova compilação iOS. Binários anteriores mantêm os recursos que já oferecem e ocultam os controles ausentes. A captura Android/Expo continua em 720p/1080p; 2K e controles físicos PRO não são anunciados sem implementação e capacidade nativa comprovadas. O seletor de saída do editor também aceita 720p, mantendo os originais e verificando a capacidade do exportador.

Validação sem abrir câmera: `npm run typecheck`, `npm run test:studio` e `bash modules/classfy-studio-media/tests/verify-capture-pro.sh`. O último comando executa arquivos reais 4K→2K em 24/60 FPS, verifica áudio/dimensões e testa a proteção dos ganhos; a confirmação física e a sensação dos gestos ainda precisam de QA no aparelho.

Referências: [Apple: exposição manual](https://developer.apple.com/documentation/avfoundation/avcapturedevice/setexposuremodecustom(duration:iso:completionhandler:)), [conversão de temperatura/matiz](https://developer.apple.com/documentation/avfoundation/avcapturedevice/devicewhitebalancegains(for:)-3wtsa) e [posição relativa da lente](https://developer.apple.com/documentation/avfoundation/avcapturedevice/lensposition).

## Escopo inicial

- Tabs: Home, Explore, Rewards, Profile
- Rotas: Watch, Creator, Auth, Settings
- Home busca `contents` aprovados do Supabase quando as variaveis publicas existem; sem env, usa preview local.

## Assinaturas oficiais no aplicativo

A tela Premium usa `expo-iap` 6.0.0 (StoreKit 2 e Google Play Billing), com preços localizados enviados pela loja. Não abre checkout Stripe para contratar planos. Uma assinatura feita na web continua válida na mesma conta Classfy; a gestão permanece no canal da compra original.

Compras são vinculadas ao UUID da conta Classfy (`appAccountToken` na Apple e `obfuscatedAccountId` no Google). O aplicativo envia a transação à função `mobile-subscription`; somente a confirmação do servidor permite finalizar a transação e atualizar o perfil. A restauração segue a mesma verificação. Transações pendentes ou com validação indisponível permanecem sem finalização para permitir nova tentativa.

### Ativação e validação

1. Criar os produtos mensais no App Store Connect: `br.com.classfy.pro.monthly` e `br.com.classfy.premium.monthly`, no mesmo grupo de assinaturas. Configurar ordem dos níveis, descrição, preços, territórios e revisão. São necessários Apple Developer Program e acordos bancários/tributários ativos para distribuição e cobrança reais.
2. No Google Play Console, criar `classfy_pro` e `classfy_premium`, cada um com plano base recorrente `monthly`, preços e territórios. Configurar testadores e um canal de testes antes de produção. O catálogo exibe apenas o plano mensal regular, sem selecionar ofertas introdutórias implicitamente.
3. Configurar as credenciais e notificações de servidor conforme a documentação da função `mobile-subscription`. Sem configuração, o catálogo fica desabilitado e o app informa que as assinaturas estão em preparação.
4. Gerar uma **nova compilação nativa** com o plugin `expo-iap`. Expo Go e instalações anteriores sem o módulo nativo não suportam compras; atualização JavaScript/Metro não adiciona esse módulo. É possível compilar e validar o app localmente sem publicar nem contratar EAS; a compra real depende das contas e produtos de cada loja.
5. Testar compra aprovada, pendente e cancelada, restauração, troca de conta Classfy, renovação, reembolso, expiração e falha de rede no sandbox de cada loja. Confirmar a atualização do plano no servidor e na web antes de habilitar produção.

Comandos de validação do cliente (na raiz do repositório):

```bash
npx vitest run mobile/src/features/billing --environment node
```

No diretório `mobile`, `npx tsc --noEmit` valida tipos e `npx expo config --type prebuild` valida o plugin. O fluxo de compra mantém transações não confirmadas no servidor recuperáveis por **Restaurar compras**; não concede acesso por resultado local da loja.

Referências: [Expo: compras no app](https://docs.expo.dev/guides/in-app-purchases/), [OpenIAP: Expo](https://openiap.dev/docs/setup/expo), [Apple: assinaturas](https://developer.apple.com/app-store/subscriptions/), [Google Play: assinaturas](https://developer.android.com/google/play/billing/subscriptions).
