# Assinatura cinematográfica local do Studio

A pessoa e o fundo são segmentados localmente em Worker. A máscara agrupa cabelo, pele do corpo, pele do rosto e roupa; fundo e objetos não entram nessa soma. Uma seleção do componente principal ancorado no rosto remove ilhas externas sem recorte geométrico do corpo. O shader separa iluminação facial, exposição do fundo, curva autoral e desfoque normalizado que exclui a pessoa. Não há upload de quadros, reconhecimento de identidade ou serviço pago. A receita opt-in usa `cinematic-signature-v1`; falha de modelo, Worker ou GPU interrompe aplicação/exportação com erro explícito.

## Assets, versão e proveniência

Obtido em 2026-10-13. Arquivo imutável; substituir bytes exige novo caminho e versão de cache.

| Arquivo ativo | Origem oficial | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `selfie-multiclass-256-float32-v1.tflite` | [Google MediaPipe selfie_multiclass_256x256 float32/v1](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite) | 16.371.837 | `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0` |

Os dois assets anteriores, `selfie-square-float16-v1.tflite` (249.537 bytes, SHA-256 `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`) e `selfie-landscape-float16-v1.tflite` (250.177 bytes, SHA-256 `490e9ea734313e0de10fa0cd9e3c6133e36ea4db2b7a49bde9ef019f72796b8e`), permanecem públicos somente para compatibilidade de abas antigas que já carregaram o runtime anterior. O novo Worker não os usa. São as versões oficiais float16/v1 e Apache-2.0 documentadas no [model card Selfie Segmentation](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf). Reter esses 499.714 bytes evita 404 no intervalo entre deploy e refresh; não há fallback automático entre modelos.

Reutiliza runtime ESM/SIMD de `@mediapipe/tasks-vision@1.1.0` e o modelo facial já hospedados em `/studio/portrait/`; não há cópia extra do WASM. JavaScript do Worker e modelo só são carregados ao preparar/ativar a assinatura. Cache Storage versionado e `force-cache` evitam downloads repetidos; indisponibilidade do cache não impede execução. Bytes e metadata das seis classes são validados antes de produzir uma máscara. Não existe fallback silencioso para o antigo selfie binário.

Licença Apache-2.0, cópia em `LICENSE-APACHE-2.0.txt`. O [model card oficial Multiclass Segmentation](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf) declara a licença e as classes background, hair, body, face, clothes e others; input 256×256 e saída de seis mapas de confiança. A metadata do arquivo fixado contém exatamente `background`, `hair`, `body-skin`, `face-skin`, `clothes`, `others`. [Documentação oficial do Image Segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter).

## Execução e limites

- IMAGE stateless: máscara e rosto são calculados no quadro atual a partir de RGBA explícito, com dimensão máxima 512, sem tracking histórico ou máscara reutilizada em outro timestamp. Uma task facial e uma task multiclass são retidas por superfície de editor/export. Modelo é 256; entrada arbitrária é redimensionada internamente pela tarefa mantendo o suporte a portrait/landscape.
- Tasks são construídas em fila serial. Tasks Vision 1.1.0 consome e limpa a factory global do loader ESM após criar cada task. Cada construção recebe query de contador previsível no URL do loader para reexecutar esse registro, inclusive retry, mantendo bytes oficiais e caminho/cache do WASM compartilhado. Não altera SDK nem injeta globals privados.
- Soma somente classes 1..4. Componente 8-conexo com confiança ≥ 0,25 é escolhido pelo overlap do oval facial atual; sem rosto, maior componente. Alfa original de franjas até dois pixels de máscara do componente é conservado, sem dilatação ou preenchimento de buracos. Uma planta conectada pode exigir distinção semântica; por isso o modelo multiclass substitui o selfie binário.
- Matte é refinada por guia de cor e limitada a não espalhar confiança do foreground no background. Não recebe erosão ou remap agressivo de confiança. Um guard interno ao rosto preserva pele se houver falha local, sem inventar corpo/cabelo. Métricas de luminância usam até 256 pixels e preferem o rosto, sem expor roupas escuras como pele.
- Blur Gaussian separável em luz linear sRGB usa somente amostras de fundo, peso=`1 - smoothstep(0,02, 0,18, confidence)`. Pixels de fronteira contaminados por cor da pessoa são excluídos. Buffer half-float16 evita quantização de sombras; normalização e conversão a sRGB antecedem a curva/cor autoral. Sigma=`min(width,height) × 0,035 × backgroundBlur`, nove taps por eixo.
- Original permanece intacto. Só parâmetros da assinatura são persistidos; bitmaps, máscaras e landmarks são transitórios e descartados após análise/render/dispose. Preview e export usam o mesmo processamento do quadro atual. Sem GPU/modelo/half-float suportados não há fallback que omita a assinatura.
- Pessoa que sai do quadro mantém tratamento do fundo sem rosto antigo. Preflight exige detecção suficiente para aplicar inicialmente. Não é recorte pixel-perfect: fios/dedos finos, oclusão, baixa luz, movimento rápido e pessoas distantes continuam limites do modelo. A assinatura não recupera informação já perdida na captura.

## Escolha do modelo e QA

Em seis quadros originais 4K do caso reportado, o selfie binário incluiu 96–99% da ROI da planta em três quadros mesmo após selecionar componente principal, pois a ilha estava ligada ao creator. Multiclass reduziu essa inclusão para 0% em cinco quadros e aproximadamente 0,58% no sexto, com contorno mais justo no cabelo e ombro. Isso justificou o modelo adicional lazy, em vez de contrair agressivamente cabelo/mãos para compensar erro de classe.

No Mac testado, 24 chamadas quentes equivalentes (rosto+segmentação+pruning, GPU, input ≤512): selfie média 33,0 ms/p95 35,8 ms; multiclass média 54,8 ms/p95 52,7 ms, com uma amostra de 186,3 ms ainda afetada por inicialização. Mediana multiclass 50,3 ms. Não é garantia de 24/30/60 FPS em qualquer dispositivo; modelo de recorte, efeito 4K, decodificação e composição têm custos separados. Provas locais e quadros autorizados não são assets de produção.
