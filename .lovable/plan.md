
# Refatoracao Total: Zero Video Elements Extras

## Problema Raiz

O console mostra `Frame generation failed: load error`. Tanto o `VideoTrimBar` (20 video elements) quanto o `CoverFrameSelector` (8+1 video elements) criam elementos `<video>` via `document.createElement("video")` para extrair frames. No Safari mobile, isso falha porque o browser limita video elements simultaneos com blob URLs.

**O lobby ja tem um `<video>` carregado e funcionando** -- mas nenhum componente o reutiliza.

## Solucao: Passar o videoRef do lobby para os componentes filhos

A abordagem do Instagram: **um unico elemento `<video>`**, reutilizado em tudo. O lobby passa `videoRef` para `VideoTrimBar` e para o cover selector. Eles fazem seek no video do lobby e capturam via canvas -- zero `document.createElement("video")`.

## Mudancas por Arquivo

### 1. `VideoTrimBar.tsx` -- Reescrever para usar videoRef

**Antes:** Cria 20 video elements separados para extrair frames.
**Depois:** Recebe `videoRef` como prop. Quando o video esta pronto, faz seek sequencial no video do lobby para capturar os 20 frames da timeline.

```text
Props novas:
  videoRef: React.RefObject<HTMLVideoElement>  // video do lobby
  videoReady: boolean                           // so inicia quando true

Logica:
  1. Quando videoReady=true, pausa o video do lobby
  2. Faz seek sequencial: currentTime = t0 -> seeked -> canvas.drawImage(videoRef) -> t1 -> ...
  3. Restaura currentTime original ao finalizar
  4. Remove: extractFrame(), document.createElement("video"), props videoSrc
```

### 2. `CoverFrameSelector.tsx` -- Reescrever para usar videoRef

**Antes:** Cria 8 video elements para thumbnails + 1 para HQ capture.
**Depois:** Recebe `videoRef` como prop. Usa o video do lobby para seek + canvas capture.

```text
Props novas:
  videoRef: React.RefObject<HTMLVideoElement>
  videoReady: boolean
  duration: number        // ja calculado pelo lobby
  videoAspect: number     // ja calculado pelo lobby

Remove: document.createElement("video") em TODOS os lugares
Remove: videoSrc prop (nao precisa mais)

Logica de geracao:
  1. Quando videoReady=true, salva currentTime e pausa
  2. Seek sequencial no videoRef -> canvas.drawImage -> dataURL
  3. Restaura currentTime

Logica de HQ capture (captureAndSelect):
  1. Seek no videoRef -> canvas 1920px -> drawImage -> file
  2. Sem criar video element nenhum
```

### 3. `VideoPreparationLobby.tsx` -- Passar videoRef + videoReady para filhos

```text
Mudancas:
  - VideoTrimBar recebe: videoRef, videoReady (remove videoSrc)
  - CoverFrameSelector recebe: videoRef, videoReady, duration, videoAspect (remove videoSrc)
  - Ao abrir coverMode: pausa o video antes de entrar
  - Ao confirmar/cancelar cover: permite retomar playback
```

### 4. `StudioUpload.tsx` -- Nenhuma mudanca

O fluxo de abrir o lobby instantaneamente com blob URL ja esta correto. Nao precisa alterar.

## Fluxo Corrigido no Mobile

```text
1. Usuario seleciona video
2. blob URL criado -> lobby abre INSTANTANEAMENTE (tela preta)
3. <video preload="metadata"> carrega metadados (~0.5-1s)
4. "loadeddata" dispara -> videoReady=true -> video aparece
5. VideoTrimBar recebe videoReady=true -> faz seek no MESMO video -> frames aparecem
6. Usuario clica "Capa" -> coverMode=true -> video pausa
7. CoverFrameSelector faz seek no MESMO video -> frames aparecem
8. Tudo funciona com UM UNICO video element
```

## Por que isso resolve

- **Zero `document.createElement("video")`** = zero "load error" no Safari mobile
- **Um video, multiplos seeks** = rapido e confiavel
- O video do lobby ja esta carregado, entao seek e quase instantaneo (~50ms por frame)
- 20 frames do trim bar: ~1s total vs timeout/falha atual
- 8 frames da capa: ~0.5s total vs falha atual

## Detalhes Tecnicos

### Funcao utilitaria de seek seguro (compartilhada)

```text
seekAndCapture(video, time, width, height):
  1. video.currentTime = time
  2. Espera evento "seeked" com timeout de 3s
  3. Delay 80ms (iOS Safari)
  4. canvas.drawImage(video, 0, 0, width, height)
  5. Retorna dataURL
```

Essa funcao sera usada tanto pelo TrimBar quanto pelo CoverFrameSelector, evitando duplicacao de codigo.

### Gestao de estado do video durante captura

Para evitar conflito entre playback e captura de frames:
- Antes de iniciar captura: `video.pause()`, salva `currentTime`
- Durante captura: seeks sequenciais
- Apos captura: restaura `currentTime` original
- O usuario pode dar play novamente normalmente

### Consideracoes iOS Safari

- `playsinline` e `webkit-playsinline` ja presentes no video do lobby
- Delay de 80-100ms apos `seeked` para garantir frame renderizado
- Sem `crossOrigin` para blob URLs (ja correto)
- Touch events via Pointer Events API (ja implementado)
