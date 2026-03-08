

# Melhorias na Lógica de Pagamento de Pontos de Monetização

## Problemas Identificados

1. **Race condition no `reverse-reward`**: O revert de PP usa SELECT + UPDATE separados em vez do RPC atômico `increment_cycle_user_points` (com valor negativo). Isso pode causar inconsistências sob concorrência.

2. **Sem valor mínimo de payout**: O `close-economic-cycle` distribui qualquer valor, mesmo R$ 0.01. Micro-pagamentos geram custo operacional sem benefício real.

3. **Sem limite de participantes no pool**: Se houver milhares de usuários com poucos pontos cada, o valor individual pode ser insignificante. Não há threshold mínimo de PP para participar da distribuição.

4. **Query sem paginação no fechamento**: `economic_cycle_users` usa `.select('*')` sem `.range()`. Com muitos usuários, pode exceder o limite de 1000 rows do Supabase, resultando em usuários não pagos silenciosamente.

5. **Processamento sequencial no fechamento**: Cada usuário é processado com 4 queries sequenciais (update cycle_user, increment wallet, select wallet, insert transaction, insert notification). Em escala, isso pode causar timeout na edge function.

6. **Sem auditoria/reconciliação**: Não há log de fechamento que permita verificar se `distributed_amount` bate com a soma real dos `wallet_transactions` criados.

7. **Sem proteção contra fechamento duplo parcial**: Se a function falhar no meio do loop de distribuição, não há rollback -- alguns usuários recebem, outros não, e o ciclo não é marcado como "closed".

---

## Plano de Melhorias

### 1. Corrigir race condition no reverse-reward
Usar `increment_cycle_user_points` com valor negativo em vez de SELECT + UPDATE manual. Isso garante atomicidade.

### 2. Adicionar threshold mínimo de payout
No `close-economic-cycle`, pular usuários cujo `calculated_share` seja menor que R$ 0.10. Os pontos desses usuários seriam transferidos para o ciclo seguinte (carry-over).

### 3. Paginar a query de cycle_users
Substituir o `.select('*')` único por um loop paginado (batches de 500) para garantir que todos os usuários sejam processados, não apenas os primeiros 1000.

### 4. Adicionar estado intermediário "distributing"
Antes de iniciar o loop de pagamento, marcar o ciclo como `status: 'distributing'`. Isso evita que um retry do CRON ou trigger manual inicie uma segunda distribuição. Ao final, muda para `closed`.

### 5. Criar RPC de distribuição em batch
Mover a lógica de crédito (wallet + transaction + notification) para uma database function PostgreSQL que processa um batch de usuários atomicamente dentro de uma transaction. Isso reduz round-trips e garante consistência.

### 6. Adicionar log de reconciliação
Após o loop, fazer uma query de soma em `wallet_transactions` do tipo `pool_distribution` para o `year_month` e comparar com `distributed_amount`. Logar discrepâncias.

### 7. Carry-over de pontos não distribuídos
Para usuários abaixo do threshold mínimo, criar registros no ciclo seguinte com os pontos acumulados, garantindo que não se percam.

---

## Detalhes Técnicos

### Migration SQL
- Adicionar status `'distributing'` ao ciclo (ou usar text field existente)
- Criar RPC `distribute_cycle_payout(p_cycle_id, p_user_id, p_amount, p_year_month, p_user_pp, p_total_pp)` que faz INSERT em wallet_transactions + notification + UPDATE economic_cycle_users em uma transaction
- Criar RPC `carryover_cycle_points(p_from_cycle_id, p_to_cycle_id, p_min_payout)` para transferir pontos de usuários abaixo do threshold

### Edge Function: close-economic-cycle
- Adicionar paginação com loop `while` e `.range(offset, offset+499)`
- Adicionar estado `distributing` antes do loop
- Usar threshold de R$ 0.10 (configurável via `platform_settings`)
- Adicionar reconciliação ao final

### Edge Function: reverse-reward
- Substituir linhas 78-96 e 118-136 por chamadas a `increment_cycle_user_points` com valor negativo (`p_points: -ppToRevert`)

### Arquivos modificados
- `supabase/functions/close-economic-cycle/index.ts`
- `supabase/functions/reverse-reward/index.ts`
- 1 migration SQL (novas RPCs)

