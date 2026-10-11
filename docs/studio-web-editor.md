# Studio web desktop

## Rotas e publicação

- `/studio` continua sendo o dashboard. **Gravar** abre a produção; **Novo projeto** abre a biblioteca.
- `/studio/record` começa com formato e entrada (câmera, tela ou microfone para podcast), abre a gravação e só depois leva ao editor. O acesso é direto pelo dashboard ou pela biblioteca, sem precisar criar uma montagem vazia.
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
- O projeto é criado no primeiro take válido. Falha na leitura ou no salvamento preserva o candidato para tentar novamente; repetir o salvamento do mesmo take não acrescenta clips duplicados. Os takes duráveis continuam na biblioteca se o usuário sair antes da edição.
- Importação real de vídeo, imagem e áudio, com metadados e thumbnail; câmera, tela e narração são solicitadas por ação explícita.
- Captura mostra a entrada de áudio efetiva e dBFS. Interrupção/ocultação da aba encerra a captura; o trecho disponível deve ser conferido antes de usar. Falha ao salvar mantém a gravação para retry, sem inserir duplicatas.
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

Validação final: **361 testes em 61 suítes passaram**, incluindo 96 regressões compartilhadas, 19 de captura e 17 do workspace de gravação. Typecheck dedicado, lint do escopo (zero erros), diff-check e build passaram. Chrome desktop com StrictMode aprovou importação, split/rate/texto/camadas, download, persistência/reabertura, recuperação do arquivo para publicação e Back/Forward com draft/gravação. Câmera/microfone sintéticos para o ciclo de captura; encoder e demuxer reais, com inspeção adicional via FFmpeg/FFprobe.

O fluxo de produção foi validado no Chrome real: entrada pela biblioteca sem abrir o editor, dois takes com autosave, revisão/exclusão, avanço e reabertura no editor, exportação H.264/AAC em 1920×1080 e podcast AAC/M4A. Back durante REC cancela sem parar o trecho quando rejeitado e encerra/salva antes de sair quando confirmado. Short continua em 9:16 após remover o último take e exporta 1080×1920. Preparação em 1440×950 e 390×844 sem overflow horizontal; botão de avanço visível no palco desktop.

O palco imersivo foi validado em 1440×900, 2048×1141, 1280×720 e 393×852, com toolbar visível sem rolagem. Em 1440×900 a imagem 16:9 ocupa 1406×791, aproximadamente 86% da viewport. Chrome com dois dispositivos de vídeo e três de áudio sintéticos confirmou os IDs efetivos após cada troca, retenção da câmera ao trocar só o mic e `track.enabled` no mute. Permissão realmente negada mostrou instruções centrais e retry sem liberar REC. Dois takes chegaram ao editor, exportaram MP4 H.264/AAC e foram reabertos sem perda. Seleção pendente pode ser cancelada na saída sem aguardar a resolução da permissão; falha de troca mantém a entrada anterior e informa a causa. A troca do microfone mantendo a tela foi coberta pelo teste do controller, sem simular uma validação do seletor de tela do sistema.

MP4 de 1,5s em 1920×1080/30 FPS preservou cores, camadas e áudio; início do áudio da fixture coincide com a prévia. M4A de 3s e 180s e MP4 de 120s em 320×180/24 FPS foram exportados/reabertos com duração exata. O kernel limita os blocos PCM e descarta fontes antigas, mantendo recursos de draw/áudio em voo. Estas provas não certificam aulas de 20–60 minutos em HD/4K. Captura de tela via seletor do sistema, dispositivos físicos externos e Safari/Firefox continuam exigindo validação manual.

O typecheck global do app tem erros anteriores em módulos fora deste editor; o comando dedicado verifica o novo domínio/adaptadores/UI. O build de produção passa, com avisos de chunks já existentes no aplicativo.
