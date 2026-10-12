# Classy do creator

Ideias e roteiro falado em português, antes da ação de gravar. Usa o provedor já
configurado em `_shared/ai-provider.ts`, sem alterar o chat, planos ou Points.

## Contrato

`POST /functions/v1/studio-ideas`, sessão Supabase válida e creator aprovado ou
admin. O servidor resolve a identidade e todo o contexto; não aceita conteúdo,
owner ou roteiro enviados como base pelo cliente.

- `{action:"context", categoryId?}`: categorias oficiais, até oito publicações
  próprias aprovadas, `source`, `suggestions` já salvas, `cached`, `generatedAt`.
  Não chama IA. Sem histórico e sem categoria, `source.type` é `empty`.
- `{action:"suggest", categoryId?, refresh?, requestId:UUID}`: exatamente três
  sugestões, `source`, `cached`, `generatedAt`. Categoria explícita usa apenas
  essa categoria; sem ela, usa título, descrição, tags e categoria dos conteúdos
  recentes. Nunca consulta comentários, métricas, estudos ou chats privados.
- `{action:"script", suggestionId:UUID, kind:"aula"|"short"|"podcast",
  durationMinutes:inteiro, requestId:UUID}`: `draft` com `kind`, `title`,
  `description`, `objective`, `audience`, `script`, `tags`, mais `suggestionId`,
  `durationMinutes`, `cached`, `generatedAt`. A sugestão deve existir no cache do
  próprio owner. Duração de 1 a 10 minutos, com Short limitado a 3. O texto é
  falado, dividido em parágrafos, revisável antes da gravação.
- `{action:"cancel", requestId:UUID}`: encerra a geração ativa desse request e
  impede um resultado atrasado de ser salvo. A tentativa continua contando no
  orçamento, pois o provedor pode já estar processando. Fechar um sheet não deve
  cancelar automaticamente: o resultado pode continuar salvo para a próxima
  abertura.

Sugestão: `{id,title,summary,objective,audience,tags,kind,durationMinutes}`. IDs
gerados pelo servidor. `source`: `{type:"recent"|"category"|"empty",label,
contentIds,categoryId}`. A fonte é factual, sem explicações de popularidade
inventadas pela IA.

Erros: `{error,code,retryAfterSeconds?}`. `unauthorized` 401,
`creator_required` 403, `suggestion_not_found`/`category_not_found` 404,
`generation_in_progress`/`request_conflict`/`request_failed` 409,
`context_required` 422, `generation_limit` 429,
`ai_unavailable`/`ai_invalid_response`/`generation_failed` 503. A UI deve
preservar o UUID em retries da mesma tentativa; uma nova geração usa novo UUID.
Falhas do adaptador podem incluir `diagnostic` seguro (`provider`, status HTTP,
`finishReason` em allowlist e número de caracteres). Nunca inclui corpo, roteiro,
metadados do creator, chave ou mensagem bruta do provedor. HTTP é verificado antes
do parse do JSON; saída vazia/truncada recebe `ai_invalid_response`.

O orçamento local é de 6.000 tokens para sugestões e 6.000 a 8.192 para roteiros.
Gemini 2.5 compartilha esse limite entre raciocínio e resposta; atingir o limite
durante o raciocínio pode produzir `MAX_TOKENS` e saída vazia. Não há retry oculto
nem aumento de custo em outros recursos Classy.
[Documentação oficial do Google](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en).

## Cache e segurança

Migração `20261011195000_studio_ideas_private_cache.sql`. Cache por owner e hash
dos metadados, sete dias para ideias e trinta para roteiros. Mesma ideia, formato
e duração reutilizam o roteiro. A abertura da tela lê `context` sem gerar.
Reservas e idempotência são serializadas por owner via advisory lock transacional
e índice de uma geração ativa. Limites móveis: 12 lotes de ideias e 24 gerações
totais por 24h, cooldown de 60s para atualizar ideias e 120 IDs de request/dia
para limitar aliases do cache. Resultados expirados são limpos oportunisticamente
após sete dias adicionais, sem scheduler. O retry do mesmo UUID pode recuperar o
resultado já confirmado durante essa retenção adicional: a validade de novas
consultas continua limitada ao TTL, enquanto a idempotência evita outra chamada
ao provedor numa resposta tardia. RLS permite apenas leitura própria;
escrita e RPCs são exclusivas do service_role. A Edge confirma creator/admin, e
a reserva repete a permissão no banco.

Nada é publicado automaticamente. Roteiros usados pelo creator devem ser
persistidos no projeto local pelo cliente. Cancelamento, falha e lease de 150s
impedem jobs presos ou commits atrasados. Saída da IA é validada antes de salvar;
erros/logs contêm apenas códigos seguros.

## Validação

```sh
deno check --no-lock supabase/functions/studio-ideas/index.ts
deno test --no-lock supabase/functions/studio-ideas/core_test.ts supabase/functions/studio-ideas/ai_test.ts
```

`tests/cache_test.sql` cria fixtures/roles e aplica a migração dentro de uma
transação com rollback: execute **somente num PostgreSQL local descartável**.
Inclui RLS, permissões, isolamento por owner, reserva, idempotência, cancelamento,
lease, cooldown e limites. Duas conexões concorrentes também foram verificadas
localmente: apenas uma reservou a geração; a outra recebeu `pending`.

Deploy requer a migração e a Edge Function `studio-ideas` (`verify_jwt=true`).
Não requer novos segredos se o provedor Classy já estiver configurado. Geração
real e UI precisam ser validadas no ambiente após o deploy.
