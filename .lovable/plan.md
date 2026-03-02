

# Revisao Geral - Terceira Bateria

## CRITICO

### 1. Shorts.tsx nao filtra por `status = 'approved'`
As queries `fetchInitialShorts` e `fetchMoreShorts` buscam shorts sem filtrar por status. Conteudos pendentes, rejeitados e rascunhos aparecem no feed publico para todos os usuarios.

**Correcao**: Adicionar `.eq("status", "approved")` em todas as queries de shorts.

### 2. Listen.tsx incrementa views com UPDATE direto (bypass de logica)
A pagina de podcast faz `UPDATE contents SET views_count = views_count + 1` diretamente, ignorando o RPC `increment_content_view` que previne auto-views do creator e views duplicados no mesmo dia. Resultado: creators inflam views dos proprios podcasts e cada reload conta como novo view.

**Correcao**: Substituir o UPDATE direto por `supabase.rpc("increment_content_view", ...)`.

### 3. Shorts.tsx usa `window.location.href` para redirect de auth
Na linha 591, `window.location.href = '/auth'` causa reload completo da SPA, destruindo todo o state do React. Deveria usar `<Navigate>` ou `navigate()`.

**Correcao**: Substituir por `return <Navigate to="/auth" replace />`.

---

## MEDIO

### 4. Shorts usa `favorites` para likes em vez de `actions`
Em `Shorts.tsx`, `checkLikeStatus` e `handleLike` usam a tabela `favorites` para registrar likes. Porem, `Watch.tsx` e `ContentActions.tsx` usam a tabela `actions` com `type: 'LIKE'`. Isso gera inconsistencia: um like dado em Shorts nao aparece como like em Watch e vice-versa. O trigger `sync_content_likes_count` tambem so escuta `actions`, nao `favorites`.

**Correcao**: Migrar Shorts para usar `actions` com `type: 'LIKE'`, consistente com o resto do sistema.

### 5. CreatorProfile nao mostra cursos (so busca `contents`)
A aba "Cursos" existe no perfil do creator, mas `loadCreatorProfile` so busca da tabela `contents` (que nao tem cursos — cursos ficam na tabela `courses`). A aba "Cursos" sempre aparece vazia.

**Correcao**: Fazer query adicional em `courses` e combinar os resultados, ou buscar cursos separadamente para a aba.

### 6. Carteira calcula stats com `value` (sempre 0 no novo sistema PP)
Em `Carteira.tsx`, os cards "Ultimos 7 dias", "Ultimos 30 dias" e "Este Mes" somam `r.value` dos reward_events. Desde a migracao para Performance Points, `value` e sempre 0. Todos os stats mostram R$ 0.00 permanentemente.

**Correcao**: Usar `performance_points` em vez de `value`, ou mostrar PP em vez de R$.

### 7. Carteira `getActionLabel` nao reconhece as action_keys reais
O mapeamento de labels usa keys antigas (`view`, `like`, `comment`) que nao existem mais. As keys reais sao `VIEW_15S`, `LIKE_CONTENT`, `WATCH_50`, `DAILY_LOGIN`, etc. O historico de ganhos mostra keys cruas em vez de labels legiveis.

**Correcao**: Atualizar o mapeamento para as action_keys reais do sistema.

### 8. `MobileShortsView` e `DesktopShortsView` usam `window.location.href` para navegacao
Navegacao para perfil de creator usa `window.location.href` (reload completo) em vez de React Router.

**Correcao**: Usar `useNavigate()` para navegacao interna.

---

## BAIXO / MELHORIAS

### 9. Index.tsx busca cursos sem filtro de status
A query de cursos na home (`courses`) nao filtra por `status = 'approved'`. Cursos em draft ou pendentes podem aparecer.

**Correcao**: Adicionar `.eq("status", "approved")`.

### 10. ContentCard faz RPC `is_content_boosted` para cada card
Cada ContentCard renderizado executa uma chamada RPC individual para verificar boost. Em uma pagina com 20+ cards, sao 20+ requests ao banco.

**Melhoria**: Fazer batch check no componente pai e passar `isBoosted` como prop, ou usar um hook compartilhado.

### 11. Conta.tsx busca `system_config` que pode nao existir
Se a tabela `system_config` nao tiver a key `minimum_withdrawal_amount`, o valor default e 10 — mas se a tabela nao existir, a query falha silenciosamente.

---

## Plano de Implementacao

### Tarefa 1: Corrigir Shorts - status filter + actions consistency
- Adicionar `.eq("status", "approved")` nas queries de shorts
- Migrar likes de `favorites` para `actions` (consistente com Watch)
- Substituir `window.location.href` por `<Navigate>` e `useNavigate()`

### Tarefa 2: Corrigir Listen.tsx - usar RPC para views
- Substituir o UPDATE direto por `supabase.rpc("increment_content_view")`

### Tarefa 3: Corrigir CreatorProfile - mostrar cursos
- Adicionar query em `courses` para popular a aba "Cursos"

### Tarefa 4: Corrigir Carteira - stats e labels
- Usar `performance_points` nos calculos de stats
- Atualizar `getActionLabel` com as action_keys reais

### Tarefa 5: Corrigir Index.tsx - filtrar cursos aprovados
- Adicionar `.eq("status", "approved")` na query de cursos

### Tarefa 6: Corrigir navegacao em Shorts views (Mobile/Desktop)
- Substituir `window.location.href` por `useNavigate()` em MobileShortsView e DesktopShortsView

