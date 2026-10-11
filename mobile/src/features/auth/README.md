# Auth

Login por senha, cadastro e recuperação compartilham o Supabase da web.

O login Google usa o provedor já configurado no Supabase, uma sessão de autenticação
do sistema (`expo-web-browser`) e PKCE S256. Não exige um SDK nativo Google novo.

- O esquema `classfy` já está registrado em `app.json`.
- O Supabase deve permitir `classfy://auth/callback` e
  `classfy://auth/callback?attempt=*`, preservando os redirects existentes.
- `googleOAuth.ts` mantém a intenção de retorno em AsyncStorage; a rota
  `auth/callback` também conclui o acesso quando o app é reaberto pelo link.
- `oauth.ts` valida o callback, os IDs de conteúdo/live e deduplica a entrega
  simultânea do browser e Expo Router. Códigos/tokens nunca são registrados.
- `oauthPkce.ts` usa RNG e SHA-256 nativos do `expo-crypto` para gerar S256,
  evitando o fallback PKCE plain do SDK em Hermes. A troca continua usando
  `supabase.auth.exchangeCodeForSession`; nenhum global WebCrypto é alterado.
- Fechar a autenticação Google ou negar consentimento retorna ao login sem alerta.
- Cadastro com confirmação por email usa a página segura da web; recuperação usa
  o fluxo de email já adotado pela plataforma.

Verificação: `node --experimental-strip-types --test src/features/auth/oauth.test.mjs`
na pasta `mobile` e `npm run typecheck`. O sucesso desses checks não substitui
uma autenticação real em iOS/Android.

Referências: [Expo WebBrowser SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/webbrowser/),
[Supabase deep links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking),
[Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
