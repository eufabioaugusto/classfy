# Plano: Vincular Todos os Valores ao Pool Fixo

## Diagnóstico dos Problemas Encontrados

Existem **4 pontos onde dinheiro (R$) ainda é pago diretamente na wallet**, fora do pool:

1. `**reward_actions_config` com `value_user` / `value_creator**`: Os campos ainda existem e são exibidos no admin como "Valor Usuário" e "Valor Criador" (R$ 0.10, R$ 0.25, etc). Embora o `process-reward` já não credite valor direto (seta `value: 0`), os campos confundem e não têm mais propósito funcional no novo modelo.
2. `**useCreatorMilestones.ts` → `claimMilestone()**` (linhas 228-244): Quando um creator resgata uma meta (Publicador Bronze, Influenciador Prata, etc), o código **credita `value_reward` direto na wallet** do creator. Isso ignora totalmente o pool.
3. **Trigger `check_view_milestones()**` no banco: Quando um conteúdo atinge 100/500/1000 views, o trigger **credita `value_creator` direto na wallet** e usa os valores fixos da `reward_actions_config`. Também ignora o pool.
4. `**reverse-reward` edge function**: Tenta reverter `reward.value` da wallet, mas como `value` agora é sempre 0, a reversão financeira já é inócua. Porém o campo `performance_points` não é revertido do `economic_cycle_users`.

## Plano de Correções

### 1. Limpar tabela `reward_actions_config` no admin

- Remover colunas "Valor Usuário" e "Valor Criador" da tabela visual no admin (são enganosas)
- Renomear "Pontos Usuário" e "Pontos Criador" para "PP Usuário" e "PP Criador" (Performance Points)
- No dialog de edição, remover os campos `value_user` e `value_creator`
- Adicionar nota explicativa: "Os pontos definem o peso de performance. O valor em R$ é calculado proporcionalmente ao pool no fechamento mensal."

### 2. Migrar `claimMilestone()` para o modelo de pool

- Em vez de creditar `value_reward` direto na wallet, acumular Performance Points no `economic_cycle_users`
- Os `points_reward` da milestone continuam como XP de gamificação (instantâneo)
- O `value_reward` da milestone é convertido em PP adicional (ou um peso configurável)
- Atualizar toast e notificação para mostrar "+X PP" em vez de "R$ X"

### 3. Atualizar trigger `check_view_milestones()`

- Remover crédito direto na wallet (`UPDATE wallets SET balance = balance + value_amt`)
- Em vez disso, inserir PP no `economic_cycle_users` via chamada ao ciclo atual
- Manter a notificação mas sem mostrar valor em R$

### 4. Atualizar `reverse-reward` para reverter PP

- Além de deletar o `reward_event`, decrementar `performance_points` no `economic_cycle_users`
- Remover lógica de wallet (já não há valor direto)

### 5. Limpar tabela de milestones no admin

- Remover ou relabear coluna "Valor R$" para "PP Bônus" 
- Explicar que o valor monetário será proporcional ao pool

### 6. Atualizar `Recompensas.tsx` (dashboard do usuário)

- Na seção de milestones/metas do creator, não mostrar "R$ X.XX" como recompensa fixa
- Mostrar apenas pontos de performance e a estimativa proporcional ao pool

## Arquivos Afetados


| Arquivo                                      | Mudança                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `src/pages/AdminRewards.tsx`                 | Remover colunas value_user/value_creator, renomear pontos para PP |
| `src/hooks/useCreatorMilestones.ts`          | `claimMilestone()`: PP no pool em vez de wallet direta            |
| `supabase/functions/reverse-reward/index.ts` | Reverter PP no economic_cycle_users                               |
| `src/pages/Recompensas.tsx`                  | Ajustar exibição de recompensas de milestones                     |
| `src/components/CreatorMilestoneItem.tsx`    | Mostrar PP em vez de R$                                           |
| Migration SQL                                | Atualizar trigger `check_view_milestones()` para usar PP          |
| `src/components/CreatorStatsCard.tsx`        | Garantir que não mostra valores fixos em R$                       |


## Resultado

Após essas mudanças, **zero reais serão creditados fora do pool**. Todo valor monetário virá exclusivamente do fechamento mensal do ciclo econômico (`close-economic-cycle`), garantindo que a soma de payouts nunca ultrapasse o PRM.

A expectativa é que toda a logica de valores (as tabelas e itens) gire em torno do que está livre no pool, a ponto de se eu ou a receita alterar o valor do pool, isso tbm altera os itens. eles podem ter o controle manual, mas creio que o melhor seja setar o item por % em cima do pool, ao invez de valor fixo, assim independente do valor liberado no pool, o item tbm está vinculado a isso. Ex: like = 2%. Se tem 100 no pool ou 400, equivale a 2% mesmo assim. E o admin pode/deve editar esse valor manualmente quando quiser