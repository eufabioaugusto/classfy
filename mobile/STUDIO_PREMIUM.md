# Studio: motor nativo e edição em camadas

## Arquitetura

A interface é React Native com TypeScript. Os gestos da timeline rodam na UI thread com Reanimated e Gesture Handler. O processamento de vídeo no iOS é Swift, AVFoundation, Core Image, Metal, Vision e CoreText. Não há WebView, renderização de vídeo em JavaScript ou envio de gravações a serviços externos para tratar a imagem.

`StudioCaptureSession` controla a sessão AVFoundation, consulta formatos reais do aparelho e grava os originais com `AVCaptureMovieFileOutput`. A prévia usa uma superfície Metal. Um erro da superfície de tratamento pode retornar à prévia AVFoundation preservando a gravação. STOP antecipado, repetido, interrupções e encerramento da sessão têm uma operação identificada e uma conclusão única.

`StudioRecipeEngine` prepara uma composição AVFoundation. `StudioCompositionView` usa um único AVPlayerItem para a montagem inteira; escolher um take ou uma camada não navega o cursor. O AVVideoCompositor e o `StudioEffectRenderer` são compartilhados por prévia e exportação. Inspecionar um quadro excluído por um corte usa uma superfície separada e não move a reprodução.

A prévia ativa a sessão de áudio em modo playback ao reproduzir, inclusive no silencioso, e pausa quando a câmera inicia. O estado de gravação não é reutilizado como modo de reprodução depois de retornar ao editor. Uma falha de ativação é mostrada e só desaparece após recuperação confirmada.

## Documento de edição

O schema v2 distingue originais imutáveis (`assets`), sequência principal (`main`), camadas (`layers`), canvas e perfil de saída. O tempo usa ticks inteiros com timebase de 120.000. O array `takes` continua disponível como adaptador para as telas existentes, mas não é uma segunda fonte de verdade persistida.

A migração salva backup, escreve a versão nova e relê antes de adotá-la. IDs, cortes, originais e estado de envio são preservados. Uma falha de leitura oferece recuperação do snapshot anterior. Importações mantêm um journal com o destino completo, incluindo camada e item, para recuperar arquivos copiados antes de uma interrupção. Abrir a câmera sem criar conteúdo mantém uma sessão transitória.

Texto, legendas, imagens e vídeo sobreposto podem acompanhar um take. Cortes, divisões e reordenação reconciliam suas âncoras. Áudio de fundo pode ocupar uma posição absoluta. A duração final inclui as camadas; áudio que ultrapassa a sequência principal produz uma cauda com o fundo do canvas. Undo/redo guarda o documento completo, preservando originais e camadas.

## Recursos desta entrega

O contrato completo dos gestos e a matriz de paridade com referências oficiais
estão em [STUDIO_EDITOR_INTERACTIONS.md](STUDIO_EDITOR_INTERACTIONS.md).

Vídeo principal, vídeo sobreposto, imagem, texto e legenda usam seleção, arraste,
pinça e alças na prévia; duplo toque abre a edição contextual. As bordas de cada
camada controlam início/fim na timeline, e segurar o corpo permite mover o intervalo.
Esses gestos têm regressões de estado e persistência; o aceite de fluidez por toque
no iPhone permanece separado.

- Câmera AVFoundation integrada aos controles existentes, com formatos e FPS consultados no dispositivo; captura de Aula em paisagem, editor em retrato.
- Natural, Studio e Cinematic também podem ser escolhidos na câmera, com intensidade. A confirmação espera um quadro concluído na GPU com a receita e o formato atuais. O REC congela o tratamento no journal: o original continua bruto e a receita é aplicada uma vez no editor e na exportação. Uma build anterior sem essa confirmação não oferece tratamento ao vivo. Projetos legados exigem escolha explícita do perfil de composição antes da captura tratada.
- Camadas de texto, legenda, imagem, vídeo sobreposto e áudio; posição, escala, opacidade, tempo, volume e fades no painel abaixo da prévia.
- Faixas sincronizadas com o cursor principal; selecionar não navega. Segurar e arrastar desloca uma camada. A edição provisória do item e seu deslocamento são salvos na mesma operação. Revisar, gravar outro take ou sair do editor salva o ajuste visível antes de navegar; uma falha mantém o painel disponível para tentar novamente.
- Presets Natural, Studio e Cinematic, intensidade e ajustes de cor, com comparação antes/depois. Studio usa iluminação local suave nas regiões de rosto detectadas; não altera geometria nem aplica suavização de pele.
- Legendas manuais, importação SRT/VTT e transcrição local em português via SpeechAnalyzer em iOS 26 quando o sistema suporta o idioma. Instalar o modelo é uma operação explícita e cancelável; transcrever não inicia um download implicitamente.
- Exportação de camadas, CoreText, grade de cor, gain e fades pelo mesmo compositor da prévia.

O compositor v2 usa **1080p, 30 FPS e SDR Rec.709** nesta entrega. O perfil anterior conserva sua exportação na qualidade da fonte. Adicionar tratamentos ou camadas a um projeto antigo pede a conversão explícita do perfil; o arquivo original permanece na qualidade da captura. Builds antigas não exibem nem exportam uma edição avançada pela metade: orientam atualizar o binário.

Há um limite de dois decoders de vídeo simultâneos (principal + um vídeo sobreposto). Texto e imagens são rasterizados em camadas. As faixas e a lista de legendas são virtualizadas para não renderizar todos os itens em cada atualização do cursor.

## Limites e critérios das próximas entregas

O preset Cinematic desta versão é um tratamento de cor; não cria profundidade. O modo Cinema por hardware continua bloqueado até câmera, metadados, prévia e exportação preservarem a profundidade na mesma cadeia. Cenários virtuais também dependem de um pipeline de máscara com bordas, cabelo, movimento, estabilidade temporal e integração de luz aprovados visualmente.

Ainda não estão entregues EQ, dinâmica e normalização de voz, animações por keyframe, transições e velocidade por camada. Gain e fades já são reais no audioMix. O reconhecimento local foi validado no Mac com voz sintetizada em português, palavras temporizadas, cancelamento e retomada; isso verifica a integração, sem provar precisão em fala humana, ruído ou aulas longas. O custo da detecção de rosto e a fluidez contínua da composição precisam ser medidos no iPhone; os resultados de teste no Mac não substituem essa avaliação.

O fallback Android mantém a experiência anterior; estes novos motores são iOS primeiro. Nenhuma dependência paga, assinatura de SDK ou processamento em nuvem foi adicionada.

## Validação e reprodução

Na pasta `mobile`:

```bash
npm run typecheck
npm run test:studio
npm run test:navigation
npm run test:studio:media
npm run test:studio:capture
npm run test:studio:recipe
npm run test:studio:transcription
npm run test:studio:headless
```

Os testes Swift usam o Xcode em `/Applications/Xcode.app`; os testes de composição também usam ffmpeg. `verify-recipe.sh` gera fixtures locais para dois vídeos, imagem, texto, áudio, rotação e inspeção de quadros; verifica o arquivo exportado e pixels da prévia. `STUDIO_FACE_FIXTURE` e `STUDIO_ROTATION_FIXTURE` permitem acrescentar materiais reais locais sem copiá-los para o repositório. Os artefatos de composição ficam na pasta temporária informada pelo teste.

O runner headless não interage com a tela nem precisa do iPhone: reúne TypeScript, Studio, navegação, captura, composição, exportação e contratos de transcrição. Salva logs e `report.json` com resultados, tempos, revisão e hash dos fontes; invalida a evidência se os fontes mudarem durante a execução. `--build-ios` também compila para simulador e iPhone, sem conectar um aparelho. Para essa opção, use a variante `CLASSFY_IOS_PERSONAL_TEAM=1` no ambiente local.

`--speech-smoke` acrescenta reconhecimento real do motor em áudio de teste sintetizado localmente pela voz Luciana instalada no Mac. Exige modelo de português já instalado. `--install-speech-model`, junto com `--speech-smoke`, autoriza explicitamente a instalação do modelo do sistema. Os testes normais não baixam modelos e nenhuma gravação é enviada a servidores.

```bash
CLASSFY_IOS_PERSONAL_TEAM=1 npm run test:studio:headless -- --speech-smoke
# Modelo ausente: acrescentar --install-speech-model.
# Recompilar os dois destinos: acrescentar --build-ios.
```

A rota **`classfy://dev/studio-premium`**, somente em desenvolvimento, abre prévia, timeline e painéis de produção com fixtures locais. Não precisa de conta e não publica. `Exportar QA` salva `classfy-studio-premium-qa-result.json` no cache com duração, resolução, FPS, áudio e receita. A rota também permite conferir posição, PiP, texto e tratamento por toque.

Depois de reconstruir o binário, validar no iPhone: troca de lentes, 4K/FPS conforme capacidade, Aula horizontal, STOP durante início, segundo take, retorno do background, seleção sem salto de cursor, trim/restauração, camadas, antes/depois, replay após EOF, instalação/cancelamento do modelo e legendas. Exportar um arquivo local e compará-lo com a prévia, sem enviar a publicação.
