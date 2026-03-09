

## Plano: Converter pontos de INTEGER para NUMERIC (decimal)

### Problema
As colunas `points_user` e `points_creator` na tabela `reward_actions_config` são do tipo **INTEGER**, impedindo valores decimais como 0.3. Além disso, a coluna `points` em `reward_events` também é INTEGER. Isso força valores mínimos de 1 ponto por ação, o que com poucos usuários resulta em valores R$ por ação muito altos.

**Os valores já foram atualizados** no banco (LIKE=1, COMMENT=1, etc.) pela migration anterior. O que falta é permitir decimais para granularidade maior.

### Mudanças necessárias

**1. Migration: Alterar colunas de INTEGER para NUMERIC**
- `reward_actions_config.points_user`: INTEGER → NUMERIC(10,2)
- `reward_actions_config.points_creator`: INTEGER → NUMERIC(10,2)
- `reward_events.points`: INTEGER → NUMERIC(10,2)

**2. Migration: Atualizar valores para decimais**
Nova tabela de valores proposta:

| Ação | User | Creator |
|------|------|---------|
| VIEW_15S | 0.10 | 0.15 |
| LIKE_CONTENT | 0.30 | 0.50 |
| SAVE_CONTENT | 0.20 | 0.30 |
| FAVORITE_CONTENT | 0.20 | 0.30 |
| COMMENT_CONTENT | 0.80 | 0.50 |
| SHARE_CONTENT | 0.80 | 1.50 |
| WATCH_50 | 1.50 | 0.50 |
| WATCH_100 | 3.00 | 1.00 |
| SUBSCRIBE_CREATOR | 0.50 | 2.00 |
| DAILY_LOGIN | 0.50 | 0 |
| BINGE_WATCH | 3.00 | 0 |
| FIRST_CONTENT_WEEK | 1.50 | 0 |
| WEEKLY_STREAK | 5.00 | 0 |
| PROFILE_COMPLETE | 2.00 | 0 |
| CONTENT_APPROVED | 0 | 10.00 |
| FIRST_UPLOAD | 0 | 20.00 |
| COMPLETE_COURSE | 10.00 | 5.00 |
| MILESTONE_100_VIEWS | 0 | 15.00 |
| MILESTONE_500_VIEWS | 0 | 30.00 |
| MILESTONE_1000_VIEWS | 0 | 50.00 |

**3. Edge Function `process-reward`**
- Remover `Math.floor()` dos cálculos de `userPoints` e `creatorPoints` (linhas 306, 366) para preservar decimais.

**4. Edge Function `reverse-reward`**
- Verificar que não trunca valores decimais (já usa NUMERIC para `performance_points`, apenas `points` precisa atenção).

**5. Frontend - `AdminRewards.tsx`**
- Atualizar exibição das colunas "Pontos Usuário" e "Pontos Criador" para mostrar decimais (usar `.toFixed(2)` ou formatação inteligente).
- No dialog de edição, permitir input de decimais (step="0.01").

**6. Frontend - `PoolSimulator.tsx`**
- Já usa valores do banco, vai funcionar automaticamente com decimais.

**7. Frontend - `useRewardSystem.ts` / toast de recompensa**
- Atualizar o toast para exibir pontos com decimais quando necessário.

**8. DB Function `check_view_milestones`**
- Remover `FLOOR()` dos cálculos de `points_amt` (linha que faz `FLOOR(reward_config.points_creator * plan_mult)`) para preservar decimais.

### Resultado
- Com 1 usuário: recebe 100% do pool (ex: R$ 160)
- Com 1000 usuários: cada um recebe sua proporção do pool
- Valores por ação ficam muito menores (0.10 vs 1), tornando o simulador e os totais mais realistas
- A lógica proporcional não muda - apenas a granularidade dos pesos

