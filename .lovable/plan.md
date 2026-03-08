

# Revisao Geral - Quinta Bateria (Navegacao, UX, Design, Upload)

## CRITICO

### 1. Index.tsx bloqueia conteudo gratuito para usuarios nao-logados
Em `handleContentClick` (linha 202), se `!user`, redireciona para `/auth`. Isso impede que visitantes acessem conteudo **gratuito**. Uma plataforma de conteudo precisa permitir que visitantes assistam conteudo free para converter em signups.

**Correcao**: Permitir navegacao para conteudo gratuito sem login. So redirecionar para `/auth` em conteudo restrito (pro/premium/paid).

### 2. Messages.tsx usa `navigate()` dentro do render (side effect)
Linha 22: `navigate("/auth")` e chamado diretamente no corpo do componente quando `!user`. Isso causa warnings do React e comportamento imprevisivel.

**Correcao**: Substituir por `return <Navigate to="/auth" replace />;`

### 3. StudioUpload.tsx tem 1216 linhas - monolito critico
O componente e um unico arquivo com upload, compressao, lobby, thumbnail, formulario, preview, e submit. Qualquer mudanca e arriscada e o componente e dificil de manter.

**Correcao**: Extrair em hooks (`useUploadForm`, `useFileUpload`, `useThumbnailUpload`) e sub-componentes (`UploadHero`, `UploadFileSection`, `UploadDetailsForm`, `UploadVisibilitySection`).

### 4. ContentCard ainda faz RPC `is_content_boosted` individualmente quando `isBoosted` prop nao e passada
A prop `isBoosted` foi adicionada mas nenhum componente pai (Index, CreatorProfile, Favoritos, etc.) passa essa prop. Cada card continua fazendo a RPC.

**Correcao**: No `Index.tsx` e outros pais, fazer batch fetch de boost status e passar como prop.

---

## MEDIO

### 5. GlobalSearch nao filtra conteudo por tags
A busca global so usa `title.ilike` e `description.ilike`. Tags sao ignoradas, o que reduz significativamente a descoberta de conteudo.

**Correcao**: Adicionar busca por tags usando `tags.cs.{searchPattern}` ou full-text search.

### 6. Header `showSearch` e false por default, busca so aparece na Home
A barra de busca global so e visivel em `Index.tsx` porque so ele passa `showSearch={true}`. Em todas as outras paginas (Favoritos, Historico, Studio, etc.) nao ha forma de buscar conteudo.

**Correcao**: Sempre mostrar a busca no Header, ou pelo menos o icone que abre o Sheet de busca em mobile.

### 7. Planos.tsx nao mostra plano atual do usuario
A pagina de planos nao indica qual plano o usuario ja tem. Botoes de "Assinar" aparecem mesmo para quem ja e assinante do plano.

**Correcao**: Buscar `profile.plan` e mostrar badge "Seu plano" no card ativo, desabilitar ou mostrar "Gerenciar" para assinantes.

### 8. MobileBottomNav esconde em rotas uteis
`hiddenRoutes` inclui `/studio` e `/admin`, o que faz sentido. Mas tambem esconde em `/c/` (estudo) e `/shorts`, onde o usuario pode querer navegar para outra area.

**Correcao**: Revisar se `/shorts` e `/c/` realmente precisam esconder a nav. Considerar manter a nav com transparencia ou mini-modo.

### 9. AppSidebar nao tem link para Shorts
Shorts e um formato importante mas nao aparece no menu lateral. O usuario so descobre Shorts pela home.

**Correcao**: Adicionar "Shorts" ao `mainItems` no sidebar.

### 10. ContentSection limita itens sem "Ver mais"
`getMaxItems()` corta em 5-6 itens e nao ha botao/link para ver mais conteudos daquela categoria.

**Correcao**: Adicionar link "Ver todos" que navega para uma rota filtrada ou expande a secao.

---

## BAIXO / UX

### 11. Auth.tsx busca 20 videos para background - pesado e desnecessario
Na pagina de login, faz query de 20 videos aprovados e rotaciona como background. Isso e pesado, consome bandwidth do visitante, e pode mostrar conteudo inapropriado como fundo de login.

**Melhoria**: Usar imagem estatica ou gradient animado. Se quiser video, limitar a 1-2 com lazy loading.

### 12. Upload nao valida tamanho maximo antes de abrir Lobby
O Lobby abre imediatamente apos selecionar o arquivo (`handleFileUpload`), sem checar se o arquivo excede o limite (ex: 500MB). O usuario edita trim/cover e so descobre o erro no upload.

**Melhoria**: Validar tamanho e formato antes de abrir o Lobby.

### 13. Design: Cards de curso na Home usam `navigate(/watch/${course.id})` 
Cursos devem ter uma rota dedicada (ex: `/course/${id}`) com pagina de overview, modules, enrollment. Usar `/watch/` para cursos quebra a experiencia.

**Melhoria**: Criar rota `/course/:id` ou ao menos redirecionar corretamente no Watch.

### 14. Nenhuma pagina tem meta tags / SEO
SPA sem SSR nao tem meta tags dinamicas. Para uma plataforma de conteudo, isso e critico para compartilhamento em redes sociais e indexacao.

**Melhoria**: Adicionar `react-helmet` com titulo e description por pagina.

---

## Plano de Implementacao

### Tarefa 1: Corrigir acesso de visitantes a conteudo gratuito
- Em `Index.tsx`, permitir navegacao para `/watch/:id` sem login para conteudo `visibility = 'free'`
- Em `Watch.tsx`, mostrar prompt de login apenas para acoes (like, save, comment), nao para assistir

### Tarefa 2: Corrigir navegacao e UX
- `Messages.tsx`: trocar `navigate()` no render por `<Navigate />`
- Adicionar "Shorts" ao `mainItems` do `AppSidebar`
- Mostrar busca global em todas as paginas (nao so Home)
- Adicionar "Ver todos" em `ContentSection`

### Tarefa 3: Planos - mostrar plano atual
- Passar `currentPlan` para `PlanCards` e destacar o plano ativo
- Mostrar "Gerenciar assinatura" via customer-portal para assinantes

### Tarefa 4: Upload - validacao e refatoracao
- Validar tamanho/formato do arquivo ANTES de abrir o Lobby
- Extrair hooks e sub-componentes do `StudioUpload.tsx`

### Tarefa 5: Batch boost check na Home
- No `Index.tsx`, apos buscar conteudos, fazer uma unica query de boost status
- Passar `isBoosted` como prop para cada `ContentCard`

### Tarefa 6: Melhorias de discoverability
- Busca por tags no `GlobalSearch`
- SEO basico com `document.title` por pagina

