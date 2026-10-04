# Validação isolada do workspace de prospecção

Pré-requisito: Docker já em execução. Não use o projeto Supabase remoto.

```bash
supabase start
supabase db reset
```

O `db reset` deve aplicar `20261004120000_manual_prospecting_workspace.sql`
sem alterar dados externos. Depois, use apenas usuários sintéticos:

1. Crie um usuário admin e um usuário comum no Auth local e atribua a role admin
   somente ao primeiro em `user_roles`.
2. Com o JWT do usuário comum, confirme que `select`, `insert` e a RPC
   `record_manual_prospect_event` são recusados.
3. Com o JWT admin, insira um prospect sintético com `source_url`, salve os
   campos de pesquisa, recarregue e confirme a persistência.
4. Registre `copied`, `opened` e `sent` pela RPC. Confirme a ordem do histórico
   e que somente `sent` altera `status/contacted_at`.
5. Marque `do_not_contact=true`; a RPC com evento `sent` deve falhar e não pode
   deixar uma linha órfã no histórico (a função é transacional).
6. Em duas sessões `psql`, abra transações e insira simultaneamente o mesmo
   `channel_id` com caixa diferente. A segunda sessão deve esperar a primeira e,
   após o commit, falhar com `duplicate prospect channel_id`.
7. Repita com URLs que diferem apenas por caixa/barra final.
8. Insira dois perfis distintos com o mesmo e-mail de agência; ambos devem ser
   aceitos.
9. Na UI local, importe um CSV sintético, cancele e reabra para confirmar que
   nada foi salvo; depois importe, edite, cancele e reabra para conferir que o
   último valor persistido permaneceu. Por fim salve e reabra para conferir o
   novo valor.

Encerre o ambiente isolado com `supabase stop`. Não execute `supabase link`,
`db push` ou qualquer comando com `--linked` durante este QA.

## Execução de 2026-10-04

Como Docker não estava disponível, a migração foi aplicada em PostgreSQL 18.6
descartável com fixtures compatíveis para `auth.uid()`, `user_roles` e
`has_role`. Passaram:

- migração sobre duas duplicatas legadas sem exclusão/mesclagem;
- negação de leitura, escrita e RPC para usuário não admin;
- persistência/releitura dos campos de pesquisa e rascunho;
- histórico `copied` + `sent` e atualização do status apenas em `sent`;
- rollback completo do evento quando `do_not_contact=true`;
- dois perfis distintos usando o mesmo e-mail de agência;
- concorrência real em duas sessões para `channel_id` e URL normalizados.

O cluster temporário foi desligado após os testes. Isso valida PostgreSQL/RLS e
as funções SQL, não GoTrue, PostgREST, Realtime ou os grants padrão de um projeto
Supabase completo. Os scripts reproduzíveis são `prospecting-db-fixture.sql`,
`prospecting-db-test.sql` e `prospecting-db-concurrency-test.sh`.
