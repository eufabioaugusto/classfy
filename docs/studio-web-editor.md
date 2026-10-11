# Studio web desktop

## Rotas e publicação

- `/studio` continua sendo o dashboard. **Gravar** abre a produção; **Novo projeto** abre a biblioteca.
- `/studio/record` começa com formato e entrada (câmera, tela ou microfone para podcast). A opção **Live** encaminha à preparação já existente em `/studio/live`, sem criar transmissão ou projeto local no clique. O fluxo local abre a captura e só depois leva ao editor. O acesso é direto pelo dashboard ou pela biblioteca, sem precisar criar uma montagem vazia.
- `/studio/projects` contém as montagens editáveis deste navegador: criar, buscar, renomear, duplicar e excluir.
- `/studio/projects/:projectId` abre o editor, exclusivo para contas creator/admin.
- **Preparar publicação** renderiza a montagem e abre `/studio/upload?type=...&studioProject=...&studioRevision=...`. O usuário escolhe **Usar arquivo do editor**; os passos existentes continuam responsáveis por enviar a mídia e concluir a publicação.
- Os uploads existentes e `/studio/contents` mantêm suas responsabilidades. Preparar um arquivo não o publica automaticamente.

## Domínio e arquivos locais

`shared/studio` contém schema v2, tempo em 120000 ticks/s, validação, montagem, histórico e geometria extraídos do mobile. A origem e seus hashes constam no README do núcleo. O aplicativo nativo não foi alterado nem passou a importar essa extração nesta entrega.

A UI usa `editing` como montagem canônica; `takes` é derivado. O armazenamento `classfy-studio-web-v1` separa projetos e originais por conta/projeto/asset. A edição preserva originais imutáveis, e o salvamento exige a revisão anterior (CAS) para impedir sobrescrita silenciosa entre abas. Undo mantém os arquivos já importados.

Os projetos pertencem ao navegador e à origem (domínio) atuais. Limpar os dados do site pode apagá-los; uma URL de preview diferente tem outra biblioteca. Não há backup na conta nem sincronização com o celular nesta etapa. A biblioteca informa **Salvos neste navegador**. Não tratar a separação por owner no armazenamento local como uma fronteira de segurança contra código executado na mesma origem.

## Captura, composição e exportação

- No fluxo **Gravar**, permissões só são solicitadas após ação explícita. Cada take válido é salvo automaticamente no projeto local antes de liberar outra gravação ou **Ir para edição**. Miniaturas permitem revisar e excluir takes da montagem. REC mantém apenas o botão de parar, tempo e monitor do microfone visíveis.
- A produção usa um palco que ocupa a maior parte da janela, com controles na barra inferior e takes compactos. Antes de REC, os seletores de câmera e microfone mostram os dispositivos autorizados e a entrada efetivamente aberta. Câmeras externas e de continuidade aparecem quando disponibilizadas pelo sistema ao navegador; os nomes são os informados pelos dispositivos, sem categorias inferidas pela marca.
- A lista é atualizada quando os dispositivos mudam. A seleção usa o ID exato e fica bloqueada durante REC; silenciar o microfone preserva a escolha e o monitor indica o silêncio. Trocar o microfone na captura de tela preserva o compartilhamento ativo. As instruções de permissão pertencem ao app; a autorização continua sendo o diálogo nativo do navegador.
- **Configurações da gravação** abre um painel no palco, preservando a sessão e a câmera. Imagem reúne zoom, filtros Natural/Studio/Cinema, intensidade, exposição, contraste, saturação e temperatura; gravação reúne resolução/FPS confirmados, temporizador e guias; roteiro oferece teleprompter. Atalhos no palco tornam os controles visíveis antes de REC.
- Zoom de hardware depende das capacidades e de confirmação do dispositivo. Quando necessário, o recorte digital atua no stream gravado. Filtros passam pela composição WebGL; a prévia e o MediaRecorder usam o mesmo stream tratado. As opções indisponíveis ficam desabilitadas com motivo. Não há filtros aplicados apenas por CSS nem dupla aplicação na exportação.
- Resolução e FPS só mudam após a câmera confirmar o perfil. Uma tentativa incompatível conserva a configuração anterior; o estado efetivo é mostrado no painel. Grade e espelhamento de prévia são guias, não alteram o take. O temporizador de 3/10s não grava até concluir e cancela ao ocultar a aba. O teleprompter permite ensaio antes de REC e inicia a leitura junto com a gravação; fundo uniforme e altura conforme o texto, com pausa/retomada/reinício e palavras destacadas. Ele fica apenas na tela.
- O projeto é criado no primeiro take válido. Falha na leitura ou no salvamento preserva o candidato para tentar novamente; repetir o salvamento do mesmo take não acrescenta clips duplicados. Os takes duráveis continuam na biblioteca se o usuário sair antes da edição.
- Importação real de vídeo, imagem e áudio, com metadados e thumbnail; câmera, tela e narração são solicitadas por ação explícita.
- Captura mostra a entrada de áudio efetiva e dBFS. A prévia pronta sobrevive à troca de aba; ao voltar, a apresentação é retomada sem iniciar REC. Abertura inicial ainda pendente pode ser cancelada ao ocultar a aba e reaberta por ação do usuário. Desconexão real da entrada ou ocultação da aba durante REC encerra a captura; o trecho disponível deve ser conferido antes de usar. Falha ao salvar mantém a gravação para retry, sem inserir duplicatas.
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

Validação final: **452 testes em 65 suítes passaram**, incluindo 96 regressões compartilhadas, 40 de captura/processamento da câmera, 32 do workspace de gravação, 33 do teleprompter (alinhamento/serviço/UI), 7 do diálogo compartilhado, 20 do editor/recorder e 17 da biblioteca. Typecheck dedicado, lint do escopo (zero erros), diff-check e build passaram. Chrome desktop com StrictMode aprovou importação, split/rate/texto/camadas, download, persistência/reabertura, recuperação do arquivo para publicação e Back/Forward com draft/gravação. Câmera/microfone sintéticos para o ciclo de captura; encoder e demuxer reais, com inspeção adicional via FFmpeg/FFprobe.

O fluxo de produção foi validado no Chrome real: entrada pela biblioteca sem abrir o editor, dois takes com autosave, revisão/exclusão, avanço e reabertura no editor, exportação H.264/AAC em 1920×1080 e podcast AAC/M4A. Back durante REC cancela sem parar o trecho quando rejeitado e encerra/salva antes de sair quando confirmado. Short continua em 9:16 após remover o último take e exporta 1080×1920. Preparação em 1440×950 e 390×844 sem overflow horizontal; botão de avanço visível no palco desktop.

O palco imersivo foi validado em 1440×900, 2048×1141, 1280×720 e 393×852, com toolbar visível sem rolagem. Em 1440×900 a imagem 16:9 ocupa 1406×791, aproximadamente 86% da viewport. Chrome com dois dispositivos de vídeo e três de áudio sintéticos confirmou os IDs efetivos após cada troca, retenção da câmera ao trocar só o mic e `track.enabled` no mute. Permissão realmente negada mostrou instruções centrais e retry sem liberar REC. Dois takes chegaram ao editor, exportaram MP4 H.264/AAC e foram reabertos sem perda. Seleção pendente pode ser cancelada na saída sem aguardar a resolução da permissão; falha de troca mantém a entrada anterior e informa a causa. A troca do microfone mantendo a tela foi coberta pelo teste do controller, sem simular uma validação do seletor de tela do sistema.

MP4 de 1,5s em 1920×1080/30 FPS preservou cores, camadas e áudio; início do áudio da fixture coincide com a prévia. M4A de 3s e 180s e MP4 de 120s em 320×180/24 FPS foram exportados/reabertos com duração exata. O kernel limita os blocos PCM e descarta fontes antigas, mantendo recursos de draw/áudio em voo. Estas provas não certificam aulas de 20–60 minutos em HD/4K. Captura de tela via seletor do sistema, dispositivos físicos externos e Safari/Firefox continuam exigindo validação manual.

O typecheck global do app tem erros anteriores em módulos fora deste editor; o comando dedicado verifica o novo domínio/adaptadores/UI. O build de produção passa, com avisos de chunks já existentes no aplicativo.

A paridade de controles foi validada no Chrome com processamento WebGL e encoder reais. Zoom, filtros e ajustes mudaram pixels da prévia; a região estável do original H.264/AAC e do MP4 exportado coincidiu com o tratamento na prévia (diferença 0/255). Resolução 1280×720 foi confirmada pelo dispositivo e pelos bytes do original; a câmera sintética entregou 20 FPS, mostrado honestamente no painel. Troca de perfil não reabriu getUserMedia. Temporizador de 3s, cancelamento sem take, foco do roteiro entre amostras, rolagem real do teleprompter, manutenção de filtro/zoom no próximo take e reinício de zoom ao trocar a câmera passaram. Em headless, a visibilidade foi exercitada por evento controlado; uma troca física de aba/Continuity ainda requer validação no dispositivo.


## Teleprompter por voz

O modo **Acompanhar voz** é escolhido no painel Roteiro, junto ao controle para ativar o teleprompter. Só começa por Ensaiar leitura ou por REC. Acompanha palavras reconhecidas em pt-BR e mantém a posição nas pausas, com alinhamento local tolerante a acentos, resultados parciais e pequenas mudanças de leitura. Rolagem automática permanece como opção explícita, em palavras por minuto e com pausas de pontuação.

O reconhecimento recebe `getMicrophoneTrack()` da captura: a pista física selecionada, mesmo ao compartilhar tela com áudio. Nunca abre o microfone padrão com `start()` sem argumento, nem pede outra captura. O serviço é do navegador e pode processar áudio remotamente; isso aparece no painel antes da ativação. Transcrições não são armazenadas, exportadas nem enviadas ao backend Classfy.

`SpeechRecognition.start(audioTrack)` tem suporte limitado. O modo por voz é conservadoramente habilitado em Chromium desktop 135+ com API e contexto seguro; outros navegadores mostram a indisponibilidade e a opção automática. Não há probe que abra outro microfone. Fontes: [MDN start](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start) e [MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json).

Pausar a leitura, trocar a entrada, silenciar, ocultar a aba ou sair invalida callbacks e libera apenas o reconhecimento. A leitura requer retomada explícita após interrupção; isso não para a pista da gravação. A política de preservar o take ao ocultar REC continua na captura. Falhas de rede/permissão e limite de reconexões ficam visíveis; nenhuma troca silenciosa para rolagem por tempo é feita.

A leitura foi validada no Chrome 154 com StrictMode: ensaio, pausa/retomada/reinício, início junto com REC, rolagem de roteiro longo e atalhos circulares em desktop/mobile. Resultados de voz controlados cobrem silêncio, erro de rede, mute, mudança de entrada e aba sem interferir no take. Uma jornada separada usou o `SpeechRecognition` nativo, sem substituir seu construtor/eventos, com fala sintética pt-BR: a pista selecionada foi confirmada e o roteiro avançou de 0 para 3/29 palavras. O take original e a exportação mantiveram vídeo e áudio sem o roteiro. Isso comprova integração real do serviço, não qualidade com voz humana ou aulas longas.

## Confirmações visuais do Studio

Excluir take, descartar um trecho e decidir saída com gravação/operação pendente usam o diálogo próprio centralizado, com identidade visual do Studio. A biblioteca reutiliza o mesmo diálogo ao excluir projetos. Cancelar recebe o foco inicial; Escape cancela, Tab mantém o foco na decisão e o botão de origem recupera foco quando ainda existe. O portal acompanha o elemento fullscreen, sem sair da tela cheia para perguntar.

A decisão é assíncrona: o navegador continua capturando/processando enquanto a pergunta aparece. Cada operação reserva a decisão e revalida owner, epoch, projeto/take e controller após a resposta. Mudança de sessão ou desmontagem resolve como cancelamento; cliques repetidos não autorizam duas ações. Na tela de gravação, Cancelar saída preserva REC e Confirmar encerra/salva antes de navegar. A contagem regressiva espera durante a pergunta e retoma se cancelada.

Chrome com BrowserRouter/StrictMode validou cancelamento por botão e Escape, foco/Tab, exclusão durável uma vez, retorno à biblioteca, saída durante REC preservando a mesma pista ao cancelar e salvando um take ao confirmar. O diálogo ficou centralizado em 1440×900 e 393×852; fullscreen real manteve o portal dentro do elemento ativo. Vinte aberturas seguidas com Escape imediato passaram. O recorder do editor preservou o arquivo ao cancelar, reiniciou após confirmação e liberou as pistas ao descartar. Nenhum `confirm`, `alert` ou `prompt` nativo foi acionado nessas jornadas.

Os erros e feedback já pertencem à interface e mantêm suas opções de recuperação. Permissões de dispositivo e proteção nativa de fechar/recarregar (`beforeunload`) seguem sob controle do navegador; a migração não altera essas fronteiras nem o dashboard/Live/uploads existentes.
