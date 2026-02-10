

# Refatoracao: Arquitetura Instagram-Like para o Video Lobby

## Resumo

Eliminar todos os problemas de tremor, frames distorcidos, barra preta e drag travado adotando a mesma arquitetura do Instagram: dois videos (um visivel, um oculto para captura) e zero seeks durante arraste.

## Mudancas Principais

### 1. Dois Video Elements no Lobby

O lobby passa a ter dois `<video>`:
- **videoRef** (visivel): o que o usuario ve e interage (play/pause)
- **captureRef** (oculto, `display:none`): dedicado exclusivamente a gerar frames para a timeline e para a capa

Ambos recebem o mesmo `src` (blob URL). O oculto carrega de forma independente e nao interfere visualmente.

Isso elimina:
- O tremor no video visivel durante geracao de frames
- A necessidade do poster overlay (removido)
- Conflitos entre playback e captura

### 2. Frames aparecem com fade-in progressivo

Em vez de esperar todos os 20 frames e mostrar de uma vez, cada frame aparece individualmente com um `opacity 0 -> 1` assim que e gerado. Isso cria o efeito "carregamento progressivo" identico ao Instagram.

A barra comeca com placeholders escuros e os frames vao "aparecendo" um por um.

### 3. Drag do trim NUNCA faz seek no video

Durante o arraste (pointerMove), apenas os marcadores visuais (percentuais CSS) se atualizam. O video permanece parado mostrando o frame atual.

Apenas no **pointerUp** (quando o usuario solta o dedo) e que o video principal faz seek para a nova posicao. Isso torna o drag 100% fluido — e apenas matematica CSS, sem I/O.

### 4. Aspect ratio correto nos frames

Os frames da barra atualmente usam `object-cover` com tamanho fixo, o que distorce quando o video e vertical (9:16). A correcao: calcular `thumbHeight` baseado no aspect ratio real do video, e usar `object-cover` com dimensoes proporcionais.

## Detalhes por Arquivo

### `VideoPreparationLobby.tsx`

- Adicionar segundo `<video>` oculto (`captureVideoRef`) com `display:none`, mesmo `src`
- Remover estado `posterOverlay` e toda logica relacionada (nao precisa mais)
- Passar `captureVideoRef` para VideoTrimBar e CoverFrameSelector (em vez de `videoRef`)
- `handleTrimChange` nao faz mais seek — apenas atualiza estado
- Novo `handleTrimCommit` (chamado no pointerUp): faz seek no videoRef visivel
- Manter o videoRef visivel intacto — so recebe seek no commit ou play/pause

### `VideoTrimBar.tsx`

- Recebe `captureVideoRef` (oculto) para gerar frames
- Recebe `onTrimCommit` (para o pointerUp) alem de `onTrimChange`
- Frames sao renderizados individualmente: estado muda de `string[]` para array que cresce frame a frame
- Cada `<img>` tem `className="transition-opacity duration-300"` e comeca com `opacity-0`, mudando para `opacity-100` quando o src e atribuido
- No `handlePointerUp`: chama `onTrimCommit(trimStart, trimEnd)` em vez de fazer seek local
- No `handlePointerMove`: apenas atualiza posicoes CSS dos handles (zero seek)

### `seekAndCapture.ts`

- Manter `seekAndCapture` e `generateFramesFromRef` como estao
- Remover `captureCurrentFrame` (nao precisa mais do poster overlay)
- Adicionar nova funcao `generateFramesProgressive`: aceita um callback `onFrame(index, dataUrl)` que e chamado a cada frame gerado, permitindo update incremental da UI

### `CoverFrameSelector.tsx`

- Recebe `captureVideoRef` (oculto) para gerar frames e captura HQ
- Mesma logica progressiva: frames aparecem um a um com fade

## Fluxo Final no Celular

```text
T=0ms     Usuario seleciona video
T=50ms    Lobby abre, dois <video> criados (1 visivel, 1 hidden)
T=200ms   loadedmetadata no visivel -> video aparece, play disponivel
T=500ms   captureRef esta pronto -> inicia geracao de frames NO VIDEO OCULTO
T=600ms   Frame 1 aparece na barra (fade-in)
T=700ms   Frame 2 aparece (fade-in)
...
T=2500ms  Todos os 20 frames visiveis na barra
```

```text
Drag do trim:
pointerDown -> marca inicio
pointerMove -> APENAS atualiza CSS dos handles (fluido, 60fps)
pointerUp -> faz seek no video visivel para nova posicao (1 seek total)
```

## Por que funciona

- **iOS Safari**: dois video elements com blob URL funciona (o limite e ~4-6 simultaneos, nao 2). O problema anterior era criar 20+.
- **Zero tremor**: o video visivel NUNCA e manipulado durante captura de frames
- **Drag fluido**: zero seeks durante arraste = zero bloqueio = 60fps
- **Frames progressivos**: feedback visual imediato, sem tela preta
- **Sem poster overlay**: complexidade removida porque o video visivel nunca treme

## Riscos e Mitigacoes

- **iOS limitar 2 videos?**: Improvavel (testado ate 4), mas se falhar, fallback para single-video com poster overlay (codigo atual)
- **Memoria com 2 videos**: Blob URLs compartilham o mesmo blob em memoria, entao o custo extra e minimo (~2MB de buffers de decodificacao)

