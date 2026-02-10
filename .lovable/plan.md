
# Refatoracao Completa: Video Lobby Premium UX

## Problema Raiz

O video no lobby usa `preload="metadata"` e escuta `loadeddata`. No iOS Safari, `loadeddata` com blob URL frequentemente NAO dispara, resultando em spinner eterno. Alem disso, o `VideoTrimBar` faz seeks VISIVEIS no video (causando "tremor" no desktop) porque usa o mesmo elemento de video que esta na tela.

## Arquitetura Nova: Zero Tremor, Zero Espera

### Principio 1: loadedmetadata em vez de loadeddata

`loadedmetadata` dispara MUITO mais rapido que `loadeddata` (nao precisa decodificar frames, so headers). Isso da acesso a `duration`, `videoWidth`, `videoHeight` imediatamente.

### Principio 2: Poster overlay durante extracao de frames

Quando o trim bar precisa extrair frames, o video faz seeks. Para o usuario nao ver "tremor":
1. Captura UM frame atual via canvas (imagem estatica)
2. Mostra essa imagem como overlay em cima do video (opacity 1)
3. Video faz seeks por baixo (invisivel)
4. Ao terminar, remove overlay e restaura posicao

### Principio 3: Frames sao opcionais, nao bloqueantes

O trim bar funciona IMEDIATAMENTE com placeholders cinza. Os frames sao gerados em background 500ms apos o video ficar pronto, com overlay escondendo os seeks.

## Mudancas por Arquivo

### 1. VideoPreparationLobby.tsx

- Trocar evento `loadeddata` por `loadedmetadata` (resolve iOS)
- Adicionar fallback: se `loadedmetadata` nao disparar em 3s, tentar `canplay`
- Adicionar estado `posterOverlay` (string dataURL) para cobrir video durante extraccao
- Mostrar poster overlay quando trim bar ou cover selector estao gerando frames
- Video usa `preload="auto"` novamente (necessario para blob URLs no iOS)

```text
Fluxo:
1. Lobby abre -> <video preload="auto" src={blobURL}>
2. loadedmetadata dispara (~200ms) -> duration, aspect, videoReady=true
3. Video aparece, usuario pode interagir
4. Apos 500ms: trim bar inicia geracao de frames
5. Antes de seeks: captura poster -> mostra overlay -> video fica invisivel
6. Seeks acontecem por baixo (0 tremor)
7. Frames prontos -> remove overlay -> video normal
```

### 2. VideoTrimBar.tsx

- Adicionar callback `onGeneratingFrames(generating: boolean)` para avisar o lobby
- Atrasar geracao de frames em 500ms apos videoReady (nao bloquear primeira renderizacao)
- Se a geracao falhar, manter placeholders cinza (funcional sem frames)

### 3. CoverFrameSelector.tsx

- Mesma logica de overlay: lobby mostra poster enquanto cover gera frames
- Reduzir HQ capture para 1280px em vez de 1920px (mais rapido, qualidade suficiente)
- Adicionar timeout de 8s na geracao total: se falhar, mostrar erro gracioso

### 4. seekAndCapture.ts

- Adicionar funcao `captureCurrentFrame(video, width, height)` que captura sem seek (para o poster overlay)
- Reduzir timeout de seek de 5s para 3s
- Melhorar fallback: se seek falhar, usar placeholder cinza em vez de rejeitar

## Fluxo Visual no Celular

```text
T=0ms     Usuario seleciona video
T=50ms    Lobby abre (tela preta)
T=200ms   loadedmetadata dispara -> video aparece, play disponivel
T=700ms   Trim bar inicia geracao de frames
T=700ms   Poster overlay aparece no video (imagem estatica do frame atual)
T=700ms   Video faz 20 seeks por baixo (invisivel para usuario)
T=2500ms  Frames prontos -> overlay some -> video normal com filmstrip
```

```text
Quando usuario clica "Capa":
T=0ms     coverMode=true, video pausa
T=100ms   CoverFrameSelector inicia geracao (8 frames)
T=100ms   Spinner "Gerando preview..." aparece
T=1500ms  Frames prontos -> scrubber aparece
T=???     Usuario arrasta e escolhe frame
T=???     Clica "Confirmar" -> capa aplicada
```

## Por que isso resolve todos os problemas

1. **iOS nao carrega**: `loadedmetadata` + `preload="auto"` resolve. Com fallback de 3s.
2. **Desktop treme**: Poster overlay cobre o video durante seeks. Zero tremor visivel.
3. **Capa fecha sozinha**: Ja corrigido no codigo atual (pending state). Mantido.
4. **Velocidade**: loadedmetadata e 5-10x mais rapido que loadeddata. Frames gerados em background.

## Arquivos Modificados

1. `src/components/video-lobby/seekAndCapture.ts` -- nova funcao captureCurrentFrame
2. `src/components/video-lobby/VideoTrimBar.tsx` -- delay de 500ms, callback onGeneratingFrames
3. `src/components/video-lobby/VideoPreparationLobby.tsx` -- loadedmetadata, poster overlay, preload auto
4. `src/components/CoverFrameSelector.tsx` -- HQ reduzido para 1280px, timeout de 8s
