# Retrato local do Studio

Processamento exclusivamente local no navegador. Não há envio de quadros, reconhecimento de identidade ou chamada a serviço pago. O original não é modificado; a receita opt-in recebe `portrait-v1` e a exportação falha explicitamente se o efeito não puder ser processado.

## Assets e proveniência

Obtidos em 2026-10-13. Versões e arquivos são fixados; não substituir bytes mantendo o mesmo caminho.

| Arquivo | Origem | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `face-landmarker-float16-v1.task` | [Google MediaPipe modelo float16/v1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) | 3.758.596 | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `mediapipe-1.1.0/vision_wasm_module_internal.js` | `@mediapipe/tasks-vision@1.1.0/wasm/` | 335.431 | `70eff3956521b7de058d7173a4935c95e4a223c26ea624b9f5a936d3a043dcb0` |
| `mediapipe-1.1.0/vision_wasm_module_internal.wasm` | `@mediapipe/tasks-vision@1.1.0/wasm/` | 12.997.272 | `ee03b14a878e6c3c053a1bfa62e166dc45244be54dc0bbe61c578f710b771f6a` |

Assets totalizam 17.091.299 bytes antes de compressão, além do bundle JavaScript do Worker. Só a variante ESM/SIMD necessária é hospedada; CPU sem SIMD rejeita o recurso em vez de baixar variantes adicionais. A dependência está fixada em `package.json` e no lock, com integridade npm.

Licença do MediaPipe e do pacote: Apache-2.0, cópia em `LICENSE-APACHE-2.0.txt`. O [model card Face Mesh V2](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf) identifica Apache-2.0 para o modelo e descreve limitações de posição, iluminação e oclusão. [Documentação da tarefa e modelos](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker).

## Execução e limites

- Worker é criado somente ao preparar/ativar retrato. Modelo local usa Cache Storage versionado e fetch `force-cache`; cache indisponível permite execução normal. WASM/loader e pacote ficam no cache HTTP do navegador. Toda detecção usa `IMAGE`, sem herdar tracking de outro timestamp.
- Análise tem até 640px no maior lado e uma face. O mesh define oval contraído e protege olhos, lábios e sobrancelhas. Sem rosto válido há passagem sem efeito, sem reutilizar máscara antiga.
- Shader GPU conserva geometria e diferenças cromáticas RGB: bilateral em luminância, delta máximo ±0,03 × intensidade × máscara × 0,45. Não altera exposição global nem usa um alvo de cor de pele. A redução de microcontraste é deliberadamente suave.
- Falha no modelo, Worker, GPU, textura ou cancelamento interrompe o tratamento/exportação; não há fallback que declare o efeito aplicado sem renderizá-lo.
- Cada quadro tem bitmap transitório e é descartado após render; nenhuma imagem/landmark é salva ou enviada. Uma superfície retida reutiliza Worker e GPU; `dispose()` termina Worker, requests e contextos.
- Prévia e exportação usam o mesmo render e a mesma intensidade. Análise stateless é reexecutada após seek; não há cache de rosto em histórico do play.

Qualidade e FPS precisam ser medidos em vídeos autorizados diversos. Este efeito reduz microcontraste facial; não reconstrói rosto, não remove linhas profundas e não promete rejuvenescimento generativo.
