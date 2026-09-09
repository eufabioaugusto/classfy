# Infraestrutura de vídeo

A identidade de cada vídeo pertence à Classfy (`media_assets.id`). Integrações externas vivem em
`media_provider_assets`, e o binding ativo pode ser trocado sem alterar conteúdos, progresso,
estudos ou relações da Classy.

## Fluxo VOD

1. O Studio chama `video-create-upload`.
2. A função seleciona o adapter via `VIDEO_PROVIDER` e cria o `media_asset` canônico.
3. O navegador envia o arquivo diretamente ao destino retornado (PUT no Mux, TUS no Bunny).
4. O webhook do provider normaliza o evento e atualiza binding e asset de modo idempotente.
5. O conteúdo armazena somente `media_asset_id`; campos Bunny antigos continuam como compatibilidade.
6. O player chama `video-playback`; a Classfy autoriza o usuário e retorna uma fonte HLS/MP4 genérica.

O Mux usa playback policy `signed`. Tokens são criados apenas na Edge Function e nunca usam
variáveis `VITE_*`. O tempo de vida cobre no mínimo a duração do vídeo mais margem.

## Configuração Mux e Supabase

Crie no ambiente correto do Mux um Access Token com permissão de vídeo, uma Signing Key para
playback e um webhook apontando para:

`https://<project-ref>.supabase.co/functions/v1/mux-webhook`

Eventos utilizados: `video.upload.asset_created`, `video.asset.created`, `video.asset.ready`,
`video.asset.errored` e `video.asset.deleted`. Guarde o signing secret exibido na criação do webhook.

Depois aplique `20260909190000_media_provider_architecture.sql`, configure os secrets listados em
`.env.example` com `supabase secrets set`, e publique `video-create-upload`, `video-playback` e
`mux-webhook`. A migration é aditiva e faz backfill dos registros Bunny sem apagar colunas antigas.

## Migração futura

Um worker poderá criar um segundo binding (`classfy`) para o mesmo asset, validar o novo playback e
trocar `active_provider_binding_id`. Os campos `master_storage_provider` e `master_storage_key`
reservam o modo `master_first`; permanecem nulos enquanto a ingestão for `direct_provider`.
