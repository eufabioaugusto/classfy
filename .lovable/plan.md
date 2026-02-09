
# Video Preparation Lobby -- Editor Fullscreen estilo Instagram/YouTube

## Visao Geral

Criar uma tela fullscreen de preparacao de video (lobby) que abre automaticamente ao selecionar um arquivo de video no mobile. Essa tela funciona como um editor/previsualizador antes do formulario de upload, similar ao Instagram Reels e YouTube Shorts.

## O que sera construido

### 1. Novo Componente: `VideoPreparationLobby`

Tela fullscreen (100vh, 100vw) com fundo preto que exibe:

```text
+----------------------------------+
| [X]                    [Avancar] |  <- Header: fechar + avancar
|                                  |
|                                  |
|         VIDEO PREVIEW            |  <- Video adaptativo:
|         (aspect ratio            |     9:16 = fullscreen
|          preservado)             |     16:9 = centralizado com
|                                  |     barras pretas
|                                  |
|                                  |
|  [Play/Pause]  00:32 / 01:30    |  <- Controles de playback
|                                  |
|  |=====[======]===============|  |  <- Barra de trim com handles
|                                  |     (shorts: max 90s)
|                                  |
|  [Capa]  [Cortar]  [+]  [+]    |  <- Toolbar inferior
|                                  |     (capa = seletor de frame)
|                                  |     (outros = placeholder futuro)
+----------------------------------+
```

**Comportamento do video:**
- Videos verticais (9:16): preenchem a tela toda, `object-contain` no container fullscreen
- Videos horizontais (16:9): centralizados verticalmente com fundo preto acima e abaixo
- O video fica em loop automatico para facilitar a visualizacao

**Barra de trim:**
- Dois handles (inicio e fim) arrastaveis sobre a timeline de frames do video
- Para `short`: limite maximo de 90 segundos entre os handles
- Para `aula`/`curso`: sem limite
- Exibe duracao selecionada em tempo real
- Visualmente mostra thumbnails do video ao fundo da barra (reutiliza logica do CoverFrameSelector)

**Toolbar inferior (preparada para o futuro):**
- Botao "Capa" -- abre o seletor de frame (CoverFrameSelector) em um sheet
- Botao "Cortar" -- ativa/destaca a barra de trim (ja visivel)
- Botoes placeholder desabilitados para: Texto, Musica, Efeitos (com icones, mas `opacity-50` e tooltip "Em breve")

**Acao "Avancar":**
- Fecha o lobby e retorna ao formulario de upload com os dados:
  - `trimStart` e `trimEnd` (em segundos) -- salvos mas o trim efetivo via FFmpeg e fase futura
  - Frame de capa selecionado (thumbnail)
  - Duracao ajustada

### 2. Integracao no StudioUpload.tsx

- Quando um video e selecionado no mobile, em vez de mostrar o preview inline, abre o `VideoPreparationLobby` em fullscreen
- O lobby recebe o blob URL do video
- Ao clicar "Avancar", o lobby fecha e o upload prossegue normalmente com os metadados definidos
- No desktop, o lobby tambem abre mas como um modal/dialog (nao fullscreen) -- ou pode ser fullscreen tambem para consistencia

### 3. Ajustes no CoverFrameSelector

- Adaptar para funcionar como bottom sheet dentro do lobby (ja existe essa logica)
- Manter compatibilidade com iOS Safari (logica atual de sequential seeking)

## Detalhes Tecnicos

### Arquivos

1. **Novo:** `src/components/video-lobby/VideoPreparationLobby.tsx` -- Componente principal do lobby
2. **Novo:** `src/components/video-lobby/VideoTrimBar.tsx` -- Barra de trim com handles draggable
3. **Novo:** `src/components/video-lobby/LobbyToolbar.tsx` -- Toolbar inferior com acoes
4. **Editado:** `src/pages/StudioUpload.tsx` -- Integrar o lobby no fluxo de upload
5. **Editado:** `src/components/CoverFrameSelector.tsx` -- Adaptar para funcionar dentro do lobby

### VideoPreparationLobby Props

```text
interface VideoPreparationLobbyProps {
  videoSrc: string;          // blob URL do video
  contentType: ContentType;  // para saber se aplica limite de 90s
  onConfirm: (data: {
    thumbnailFile?: File;
    thumbnailPreview?: string;
    trimStart: number;
    trimEnd: number;
    duration: number;
  }) => void;
  onClose: () => void;
  open: boolean;
}
```

### Video Aspect Ratio Detection

- Ao carregar o video no lobby, detectar `videoWidth` / `videoHeight`
- Se ratio < 1 (vertical): container usa `h-full w-auto mx-auto` para preencher verticalmente
- Se ratio >= 1 (horizontal): container usa `w-full h-auto my-auto` para centralizar

### VideoTrimBar

- Gera thumbnails do video (reusa logica do CoverFrameSelector, ~20 frames)
- Exibe como barra horizontal com imagens de fundo
- Dois handles nas pontas, arrastaveis com pointer events (touch-friendly)
- Area selecionada fica com opacidade normal, areas fora ficam escurecidas
- Para shorts: se o usuario tentar arrastar alem de 90s, trava
- O video faz seek em tempo real conforme o usuario arrasta

### Fluxo no Mobile

```text
1. Usuario seleciona video no input
2. Blob URL criado -> VideoPreparationLobby abre fullscreen
3. Usuario ve o video, pode:
   a. Ajustar trim (inicio/fim)
   b. Selecionar frame de capa
   c. (futuro) adicionar texto, musica, etc.
4. Clica "Avancar"
5. Lobby fecha, formulario de upload recebe os dados
6. Upload inicia com o arquivo original (trim sera aplicado server-side futuramente)
```

### Consideracoes iOS Safari

- Video element com `playsinline`, `webkit-playsinline`, `muted` inicialmente
- Sem `crossOrigin` para blob URLs
- Seek sequencial com delay de 100ms para frame extraction
- Touch events via Pointer Events API para compatibilidade
