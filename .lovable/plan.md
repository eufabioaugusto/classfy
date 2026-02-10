
# Fix Cover Selector Bug + Premium Speed UX

## Problemas Identificados

### 1. Capa fecha sozinha (Bug critico)
O `CoverFrameSelector` auto-seleciona um frame a 25% do video ao terminar de carregar. Isso dispara `onFrameSelect` -> `handleCoverSelect` no lobby -> `setCoverMode(false)`, fechando o overlay automaticamente antes do usuario interagir.

### 2. Video demora no celular
O `<video>` do lobby usa `preload="auto"`, forcando o Safari/iOS a carregar o arquivo inteiro antes de exibir qualquer coisa. Combinado com o metadata extraction (que cria OUTRO elemento `<video>`), o resultado e uma tela preta ate tudo carregar.

### 3. CoverFrameSelector pesado demais para iOS
Cada frame extrai criando um novo `<video>` element, carregando o blob inteiro, fazendo seek. x12 frames = 12 video elements sequenciais no iOS Safari. Muito lento.

---

## Solucao

### 1. Separar callback de auto-selecao vs selecao manual no CoverFrameSelector

Modificar o `CoverFrameSelector` para NAO chamar `onFrameSelect` na auto-selecao inicial. Apenas chamar quando o usuario INTERAGIR (arrastar no scrubber). Isso resolve o bug do overlay fechando sozinho.

**Arquivo:** `src/components/CoverFrameSelector.tsx`
- Remover a chamada `onFrameSelect` dentro de `selectHighQualityFrame` quando for auto-select (montagem)
- Manter a chamada apenas quando o usuario interage via `handleStripInteraction`

### 2. Video do lobby com preload="metadata" + poster frame

**Arquivo:** `src/components/video-lobby/VideoPreparationLobby.tsx`
- Trocar `preload="auto"` por `preload="metadata"` no `<video>` do lobby
- Reusar o mesmo video element para metadata ao inves de criar um segundo
- Usar `loadeddata` event para mostrar o video assim que o primeiro frame estiver disponivel
- Adicionar um estado `videoReady` com loading spinner ate o video estar pronto
- Nao bloquear a UI enquanto carrega -- o usuario ve a tela preta com spinner por 1-2s no maximo

### 3. Otimizar CoverFrameSelector para iOS: single video element

**Arquivo:** `src/components/CoverFrameSelector.tsx`
- Em vez de criar 12 video elements (um por frame), reusar UM UNICO video element para todos os seeks
- Seek sequencial: load -> seek(t0) -> capture -> seek(t1) -> capture -> ... -> seek(t11) -> capture
- Isso reduz drasticamente o tempo no iOS Safari (de ~12 loads para 1 load + 12 seeks)
- Reduzir frame count de 12 para 8 no mobile para ser ainda mais rapido

### 4. Cover overlay nao fecha no auto-select

**Arquivo:** `src/components/video-lobby/VideoPreparationLobby.tsx`
- `handleCoverSelect` NAO deve fechar o coverMode automaticamente
- O usuario fecha manualmente clicando "Confirmar" ou "X"
- Criar um state local para o frame selecionado no cover mode, so aplicar ao confirmar

---

## Detalhes Tecnicos

### CoverFrameSelector - Single Video Element Pattern

```text
Antes (lento no iOS):
  Frame 0: createElement("video") -> load -> seek -> capture -> remove
  Frame 1: createElement("video") -> load -> seek -> capture -> remove
  ...x12 = 12 loads completos

Depois (rapido):
  1x createElement("video") -> load
  Frame 0: seek -> waitSeeked -> capture
  Frame 1: seek -> waitSeeked -> capture
  ...x8 = 1 load + 8 seeks
```

### Fluxo do Cover Mode corrigido

```text
1. Usuario clica "Capa" na toolbar
2. coverMode = true, overlay abre
3. CoverFrameSelector carrega frames (8 frames, single video element)
4. Auto-select frame 25% VISUALMENTE, mas NAO chama onFrameSelect
5. Usuario arrasta scrubber para escolher outro frame
6. Usuario clica "Confirmar"
7. Ai sim: aplica o frame selecionado (thumbnailFile/thumbnailPreview)
8. coverMode = false
```

### Video Lobby - Loading State

```text
1. Lobby abre INSTANTANEAMENTE (tela preta com spinner central)
2. <video preload="metadata"> comeca a carregar
3. Evento "loadeddata" -> videoReady = true -> spinner desaparece
4. Video visivel, usuario pode interagir
Tempo estimado iOS: 0.5-2s vs 5-10s atual
```

### Arquivos Modificados

1. `src/components/CoverFrameSelector.tsx` -- Single video element, separar auto-select de callback
2. `src/components/video-lobby/VideoPreparationLobby.tsx` -- preload metadata, loading state, cover confirm flow
