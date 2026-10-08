# Classfy Studio Media

Módulo Expo local para iOS. Usa AVFoundation para transformar a timeline em um arquivo real, sem alterar os takes originais.

- Cortes com precisão de 1/600 s e concatenação na ordem enviada.
- Vídeo normalizado em 1920 × 1080, 1080 × 1920 ou 1080 × 1080; orientação respeitada, enquadramento centralizado com bordas quando necessário.
- MP4 com áudio, ou podcast M4A sem imagem.
- Capas JPEG, metadados, progresso e cancelamento por `requestId`.
- Exportações incompletas são removidas; arquivos de entrada e destinos existentes são preservados.

`index.ts` usa `requireOptionalNativeModule`; um binário anterior ou outra plataforma recebe uma mensagem explícita ao tentar usar o exportador. O módulo entra no build por Expo Autolinking. Depois de alterar fontes Swift ou instalar o módulo, reconstruir o app.

Os métodos compatíveis com iOS 15.1 continuam usando as APIs de composição clássicas da Apple. Xcode 26 pode emitir avisos de depreciação; isso não é uma falha de exportação.

## Verificação local

Exige Xcode e FFmpeg no Mac; não usa servidor, conta ou publicação:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer bash modules/classfy-studio-media/tests/verify-engine.sh
```

O teste verifica duração efetiva dos cortes, ordem por pixels do arquivo exportado, rotação por metadata, centralização de conteúdo vertical, formatos horizontal/vertical, áudio após take silencioso, duração com take final silencioso, capa, preservação de originais e cancelamento. Os arquivos gerados ficam em diretórios temporários para inspeção.

O harness fica em `tests/`, fora de `ios/`, e não entra no pod ou no aplicativo. Gravação de câmera e microfone precisa de QA no iPhone físico; o simulador permite importar e exportar os fixtures.
