# Desenvolvimento ao vivo no iPhone e no simulador

O aplicativo usa uma development build com `expo-dev-client`. As alterações de
TypeScript e estilos chegam pelo Metro/Fast Refresh. Dependências nativas e
mudanças de configuração exigem recompilar o aplicativo.

## Preparar o Mac

- Instalar Xcode pela App Store, abrir e concluir a instalação dos componentes.
- Instalar o runtime iOS para usar o simulador.
- Instalar CocoaPods (`brew install cocoapods`).
- Configurar a equipe de assinatura no Xcode para instalar no iPhone.

Se `xcode-select -p` ainda apontar para CommandLineTools após reinstalar Xcode,
usar `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` no terminal
antes dos comandos iOS. Isso seleciona Xcode para a sessão sem alterar o sistema.

As credenciais Apple e o pareamento ficam no Mac/aparelho, fora do repositório.

## Preparar o projeto

Na pasta `mobile`, instalar o lockfile com `npm ci`. Configurar `.env.local`
com as variáveis públicas descritas no README, sem versionar o arquivo.

```sh
npm run check:dependencies
npm run typecheck
```

## Abrir no iPhone

Conectar e desbloquear o aparelho, confiar no Mac se solicitado e habilitar
Modo de Desenvolvedor nas configurações do iPhone quando necessário.

```sh
npm run ios:device
```

O comando gera a estrutura iOS quando necessário, instala os Pods, compila,
instala e inicia o servidor. Se solicitar assinatura, configurar a equipe Apple
no projeto gerado. Não alterar o bundle identifier para contornar um erro de
assinatura sem entender a configuração existente.

### Equipe Apple pessoal gratuita

Para testar com uma equipe pessoal que não suporta push remoto:

```sh
npm run ios:device:personal
```

Essa variante chama-se **Classfy Dev**, usa `br.com.classfy.mobile.dev` e remove
somente nela o entitlement de push. O registro de token também fica desativado.
O app normal mantém sua configuração. Iniciar o Metro correspondente com
`npm run start:personal`. Para retornar ao app normal, executar prebuild sem
`CLASSFY_IOS_PERSONAL_TEAM` e recompilar. Push remoto precisa ser validado numa
build assinada por equipe que suporte essa capacidade.

## Abrir no simulador

```sh
npm run ios
```

## Trabalhar depois da primeira instalação

```sh
npm start
```

Abrir Classfy no iPhone e conectar ao servidor apresentado pelo Metro.
Mac e iPhone devem ter conectividade entre si na rede local. O cabo permite
instalação e pareamento, mas não substitui automaticamente essa conectividade.

Para uma inspeção de layout no browser, usar `npm run web`. Isso não substitui
validação de player, permissões, teclado, gestos e ciclo de vida no iOS.

## Acesso remoto ao Classfy Dev

O launcher descobre servidores da mesma rede; os recentes `192.168...:8081` não ficam acessíveis em 5G/outra rede. Para testar remotamente, disponibilizar Metro por túnel HTTPS e configurar o endereço público **também no manifest, bundle e assets**. Isso não publica em produção e não instala mudanças nativas.

Com o binário oficial `ngrok` já instalado/configurado no Mac:

```sh
ngrok http http://127.0.0.1:8081 --inspect=false
```

Usar a URL HTTPS retornada para iniciar o Metro no worktree correto. Encerrar o Metro anterior desse worktree antes de ocupar a mesma porta; não encerrar outros servidores indiscriminadamente.

```sh
CLASSFY_IOS_PERSONAL_TEAM=1 EXPO_PACKAGER_PROXY_URL='https://DOMINIO-DO-TUNEL' npx expo start --dev-client --localhost --port 8081
```

Esse proxy foi confirmado no Expo54 instalado. Sem `--tunnel`, não precisa instalar o pacote JS `@expo/ngrok`. A alternativa oficial `expo start --tunnel` usa esse pacote. A URL é uma origem sem caminho. O endereço público não substitui a configuração do runtime nativo.

No iPhone: Classfy Dev → **Enter URL manually** → colar a URL HTTPS → conectar. Um link `exp+classfy-mobile://expo-development-client/?url=URL_HTTPS_CODIFICADA` também abre a mesma build. Mac, Metro e túnel precisam continuar ativos; a descoberta automática pode continuar vazia no 5G. Mudanças JS/estilos compatíveis chegam por esse servidor; módulos nativos continuam exigindo nova instalação. EAS Update não está configurado nesta build.

Validar sem imprimir manifest completo/variáveis de ambiente: `/status` responde `packager-status:running`; `/` com `Expo-Platform: ios` e `Accept: application/expo+json,application/json` retorna manifest; `launchAsset.url` deve usar o domínio público e responder com o bundle iOS. Abrir esse endereço no Dev Client confirma a cadeia. Não anunciar acesso no telefone do usuário apenas por teste no simulador.

## Recompilar

Depois de mudar dependências nativas ou `app.json`, executar `npm run ios` ou
`npm run ios:device` novamente. Se a configuração gerada precisar ser atualizada,
usar `npx expo prebuild --platform ios` antes da compilação. As pastas `ios` e
`android` são geradas e ignoradas pelo Git; configurações duráveis ficam em
`app.json`, plugins e dependências.

## Limites

Exportar o bundle com `expo export` verifica empacotamento JavaScript. Somente
compilar, instalar e abrir confirma funcionamento nativo. Desenvolvimento local
não publica em App Store, TestFlight, Vercel ou Supabase.

Referências: [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
e [DevClient SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/dev-client/).

## Inspeção do player

A rota `classfy://dev/player` abre uma prévia com HLS público da Mux na build
de desenvolvimento. Usa o mesmo provider/controles/miniplayer do Watch, com
tracking desativado. Dá para testar pausa, avanço, minimizar/expandir e tela cheia
sem registrar progresso ou Points. Em distribuição, a rota retorna à Home.

Depois de instalar `expo-video`, regenerar iOS e executar `pod install` antes
de compilar. O player e miniplayer do Watch usam expo-video SDK 54; outras telas
e gravação de voz ainda podem usar expo-av e serão migradas em rodadas próprias.
