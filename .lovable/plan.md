

# Revisao Geral do Sistema - Segunda Bateria

Apos analise ampla do codebase (rotas, auth, rewards, edge functions, UI), aqui estao os problemas e melhorias encontrados, organizados por severidade.

---

## CRITICO

### 1. Rota duplicada no App.tsx (linha 122-123)
A rota `/creators/destaque/:slug` esta declarada **duas vezes identicas**. A segunda e ignorada pelo React Router, mas e lixo de codigo que pode causar confusao.

**Correcao**: Remover a linha 123 duplicada.

### 2. `upsertCycleUserPoints` NAO incrementa - sobrescreve
O upsert atual envia `performance_points: points` (o valor novo), nao `performance_points: existente + points`. Quando o Supabase faz o upsert com ON CONFLICT, ele **substitui** o valor em vez de somar. Resultado: o usuario perde todos os PP anteriores do ciclo, ficando apenas com os pontos da ultima acao.

O fallback (linhas 462-485) faz a soma corretamente, mas so e acionado quando o upsert **falha** — nao quando ele "funciona" sobrescrevendo.

**Correcao**: Criar uma funcao RPC no banco que faz `INSERT ... ON CONFLICT DO UPDATE SET performance_points = performance_points + $1` de forma atomica, ou alterar para sempre usar o fallback (SELECT + UPDATE).

### 3. `close-economic-cycle` tem race condition no credito de wallet
O loop de distribuicao faz `SELECT balance` + `UPDATE balance + share` separados para cada usuario. Se duas execucoes do fechamento de ciclo rodarem simultaneamente, podem corromper saldos.

**Correcao**: Usar uma unica query `UPDATE wallets SET balance = balance + $1, total_earned = total_earned + $1 WHERE user_id = $2` sem SELECT previo.

---

## MEDIO

### 4. `WEEKLY_STREAK` existe na config (50 pts) mas nao e chamada em nenhum lugar
A acao `WEEKLY_STREAK` existe na tabela `reward_actions_config` mas **nenhum codigo** (nem client nem server) a aciona. Sao 50 pontos configurados que nunca sao distribuidos.

**Correcao**: Implementar a logica no `checkDailyLogin` — quando `current_streak >= 7`, disparar `WEEKLY_STREAK`. Ou desativar a acao se nao for desejada.

### 5. Unlike mostra "R$ X" mas sistema usa PP (sem valor direto)
No `ContentActions.tsx` (linha 146), o dialog de unlike exibe: `"reduzira R$ {rewardValue.toFixed(2)} dos seus ganhos"`. Porem, desde a mudanca para PP puro, `reward.value` e sempre **0**. O dialog sempre mostraria "R$ 0.00" e nunca apareceria (ja que so abre se `rewardValue > 0`).

**Resultado**: O dialog de confirmacao de unlike **nunca abre** — o usuario descurte sem confirmacao.

**Correcao**: Decidir se mantem confirmacao baseada em PP (ex: "Voce perdera X pontos de performance") ou simplesmente remove o dialog.

### 6. Admin pages sem proteção consistente
- `AdminDashboard`: usa `useEffect` com `navigate("/")` se nao admin (flash de conteudo antes do redirect)
- `AdminContents`, `AdminTranscriptions`: usam `<Navigate>` (correto, sem flash)
- Outras admin pages: padroes mistos

**Correcao**: Padronizar todas as admin pages para usar `if (role !== 'admin') return <Navigate to="/" replace />` no render.

### 7. `SHARE_CONTENT` nao esta em nenhuma lista de unicidade no server
`SHARE_CONTENT` tem limite diario (15) mas nao esta em `DAILY_ACTIONS`, `UNIQUE_PER_CONTENT_ACTIONS`, nem `ONE_TIME_ACTIONS`. Cai no else generico, gerando tracking key `SHARE_CONTENT` (sem sufixo). Resultado: usuario so ganha reward de share **uma unica vez na vida** para todos os conteudos.

**Correcao**: Adicionar `SHARE_CONTENT` a `UNIQUE_PER_CONTENT_ACTIONS` (para recompensar uma vez por conteudo) ou a `DAILY_ACTIONS` (uma vez por dia).

### 8. `SUBSCRIBE_CREATOR` tracking key usa `metadata.creatorId` mas nao esta em nenhuma lista
Cai no else generico com `trackingKey = SUBSCRIBE_CREATOR_${creatorId}`, o que esta correto para impedir follow duplicado. Porem, o client em `useRewardSystem.ts` classifica `SUBSCRIBE_CREATOR` no else generico tambem, usando `metadata.creatorId` — isso esta **consistente**. Sem problema aqui.

---

## BAIXO

### 9. `WATCH_50` nao recompensa creator (points_creator = 0)
Na config, `WATCH_50` tem `points_creator: 0`. O creator so ganha PP quando o usuario completa 100% (`WATCH_100: points_creator = 5`). Pode ser intencional, mas vale revisar.

### 10. `PROFILE_COMPLETE` tem `points_creator: 30` — faz sentido?
Completar perfil nao envolve nenhum creator, mas a config da 30 pontos ao "creator". Como nao ha `creatorId` nessa acao, os 30 pontos nunca sao distribuidos (o `process-reward` so recompensa creator se `creatorId !== userId && creatorId exists`). O valor e inofensivo mas confuso.

**Correcao**: Setar `points_creator: 0` para `PROFILE_COMPLETE`.

### 11. Comments count nao exibido corretamente
No `ContentComments.tsx`, o count de comentarios mostrado (`{comments.length}`) so reflete os comentarios carregados **apos abrir** o componente. Antes de abrir, sempre mostra `(0)`.

---

## Plano de Implementacao

### Tarefa 1: Corrigir upsertCycleUserPoints (CRITICO)
Criar funcao RPC `increment_cycle_user_points(p_cycle_id, p_user_id, p_points)` no banco que faz incremento atomico, e chamar via `supabase.rpc()` no `process-reward`.

### Tarefa 2: Corrigir wallet update no close-economic-cycle
Substituir SELECT + UPDATE por UPDATE direto com `balance = balance + share`.

### Tarefa 3: Remover rota duplicada
Remover linha 123 do `App.tsx`.

### Tarefa 4: Implementar WEEKLY_STREAK ou desativar
Adicionar logica no `checkDailyLogin` ou desativar na config.

### Tarefa 5: Corrigir dialog de unlike
Trocar a mensagem de R$ para PP, ou remover o dialog de confirmacao.

### Tarefa 6: Corrigir SHARE_CONTENT unicidade
Adicionar a `UNIQUE_PER_CONTENT_ACTIONS` no server e no client.

### Tarefa 7: Limpar PROFILE_COMPLETE points_creator
Setar para 0 via SQL.

### Tarefa 8: Padronizar proteção de admin pages
Usar `<Navigate>` consistente em todas as paginas admin.

