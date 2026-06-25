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
   npm install
   npm run start
   ```

Comandos uteis:

- `npm run ios`
- `npm run android`
- `npm run web`
- `npm run lint`

## Escopo inicial

- Tabs: Home, Explore, Rewards, Profile
- Rotas: Watch, Creator, Auth, Settings
- Home busca `contents` aprovados do Supabase quando as variaveis publicas existem; sem env, usa preview local.
