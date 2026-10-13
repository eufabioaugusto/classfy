# Assinatura cinematográfica local do Studio

A pessoa e o fundo são segmentados localmente em Worker. O shader separa iluminação facial, exposição do fundo, curva autoral e desfoque normalizado que exclui a pessoa. Não há upload de quadros, reconhecimento de identidade ou serviço pago. A receita opt-in usa `cinematic-signature-v1`; falha de modelo, Worker ou GPU interrompe a aplicação/exportação com erro explícito.

## Assets, versão e proveniência

Obtidos em 2026-10-13. Arquivos imutáveis; uma substituição exige novo caminho e versão de cache.

| Arquivo | Origem oficial | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `selfie-square-float16-v1.tflite` | [Google MediaPipe selfie_segmenter float16/v1](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite) | 249.537 | `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b` |
| `selfie-landscape-float16-v1.tflite` | [Google MediaPipe selfie_segmenter_landscape float16/v1](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite) | 250.177 | `490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e` |

Somam 499.714 bytes, antes de compressão. Reutilizam o runtime ESM/SIMD de `@mediapipe/tasks-vision@1.1.0` e o modelo facial já hospedados em `/studio/portrait/`; não há cópia extra do WASM. O JavaScript do Worker só é carregado ao preparar/ativar a assinatura. Modelos usam Cache Storage versionado; indisponibilidade do cache não impede execução. Tasks são construídas em fila serial. Tasks Vision 1.1.0 consome e limpa a factory global do loader ESM após cada criação: cada construção recebe query de contador previsível no URL do loader para que esse registro seja executado novamente (inclusive retry), mantendo os mesmos bytes oficiais e o caminho/cache do WASM compartilhado. Não há alteração do SDK ou injeção de globals privados.

Licença: Apache-2.0, cópia em `LICENSE-APACHE-2.0.txt`. O [model card oficial Selfie Segmentation](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf) declara a licença e entradas 256×256 (geral) / 256×144 (paisagem), com saída de confiança da pessoa. Consulte a [documentação oficial do Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter).

## Execução, privacidade e qualidade

- O SDK 1.1.0 consome e limpa `ModuleFactory` após cada construção. O Worker serializa as construções e adiciona um contador previsível à URL do loader ESM para registrar a factory novamente, mantendo o arquivo oficial e a URL do WASM. Reabertura, preparação repetida, cancelamento e retry foram verificados com Workers novos no navegador real.
- IMAGE stateless: máscara e rosto são calculados no quadro atual a partir de RGBA explícito (evitando variação de conversão de bitmap acelerado), com dimensão máxima 512, sem tracking histórico ou máscara reutilizada em outro timestamp. Um Worker reutiliza os modelos das duas proporções e a detecção facial de uma pessoa. Segmentação pode incluir pessoas próximas de escala semelhante.
- Métricas de luminância usam até 256 pixels no maior lado. Preferem oval facial válido; roupas escuras não determinam a exposição do rosto. Um guard conservador mantém o interior do rosto visível se a segmentação falhar ali; ele não inventa contorno do corpo.
- Matte é refinada por guia de cor e preserva alpha suave. Fundo recebe Gaussian separável em luz linear sRGB, normalizado por peso de fundo, excluindo cor de cabelo, mãos e rosto. O buffer intermediário usa half-float16 para evitar banding por quantização de sombras; normalização é seguida de conversão de volta a sRGB antes da curva/cor autoral. Sigma = `min(width,height) × 0,035 × backgroundBlur`, nove taps por eixo. A iluminação usa o bbox facial e a mesma equação autoral de `shared/studio/signatureLook.ts`, sem mudar geometria.
- O original permanece intacto. Só parâmetros da assinatura são persistidos; bitmaps, máscaras e landmarks são transitórios, descartados após análise/render/dispose. Toda inferência e tratamento ficam no dispositivo.
- Preview e export usam o mesmo shader e modelo; sem GPU/modelo/half-float suportados não há fallback silencioso que ignore a assinatura. Uma pessoa que sai do quadro durante um vídeo mantém o tratamento do fundo, sem inventar rosto antigo. O preflight do editor exige detecção suficiente para aplicar inicialmente.
- O modelo não promete recorte pixel-perfect: dedos finos, oclusão, baixa luz, movimento rápido e pessoas distantes podem reduzir qualidade. A assinatura melhora separação e direção de luz até o limite do material gravado; não recupera informação que já foi perdida em sombras ou highlights.
