

# Analise: O que Temos vs O que Precisa Ser Criado para o Pool Fixo

## O que JA EXISTE

| Componente | Status | Detalhes |
|---|---|---|
| `reward_actions_config` | Existe | 19 acoes configuradas com `points_user`, `points_creator`, `value_user`, `value_creator` fixos |
| `reward_events` | Existe | Registra cada recompensa com pontos e valor |
| `reward_action_tracking` | Existe | Prevencao de duplicatas |
| `wallets` | Existe | Saldo, total ganho, total sacado |
| `wallet_transactions` | Existe | Historico de transacoes |
| `user_login_streaks` | Existe | Streaks de login |
| `user_levels` | Existe | Nivel e pontos totais |
| `profiles.plan` | Existe | free/pro/premium com multiplicadores |
| `process-reward` edge function | Existe | Paga valor fixo da config direto na wallet |
| `stripe-webhook` | Existe | Processa assinaturas e compras de conteudo |
| `purchased_contents` | Existe | Registro de compras |
| `boosts` | Existe | Receita de boost com budget |
| `withdraw_requests` | Existe | Saques com taxa |
| `AdminRewards.tsx` | Existe | Painel admin para editar recompensas |
| `Recompensas.tsx` | Existe | Dashboard do usuario com pontos, nivel, streak |
| `CreatorStatsCard` | Existe | Card com XP e ganhos |

## O que PRECISA SER CRIADO (nao existe nada disso)

### Banco de Dados (novas tabelas)

1. **`platform_settings`** -- Config global do admin (pool_percentage, etc)
2. **`economic_cycles`** -- Ciclo mensal: RBM, PRM, total_points, status (open/closed)
3. **`economic_cycle_users`** -- Performance points por usuario por ciclo
4. **`revenue_entries`** -- Registro granular de cada entrada de receita (assinatura, boost, venda, saque taxa)

### Mudancas em Tabelas Existentes

- `reward_actions_config`: Os campos `value_user` e `value_creator` deixam de ser usados para pagamento direto. Mantemos `points_user` e `points_creator` como **peso** (Performance Points weight) em vez de pontos absolutos.
- `reward_events`: Adicionar campo `cycle_id` (referencia ao ciclo economico) e `performance_points` (pontos de performance, separados do XP)
- `wallets`: Sem mudanca estrutural, mas o credito passa a ser feito apenas no fechamento mensal

### Edge Functions (novas)

1. **`close-economic-cycle`** -- Funcao mensal (cron) que:
   - Calcula RBM somando `revenue_entries` do mes
   - Calcula PRM = RBM * pool_percentage
   - Soma total de performance points de todos usuarios
   - Distribui proporcionalmente: `user_share = (user_points / total_points) * PRM`
   - Credita nas wallets
   - Marca ciclo como `closed`

2. **`record-revenue`** -- Chamada pelo stripe-webhook para registrar cada receita

### Edge Functions (modificacoes)

- **`process-reward`**: Deixa de creditar valor na wallet em tempo real. Passa a acumular performance points no `economic_cycle_users`. XP continua sendo creditado normalmente para gamificacao.
- **`stripe-webhook`**: Apos processar pagamento, chama `record-revenue` para registrar na tabela de receitas.

### Frontend (novo)

1. **Admin: Aba "Economia" no AdminRewards** -- pool_percentage, RBM em tempo real, PRM estimado, simulador
2. **Usuario: Secao "Pool" no Recompensas.tsx** -- Pool estimado, seus performance points, estimativa de ganho, posicao relativa

### Frontend (modificacoes)

- `process-reward` hook: Nao mostra mais toast com "voce ganhou R$X" em tempo real (pois nao ha pagamento instantaneo). Mostra apenas "+X pontos de performance"
- `CreatorStatsCard`: Separar XP (progressao) de Performance Points (economico)
- `AdminRewards.tsx`: Adicionar aba de controle economico

## Arquitetura do Fluxo

```text
RECEITA ENTRA (Stripe webhook)
  |
  v
revenue_entries (registra tipo, valor, mes)
  |
  v
ACAO DO USUARIO (like, watch, etc)
  |
  v
process-reward:
  - XP -> user_levels (gamificacao, instantaneo)
  - Performance Points -> economic_cycle_users (acumula no ciclo)
  - NAO credita valor na wallet
  |
  v
FECHAMENTO MENSAL (cron, dia 1 do mes seguinte)
  |
  v
close-economic-cycle:
  1. RBM = SUM(revenue_entries do mes)
  2. PRM = RBM * pool_percentage (ex: 40%)
  3. total_pp = SUM(economic_cycle_users.performance_points)
  4. Para cada usuario: share = (user_pp / total_pp) * PRM
  5. Credita na wallet
  6. Fecha ciclo
```

## Fases de Implementacao

**Fase 1: Infraestrutura** (tabelas + settings)
- Criar `platform_settings`, `economic_cycles`, `economic_cycle_users`, `revenue_entries`
- RLS policies para todas as tabelas
- Seed com `pool_percentage = 40`

**Fase 2: Captura de Receita**
- Modificar `stripe-webhook` para registrar em `revenue_entries`
- Registrar: assinaturas, compras de conteudo, boosts

**Fase 3: Acumulo de Performance Points**
- Modificar `process-reward` para acumular PP em vez de pagar direto
- Manter XP separado para gamificacao
- Atualizar toasts no frontend

**Fase 4: Painel Admin**
- Aba "Economia" com pool_percentage, RBM, PRM, simulador

**Fase 5: Fechamento Mensal**
- Edge function `close-economic-cycle`
- Cron job para executar no dia 1

**Fase 6: Dashboard do Usuario**
- Pool estimado, performance points, estimativa de ganho

## Notas Tecnicas

- O XP de gamificacao (niveis, badges) continua funcionando como hoje -- instantaneo, nao muda
- Apenas o **valor monetario** (R$) passa para o modelo de pool
- Os pontos na `reward_actions_config` passam a representar **pesos** de performance, nao valor absoluto
- Antifraude: limites diarios e curva decrescente podem ser implementados como regras na `process-reward`
- O campo `value_user`/`value_creator` na config pode ser mantido como referencia historica mas nao sera usado no calculo

