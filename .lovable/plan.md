

# Revisao Completa do Sistema de Monetizacao

## Falhas e Inconsistencias Encontradas

### 1. CRITICO: Boost nao registra receita no pool
O `stripe-webhook` processa pagamento de boost mas **nao registra revenue_entry** para boosts. O `activate-boost` tambem nao registra. Isso significa que dinheiro de boosts **nao entra no calculo do PRM**, perdendo receita do pool.

**Correcao**: No `stripe-webhook`, ao processar `checkout.session.completed` com `metadata.boost_id`, registrar `revenue_entry` com `revenue_type: 'boost'`.

---

### 2. CRITICO: Webhook nao processa pagamento de Boost
O `stripe-webhook` verifica `metadata.content_id` para compra de conteudo e `mode === 'subscription'` para assinaturas, mas **nao verifica `metadata.boost_id`**. Quando o usuario paga um boost via Stripe Checkout, o webhook ignora completamente — o boost nunca e ativado automaticamente.

**Correcao**: Adicionar um case no webhook que detecta `metadata.boost_id` e chama `activate-boost` + registra receita.

---

### 3. MEDIO: `SHARE_CONTENT` nao esta no anti-fraude
A acao `SHARE_CONTENT` existe na config (5 pts) e e processada pelo `ShareButton`, mas **nao tem limite diario** em `DAILY_ACTION_LIMITS` no `process-reward`. Um usuario poderia farmear shares ilimitadamente.

**Correcao**: Adicionar `SHARE_CONTENT: 15` ao `DAILY_ACTION_LIMITS`.

---

### 4. MEDIO: `BINGE_WATCH` nao tem controle de unicidade adequado
`BINGE_WATCH` nao esta em nenhuma lista de unicidade (`DAILY_ACTIONS`, `UNIQUE_PER_CONTENT_ACTIONS`, `ONE_TIME_ACTIONS`). Cai no else generico, gerando tracking key `BINGE_WATCH` sem sufixo. Na pratica, so recompensa uma vez na vida toda (pois a key e sempre a mesma). Deveria ser diaria.

**Correcao**: Adicionar `BINGE_WATCH` ao array `DAILY_ACTIONS` no `process-reward`.

---

### 5. MEDIO: `FIRST_CONTENT_WEEK` esta classificado como DAILY no server mas como daily no client
No `process-reward` (server), `FIRST_CONTENT_WEEK` esta em `DAILY_ACTIONS`, gerando key `FIRST_CONTENT_WEEK_2026-03-02`. Mas a logica do client em `useRewardSystem` tambem o classifica como daily. Isso esta **correto e consistente**. No entanto, a descricao diz "Primeira aula da semana" — deveria ser semanal, nao diaria. Se a intencao e semanal, a key deveria usar a semana, nao o dia.

**Correcao**: Mudar para tracking semanal ou manter diario e renomear a descricao para "Primeiro conteudo do dia".

---

### 6. BAIXO: Simulador - "Views" mapeia para SAVE_CONTENT
No `PoolSimulator`, o tipo "Views" (`key: "views"`) mapeia para `actionKeys: ["SAVE_CONTENT"]`. Isso e incorreto semanticamente — views deveria mapear para `VIEW_15S` ou `WATCH_50/WATCH_100`.

**Correcao**: Mudar para `actionKeys: ["VIEW_15S", "WATCH_50"]` ou remover o filtro "Views" e substituir por "Assistir".

---

### 7. BAIXO: `reverse-reward` nao reverte recompensa do creator
Quando um usuario descurtir conteudo, o `reverse-reward` reverte o reward do usuario, mas **nao reverte o reward do creator** (que tambem ganhou PP pela curtida). O creator mantem PP indevidamente.

**Correcao**: Apos reverter reward do usuario, buscar e reverter tambem o reward com `metadata.as_creator: true` para o mesmo `content_id` e `action_key`.

---

### 8. BAIXO: `upsertCycleUserPoints` tem race condition
A funcao faz SELECT + UPDATE separados sem transacao. Duas chamadas simultaneas podem ler o mesmo valor e perder pontos.

**Correcao**: Usar `ON CONFLICT ... DO UPDATE SET performance_points = performance_points + $value` diretamente no INSERT (ja existe no trigger `check_view_milestones`, mas nao na edge function).

---

### 9. INFO: `reward_events` nao salva `course_id`
Quando o contentId resolve para um curso (`resolvedCourseId`), o `process-reward` salva `content_id: null` no reward event. O course_id e salvo apenas no metadata. Nao impacta funcionalidade, mas dificulta queries futuras.

---

## Plano de Implementacao

### Tarefa 1: Corrigir webhook para processar boosts
Adicionar ao `stripe-webhook/index.ts`:
- Detectar `metadata.boost_id` no `checkout.session.completed`
- Chamar `activate-boost` (ou ativar inline)
- Registrar `revenue_entry` com tipo `boost`

### Tarefa 2: Corrigir anti-fraude
No `process-reward/index.ts`:
- Adicionar `SHARE_CONTENT: 15` ao `DAILY_ACTION_LIMITS`
- Adicionar `BINGE_WATCH` ao `DAILY_ACTIONS`

### Tarefa 3: Corrigir simulador
No `PoolSimulator.tsx`:
- Mudar "Views" para mapear `VIEW_15S` e `WATCH_50`
- Renomear label para "Assistir"

### Tarefa 4: Corrigir reverse-reward para creator
No `reverse-reward/index.ts`:
- Apos reverter reward do usuario, reverter tambem o do creator

### Tarefa 5: Corrigir race condition em upsertCycleUserPoints
No `process-reward/index.ts`:
- Usar INSERT ON CONFLICT em vez de SELECT + UPDATE

### Tarefa 6: Decidir sobre FIRST_CONTENT_WEEK
- Renomear descricao para "Primeiro conteudo do dia" ou mudar tracking para semanal

