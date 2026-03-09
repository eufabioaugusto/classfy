

# Revisao Geral - Quarta Bateria

## CRITICO

### 1. Studio.tsx mostra earnings com multiplicador hardcoded `* 2`
Na linha 352, o card de Ganhos exibe `(stats.earnings * 2).toFixed(2)` com label "Ganhos (em dobro)". Isso e arbitrario, nao reflete nenhuma regra de negocio real e engana o creator mostrando o dobro do que realmente ganhou.

**Correcao**: Mostrar `stats.earnings` sem multiplicador, ou mostrar Performance Points se o sistema ja migrou.

### 2. Studio.tsx faz 10+ queries sequenciais no dashboard
`fetchDashboardData` faz ~10 queries separadas ao banco, sem `Promise.all`. Cada uma espera a anterior terminar. O dashboard do creator e lento desnecessariamente.

**Correcao**: Agrupar queries independentes em `Promise.all`.

### 3. Conta.tsx consulta tabela `system_config` que nao existe no schema
A query em `Conta.tsx` busca `system_config.config_key = 'minimum_withdrawal_amount'`, mas a tabela definida no schema e `platform_settings` com coluna `key`. A query falha silenciosamente e o valor default 10 e sempre usado.

**Correcao**: Migrar para `platform_settings` com key correta.

### 4. Conta.tsx nao permite editar display_name nem bio
Os campos "Nome de Exibicao" e "Email" estao `disabled` sem opcao de edicao. O usuario nao consegue atualizar seu proprio nome de exibicao apos o signup.

**Correcao**: Tornar display_name e bio editaveis com botao de salvar.

---

## MEDIO

### 5. ContentCard faz RPC `is_content_boosted` para cada card (N+1)
Cada ContentCard executa `supabase.rpc("is_content_boosted")` individualmente. Em paginas com 20+ cards, sao 20+ requests.

**Melhoria**: Criar batch check no componente pai ou usar uma query unica.

### 6. useRewardSystem `checkCourseCompletion` usa logica errada
Na linha 236, busca lessons com `eq('category_id', courseId)` — mas lessons estao em `course_lessons` (nao em `contents` com `category_id`). A verificacao de conclusao de curso nunca funciona.

**Correcao**: Buscar de `course_lessons` e checar `course_enrollments.completed_lessons`.

### 7. Favoritos e Salvos nao filtram por `status = 'approved'`
`Favoritos.tsx` e `Salvos.tsx` buscam conteudos via join sem filtrar status. Conteudos rejeitados ou pendentes aparecem se o usuario favoritou/salvou antes da rejeicao.

**Correcao**: Adicionar filtro `.eq('contents.status', 'approved')` ou filtrar client-side.

### 8. Studio.tsx nao inclui cursos nas stats do creator
`totalContents`, `totalViews`, e `recentContents` so buscam de `contents`. Cursos criados pelo creator nao aparecem no dashboard.

**Correcao**: Incluir queries em `courses` e somar os resultados.

### 9. Studio `getRewardLabel` tem labels incompletas
O mapeamento tem apenas 8 labels antigas. Faltam keys reais como `VIEW_15S`, `WATCH_50`, `DAILY_LOGIN`, `SAVE_CONTENT`, `FAVORITE_CONTENT`, etc.

**Correcao**: Unificar com o mesmo mapeamento completo usado em Carteira.

---

## BAIXO / MELHORIAS

### 10. Auth.tsx nao mostra feedback de confirmacao de email
Apos signup, o usuario e redirecionado para `/` sem aviso de que precisa confirmar o email. Se auto-confirm estiver desabilitado, o usuario nao consegue logar e nao sabe por que.

**Melhoria**: Mostrar mensagem "Verifique seu email para confirmar a conta" apos signup bem-sucedido.

### 11. Conta.tsx link do perfil usa `/@` mas rota e `/:username`
Na linha 477, `navigate('/@${profile.creator_channel_name}')` inclui `@` no path. A rota definida em App.tsx e `/:username` — o `@` fica como parte do parametro, o que pode nao funcionar se CreatorProfile nao faz strip do `@`.

**Correcao**: Verificar se CreatorProfile trata o `@` ou remover o prefixo na navegacao.

### 12. Watch.tsx tem 1393 linhas — muito grande
O componente WatchContent e massivo com logica de acesso, rewards, mini player, teatro mode, comments, notes, curriculum, related contents, e action states. Refatorar em hooks menores.

**Melhoria**: Extrair logica em hooks como `useWatchContent`, `useWatchActions`, `useWatchRewards`.

---

## Plano de Implementacao

### Tarefa 1: Corrigir Studio Dashboard
- Remover multiplicador `* 2` dos earnings
- Paralelizar queries com `Promise.all`
- Incluir cursos nas stats
- Atualizar `getRewardLabel` com keys completas

### Tarefa 2: Corrigir Conta.tsx
- Migrar query de `system_config` para `platform_settings`
- Tornar display_name e bio editaveis
- Corrigir link do perfil com `@`

### Tarefa 3: Corrigir Favoritos e Salvos
- Filtrar por status approved nos joins

### Tarefa 4: Corrigir useRewardSystem
- Fix `checkCourseCompletion` para usar `course_lessons`

### Tarefa 5: Auth feedback
- Mostrar mensagem de confirmacao de email apos signup

### Tarefa 6: Otimizar ContentCard boost check
- Batch boost check no componente pai
