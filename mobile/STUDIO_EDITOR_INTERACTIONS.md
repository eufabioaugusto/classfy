# Studio: contrato de interação do editor

Revisado em 09/10/2026. Este é o comportamento obrigatório para implementação e aceite. Não é uma declaração de que todos os gestos já foram entregues ou validados. A arquitetura e os limites atuais estão em [STUDIO_PREMIUM.md](STUDIO_PREMIUM.md).

## Verificação de 09/10/2026

A pinça usa o ponto focal inicial, inclusive em vídeo principal, texto e itens rotacionados. Alças de cantos fora do canvas são projetadas para dentro da área visível sem mudar o enquadramento real. Tap no principal somente seleciona. O duplo toque de texto é vinculado ao ID e consumido uma vez; seleção, remount e saída de tela não herdam um pedido antigo de teclado.

Seeks enfileirados pertencem ao gesto que os originou e são descartados ao iniciar outro gesto de camada. A timeline mostra três faixas por janela; controles e paginação durante o hold revelam as demais, inclusive áudio, preservando cursor e seleção. Novos elementos manuais/importados ganham faixas independentes. Hold altera tempo e ordem em uma operação; itens antigos agrupados podem ser separados por arraste para outra faixa.

Os callbacks de factories de gestos usam worklets explícitos, conferidos pelo Babel real do Expo54. As alças da prévia são alvos irmãos do corpo, e os recognizers permanecem estáveis durante a transformação. END sem sucesso, cancelamento/background e callbacks atrasados não gravam nem prendem a sessão; uma escrita já iniciada mantém sua reserva até concluir. O scroll nativo não é desligado no início do hold. Os comandos de acessibilidade reservam a operação atomicamente na UI antes de iniciar a persistência no JS, respeitando os SharedValues assíncronos. A importação usa dimensões do picker e libera o raster de fallback; uma segunda ação não libera a sessão de importação que continua pendente.

A preparação nativa espera o item ficar pronto e um seek exato concluído. Comandos de restauração ficam enfileirados sem cancelar esse primeiro quadro. Testes nativos confirmaram vídeo e imagem pausados em zero em três escalas, inclusive após substituição da composição, sem play prévio.

353 testes Studio e typecheck passaram nesta rodada; as regressões cobrem componentes reais com eventos enfileirados, geometria, worklets, foco, faixas, persistência e SharedValues assíncronos. A exportação de fixtures locais no iPhone14 nesta rodada passou com 3s, 1920×1080, 30FPS e áudio. Importar uma imagem e selecionar/confirmar texto liberaram os controles na inspeção do simulador. Comandos AX consecutivos alteraram duração, faixa e tamanho sem mudar o cursor; desfazer restaurou a geometria e reabrir preservou as alterações salvas. O mouse via CUA entregou deslocamento zero nos drags, portanto não comprova arraste contínuo. Pinça, alças, hold e sensação de fluidez por toque físico continuam pendentes de aceite. Nenhum recurso ausente na matriz abaixo foi marcado como implementado por essas correções.

## Interface e guias — segunda rodada de 09/10/2026

Os 15 prints do Edits enviados nesta rodada definem a hierarquia aplicada: cabeçalho compacto, ferramentas maiores por contexto, principal abaixo das camadas, texto roxo e bordas/alças amarelas. Os avisos permanentes de posicionamento, formato, contagem e seleção saíram da tela; ajuda de gestos continua na acessibilidade. A qualidade efetiva permanece acessível no cabeçalho e exibe somente os perfis que o motor realmente exporta.

Texto tem ferramentas rápidas (dividir, editar, duplicar, excluir e opacidade), seguidas de conteúdo, fontes, cores e estilo. A grade oferece seis famílias reais do iOS com amostras, quinze cores, alinhamento, negrito/itálico e fundo. Os painéis de conteúdo e tratamento recolhem transporte/timeline para ampliar a prévia; voltar às ferramentas restaura a timeline no mesmo cursor. A edição de intervalo continua diretamente na faixa, sem modal de corte sobre a montagem. Prévia ampliada mantém reprodução, histórico e uma faixa principal para navegação; retornar restaura retrato.

A prévia encaixa o centro de vídeo principal, texto e imagens/vídeos sobrepostos em X e Y, com guias azuis independentes. A timeline encaixa movimento e alças às bordas de outros elementos/takes e ao cursor, com uma guia amarela tracejada. A tolerância adquire a guia em 8 pontos e libera em 14, usando o deslocamento bruto do dedo; o zoom temporal não altera essa distância visual. Guias são UI transitória, não entram na receita nem na exportação e desaparecem ao terminar/cancelar/interromper o gesto.

Duplicar e dividir camadas mesclam o draft visível com o projeto atual em uma escrita e uma etapa de undo, sem seek provocado pela seleção. Dividir preserva frames, âncoras, alpha e ganho nos pontos permitidos. O schema atual não representa continuidade interna de um fade: dividir dentro de uma rampa fica indisponível, em vez de mudar a curva; suas bordas são permitidas. Abrir tratamento pausa o player e fixa o alvo mesmo com o transporte recolhido.

426/426 testes Studio e typecheck passaram. A inspeção no simulador CREATOR iOS26.5 conferiu seleção e conclusão de texto, grade de fontes, paleta, painel de legendas, abrir/selecionar/cancelar filtro, prévia ampliada e retorno ao retrato, sem bloqueio observado nesses passos. Os testes reais de callbacks/worklets cobrem aquisição/liberação de guias, geometria, cancels, intervalos, cursor e undo. Esta rodada não confirma fluidez por toque físico nem revalida exportação nativa. A tentativa de recarregar o iPhone falhou: CoreDevice listou iPhone F. como unavailable; Metro continua ativo em 8081. Sem push, publicação ou mudança de dependências/motor nativo.

## Reprodução contínua da timeline — terceira rodada de 09/10/2026

O player nativo envia tempo a 15Hz e o fallback Expo a 10Hz. Antes, cada amostra movia a faixa diretamente: no zoom padrão de 60 pontos/s, o avanço nativo acontecia em degraus de 4 pontos; no zoom máximo, 16 pontos. A prévia não era a origem dessa cadência.

`timelinePlayback.ts` sincroniza um relógio visual em `useFrameCallback`, no UI thread do Reanimated. A faixa avança pelo intervalo real de cada quadro, com correção gradual de pequenos desvios entre amostras. Pausa, carregamento, seek e replay usam a posição do player; esse relógio nunca faz seek, muda receita ou grava tempo. O zoom mínimo também conserva movimento fracionário, incluindo a posição final. As camadas compiladas mantêm uma referência estável entre eventos de reprodução.

Gestos, operações pendentes e background interrompem a extrapolação. A confirmação do arraste/pinça protege o destino contra amostras antigas até o player confirmar o seek. O adapter nativo publica pausa imediatamente e rejeita eventos `playing=true` já enfileirados. Sem amostras avançando por 250ms, ou após um quadro suspenso por mais de 100ms, o relógio congela até confirmação fresca; isso também limita buffering em binários antigos que ainda informam a taxa desejada do AVPlayer.

444/444 testes Studio e TypeScript passaram. As regressões executam os handlers reais com amostras a 15Hz, quadros a 60/120Hz, feedback de scroll nativo, SharedValues assíncronos, worklets do preset Expo, pausa/carregamento, operações pendentes, seek, pinça, background e fim da montagem. A confirmação do seek conta tanto antes quanto depois da liberação UI, inclusive com o primeiro Play recebido já além do destino. Inspeção do Simulator CREATOR pelo túnel remoto confirmou Play, avanço e término na posição final, sem erro de renderização. Esta evidência não mede FPS físico do iPhone. Somente JS/TypeScript; sem novo binário, dependências, push ou publicação de produção. Disponível pelo Metro/túnel existente no Classfy Dev.

Referência da API usada: [Reanimated4 — useFrameCallback](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useFrameCallback/).

## Cadência real e eventos nativos na UI — quarta rodada de 09/10/2026

A gravação enviada após a terceira rodada mostrou que o movimento ainda falhava. A régua tinha escala de 180 pixels/s; o recuo visível foi de 28 a 51 pixels, aproximadamente 0,15 a 0,28 segundo, enquanto o vídeo e o contador continuavam. Portanto, o aceite anterior não comprovava fluidez física.

O hook `useFrameCallback` da versão instalada usa a identidade do callback para registrar/remover o loop. O callback inline e o objeto `Motion` recriados pelos renders reiniciavam a cadência; o harness anterior apenas substituía uma referência e não reproduzia esse ciclo. Os callbacks agora usam `useCallback`, worklet explícito e handles estáveis. O novo teste executa o hook e ambos os registries instalados, com React/filas controlados, além do componente transformado pelo Babel/Metro. Com amostras a 15Hz, renders e feedback de scroll, a timeline mantém um único registro em 60/120Hz. O teste de controle reproduz os reinícios da versão inline.

No compositor nativo, `useEvent` recebe `onPlaybackState` no runtime UI do Reanimated, diretamente do evento Fabric, antes da fila JS/React. `timelinePlaybackChannel.ts` define o canal compartilhado entre a prévia e ambas as apresentações da timeline. A UI consome essa amostra e anima cada quadro; React conserva contador, seleção e edição persistente. A cópia JS atrasada nunca substitui a amostra nativa mais recente. Podcast/perfis legados conservam o caminho de amostras JS e o mesmo relógio visual estável.

Um watchdog expirado não equivale a seek: a recuperação mantém a posição visual e corrige a velocidade gradualmente, sem recuos periódicos ou saltos para um timestamp atrasado. Eventos repetidos com mídia congelada não renovam a extrapolação. Pausa, carregamento, erro, seek, inspeção de origem, background e desmontagem continuam interrompendo o avanço. Revisão, token e sequência da intenção protegem o canal e a cópia JS contra confirmações antigas de Play, EOF e comandos assíncronos; o alvo otimista do seek não autoriza amostras antigas enquanto o player ainda navega.

O Simulator CREATOR recebeu os eventos pelo host animado e confirmou Play, pausa em 1,5s, retomada a partir desse instante e término/replay, com régua acompanhando o contador e sem erro de renderização. Isso confirma a integração nativa, mas não mede FPS físico do iPhone nem comprova equivalência absoluta com o Edits. A alteração é JS/TypeScript, usa o binário já instalado e chega pelo Metro/túnel remoto existente; não requer push, publicação de produção, dependências novas ou build nativo.

475/475 testes Studio, TypeScript e `git diff --check` passaram. Regressões de duas corridas foram reproduzidas antes de corrigir: Promise de seek antiga pausando um Play novo e token nativo atual publicando a posição anterior ao seek. Os testes integrados executam adapter e Timeline reais sobre o mesmo canal; a fila JS bloqueada também cobre ACK do seek na UI, novo Play, EOF e Promise atrasada. O bundle iOS atualizado respondeu HTTP 200 pelo túnel remoto, com o canal e as guardas finais presentes.

Fontes técnicas: [Reanimated — memoizar frame callbacks](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/#-memoize-frame-callbacks), [useEvent](https://docs.swmansion.com/react-native-reanimated/docs/advanced/useEvent/) e [Expo — eventos de views nativas](https://docs.expo.dev/modules/native-view-tutorial/). A [documentação pública da Meta sobre o Edits](https://about.fb.com/news/2025/04/introducing-edits-streamlined-video-creation-app/) descreve precisão de timeline por quadro, mas não identifica seu motor interno. A arquitetura desta rodada foi baseada nas APIs instaladas e no comportamento medido, sem atribuir uma implementação privada à Meta.

## Sincronismo e preparação da faixa — quinta rodada de 09/10/2026

Fabio confirmou que a quarta rodada melhorou fortemente a fluidez e eliminou os travamentos. A gravação seguinte mostrou outro defeito: o fim da faixa chegava antes do vídeo e o restante reaparecia. A régua independente das miniaturas confirma posição visual de aproximadamente 9,63s com contador em 5,5s e recuo de 10,36s para 6,23s. Depois desse recuo, a geometria continuava presente, mas uma parte das miniaturas demorava cerca de 585ms para aparecer. A duração do take não aumentou.

O relógio agora usa o timestamp monotônico do display, ignora o mesmo quadro recebido duas vezes e limita a previsão a 120ms além da última amostra real da mídia. A taxa visual acompanha a cadência observada, sem deixar um player mais lento renovar indefinidamente um relógio a 1x. O fim exige confirmação nativa. Essa proteção cobre deltas incorretos/repetidos e progresso lento; a origem específica do avanço de 1,7x no aparelho não foi comprovada por trace físico.

A UI publica sua posição para preparar miniaturas, régua e camadas sem depender do feedback de `onScroll`. Eventos antigos de rolagem não substituem essa posição durante a reprodução; o gesto físico assume o offset ao começar. A janela React avança em blocos de 96 pontos, com margem de pelo menos 192 pontos de cada lado. Células seguintes já existem com a capa enquanto quadros específicos chegam; a extração continua limitada a 10 timestamps por take/janela e um decoder global. Não se extrai nem se monta a aula inteira. Movimento por quadro permanece na UI e não depende de render React.

497/497 testes Studio, TypeScript e diff check passaram. Os testes exercitam os componentes Babel reais e os registries instalados em 60/120Hz, mídia com cadência irregular, timestamps duplicados, espera/retomada, EOF e cobertura das células sem evento de scroll, inclusive em take de uma hora. O Simulator CREATOR confirmou régua alinhada ao contador, replay, zoom ampliado e término em 8,5s na fixture nativa. Isso não substitui a repetição deste cenário específico no iPhone. A entrega continua JS pelo Metro/túnel existente do Classfy Dev, sem build novo ou publicação web.

## Arraste do principal, proporções e feedback — sexta rodada de 09/10/2026

Fabio confirmou a correção anterior do sincronismo/faixa no iPhone: “Melhorou, resolvi dessa questão”. O novo relato trata do arraste do vídeo principal, das proporções das ferramentas e do feedback sensorial ao encaixar nas guias.

O pan do principal selecionado exigia 150ms de pressão antes de ativar. No recognizer iOS do RNGH2.28 instalado, movimento maior que 10 pontos durante essa espera faz o gesto falhar. Removemos a espera do corpo já selecionado, conservando a seleção no primeiro toque, os recognizers estáveis, a pinça e os cantos separados. O teste reproduz deslocamento de 16 pontos em 40ms antes de executar os callbacks reais: a versão anterior falhava, e o arraste corrigido grava posição sem alterar tamanho ou cursor, inclusive com Babel/worklets e filas UI/JS independentes.

A seleção da prévia agora usa um contorno fino, pontos menores e somente o frame do elemento; o contorno adicional do canvas saiu. As alças da timeline ficaram mais largas, com chevrons e amarelo vivo. Cabeçalho, transporte e ferramentas contextuais usam proporções menores; os alvos dos controles permanecem alcançáveis. Nos trechos curtos, os alvos das duas alças são separados no meio do trecho e estendidos para fora, preservando o tempo real e evitando que tocar o início acione o fim.

O encaixe produz feedback somente ao adquirir uma guia/alvo novo. Aquisições antigas são descartadas após sair da guia, cancelar, terminar, trocar seleção, interromper ou desmontar. O módulo Swift usa `UISelectionFeedbackGenerator` na main queue, retém o generator, prepara o próximo tick e limita chamadas a uma por 70ms com o app ativo. Não há vibrador genérico de 400ms como substituição. A presença do método é opcional: o Classfy Dev antigo continua editando normalmente, mas a vibração exige rebuild/instalação do binário novo. As alterações de arraste e interface chegam pelo Metro/túnel existente.

537/537 testes Studio, TypeScript e diff check passaram. As regressões executam os callbacks reais com Babel/worklets, qualificam o pan do principal no recognizer instalado, descartam feedback atrasado e verificam os dois alvos/cortes em trechos de 6, 8 e 36 pontos. Builds Debug para Simulator CREATOR e dispositivo iOS genérico passaram com a função Swift. A inspeção do Classfy Dev antigo pelo túnel confirmou compatibilidade, bordas/alças e ferramentas compactas; os comandos AX de posição/tamanho renderizaram a alteração e o undo. O mouse CUA não confirmou arraste contínuo, e o simulador não comprova sensação háptica. Esses dois aceites continuam físicos. O bundle iOS atualizado respondeu HTTP200 pelo Metro existente; o novo build nativo está preparado, sem instalação no iPhone remoto, push ou publicação web.

Referência nativa: [Apple — UISelectionFeedbackGenerator](https://developer.apple.com/documentation/uikit/uiselectionfeedbackgenerator).

## Rolagem vertical de camadas — sétima rodada de 09/10/2026

O vídeo do Edits enviado por Fabio mostra somente a pilha de sobreposições rolando dentro de uma área fixa. Principal, régua, playhead, contador e ferramentas ficam ancorados. A camada selecionada pode sair desse recorte mantendo seleção e contorno da prévia; a navegação não altera tempo nem gera edição.

O Studio substitui as setas e os grupos de três por um ScrollView vertical nativo na área das camadas. A área continua mostrando até três faixas por altura, mas todas as faixas são alcançáveis por rolagem contínua. Um gesto comum sobe/desce a pilha; hold continua reservado a mover o elemento no tempo ou entre faixas, e as alças continuam cortando duração. A arbitragem de eixo mantém swipe vertical separado do scrub horizontal; navegar em Y não chama seek, não grava receita, não cria undo nem interrompe o relógio.

O conteúdo tem altura total, fundos de todas as faixas e preparação de uma altura de viewport adicional em cada direção. A UI acompanha o offset fracionário; React prepara linhas somente quando muda a linha visível. O item selecionado permanece montado mesmo fora do recorte, inclusive durante gesto e escrita pendente. O hold usa o deslocamento do dedo mais o avanço vertical real, com autoscroll contínuo nas bordas. Selecionar externamente uma camada fora da janela a revela sem mudar o offset horizontal.

Validação: `npm run test:studio` passou 547/547 e `npm run typecheck` passou. As regressões executam os callbacks transformados pelo Babel real com 13 faixas, relógio a 60/120 Hz, fila JS atrasada, hold até a última faixa, escrita pendente, crescimento da pilha após montagem, pinça e retorno do background. A revisão independente não encontrou bloqueadores. O bundle iOS remoto respondeu HTTP 200 com o ScrollView novo e sem as setas antigas; não houve alteração nativa, rebuild ou push de produção nesta rodada.

QA visual no Simulator CREATOR: 12 sobreposições preparadas, faixas fora do viewport reveladas pela acessibilidade com prévia, seleção e tempo preservados. A fixture foi restaurada, removendo somente as oito cópias temporárias; quatro sobreposições e seis takes originais ficaram intactos. Wheel e drag CUA não produziram swipe iOS e não validam a sensação física. O reveal automático de um texto por AX também moveu X sem seek, comportamento observado anteriormente nessa automação; isso não foi usado para alterar o relógio aprovado no iPhone.

Aceite no iPhone remoto: Fabio recarregou o Classfy Dev e respondeu **“Todas as camadas acessíveis”** ao teste de deslizar verticalmente sobre a pilha sem hold, alcançando texto e legenda fora das três faixas com principal fixo. O teste físico fecha a limitação de gesto da automação do Simulator.

Referências técnicas: [React Native 0.81 — ScrollView](https://reactnative.dev/docs/0.81/scrollview) e [Reanimated 4 — scrollTo na UI thread](https://docs.swmansion.com/react-native-reanimated/docs/scroll/scrollTo/).

## Controles por faixa e transformação nativa — oitava rodada de 09/10/2026

Cada faixa tem controles fixos no extremo esquerdo: olho para ocultar/mostrar conteúdo visual e áudio para silenciar/restaurar vídeo ou áudio. O principal tem seu próprio mute. A coluna acompanha a rolagem vertical na UI e permanece fixa durante navegação horizontal. Ícones de 20 pontos têm alvos de 44 pontos; uma faixa de vídeo expõe os dois controles. Faixas ocultas continuam editáveis e aparecem atenuadas.

`hidden`, `muted` e `mainMuted` são opções reversíveis do documento v2. Compilar aplica opacity/gain zero sem remover intervalos, IDs, mídia ou o ganho original. Os controles preservam cursor/seleção, mesclam o draft visível e geram uma escrita e uma etapa de histórico. Presses tardios, troca de faixa/conta, gesto ou escrita em curso não podem alterar outro alvo. O exportador legado rejeita flags que não conseguiria representar.

O contorno da seleção já movia na UI, mas a imagem ainda seguia drafts JS a cada 33ms, recompilando a composição e substituindo o player. O novo binário confirma capacidade Metal e recebe um canal UI compacto de geometria. `StudioCompositionInteractiveSurface` conserva os quadros do instante pausado e seus grafos Core Image de orientação/tratamento; cada movimento renderiza a composição diretamente na GPU, preservando ordem, alpha, grade e sobreposições. Vision não é repetido por amostra. Texto redimensionado usa o mesmo CoreText da exportação. A fila admite até dois comandos GPU e mantém a geometria mais recente, sem acumular todos os movimentos.

Ao soltar, a receita durável é salva uma vez. A superfície transitória só cede ao primeiro quadro canônico depois de confirmar a escrita. As ordens receita→recibo e recibo→receita, prime tardio, prop canônica antes do patch terminal, ACK de operação anterior e restauração do cursor são protegidas. Mudança real de instante/fonte, background, cancelamento ou remoção encerram a superfície. O Dev anterior conserva o caminho JS compatível; Reload não instala o Swift novo.

Validação: 588/588 testes Studio, TypeScript e diff check passaram. A fixture nativa comparou vídeo principal, PiP, imagem e texto com a receita final e encontrou diferença de pixels 0/255; conferiu protocolo e handoff nas ordens acima. Podcast mutado preservou faixa/duração de 1s com RMS0; restaurar produziu RMS0,088. Substituir composição inicial→mute→unmute manteve frame0 real, cursor0 e pausa, sem quadro preto. Os testes nativos de recipe, compositor e initial-frame também passaram. `test:studio:interaction` integra essa regressão ao runner headless.

QA no Simulator CREATOR: ocultar/restaurar texto e imagem, persistir/recarregar flags e alinhamento da coluna em X/Y passaram. O novo binário manteve a prévia intacta após mute/unmute; reduzir e deslocar o principal por acessibilidade preservou posições dos overlays. Undo restaurou a geometria; quatro overlays, seis takes e 8,5s da fixture foram preservados. Esses comandos não comprovam a cadência do arraste físico. A nova fluidez ainda requer instalação do binário no iPhone e aceite por toque; o aparelho remoto está indisponível ao CoreDevice nesta rodada.

Builds Debug finais de simulador e iOS genérico passaram. O binário final foi instalado no Simulator e mute/unmute reconferido; o build de dispositivo está em `/tmp/classfy-studio-device-build/Build/Products/Debug-iphoneos/ClassfyDev.app`. O bundle iOS respondeu HTTP200 pelo túnel Metro existente, com os controles e canal presentes. Os botões chegam por Reload; a renderização interativa e o prime corrigido exigem o novo Classfy Dev. Sem instalação no iPhone remoto, publicação web, push ou alteração de dependências.

## Margem inferior e controles compactos — nona rodada de 09/10/2026

Os dois prints seguintes do Fabio mostraram a barra de ferramentas encostada na navegação do iPhone e controles visualmente pesados. O `KeyboardAvoidingView` instalado sobrescreve seu próprio `paddingBottom` no modo `padding`, inclusive com teclado fechado. A margem de segurança agora pertence ao workspace: safe area inferior (mínimo de 8 pontos) mais 20 pontos de folga. Com teclado aberto, o workspace usa 8 pontos e deixa a compensação ao componente de teclado. A prévia ampliada recebeu a mesma folga; os painéis modais mantêm safe area mais 12 pontos.

Ícones e fontes maiores dos controles foram reduzidos em aproximadamente dois pontos. Rótulos pequenos mantêm piso de 11 pontos; amostras de fonte, campo de texto e conteúdo da cena conservam seus tamanhos. Ferramentas principais usam ícones de 20 pontos com traço de 1,5 e área de 62×56 pontos; ações compactas mantêm alvos de pelo menos 44 pontos. A coluna de hide/mute usa ícones de 18 pontos, sem alterar sua geometria de toque. Nenhum gesto, intervalo, receita, fonte exportada ou código nativo mudou.

Validação: TypeScript, diff check e os 41 testes existentes de posição/rota passaram. O Simulator CREATOR conferiu margem na barra normal e na seleção de camada, edição com teclado visível e retorno à barra sem sobreposição ou perda da folga. Nenhum conteúdo da fixture foi editado ou publicado. O bundle iOS remoto respondeu HTTP200 e contém a margem nova. Essa rodada chega por Reload no Classfy Dev já instalado; não requer rebuild nem push. A redução de conflitos com o gesto Home ainda depende do uso físico no iPhone remoto.

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
| Exportação, perfis e salvar/compartilhar | [CapCut mobile][capcut-overlays] documenta resolução/FPS e exportação; [Edits mobile][edits-launch] documenta exportar/compartilhar sem marca adicionada. Fluxo Studio: revisar perfil → gerar arquivo → validar → salvar/compartilhar. | Motor local e upload presentes. Composição usa 1080p/30 FPS/SDR; caminho legado preserva fontes até 4K/60 FPS conforme metadados. Conversão é explícita. UI de salvar na galeria/share e seletor completo de codec/bitrate não implementados; captura 4K não garante composição 4K. | Perfil efetivo visível; nunca reduzir qualidade silenciosamente; conferir pixels/FPS/cor/áudio/duração e espaço livre. Salvar local deve funcionar sem publicar; cancelamento conserva projeto e não anuncia sucesso antes da escrita. |
| Planejamento, storyboard e reutilização pedagógica | [Edits mobile][edits-launch] documenta storyboard com roteiro, cues, clips e notas. Fluxo Studio: organizar introdução/tópicos/exemplos → relacionar roteiro aos clips → gravar → revisar. | Roteiro/teleprompter e projetos presentes; storyboard por cena, cartões pedagógicos e templates de aula com blocos reutilizáveis não implementados. | Planejamento editável e vinculado ao projeto sem alterar o vídeo; reordenar cena mantém referências; nenhum limite de vídeo curto imposto à aula; importação de template cria IDs próprios. |

Não adicionar controles de recursos ausentes como se funcionassem. A sequência de execução prioriza os gestos diretos e sua persistência/exportação; depois amplia texto/legendas/voz e recursos de tempo. Cada ampliação deve cumprir esta matriz e os cenários abaixo, inclusive em aula longa.

O estado dos grupos novos foi conferido no [schema e receita](src/features/studio/model.ts), [faixas da timeline](src/features/studio/StudioTimeline.tsx), [seleção do exportador](src/features/studio/media.ts), [revisão/publicação](app/studio/review.tsx), [captura nativa](modules/classfy-studio-media/ios/StudioCaptureSession.swift) e [motor de composição](modules/classfy-studio-media/ios/StudioRecipeEngine.swift). A matriz amplia o inventário; não autoriza exibir ferramentas inoperantes nem transforma ausência em compromisso de entrega imediata. Para aulas, voz, texto legível, referências visuais e exportação confiável precedem efeitos decorativos.

## Prévia: manipular o que se vê

Vale para **vídeo principal, vídeo sobreposto, imagem, texto e legenda**. Áudio usa a timeline e ferramentas próprias.

| Ação | Resultado obrigatório |
| --- | --- |
| Toque em um elemento visível | Seleciona seu ID e mostra contorno/alças e ferramentas contextuais. Mantém o cursor. Em sobreposição, prioriza o elemento visível superior. |
| Segurar e arrastar | Move o elemento selecionado dentro do canvas, com resposta contínua. Vídeo principal também é manipulável. |
| Pinça | Redimensiona o elemento selecionado, preservando sua proporção e o ponto de apoio do gesto. Não altera o formato do projeto. |
| Arrastar perto do centro | Encaixa em X/Y e mostra a guia azul correspondente; afastar o dedo libera o encaixe. |
| Arrastar alça de canto | Redimensiona diretamente na prévia; a alça deve ser fácil de alcançar sem mudar a posição por um toque acidental. |
| Duplo toque em texto/legenda | Abre a edição do conteúdo com teclado e foco no campo correto. |
| Duplo toque em vídeo/imagem | Abre as ferramentas do clip selecionado. Não dispara edição de outro item nem desloca a reprodução. |
| Toque em área vazia | Remove a seleção, sem mudar tempo, conteúdo ou escala. |

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
- Cada gesto concluído gera **uma operação de undo**; movimentos intermediários não criam dezenas de entradas. Um gesto sem alteração não cria histórico. Cancelamento/interrupção restaura o estado inicial, inclusive seleção, faixa e cursor de edição.
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
