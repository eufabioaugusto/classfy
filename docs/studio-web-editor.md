# Studio web desktop

## Rotas e publicação

- `/studio` continua sendo o dashboard. **Gravar** abre a produção; **Novo projeto** abre a biblioteca.
- `/studio/record` começa com formato, composição (só câmera, só tela ou câmera e tela) e fonte da câmera (computador ou iPhone). A opção **Live** encaminha à preparação já existente em `/studio/live`, sem criar transmissão ou projeto local no clique. O fluxo local abre a captura e só depois leva ao editor. O acesso é direto pelo dashboard ou pela biblioteca, sem precisar criar uma montagem vazia.
- `/studio/projects` contém as montagens editáveis deste navegador: criar, buscar, renomear, duplicar e excluir.
- `/studio/projects/:projectId` abre o editor, exclusivo para contas creator/admin.
- **Preparar publicação** renderiza a montagem e abre `/studio/upload?type=...&studioProject=...&studioRevision=...`. O usuário escolhe **Usar arquivo do editor**; os passos existentes continuam responsáveis por enviar a mídia e concluir a publicação.
- Os uploads existentes e `/studio/contents` mantêm suas responsabilidades. Preparar um arquivo não o publica automaticamente.

## Preparação da gravação

A entrada mantém **Formato**, **Cena** e **Câmera** em três faixas compactas. A cena selecionada aparece como prévia real na própria preparação; antes de ativar a entrada há um estado vazio explícito, sem ilustração de câmera. Uma orientação contextual e o nome opcional substituem o resumo redundante. Abrir a rota, restaurar escolhas ou mudar a fonte não solicita dispositivos nem inicia REC.

O botão principal acompanha a ação seguinte: **Ativar câmera**, **Compartilhar tela**, **Conectar meu iPhone** ou **Ativar microfone**, depois **Gravar**. A preparação e o REC usam a mesma captura. O projeto local só é criado após o primeiro take válido. A prévia permite conferir a entrada de câmera/microfone, níveis reais, qualidade, ajustes de imagem, roteiro e composição antes de gravar; a superfície de produção aparece ao iniciar REC. A preparação em andamento pode ser cancelada, descartando também streams ou frames que chegarem atrasados.

**Câmera e tela · Premium** tem um mini card próprio abaixo do seletor **Só câmera / Só tela**, com estado selecionado independente. **Câmera e tela** e **Meu iPhone · Premium** continuam combináveis. Só tela oculta a seleção de câmera; Podcast e Live ocultam vídeo. Os gates permanecem no workspace. Nas cenas remotas, conectar o iPhone ainda não libera REC: a ação principal pede compartilhar a tela primeiro. Live conserva `/studio/live`. O formato fica bloqueado ao reabrir projeto existente.

Na câmera/tela/cenas locais já prontas, alternar Aula/Short recompõe o frame 16:9/9:16 e preserva fontes autorizadas, áudio, ajustes e perfil de qualidade. O formato só é apresentado como confirmado após o novo frame estar disponível. O protocolo remoto mantém o formato do original no tipo da sessão: mudar Aula/Short encerra a sessão de prévia e exige uma nova ação de conexão, reutilizando o vínculo persistente do iPhone. Recuperar uma gravação de outro formato também reconfigura o próximo take.

As últimas escolhas ativadas são guardadas neste navegador por conta, sem IDs de dispositivos, credenciais ou mídia. Na restauração, plano e suporte são revalidados; a preferência nunca liga a câmera automaticamente. Armazenamento restrito não impede gravar. No celular, os segmentos ficam em linhas largas e a ação principal permanece no rodapé, com espaço para erros e safe-area; o painel de ajustes fica acima dos seletores. No desktop a partir de 1100 px, título, nome e escolhas formam uma coluna de configuração; prévia, entradas, ferramentas e ação ficam alinhados na coluna ao lado. A bancada começa perto do header e ocupa até 1400 px, com largura independente da altura da janela ou do formato. Os quatro formatos ficam em uma linha. Aula, Short, Podcast e Live compartilham a mesma área externa de prévia; o frame 9:16 fica centralizado dentro dela, preservando foco, guias, roteiro e proporção do original. No celular, a área comum é quadrada e mantém o frame correspondente centralizado; abaixo do breakpoint desktop, os blocos ficam em uma coluna. Premium usa somente a coroa vermelha nas superfícies neutras, com identificação acessível; no mini card rosa de Câmera e tela a coroa é branca para manter contraste, conforme a referência visual. Este refinamento alterou apenas o componente de apresentação e seu CSS; 83 regressões dos workspaces, TypeScript, lint e build passaram. Chrome confirmou o mini card, seleção com computador/iPhone e a geometria idêntica nos quatro formatos (964×542,25 px no desktop e 361×361 px no mobile), além de câmera/microfone ativos e ausência de overflow em 320, 393, 820 e 1440 px.

Validação anterior da preparação com captura real: **832 testes em 72 suítes**, TypeScript dedicado, lint do escopo sem erros e build passaram. Chrome com fontes sintéticas e captura/Worker/encoder/armazenamento reais confirmou prévia, trocas de formato, REC sem segunda abertura da fonte e takes 1080×1920 idênticos ao enquadramento apresentado. Layout conferido em desktop e mobile. Essa verificação não repete o teste físico do iPhone ou do seletor nativo de compartilhamento.

## Domínio e arquivos locais

`shared/studio` contém schema v2, tempo em 120000 ticks/s, validação, montagem, histórico e geometria extraídos do mobile. A origem e seus hashes constam no README do núcleo. O aplicativo nativo não foi alterado nem passou a importar essa extração nesta entrega.

A UI usa `editing` como montagem canônica; `takes` é derivado. O armazenamento `classfy-studio-web-v1` separa projetos e originais por conta/projeto/asset. A edição preserva originais imutáveis, e o salvamento exige a revisão anterior (CAS) para impedir sobrescrita silenciosa entre abas. Undo mantém os arquivos já importados.

Os projetos pertencem ao navegador e à origem (domínio) atuais. Limpar os dados do site pode apagá-los; uma URL de preview diferente tem outra biblioteca. Não há backup na conta nem sincronização com o celular nesta etapa. A biblioteca informa **Salvos neste navegador**. Não tratar a separação por owner no armazenamento local como uma fronteira de segurança contra código executado na mesma origem.

## Captura, composição e exportação

- No fluxo **Gravar**, permissões só são solicitadas após ação explícita. Cada take válido é salvo automaticamente no projeto local antes de liberar outra gravação ou **Ir para edição**. Miniaturas permitem revisar e excluir takes da montagem. Na captura básica, REC mantém apenas o botão de parar, tempo e monitor do microfone visíveis. A produção com cenas conserva também seus controles de direção.
- A produção usa um palco que ocupa a maior parte da janela, com controles na barra inferior e takes compactos. Antes de REC, os seletores de câmera e microfone mostram os dispositivos autorizados e a entrada efetivamente aberta. Câmeras externas e de continuidade aparecem quando disponibilizadas pelo sistema ao navegador; os nomes são os informados pelos dispositivos, sem categorias inferidas pela marca.
- A revisão dos takes usa controles próprios com a identidade dos players Classfy: play central, progresso, tempo, volume, velocidade e tela cheia do palco. O enquadramento de Aula e Short é preservado, e podcasts usam a mesma barra de áudio. Trocar take ou abrir outra gravação pausa a reprodução anterior; não há autoplay nem controles nativos na revisão. A duração original salva serve de fallback quando o navegador ainda não informa uma duração finita.
- A lista é atualizada quando os dispositivos mudam. A seleção usa o ID exato e fica bloqueada durante REC; silenciar o microfone preserva a escolha e o monitor indica o silêncio. Trocar o microfone na captura de tela preserva o compartilhamento ativo. As instruções de permissão pertencem ao app; a autorização continua sendo o diálogo nativo do navegador.
- **Configurações da gravação** abre um painel no palco, preservando a sessão e a câmera. Imagem reúne zoom, filtros Natural/Studio/Cinema, intensidade, exposição, contraste, saturação e temperatura; gravação reúne resolução/FPS confirmados, temporizador e guias; roteiro oferece teleprompter. Atalhos no palco tornam os controles visíveis antes de REC.
- Zoom de hardware depende das capacidades e de confirmação do dispositivo. Quando necessário, o recorte digital atua no stream gravado. Filtros passam pela composição WebGL; a prévia e o MediaRecorder usam o mesmo stream tratado. As opções indisponíveis ficam desabilitadas com motivo. Não há filtros aplicados apenas por CSS nem dupla aplicação na exportação.
- Resolução e FPS só mudam após a câmera confirmar o perfil. Uma tentativa incompatível conserva a configuração anterior; o estado efetivo é mostrado no painel. Grade e espelhamento de prévia são guias, não alteram o take. O temporizador de 3/10s não grava até concluir e cancela ao ocultar a aba. O teleprompter permite ensaio antes de REC e inicia a leitura junto com a gravação; fundo uniforme e altura conforme o texto, com pausa/retomada/reinício e palavras destacadas. Ele fica apenas na tela.
- O projeto é criado no primeiro take válido. Falha na leitura ou no salvamento preserva o candidato para tentar novamente; repetir o salvamento do mesmo take não acrescenta clips duplicados. Os takes duráveis continuam na biblioteca se o usuário sair antes da edição.
- Importação real de vídeo, imagem e áudio, com metadados e thumbnail; câmera, tela e narração são solicitadas por ação explícita.
- Captura mostra a entrada de áudio efetiva e dBFS. A prévia pronta sobrevive à troca de aba; ao voltar, a apresentação é retomada sem iniciar REC. Abertura inicial ainda pendente pode ser cancelada ao ocultar a aba e reaberta por ação do usuário. Na captura básica, desconexão real da entrada ou ocultação da aba durante REC encerra a captura; o trecho disponível deve ser conferido antes de usar. Falha ao salvar mantém a gravação para retry, sem inserir duplicatas.
- Prévia e arquivo final usam o mesmo kernel: cortes, velocidade, camadas, texto, legendas SRT, transformações, opacidade, tratamento tonal e mixagem/fades de áudio.
- Velocidade web usa varispeed: o tom do áudio também muda. O inspector informa esse comportamento. Exportação SDR; não há retouch facial, HDR, efeitos IA nem transcrição automática.
- Vídeo final MP4 H.264/AAC; podcast M4A. Perfis Original/HD/2K/4K e 24/30/60 FPS dependem da capacidade efetiva do encoder. Um perfil incompatível falha com causa explícita.
- Codificação WebCodecs/Mediabunny em blocos, sem reprodução em tempo real. A calibração AAC mede o atraso de encoder/decoder e aplica timestamps/edit list para manter o áudio alinhado.
- Quando disponível, OPFS recebe a exportação temporária por streaming e uma cópia durável privada em `classfy-studio-library-exports`. A revisão/locator é confirmada no IndexedDB somente após fechar a escrita. O arquivo temporário pode então ser removido com segurança.
- Sem OPFS, o fallback em memória é limitado a 100 MiB. Aulas longas precisam de armazenamento em disco e espaço livre no navegador. Arquivos preparados antigos são mantidos até excluir o projeto para preservar downloads/handoffs já abertos.

## Ciclo de vida

Cada workspace usa epoch/owner/projectId para invalidar callbacks atrasados. Exportação espera o autosave, bloqueia alterações e reutiliza apenas arquivo da revisão exata. Handoff valida novamente owner, tipo, revisão, existência e MIME; não usa links temporários persistidos.

A saída pelo botão do editor salva antes de navegar. Um dispatcher neutro é instalado antes do BrowserRouter e delega somente ao editor montado: listeners POP em `window` rodam no mesmo alvo em ordem de registro no Chrome. O guard restaura a entrada enquanto conclui a escrita; operação/gravação ativa pede confirmação. Cancelamento ou falha de gravação mantém o editor aberto. O risco de saída lê refs síncronas para cobrir blur seguido imediatamente de Back. Fechar/recarregar com trabalho pendente usa a proteção nativa `beforeunload`.

## Verificação reproduzível

```sh
npm ci
npm run typecheck:studio
npm run test:studio
npx vitest run src shared/studio --environment jsdom
npm run build
npm run dev -- --host 127.0.0.1 --port 8793
```

Fixtures exclusivamente de desenvolvimento, sem backend/autenticação artificial no App de produção:

- `/tests/browser/studio-engine.html`: fonte com vermelho/azul e tom de áudio; split/rate, imagem/texto sobrepostos; exporta, salva, libera temporário e reabre os bytes para comparar composição/áudio.
- `/tests/browser/studio-workspace.html`: biblioteca e UI reais com owner de QA isolado; importação, edição, reload, download e handoff local.
- `/tests/browser/studio-history.html`: BrowserRouter real para Back/Forward e cancelamento de saída durante captura. Entrar pelo HTML; usar a fixture anterior para testar reload.
- `/tests/browser/studio-recording.html`: gravação antes da edição com BrowserRouter e StrictMode, revisão/exclusão de takes, salvamento e saída. Owner local exclusivo de QA; `?resume=<projectId>` reabre a produção e `?editor=<projectId>` reabre a montagem da fixture.

As fixtures não são entradas do build Vite de produção. Não apagar toda a base IndexedDB durante QA: excluir somente os projetos dos owners de teste.

Validação anterior à produção com cenas: **468 testes em 66 suítes passaram**, incluindo 96 regressões compartilhadas, 40 de captura/processamento da câmera, 32 do workspace de gravação, 33 do teleprompter (alinhamento/serviço/UI), 7 do diálogo compartilhado, 16 do player de revisão, 20 do editor/recorder e 17 da biblioteca. Typecheck dedicado, lint do escopo (zero erros), diff-check e build passaram. Chrome desktop com StrictMode aprovou importação, split/rate/texto/camadas, download, persistência/reabertura, recuperação do arquivo para publicação e Back/Forward com draft/gravação. Câmera/microfone sintéticos para o ciclo de captura; encoder e demuxer reais, com inspeção adicional via FFmpeg/FFprobe.

O player de revisão passou em Chrome real com vídeo horizontal/vertical e podcast: play/pausa, seek, EOF sem replay automático, replay explícito, mute/volume, velocidade e fullscreen do palco. Trocar take pausa o elemento antigo e libera sua URL; gravar outro take interrompe o áudio da revisão. Diálogo de excluir continua centralizado dentro do fullscreen, com cancelamento e exclusão duráveis. Viewports 1440×900, 1280×540, 900×600 e 393×852 aprovaram os controles sem clipping, incluindo fonte vertical 360×640 real e frames estreitos de 211,5 e 236,25 px. Essa QA funcional é local, com câmera sintética/bytes reais; a publicação é conferida separadamente por assets e gates públicos.

O fluxo de produção foi validado no Chrome real: entrada pela biblioteca sem abrir o editor, dois takes com autosave, revisão/exclusão, avanço e reabertura no editor, exportação H.264/AAC em 1920×1080 e podcast AAC/M4A. Back durante REC cancela sem parar o trecho quando rejeitado e encerra/salva antes de sair quando confirmado. Short continua em 9:16 após remover o último take e exporta 1080×1920. Preparação em 1440×950 e 390×844 sem overflow horizontal; botão de avanço visível no palco desktop.

O palco imersivo foi validado em 1440×900, 2048×1141, 1280×720 e 393×852, com toolbar visível sem rolagem. Em 1440×900 a imagem 16:9 ocupa 1406×791, aproximadamente 86% da viewport. Chrome com dois dispositivos de vídeo e três de áudio sintéticos confirmou os IDs efetivos após cada troca, retenção da câmera ao trocar só o mic e `track.enabled` no mute. Permissão realmente negada mostrou instruções centrais e retry sem liberar REC. Dois takes chegaram ao editor, exportaram MP4 H.264/AAC e foram reabertos sem perda. Seleção pendente pode ser cancelada na saída sem aguardar a resolução da permissão; falha de troca mantém a entrada anterior e informa a causa. A troca do microfone mantendo a tela foi coberta pelo teste do controller, sem simular uma validação do seletor de tela do sistema.

MP4 de 1,5s em 1920×1080/30 FPS preservou cores, camadas e áudio; início do áudio da fixture coincide com a prévia. M4A de 3s e 180s e MP4 de 120s em 320×180/24 FPS foram exportados/reabertos com duração exata. O kernel limita os blocos PCM e descarta fontes antigas, mantendo recursos de draw/áudio em voo. Estas provas não certificam aulas de 20–60 minutos em HD/4K. Captura de tela via seletor do sistema, dispositivos físicos externos e Safari/Firefox continuam exigindo validação manual.

O typecheck global do app tem erros anteriores em módulos fora deste editor; o comando dedicado verifica o novo domínio/adaptadores/UI. O build de produção passa, com avisos de chunks já existentes no aplicativo.

A paridade de controles foi validada no Chrome com processamento WebGL e encoder reais. Zoom, filtros e ajustes mudaram pixels da prévia; a região estável do original H.264/AAC e do MP4 exportado coincidiu com o tratamento na prévia (diferença 0/255). Resolução 1280×720 foi confirmada pelo dispositivo e pelos bytes do original; a câmera sintética entregou 20 FPS, mostrado honestamente no painel. Troca de perfil não reabriu getUserMedia. Temporizador de 3s, cancelamento sem take, foco do roteiro entre amostras, rolagem real do teleprompter, manutenção de filtro/zoom no próximo take e reinício de zoom ao trocar a câmera passaram. Em headless, a visibilidade foi exercitada por evento controlado; uma troca física de aba/Continuity ainda requer validação no dispositivo.


## Teleprompter por voz

O modo **Acompanhar voz** é escolhido no painel Roteiro, junto ao controle para ativar o teleprompter. Só começa por Ensaiar leitura ou por REC. Acompanha palavras reconhecidas em pt-BR e mantém a posição nas pausas, com alinhamento local tolerante a acentos, resultados parciais e pequenas mudanças de leitura. Rolagem automática permanece como opção explícita, em palavras por minuto e com pausas de pontuação.

O reconhecimento recebe `getMicrophoneTrack()` da captura: a pista física selecionada, mesmo ao compartilhar tela com áudio. Nunca abre o microfone padrão com `start()` sem argumento, nem pede outra captura. O serviço é do navegador e pode processar áudio remotamente; isso aparece no painel antes da ativação. Transcrições não são armazenadas, exportadas nem enviadas ao backend Classfy.

`SpeechRecognition.start(audioTrack)` tem suporte limitado. O modo por voz é conservadoramente habilitado em Chromium desktop 135+ com API e contexto seguro; outros navegadores mostram a indisponibilidade e a opção automática. Não há probe que abra outro microfone. Fontes: [MDN start](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start) e [MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json).

Pausar a leitura, trocar a entrada, silenciar, ocultar a aba ou sair invalida callbacks e libera apenas o reconhecimento. A leitura requer retomada explícita após interrupção; isso não para a pista da gravação. A captura básica preserva o take ao ocultar REC; a produção com cenas mantém o Worker de composição ativo durante a apresentação. Falhas de rede/permissão e limite de reconexões ficam visíveis; nenhuma troca silenciosa para rolagem por tempo é feita.

A leitura foi validada no Chrome 154 com StrictMode: ensaio, pausa/retomada/reinício, início junto com REC, rolagem de roteiro longo e atalhos circulares em desktop/mobile. Resultados de voz controlados cobrem silêncio, erro de rede, mute, mudança de entrada e aba sem interferir no take. Uma jornada separada usou o `SpeechRecognition` nativo, sem substituir seu construtor/eventos, com fala sintética pt-BR: a pista selecionada foi confirmada e o roteiro avançou de 0 para 3/29 palavras. O take original e a exportação mantiveram vídeo e áudio sem o roteiro. Isso comprova integração real do serviço, não qualidade com voz humana ou aulas longas.

## Confirmações visuais do Studio

Excluir take, descartar um trecho e decidir saída com gravação/operação pendente usam o diálogo próprio centralizado, com identidade visual do Studio. A biblioteca reutiliza o mesmo diálogo ao excluir projetos. Cancelar recebe o foco inicial; Escape cancela, Tab mantém o foco na decisão e o botão de origem recupera foco quando ainda existe. O portal acompanha o elemento fullscreen, sem sair da tela cheia para perguntar.

A decisão é assíncrona: o navegador continua capturando/processando enquanto a pergunta aparece. Cada operação reserva a decisão e revalida owner, epoch, projeto/take e controller após a resposta. Mudança de sessão ou desmontagem resolve como cancelamento; cliques repetidos não autorizam duas ações. Na tela de gravação, Cancelar saída preserva REC e Confirmar encerra/salva antes de navegar. A contagem regressiva espera durante a pergunta e retoma se cancelada.

Chrome com BrowserRouter/StrictMode validou cancelamento por botão e Escape, foco/Tab, exclusão durável uma vez, retorno à biblioteca, saída durante REC preservando a mesma pista ao cancelar e salvando um take ao confirmar. O diálogo ficou centralizado em 1440×900 e 393×852; fullscreen real manteve o portal dentro do elemento ativo. Vinte aberturas seguidas com Escape imediato passaram. O recorder do editor preservou o arquivo ao cancelar, reiniciou após confirmação e liberou as pistas ao descartar. Nenhum `confirm`, `alert` ou `prompt` nativo foi acionado nessas jornadas.

Os erros e feedback já pertencem à interface e mantêm suas opções de recuperação. Permissões de dispositivo e proteção nativa de fechar/recarregar (`beforeunload`) seguem sob controle do navegador; a migração não altera essas fronteiras nem o dashboard/Live/uploads existentes.


## Produção com cenas Premium

A opção **Gravação com cenas · Premium**, em `/studio/record`, oferece três cenas no mesmo take: **Câmera**, **Tela** e **Tela + você**. Preparar câmera/microfone e compartilhar tela exigem ações explícitas; a seleção de tela continua sendo do sistema. Só as cenas com fontes confirmadas ficam disponíveis. Câmera e tela simples continuam disponíveis nos planos anteriores; Podcast e Live mantêm os fluxos existentes.

O acesso usa o perfil remoto da conta verificada: plano, origem do entitlement, validade, estado da assinatura e período de tolerância. Cargo admin não concede Premium. Falha, plano desconhecido ou vencido bloqueia novas sessões de cenas. Revalidação no foco não interrompe um take em curso; o usuário pode terminá-lo. A oferta centralizada demonstra as três cenas e usa o checkout/portal existentes; a verificação de assinatura ocorre só por ação explícita. Nenhuma regra econômica, schema ou serviço de billing novo foi criado.

Durante REC, botões e atalhos **1/2/3** alternam cenas sem substituir as pistas de saída. Composição permite quatro cantos, tamanho da bolha e corte/fade. O microfone selecionado permanece no mix; áudio de tela autorizado entra somente nas cenas de tela. Os filtros/zoom atuam na câmera, preservando a legibilidade da tela. Espelhamento da prévia inteira fica indisponível nessa composição.

A saída composta tem dimensões fixas **1920×1080** (Aula) ou **1080×1920** (Short), com alvo de **30 FPS SDR**; a cadência efetiva depende do navegador e da carga. O painel informa essa saída, sem oferecer 4K fictício. MediaStreamTrackProcessor/Generator transferem fontes para um Worker com OffscreenCanvas: não há relógio de composição dependente de requestAnimationFrame da aba. Um frame por fonte e uma escrita de saída em voo limitam a fila. O suporte exige APIs reais, transferência de streams e inicialização do Worker; uma falha técnica anterior às entradas físicas não solicita permissões de câmera.

**Controle flutuante** usa Document Picture-in-Picture quando disponível. A janela mostra cenas, tempo, entrada/nível de microfone, mute e Parar e salvar. Fechá-la mantém REC; sair da sessão fecha somente a janela pertencente àquela sessão. Compartilhar uma janela/aba evita incluir esse controle no vídeo. Na ausência de PiP, os controles do Studio permanecem acessíveis. A janela requer gesto explícito.

Desconexão de tela volta à câmera disponível; perda da câmera permite continuar com tela. Sem fonte de vídeo ou com perda do mic, o take disponível é finalizado. O Worker detecta interrupções da fonte e da saída para evitar uma gravação silenciosamente congelada. Não se solicita nova entrada no meio de REC.

Os chunks do MediaRecorder são persistidos em IndexedDB durante REC, isolados por UUID, com fila pendente limitada. STOP/erro do encoder compartilham o mesmo finalizador e incluem o último chunk. A biblioteca recebe o File antes da limpeza do diário temporário. Se a formação/leitura do File falhar, `pendingRecovery` bloqueia nova captura, permite repetir a finalização e protege saída/descarte; se a gravação da biblioteca falhar, o File continua disponível para salvar novamente ou baixar. Cancelamento explícito descarta só o diário daquela gravação. Esta etapa não oferece restauração automática após fechar/recarregar o navegador, backup na conta ou garantia de recuperação de disco corrompido.

A fixture local `studio-recording.html?kind=aula&premium=1` libera somente a UI de QA; o App de produção não inclui essa entrada nem bypass de plano. Testes cobrem entitlement/sessão, oferta/checkout, fonte atrasada, encoder já inativo, dados finais, backpressure, isolamento do buffer e autosave/recuperação/saída. QA no Chrome usa fontes de vídeo/áudio sintéticas com Worker/encoder/demuxer/IndexedDB/PiP reais: três cenas nos bytes gravados, voz contínua, áudio da apresentação, persistência depois da limpeza, saída vertical, REC pela tela e pela janela flutuante, confirmação visual e avanço ao editor. A preparação/layout passou em Aula/Short desktop e mobile. Dispositivos físicos, seletor nativo de compartilhamento e aulas longas continuam exigindo validação no uso real.

Validação da entrega de cenas: **560 testes em 74 suítes passaram**, TypeScript dedicado e build de produção limpos. Chrome 154 sem emulação de foco comprovou `document.visibilityState=hidden` real por 6,07s: 147 frames adicionais, movimento da fonte preservado e MP4 com vídeo/voz/áudio da apresentação antes, durante e depois. A captura permaneceu VFR: FFprobe contou 241 frames em 9,9521s (média de 24,23 FPS sob essa carga de QA), enquanto o estimador do demuxer indicou 28,626; não há promessa de 30 FPS constantes. Os scripts e relatórios completos estão nos artefatos operacionais da sessão, fora do bundle de produção.
