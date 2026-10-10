# Studio: contrato de interação do editor

Revisado em 09/10/2026. Este é o comportamento obrigatório para implementação e aceite. Não é uma declaração de que todos os gestos já foram entregues ou validados. A arquitetura e os limites atuais estão em [STUDIO_PREMIUM.md](STUDIO_PREMIUM.md).

## Programa de qualidade: validar o editor como conjunto

Auditoria inicial de 09/10/2026 sobre a implementação `d731f92`, seguida da implementação remota do núcleo sobre `4c7227a`, branch `codex/mobile-dev-iphone`. O objetivo é fechar o núcleo de edição com regras consistentes e jornadas completas antes de ampliar a superfície de recursos. Corrigir um sintoma exige procurar a mesma regra nos outros tipos de elemento e pontos de entrada. Uma função isolada passar não encerra o aceite da jornada.

### Estado e evidência atual

A rodada remota registrou 668/668 testes Studio, 3/3 de navegação, TypeScript e todas as dez etapas headless aprovadas, com fontes inalteradas durante a execução. Relatório: `/var/folders/q2/8n5frlfj0bl65qtj7nmcdhlc0000gn/T/classfy-studio-headless-M8YerD/report.json`. Builds Debug finais de Simulator/iOS passaram separadamente. Fabio já confirmou melhora da reprodução da timeline e acesso a todas as camadas pela rolagem vertical. A nova pinça e a continuidade da superfície Metal ainda precisam de instalação do binário e toque físico. Esses resultados não comprovam paridade integral com o Edits nem a jornada completa de edição/exportação no iPhone.

O [histórico de validação](STUDIO_EDITOR_VALIDATION_HISTORY.md) conserva as rodadas e seus limites. Números e comportamentos antigos, como a paginação de três faixas, pertencem àquelas versões; não substituem o contrato operacional abaixo. A matriz de recursos é um inventário datado, não uma lista de itens aprovados.

### Regras compartilhadas que governam todas as ferramentas

| Área | Regra de implementação e revisão |
| --- | --- |
| Seleção | Mesmo ID e mesma intenção em prévia/timeline; selecionar não busca outro tempo. O tipo do item determina a ferramenta, sem trocar o alvo durante um gesto. |
| Gestos | Prévia: arrastar item selecionado, pinça e alças. Timeline: deslizar navega, hold move item, borda corta, pinça amplia tempo. Testar também transições entre dedos e gestos diagonais. |
| Transação | Estado comum `idle → gesture → committing → settled/cancelled`; uma reserva por operação, uma entrada de undo por mudança, nenhuma para no-op. ACK corresponde à operação que iniciou a escrita. Cancelar antes da escrita restaura; depois de iniciar a escrita, aguardar seu resultado real. |
| Draft e teclado | Concluir confirma; cancelar descarta; voltar de subpainel conserva draft. Trocar seleção e sair exigem resolução explícita do draft. Botões com o mesmo nome não podem conservar em uma ferramenta e descartar em outra sem indicação. |
| Fluxos externos | Galeria, câmera, áudio e arquivo de legenda seguem a mesma exclusão/reserva. Salvar e fazer flush antes de sair; revalidar foco/alvo após awaits; cancelamento e perda de foco não abrem outra tela nem apagam edição. |
| Player e apresentação | Atualizar pose/visibilidade/áudio mantém tempo e intenção de reprodução. Identidade do item, geração da receita e confirmação do quadro têm vidas distintas; eventos antigos não comandam a cena atual. |
| Persistência e exportação | Receita não destrutiva; fontes intactas; recuperação verdadeira após interrupção; prévia e exportação concordam em tempo, geometria, ordem, texto, tratamento e som. Histórico de undo, cursor e seleção são estados da sessão atual, sem promessa de persistência na reabertura. |
| Design e acessibilidade | Hierarquia e dimensões comuns, safe area inferior, alças alcançáveis, ferramentas contextuais e estados claros. Ícone menor não significa reduzir o alvo de toque. Não recolocar instruções permanentes para compensar um gesto difícil. |

### Divergências da auditoria e correções remotas

As diferenças abaixo foram verificadas no código/contrato e receberam correção compartilhada. As evidências não devem ser confundidas com aceite físico de usabilidade.

| Divergência | Correção | Evidência e limite |
| --- | --- | --- |
| Toque vazio tinha dois significados com item selecionado | [Rota](app/studio/[id].tsx): prévia e Canvas usam `pressEmptyCanvas`; salva draft e desmarca, sem seek ou Play acidental. Sem seleção/tela inteira alterna reprodução. | Callbacks reais da rota cobrem principal/texto/imagem, falha e retry. Simulator confirmou vazio com principal/texto; pinça/arbitragem física permanecem pendentes. |
| Política de galeria/legenda não era uniforme | [Rota](app/studio/[id].tsx): `EditorEntry` reserva antes de awaits, congela alvo/âncora e revalida foco, identidade, seleção e existência do alvo. Uma reserva até o resultado real de escrita iniciada. | Testes de blur/refocus, mudança de conta/alvo, toque duplicado, cancelamento, transcrição e falha de save. Simulator abriu/cancelou a galeria com seleção/cursor preservados; importação completa de todas as mídias por UI ainda pendente. |
| Observers do item usavam a geração de um prepare antigo | [View nativa](modules/classfy-studio-media/ios/StudioCompositionView.swift): registro vinculado ao item e à sua própria época, preservado no fast path; item substituído/rebind/dispose invalida callbacks antigos. | Helper de produção com AVPlayer real no Mac confirma EOF e erro após atualização, replay/seek e callbacks antigos. Build e inspeção do Simulator não comprovam frame pacing/Metal por toque físico. |
| Props reenviadas reiniciavam o vídeo após EOF | Simulator reproduziu mute → Play → fim → reinício automático. A fronteira Expo agora usa `setPausedProp` idempotente, separada de EOF/background/comandos internos. | AVPlayer real confirma EOF, props repetidas e replay explícito único; a UI do binário final confirmou parada em 8,5s, novo Play e Pause. O toque físico permanece pendente. |
| Aviso permanente fora do tempo contrariava a interface acordada | [Canvas](src/features/studio/StudioCanvasEditor.tsx): aviso visual removido; estado acessível conserva anúncio de seleção fora do intervalo. | Testes de seleção/rótulo e jornada com 12 camadas. Anúncio VoiceOver no aparelho ainda pendente. |
| Contrato antigo dizia hold também na prévia | Canvas usa arraste imediato no corpo já selecionado; hold de 220 ms pertence à timeline. | Redação operacional corrigida nesta auditoria. Captura comparativa deve confirmar a mecânica do concorrente, sem atribuição presumida. |

### Matriz de jornadas integradas

Usar dois projetos reproduzíveis: Short vertical e Aula horizontal, com principal, imagem, vídeo sobreposto, texto/legenda e áudio. Conservar fontes locais e versão da receita. Para cada caso registrar build/revisão, estado inicial, passos, cancelamento/retorno, resultado esperado e evidência. Os casos abaixo são trabalho pendente ou parcialmente coberto, não falhas confirmadas.

| ID | Jornada | Aceite de ponta a ponta | Lacuna atual |
| --- | --- | --- | --- |
| J01 | Selecionar principal/overlay/texto → arrastar → pinçar → cantos → vazio → undo/redo | Alvo correto, cursor estável, pose contínua; mesmo resultado nas superfícies; uma operação por gesto. | Callbacks/worklets cobertos; arbitragem UIKit completa e nova pinça física pendentes. |
| J02 | Play/Pause → scrub X → scroll Y com 12 faixas → zoom → seleção fora do tempo | Régua e principal ancorados em Y; sem salto, trecho visual ausente ou seleção redirecionando tempo. | Reprodução/scroll tiveram aceite do Fabio; sequência combinada ainda sem evidência completa. |
| J03 | Hold temporal/vertical → trim início/fim → restaurar → dividir → duplicar | Respeitar origem e duração; mudar faixa/ordem sem cortar vizinhos; guias e undo coerentes. | Testes de operações e estado; recognizers físicos em clips curtos/diagonal/transição entre dedos pendentes. |
| J04 | Duplo toque → texto/teclado → fonte/cor → voltar → trocar alvo → cancelar/concluir | Draft resolvido conforme ação; sem teclado herdado, bloqueio, texto perdido ou confirmação duplicada. | Rota testada com componentes substituídos; falta fluxo real conjunto. |
| J05 | Mais/Sobrepor/Áudio/Legendas → picker/câmera → cancelar/importar → editor | Um fluxo por vez; nenhum picker após blur; posição/seleção/orientação/sessão de áudio preservadas. | Política comum, races/cancelamentos da rota e cancelamento da galeria no Simulator cobertos; importação real completa, câmera e sessão de áudio no aparelho pendentes. |
| J06 | Play → Pause → seek → resize → hide/mute → undo → fim/erro | Sem quadro preto/pose antiga ou alteração involuntária de tempo/reprodução; fim e erro reconhecidos após fast path. | Paridade/handoff e observers de produção com AVPlayer real cobertos; mute → Play → EOF → replay manual passou pela UI final do Simulator. Falta sequência física completa com Expo/UIKit/Metal e erro de decode após item pronto. |
| J07 | Editar → interromper antes/depois da escrita/ACK → reiniciar runtime | Receita/journal recuperados sem perda ou duplicação; falha de save nunca anuncia sucesso; originais intactos. | Jornada acopla gestos a store/journal e reabre runtime; background/escrita pendente/falha/retry cobertos. Encerramento real pelo iOS permanece pendente. |
| J08 | Inserir todas as mídias → transformar/cortar/mover → Play → undo/redo → salvar → reabrir → exportar | IDs/fontes/intervalos/geometria/texto/som coerentes no projeto e arquivo; histórico por operação na sessão. | Aula e Short acoplam media/model/history/store/Canvas/Timeline/Preview reais, UI/JS separados e 12 camadas no Short. Rota/painéis não entram nessa montagem; decode/encode e filesystem são fronteiras substituídas. Receita enviada ao exportador conferida, sem comprovar arquivo dessas mesmas jornadas. |
| J09 | HEVC/VFR/HDR importado → rotação/fades/cortes → comparar prévia/export | Mesma orientação, enquadramento, tempo, tratamento e som; conversão de perfil explícita; tolerância de cor considera codec. | Composição SDR até 4K/60, Original ou saída explícita; prévia HD30 sem modificar a exportação. Fixtures curtas verificam dimensões, timestamps e cor, mas a matriz de cenas reais HDR/VFR e a carga longa no iPhone continuam pendentes. |
| J10 | Exportar → cancelar após progresso real → falha de escrita → exportar novamente | Remover somente saída parcial; conservar fonte/edição; liberar sessão; sucesso somente após arquivo válido. | Encoding AVFoundation real: cancelamento em 0<progresso<1, falha I/O, colisão inicial/tardia, retry e cancelamento após commit passaram. Saída temporária exclusiva impede apagar arquivo alheio; 100% somente após validação/commit. Background/dispose pelo iOS e montagem completa de J08 ainda pendentes. |
| J11 | Aula de 20–30 min → fontes 4K, dois vídeos, 12+ faixas, centenas de legendas → editar/reproduzir/exportar | Medir frame pacing, memória e aquecimento; sem crescimento contínuo por gesto, perda de áudio ou encerramento. | Relógio/cache e 100 legendas em 2 s testados; carga longa real no iPhone14 não comprovada. |
| J12 | Safe area → rolar ferramentas → fullscreen → teclado → câmera → background/retorno | Controles acessíveis; orientação/áudio corretos; nenhum recognizer ou comando antigo deixa sessão presa. | Inspeções pontuais e guards existentes; falta sequência combinada de lifecycle/entradas externas. |

### Sequência de execução

1. **Uniformizar o núcleo:** corrigir as divergências acima e aplicar as políticas comuns de seleção, transação e entrada externa. Cobrir ordens diferentes entre UI, JS, armazenamento e confirmação nativa. Preferir consolidar regras existentes; não reescrever todo o editor por conta da auditoria.
2. **Fechar as jornadas:** executar J01–J08 e J12 com componentes reais e mesmo conjunto de mídia. Cada defeito recebe uma regressão de sua causa e revisão de todos os lugares que usam aquela regra.
3. **Comparar a referência:** observar o Edits iOS real por jornadas, registrando versão, dedos/hold, prioridade, cancelamento, teclado, retorno e resultado. Capturas do usuário complementam a referência; não substituem uma sessão completa. Documentar comportamentos observados, sem inferir código ou linguagem privada.
4. **Provar carga e saída:** executar J09–J11, comparar arquivo final e medir a apresentação física. Depois ampliar recursos conforme a matriz, passando pelo mesmo aceite integrado.

### Condição para declarar uma entrega pronta

- Evidência automatizada identifica revisão e fontes; reaproveitar [verify-studio-headless.mjs](scripts/verify-studio-headless.mjs), que registra fingerprint e resultados, sem transformar a contagem de testes em selo de usabilidade.
- Mudança precisa passar sua jornada e as vizinhas afetadas; testes isolados, compilação, UI no simulador, toque físico e exportação são evidências distintas. Sem ampliar/repetir checks que não correspondam a uma mudança ou risco novo.
- Regra de gesto/comportamento tem resultado registrado; tarefa não termina ao apenas adicionar contorno, botão ou callback. Medir a sequência até persistência/apresentação/exportação relevante.
- Diferenças, limitações e pendências permanecem explícitas. Simulator/fixtures antecipam problemas; o aceite físico confirma sensação de toque e háptica. Fabio faz o aceite de produto, não deve ser o único mecanismo de descoberta de regressões.
- Build/install, atualização JS e publicação são etapas distintas. A rodada remota implementa/testa o núcleo, prepara os builds e instala somente no Simulator. Não instala no iPhone remoto, publica app, faz push ou amplia perfis de exportação.

## Origem dos requisitos

Os prints, gravações e orientações do Fabio são a referência de produto: edição direta na prévia, corte integrado à timeline, ferramentas contextuais e seleção que não salta o cursor. CapCut e Edits ajudam a modelar a experiência; a identidade continua Classfy.

- O [guia oficial de overlays do CapCut](https://www.capcut.com/resource/how-to-add-capcut-overlays) descreve arrastar e usar pinça na prévia mobile; os controles de canto também aparecem na seção desktop. Não generalizar automaticamente um gesto entre plataformas.
- O [guia de imagem sobreposta do CapCut](https://www.capcut.com/resource/overlay-picture-on-video) descreve arrastar/pinçar a imagem e ajustar as extremidades da faixa para definir sua aparição.
- A [ajuda oficial sobre texto invisível](https://www.capcut.com/help/text-not-appearing) distingue ordem das camadas, opacidade e cursor fora do intervalo do texto.
- O [anúncio oficial do Edits](https://about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app/) informa timeline precisa por quadro e edição por clip; publicado em 22/04/2025, com atualização indicada em 17/12/2025. Não documenta ali a mecânica de duplo toque.

Fontes consultadas em 08/10/2026. Os gestos específicos abaixo são **decisões do Studio solicitadas pelo usuário**, inclusive duplo toque, segurar para mover e preservação do cursor; não devem ser atribuídos à Meta sem evidência.

## Como obter precisão e reproduzir a experiência

Documentação oficial confirma capacidades e alguns passos; **o app real da mesma plataforma/build** confirma áreas de toque, prioridade dos gestos, snapping, cancelamento e continuidade. Gravações fornecidas pelo usuário permitem comparar a sequência e o resultado visível; sem indicador de toque, pressão longa e pinça não podem ser deduzidas apenas do deslocamento na imagem. Mouse no simulador não substitui esses testes. Não inferir linguagem ou arquitetura interna dos concorrentes pela aparência.

Para cada recurso da matriz: abrir o mesmo material nos dois editores; registrar versão/plataforma e estado inicial; executar o fluxo indicado; repetir com cancelamento, undo/redo e retorno ao projeto; exportar localmente e comparar o mesmo instante. Marcar separadamente **fonte consultada**, **modelo/motor testado**, **toque real testado** e **exportação comparada**. Uma dessas evidências não substitui as outras.

Referências adicionais verificadas: [CapCut split/organização de clips][capcut-split] (desktop); [gravação de voiceover][capcut-voice] (mobile); [volume e fades][capcut-audio] (editor descrito no guia); [velocidade/curvas][capcut-speed] (seções mobile/web/desktop); [keyframes][capcut-keyframes] (web/desktop); [crop/rotação][capcut-crop] (desktop). A [retrospectiva oficial do Edits, 22/04/2026][edits-year] confirma teleprompter com tamanho/ritmo ajustáveis, mas apresenta outros avanços como futuros naquela data. Nenhuma página isolada comprova paridade integral entre plataformas ou planos.

A revisão ampliada usa também os guias oficiais de máscaras, remoção de fundo, estabilização, áudio e stickers do CapCut, nas plataformas indicadas em cada linha. A atualização de dezembro de 2025 do [anúncio do Edits][edits-launch] apresenta title cards, storyboards, estilos animados de texto e templates no app mobile. Descrições comerciais comprovam que o fornecedor documenta a capacidade; não comprovam qualidade, gratuidade, disponibilidade regional ou desempenho no aparelho do Fabio. Recursos anunciados como futuros continuam sem confirmação de entrega por essas fontes.

## Matriz de paridade e implementação

Snapshot de leitura do código em 08/10/2026, durante desenvolvimento. “Código presente” indica integração/modelo existente, **não aprovação da usabilidade**. A implementação direta da UI continua em paralelo; esta matriz deve acompanhar cada entrega.

| Recurso | Referência / fluxo de reprodução | Estado observado no Studio | Critério específico de aceite |
| --- | --- | --- | --- |
| Principal: trim e restauração | [CapCut split][capcut-split] + contrato: selecionar → puxar início/fim → restaurar. | Cortes/inspeção de origem presentes; toque contínuo pendente. | Sem mover cursor na seleção; limites da origem; preview visível; um undo; cancel restaura. |
| Dividir, reordenar, duplicar | [CapCut organização][capcut-split] cobre corte/reordenação; duplicar é contrato: dividir no cursor → mover → duplicar. | Operações de principal e camadas presentes; divisão de camada preserva fades nos pontos permitidos. Reordenação por gesto ainda sem aceite físico. | Ordem, duração, IDs e âncoras de camadas/legendas coerentes; originais intactos. |
| Layers de vídeo/imagem | [CapCut overlays][capcut-overlays]: adicionar → tap → hold/drag → pinch → alças temporais. | Motor/exportação e interação direta integrados; alças/hold/pinça têm regressões de estado, mas a fluidez por toque real continua pendente. | Item superior correto; pinça e alças sem roubar scroll; ordem/posição iguais na exportação. |
| Texto: conteúdo/estilo/fonte/contorno | [CapCut texto][capcut-overlays], [visibilidade][capcut-text] e Edits: adicionar → duplo toque → editar/estilizar. | Conteúdo, tamanho, quinze cores, fundo, alinhamento, seis famílias iOS e variantes negrito/itálico presentes via CoreText; contorno ainda não implementado. | Teclado no item certo; quebra/acentos iguais no preview/export; estilo legível e persistido. |
| Legendas e tempos por palavra | [CapCut captions][capcut-overlays]: gerar/importar → revisar texto/tempo → cortar origem. | Manual/SRT/VTT e SpeechAnalyzer local presentes; palavras temporizadas viram grupos. Destaque palavra a palavra não implementado. | Português revisável; cortes/reordenação mantêm sincronismo; cancel/modelo explícitos; sem prometer precisão humana a partir de TTS. |
| Áudio/música importados | [CapCut áudio][capcut-audio]: importar faixa → mover/cortar → misturar com voz. | Importação de áudio e camada independente presentes; biblioteca musical não implementada. | Escuta e exportação no mesmo tempo, sem perder voz ou deixar áudio no modo câmera. |
| Voiceover | [CapCut gravação][capcut-voice] / [Edits teleprompter][edits-year]: abrir áudio → gravar sobre a montagem → revisar. | Captura de podcast existe; gravação de voiceover sincronizada ao editor não implementada. | Início/fim alinhados; cancelar preserva projeto; retorno da sessão de áudio seguro. |
| Gain e fades | [CapCut volume/fades][capcut-audio]: selecionar áudio → volume → entrada/saída → exportar. | audioMix real e controles presentes; testes de amostras passaram. EQ/dinâmica/normalização ainda ausentes. | Resultado audível/exportado; fade limitado à faixa; undo restaura volume/intervalo. |
| Velocidade e curvas | [CapCut speed][capcut-speed]: clip → velocidade constante/curva → revisar duração. | Não implementado no schema/motor v2. | Duração/âncoras/voz corretas, sem reordenar clips; preview/export iguais e restauração possível. |
| Keyframes | [CapCut keyframes][capcut-keyframes]: selecionar propriedade → dois instantes → reproduzir. | Não implementado. | Interpolação real; edição/cancel/undo por ação; mesmos valores em exportação. |
| Filtros / grade | [CapCut filtros][capcut-overlays]: selecionar clip → preset/intensidade → comparar origem. | Natural/Studio/Cinematic e motor compartilhado presentes; rosto/fluidez física ainda exigem QA. | Intensidade real, pele preservada, sem efeito aplicado duas vezes ou profundidade fictícia. |
| Ajustes de imagem | [CapCut ajustes][capcut-images]: exposição/contraste/saturação/temperatura → antes/depois. | Grade e controles presentes. | Valores persistidos, undo e cancel coerentes; exportação corresponde ao último ajuste confirmado. |
| Transições | [CapCut transições][capcut-overlays] / Edits: juntar clips → escolher transição → ajustar duração. | Não implementado no motor v2. | Intervalo/decoders/áudio corretos; resultado real, sem botão que simula efeito. |
| Crop, rotação e formato | [CapCut crop][capcut-crop]: selecionar → enquadrar/girar → confirmar. | Rect, contain/cover e rotação existem no contrato/motor; superfície de crop/rotação ainda incompleta. | Transformação não altera origem; aspect-fit/toque corretos; formato e pixels preservados no export. |
| Snapping | Contrato Studio; mecânica exata a observar no app real: mover/alça perto de borda/cursor/guia. | Centro X/Y na prévia e bordas/cursor na timeline implementados com tolerância visual 8/14, guias azuis e amarela tracejada. Toque real ainda sem aceite. | Alinhamento indicado discretamente; soltar/desligar permite ajuste fino; sem saltar o cursor ou aderir ao alvo errado. |
| Undo e autosave | Contrato: concluir gesto → undo/redo → sair/reabrir → interromper salvamento. | Histórico, persistência, backups e guards presentes; gestos novos integrados com uma operação por gesto, ainda exigindo aceite por toque. | Uma entrada por gesto, nenhum histórico para no-op; falha conserva edição recuperável; estado reaberto verdadeiro. |
| Organização de projetos | Edits gerencia projetos; contrato: criar/importar → buscar/ordenar → abrir/excluir/cancelar. | Grid regular, busca, ordem, filtros e sessão transitória presentes. | Abrir câmera/cancelar importação não cria rascunho vazio; dono, arquivos e backup preservados. |
| Câmera: qualidade/FPS/EV/foco/zoom | Edits documenta captura; controles detalhados são contrato Studio: consultar aparelho → ajustar → REC/STOP → editor. | Bridge AVFoundation e controles presentes. QA automatizado no iPhone14 confirmou originais1080p/4K30FPS, frontal/traseira, vídeo/áudio e confirmação de preset. Uso dos controles por toque e aula longa permanecem pendentes. | Exibir somente suporte real; gravação reflete confirmação; interrupção/STOP seguro; edição restaura orientação/áudio. |
| Teleprompter | [Edits][edits-year]: preparar roteiro → ajustar leitura → REC → revisar. | Roteiro e ritmo de leitura presentes na captura; experiência por toque ainda a validar. | Texto/velocidade acessíveis, sem capturar o roteiro no vídeo final nem esconder enquadramento/STOP. |
| Máscaras, blur localizado e chroma key | [CapCut máscaras/blur][capcut-mask] descreve desktop e iPhone; [chroma key][capcut-background] tem passos mobile/desktop: sobrepor → delimitar área ou escolher cor → ajustar bordas → exportar. | Máscara, feather, blur localizado, rastreamento e chroma key não implementados no schema/motor. Rect/crop não removem uma cor nem isolam uma região. | PiP circular e ocultação de dados legíveis; bordas estáveis durante movimento; original recuperável; preview/export iguais. Rastreamento exige teste próprio. |
| Recorte de pessoa e substituição de fundo | [CapCut Remove BG][capcut-background], seções mobile/desktop/web: auto/custom removal → corrigir bordas → inserir fundo. | Segmentação automática e pincel de correção ausentes. Cor do canvas e imagem sobreposta existem, mas não recortam o professor. | Cabelo, mãos, óculos e objetos preservados em movimento; correção/cancelamento disponíveis; custo, processamento local/remoto e suporte explicitados antes da entrega. |
| Retoque facial / beleza discreta | [CapCut retoque][capcut-retouch] descreve o editor **web**: selecionar vídeo → Retouch → ajustar → comparar/exportar. Não comprova o mesmo fluxo no iPhone. | Detecção/retouch de rosto não implementados. Presets de cor não equivalem a suavização de pele ou remodelação facial. | Opcional e reversível; preservar identidade e textura, sem deformar rosto/óculos. Avaliar em diferentes tons de pele e movimentos; prioridade abaixo de voz e legibilidade da aula. |
| Estabilização de vídeo | [CapCut estabilização][capcut-stabilize], passos desktop/web/mobile: selecionar clip → Stabilize → intensidade → revisar/exportar. | Captura pede estabilização AVFoundation `.standard` quando suportada; análise e estabilização **pós-gravação**, inclusive de importados, não implementadas. | Mostrar crop resultante e área perdida; sem saltos no professor/slides; preview/export consistentes; possibilidade de desativar e recuperar enquadramento. |
| Limpeza de voz e redução de ruído | [CapCut Reduce noise][capcut-denoise] descreve desktop; [limpeza de áudio][capcut-clean-audio] descreve web: faixa → redução → ouvir antes/depois → exportar. | Supressão de ruído, isolamento de voz e redução de reverberação não implementados. Gain/fades existentes não removem ruído. | Fala portuguesa inteligível, sem cortar consoantes ou criar som metálico; teste com ventilador/eco/música; ajuste reversível e mesmo áudio na prévia/exportação. |
| Animação de texto, títulos e templates de aula | [Edits mobile][edits-launch], atualização de 17/12/2025, documenta estilos animados, title cards e templates; [CapCut mobile][capcut-overlays] descreve Text template. Fluxo Studio: título/identificação → modelo → editar conteúdo → ajustar entrada/saída. | Texto estático presente; animações, biblioteca de títulos/identificações e templates reutilizáveis não implementados. | Conteúdo/estilo continuam editáveis; timings e fontes persistidos; reutilização não altera originais; animação legível em aula horizontal, sem confundir modelo visual com vídeo pronto. |
| Stickers, formas e anotações didáticas | [CapCut stickers][capcut-stickers] inclui mobile/desktop/web: inserir → posicionar/redimensionar → definir intervalo. Setas e marcações para aula são requisito Studio. | Imagens importadas podem compor anotações estáticas; biblioteca de stickers, formas vetoriais, desenho livre e stickers animados não implementados. | Setas/círculos acompanham o intervalo escolhido, sem esconder informação; cores/espessura legíveis; ativos com origem/licença registrada; sem atribuir animação a PNG estático. |
| Waveform real e referência de áudio | [CapCut ajuda][capcut-waveform] confirma waveform da faixa na seção **desktop**; [visualizador][capcut-audiogram] trata stickers/audiogramas desktop, um recurso diferente. Fluxo Studio: expandir áudio → localizar fala/pausa → cortar → conferir por escuta. | Faixa de áudio mostra ícone de microfone, sem análise PCM/waveform. Detecção de silêncio/beat e audiogramas também ausentes. | Desenho deriva do áudio real e respeita source cuts/zoom; arquivo silencioso não recebe picos inventados; carregamento/cache não bloqueiam scroll. Não prometer precisão de corte por waveform decorativo. |
| Exportação, perfis e salvar/compartilhar | [CapCut mobile][capcut-overlays] documenta resolução/FPS e exportação; [Edits mobile][edits-launch] documenta exportar/compartilhar sem marca adicionada. Fluxo Studio: revisar perfil → gerar arquivo → validar → salvar/compartilhar. | Exportar arquivo separado de envio/curadoria, com prévia pausada, progresso real e folha nativa iOS. Original/HD/2K/4K, 24/30/60 FPS e avisos de conversão; Original preserva cadências fracionárias suportadas. Composição SDR até 4K/60 depende do novo binário e do encoder anunciado. Seleção manual de codec/bitrate e saída HDR não implementadas. | Perfil efetivo visível; nunca reduzir qualidade silenciosamente; conferir pixels/FPS/cor/áudio/duração e espaço livre. Salvar local deve funcionar sem publicar; cancelamento conserva projeto e não anuncia sucesso antes da escrita. |
| Planejamento, storyboard e reutilização pedagógica | [Edits mobile][edits-launch] documenta storyboard com roteiro, cues, clips e notas. Fluxo Studio: organizar introdução/tópicos/exemplos → relacionar roteiro aos clips → gravar → revisar. | Roteiro/teleprompter e projetos presentes; storyboard por cena, cartões pedagógicos e templates de aula com blocos reutilizáveis não implementados. | Planejamento editável e vinculado ao projeto sem alterar o vídeo; reordenar cena mantém referências; nenhum limite de vídeo curto imposto à aula; importação de template cria IDs próprios. |

Não adicionar controles de recursos ausentes como se funcionassem. A sequência de execução prioriza os gestos diretos e sua persistência/exportação; depois amplia texto/legendas/voz e recursos de tempo. Cada ampliação deve cumprir esta matriz e os cenários abaixo, inclusive em aula longa.

O estado dos grupos novos foi conferido no [schema e receita](src/features/studio/model.ts), [faixas da timeline](src/features/studio/StudioTimeline.tsx), [seleção do exportador](src/features/studio/media.ts), [revisão/publicação](app/studio/review.tsx), [captura nativa](modules/classfy-studio-media/ios/StudioCaptureSession.swift) e [motor de composição](modules/classfy-studio-media/ios/StudioRecipeEngine.swift). A matriz amplia o inventário; não autoriza exibir ferramentas inoperantes nem transforma ausência em compromisso de entrega imediata. Para aulas, voz, texto legível, referências visuais e exportação confiável precedem efeitos decorativos.

## Prévia: manipular o que se vê

Vale para **vídeo principal, vídeo sobreposto, imagem, texto e legenda**. Áudio usa a timeline e ferramentas próprias.

| Ação | Resultado obrigatório |
| --- | --- |
| Toque em um elemento visível | Seleciona seu ID e mostra contorno/alças e ferramentas contextuais. Mantém o cursor. Em sobreposição, prioriza o elemento visível superior. |
| Arrastar elemento já selecionado | Move dentro do canvas com resposta contínua, sem exigir hold. Vídeo principal também é manipulável. Hold para mover intervalo/faixa pertence à timeline. |
| Pinça | Redimensiona o elemento selecionado, preservando sua proporção e o ponto de apoio do gesto. Não altera o formato do projeto. |
| Arrastar perto do centro | Encaixa em X/Y e mostra a guia azul correspondente; afastar o dedo libera o encaixe. |
| Arrastar alça de canto | Redimensiona diretamente na prévia; a alça deve ser fácil de alcançar sem mudar a posição por um toque acidental. |
| Duplo toque em texto/legenda | Abre a edição do conteúdo com teclado e foco no campo correto. |
| Duplo toque em vídeo/imagem | Abre as ferramentas do clip selecionado. Não dispara edição de outro item nem desloca a reprodução. |
| Toque em área vazia com seleção | Resolve o draft e remove a seleção, sem mudar tempo, conteúdo, escala ou reprodução. Sem seleção e na tela inteira, o transporte pode usar o toque para Play/Pause. |

A geometria do toque usa o canvas realmente exibido, incluindo margens de aspect-fit. Pinça no elemento e zoom da timeline têm áreas de atuação distintas. Contorno e alças são UI de edição: não entram na exportação. Durante reprodução, a composição continua respeitando o tempo real de cada camada.

## Timeline: selecionar, navegar e editar

- Deslizar verticalmente na área das camadas rola a pilha completa acima do principal, preservando seleção, cursor e escala horizontal. O vídeo principal, a régua e as ferramentas permanecem fixos. Segurar um elemento continua iniciando sua movimentação, sem transformar a navegação comum em edição.
- Ocultar uma faixa visual remove sua imagem da composição sem apagar itens; mute silencia a faixa de vídeo/áudio ou o principal sem perder o ganho original. Controles ficam fixos à esquerda, acompanham a rolagem vertical, preservam cursor/seleção e têm undo/redo.
- Toque em clip ou camada **apenas seleciona**; mantém o cursor e não força rolagem para o centro do item. Arrastar a faixa/régua navega no tempo sob o cursor fixo. Pinça amplia/reduz a escala temporal preservando o instante de referência.
- Segurar e arrastar o corpo de uma camada desloca seu intervalo no projeto. Arraste vertical muda sua faixa e ordem de sobreposição; agrupar mídia não pode deslocar outros itens silenciosamente. As alças de início/fim ajustam sua duração; o corpo não pode roubar o gesto de uma alça. Rolar e mover uma camada precisam de reconhecimento distinto.
- Snapping indica bordas/cursor com guia amarela tracejada e preserva ajuste fino: o dedo adquire o alvo em 8 pontos e solta após 14. Encostar no limite da origem não conta como snapping. Estado e cancelamento ainda exigem aceite por toque físico.
- No vídeo/áudio, as alças editam o intervalo da origem, limitado ao arquivo real. Texto/imagem editam entrada e saída no projeto. Deslocar não deve cortar nem alterar a duração silenciosamente.
- Corte fica integrado à faixa selecionada: prévia e timeline permanecem disponíveis. Não abrir uma superfície de corte flutuando por cima da própria timeline.
- Seleção fora do intervalo temporal continua disponível na timeline e nas ferramentas; sua faixa indica o intervalo efetivo sem aviso permanente na tela. A prévia não inventa um quadro nem exibe uma camada ausente para justificar a seleção. Ver o item exige navegar explicitamente ao seu intervalo.
- Inspeção de uma borda de corte pode mostrar o quadro real da origem com contexto de edição explícito; não altera o cursor salvo da montagem. Encerrar/cancelar devolve a composição ao instante anterior.

## Continuidade e segurança da edição

- Cortes, posição e tamanho são receita não destrutiva; o original permanece intacto. Prévia e arquivo exportado devem concordar em enquadramento, ordem, intervalos e tratamentos.
- Zoom, régua, cursor e geometria do gesto atualizam na UI thread; não dependem de salvar o projeto ou compilar vídeo a cada movimento do dedo. Atualizações nativas antigas não podem sobrescrever a edição recente.
- Cada gesto concluído gera **uma operação de undo**; movimentos intermediários não criam dezenas de entradas. Um gesto sem alteração não cria histórico. Cancelamento/interrupção antes da escrita restaura o estado inicial, inclusive seleção, faixa e cursor de edição. Se a escrita já começou, sua reserva permanece até o resultado real; não anunciar cancelamento de uma alteração que foi persistida.
- O ID e a geometria inicial do item ficam fixos durante o gesto. Troca de projeto, remoção do item, nova receita incompatível, navegação ou background encerram o gesto com segurança. Falha ao salvar mantém a edição recuperável e informa o erro.
- Overlays transparentes e controles decorativos não capturam toques indevidos (`pointerEvents`). Safe area/notch, header, teclado e sheets devem preservar acesso aos controles; evitar padding duplicado e alturas negativas.
- Editor e revisão usam retrato; a prévia respeita o formato do projeto. A orientação de captura pode mudar conforme o formato, mas deve ser restaurada ao retornar. Câmera, teclado ou modal não podem deixar gestos/áudio/reprodução presos ao modo anterior.

## Aceite por cenário

Registrar aparelho, build, formato, passos e evidência. Não marcar como aprovado por compilação, screenshot estático ou clique de mouse.

- [ ] Vídeo principal e cada tipo de camada: toque, arraste, pinça e alças atingem o item certo; preview/export concordam.
- [ ] Texto e legenda: duplo toque abre teclado; editar, cancelar e confirmar preservam seleção e intervalo.
- [ ] Timeline: seleção não muda o cursor nem a rolagem; navegar, ampliar, mover camada e cortar são gestos distintos.
- [ ] Camada fora do tempo ou coberta: nenhuma prévia falsa; navegar ao intervalo correto mostra a composição real.
- [ ] Corte nas duas bordas, restauração e deslocamento respeitam origem e duração; undo/redo desfaz/refaz cada gesto inteiro.
- [ ] Interrupção no meio do gesto, troca de projeto e background não deixam transformações parciais ou callbacks tardios.
- [ ] iPhone com notch, teclado aberto, retorno da câmera e sheets: controles acessíveis, orientação correta e áreas de toque sem bloqueio.
- [ ] Aula horizontal e Short vertical, clips curtos e aula longa: gestos contínuos por toque real, sem salto de quadro, faixa ou seleção.

**Estado deste contrato:** os cenários acima exigem validação por toque real e comparação de exportação. Testes headless de composição/estado comprovam seus próprios contratos; não comprovam pinça, pressão longa, alças ou fluidez física. Pendências devem permanecer explícitas até o teste correspondente passar.

[capcut-overlays]: https://www.capcut.com/resource/how-to-add-capcut-overlays
[capcut-images]: https://www.capcut.com/resource/overlay-picture-on-video
[capcut-text]: https://www.capcut.com/help/text-not-appearing
[capcut-split]: https://www.capcut.com/tools/split-scene
[capcut-voice]: https://www.capcut.com/resource/how-to-add-voice-in-a-video
[capcut-audio]: https://www.capcut.com/resource/edit-voice-recording
[capcut-speed]: https://www.capcut.com/resource/how-to-do-velocity-on-capcut
[capcut-keyframes]: https://www.capcut.com/tools/keyframe-animation
[capcut-crop]: https://www.capcut.com/tools/crop-video
[edits-year]: https://about.fb.com/news/2026/04/one-year-of-edits-built-for-and-with-creators/
[edits-launch]: https://about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app/
[capcut-mask]: https://www.capcut.com/resource/how-to-blur-face-on-capcut
[capcut-background]: https://www.capcut.com/resource/how-to-remove-background-in-capcut
[capcut-retouch]: https://www.capcut.com/tools/face-retouching
[capcut-stabilize]: https://www.capcut.com/resource/capcut-stabilizer
[capcut-denoise]: https://www.capcut.com/resource/eliminate-background-noise
[capcut-clean-audio]: https://www.capcut.com/resource/clean-up-audio
[capcut-stickers]: https://www.capcut.com/resource/video-editing-with-stickers
[capcut-waveform]: https://www.capcut.com/help/fix-audio-recognition-error
[capcut-audiogram]: https://www.capcut.com/resource/best-sound-waves-generators
