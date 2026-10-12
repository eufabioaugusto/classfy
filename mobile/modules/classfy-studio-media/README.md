# Classfy Studio Media

Módulo Expo local para iOS. Usa AVFoundation para transformar a timeline em um arquivo real, sem alterar os takes originais.

- Cortes com precisão de 1/600 s e concatenação na ordem enviada.
- Vídeo normalizado em 16:9, 9:16 ou 1:1; orientação respeitada, enquadramento centralizado com bordas quando necessário. Fontes UHD usam canvas de até 3840 × 2160, sem reduzir automaticamente a 1080p.
- Cadência dos originais preservada até 60 FPS, incluindo 25/50 e taxas fracionárias. Exportação acima de 30 FPS usa HEVC; resolução e FPS finais são conferidos antes do sucesso.
- MP4 com áudio, ou podcast M4A sem imagem.
- Capas JPEG, metadados, progresso e cancelamento por `requestId`.
- Exportações incompletas são removidas; arquivos de entrada e destinos existentes são preservados.

`index.ts` usa `requireOptionalNativeModule`; um binário anterior ou outra plataforma recebe uma mensagem explícita ao tentar usar o exportador. O módulo entra no build por Expo Autolinking. Depois de alterar fontes Swift ou instalar o módulo, reconstruir o app.

Os métodos compatíveis com iOS 15.1 continuam usando as APIs de composição clássicas da Apple. Xcode 26 pode emitir avisos de depreciação; isso não é uma falha de exportação.

## Controles de câmera

`StudioCameraControls.swift` usa a sessão do `ExpoCamera.CameraView` montado, encontrada pelo tag React Native, e executa os controles na `sessionQueue` dessa view. Não cria outra câmera nem consulta capacidades de uma sessão frontal paralela.

- `getStudioCameraCapabilitiesAsync`: formatos/FPS compatíveis com a saída de vídeo, limites de zoom/EV, abertura e suporte a foco, trava e luz.
- `configureStudioCameraAsync`: formato, 24/30/60 FPS e estado confirmado; bloqueia reconfiguração durante REC.
- `setStudioCameraZoomAsync`: fator real com rampa e limite do formato ativo.
- `setStudioCameraExposureAsync`: compensação EV confirmada com timeout.
- `setStudioCameraFocusAsync`: ponto convertido pelo preview nativo e trava após estabilização, quando suportada.

Mudanças de câmera, fechamento da view e callbacks atrasados são revalidados antes de alterar a sessão. `isStudioCameraControlsAvailable()` permite fallback explícito em binários antigos; os controles PRO só aparecem quando a ponte e as capacidades reais estão disponíveis.

## Teleprompter por voz na câmera nativa

`StudioCaptureSpeech` envia ao `SFSpeechRecognizer` local os mesmos buffers PCM de `AVCaptureAudioDataOutput` usados pelo monitor. Não cria microfone, `AVAudioEngine`, outro gravador nem altera `AVAudioSession`/REC. `requiresOnDeviceRecognition` é obrigatório e o idioma precisa confirmar `supportsOnDeviceRecognition`; indisponibilidade não aciona fallback de áudio na nuvem.

- `isStudioNativeCameraSpeechAvailable()` detecta a bridge no binário. A disponibilidade do idioma/modelo é confirmada por eventos nativos.
- `requestStudioCaptureSpeechPermissionAsync()` retorna `{granted, canAskAgain}`. É a única operação que pede autorização, chamada por gesto explícito; montar a câmera ou começar REC não mostra o prompt.
- A view recebe `speechEnabled`, `speechSessionId` e `speechLocale` (`pt-BR`). `onSpeech` informa resultado parcial/final ou estado `listening`, `paused`, `unavailable`, `denied`, `error`.
- Cada evento contém `sessionId`, geração da câmera, sequência e `segmentId` numérico. A sequência e os segmentos reiniciam ao mudar sessão/geração. Cancelar, trocar câmera/rota, fechar ou entrar em background invalida a tarefa; callbacks antigos não podem assumir a identidade nova.
- Tarefas são renovadas após resultado final ou a cada 50 s. Silêncio prolongado termina em `paused/awaiting_speech`: buffers novos com atividade retomam a escuta sem consumir tentativas ou criar loop de reconhecimento. RMS apenas desperta uma tarefa; somente transcrição alinhada ao roteiro avança/pinta palavras no app. Falhas com atividade são repetidas duas vezes, com backoff, e depois informadas como erro.

`tests/verify-capture-speech.sh` verifica tokens, renovação, pausa longa, limite de retries e o encaminhamento do mesmo `CMSampleBuffer` PCM. `StudioCaptureSpeechBridge.test.mjs` cobre binário antigo, autorização e entrega dos eventos da view sem iniciar REC. Esses fixtures e a compilação não comprovam qualidade de reconhecimento nem captura simultânea no iPhone; essas verificações exigem teste físico e um binário atualizado.

## Verificação local

Exige Xcode e FFmpeg no Mac; não usa servidor, conta ou publicação:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer bash modules/classfy-studio-media/tests/verify-engine.sh
```

O teste verifica duração efetiva dos cortes, ordem por pixels do arquivo exportado, rotação por metadata, centralização de conteúdo vertical, formatos horizontal/vertical/UHD, 24/25/30/60 FPS e misturas, áudio após take silencioso, duração com take final silencioso, capa, preservação de originais e cancelamento. Os arquivos gerados ficam em diretórios temporários para inspeção.

O harness fica em `tests/`, fora de `ios/`, e não entra no pod ou no aplicativo. Gravação de câmera e microfone precisa de QA no iPhone físico; o simulador permite importar e exportar os fixtures.

## Transformação interativa da prévia

`getStudioInteractiveCompositionVersionAsync` confirma versão 1 e disponibilidade de Metal. `StudioCompositionView.liveVisualJSON` recebe apenas a geometria transitória do elemento selecionado, com operação, sequência, revisão e recibo de commit/cancel. A superfície Metal reutiliza o quadro decodificado e seus grafos Core Image imutáveis de orientação/tratamento, com o mesmo compositor da exportação e sem bitmap intermediário; não substitui `AVPlayerItem` durante o movimento. O quadro final só assume a tela depois do primeiro frame canônico e da escrita confirmada. Seek para outro instante, inspeção de fonte, background e remoção da view cancelam a superfície.

`tests/verify-interaction.sh` verifica paridade da transformação e da receita final com fixtures locais. Compilação e testes no Mac não confirmam a sensação de arraste no iPhone. Um Dev instalado antes dessa API continua no renderer anterior até instalar o novo binário.
