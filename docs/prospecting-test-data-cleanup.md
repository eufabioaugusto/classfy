# Prospects de teste: backup, limpeza e restauração

Este procedimento só deve ser executado após a migração do workspace manual e
com confirmação explícita do responsável. Nada nesta mudança apaga os 22
registros atuais.

## Backup antes da limpeza

1. Exporte os prospects pela nova ação **Exportar CSV** para revisão humana.
2. Faça um backup transacional no banco:

```sql
create table public.prospects_backup_20261004 as
select * from public.prospects;

create table public.prospect_outreach_events_backup_20261004 as
select * from public.prospect_outreach_events;
```

3. Compare as contagens das tabelas de backup e origem antes de prosseguir.

## Limpeza controlada

Marque os IDs de teste explicitamente em uma tabela temporária ou lista
revisada. Não use `truncate` e não filtre apenas por data. Exclua somente os IDs
aprovados, em uma transação, depois de conferir a contagem afetada.

## Restauração

Caso seja necessário restaurar, insira novamente os registros pela chave `id`
a partir das tabelas de backup. Restaure `prospects` antes do histórico, por
causa da chave estrangeira. Valide as contagens e só então remova os backups.

## Captação futura

A captação deve entrar por uma função separada que grave `source_url`,
`source_label`, `researched_at` e evidências de qualificação, aplicando os
índices únicos de `channel_id` e `channel_url`. Ela não deve gerar contatos
falsos, enviar mensagens nem alterar automaticamente o estado para enviado.
