# Plano de publicação — prospecção manual

Este plano não autoriza execução. O alvo configurado no repositório é o projeto
Supabase `jeqezibfollsvdknfebj` e a aplicação publicada é a Classfy/Lovable que
serve `classfy.com.br/admin/prospects`.

## Pré-checagens

1. Confirmar no painel Supabase que o projeto aberto tem exatamente o ref
   `jeqezibfollsvdknfebj` e pertence à Classfy.
2. Confirmar no Lovable que o projeto é
   `37355d1b-86cf-4c44-8c9a-dd5a87a782b0` e que o domínio publicado é
   `classfy.com.br`.
3. Confirmar que o checkout de publicação ainda parte do commit
   `14f40a366b009f60029190e400eeedd846c28e41`; se mudou, revisar o novo diff.
4. Registrar contagens por status e a contagem total de prospects. A expectativa
   atual observada é 22 registros, que devem ser preservados.

## Backup

Antes da migração, confirmar que existe backup recuperável do projeto no painel
Supabase. Além disso, criar uma cópia lógica dos registros do módulo, com nome
datado, dentro de uma transação administrativa aprovada:

```sql
create table public.prospects_backup_20261004 as
select * from public.prospects;
```

Depois da migração e antes de qualquer limpeza futura, copiar também o histórico:

```sql
create table public.prospect_outreach_events_backup_20261004 as
select * from public.prospect_outreach_events;
```

Comparar contagens origem/backup. Não apagar os backups nesta publicação.

## Ordem de publicação

1. Aplicar `20261004120000_manual_prospecting_workspace.sql` no projeto
   confirmado.
2. Validar campos, políticas, grants, função RPC e contagem dos 22 registros.
3. Publicar `send-prospect-email` como tombstone `410 MANUAL_OUTREACH_ONLY`.
   Isso garante que clientes antigos não enviem enquanto o frontend atualiza.
4. Publicar o frontend com o workspace manual.
5. Verificar `/admin/prospects` como admin e como usuário não admin.

## Smoke test sem contato externo

- a página carrega os mesmos 22 registros;
- busca e filtros funcionam;
- abrir e cancelar a preparação não altera dados;
- salvar uma alteração sintética/reversível em um dos registros de teste persiste
  após reabrir;
- importar o CSV sintético chega à prévia e é cancelado;
- “Não contatar” remove ações manuais;
- copiar um rascunho não muda status;
- não clicar em `mailto:`, `ig.me` nem “Marcar enviado” no smoke test;
- chamada direta ao endpoint antigo retorna 410 e não cria histórico.

## Rollback seguro

O rollback preferido é de aplicação, sem destruir o schema aditivo:

1. Reverter o frontend para o artefato anterior se a nova tela falhar.
2. Manter o tombstone de e-mail para continuar impedindo disparos acidentais.
3. Manter campos/tabela/índices novos; eles são aditivos e não afetam as 22
   linhas antigas.
4. Se dados do módulo forem alterados incorretamente, restaurar somente os IDs
   afetados a partir de `prospects_backup_20261004`, dentro de transação e após
   comparar os valores.

Não remover colunas, tabela de histórico, trigger ou função RPC durante o
rollback imediato. Uma reversão destrutiva de schema deve ser planejada à parte,
depois de exportar o histórico e confirmar que nenhum dado novo precisa ser
preservado.
