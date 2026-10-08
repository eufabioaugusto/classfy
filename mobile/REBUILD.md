# Reconstrução da experiência mobile

Direção autorizada em 08/10/2026: aproveitar Expo/React Native e o backend da
Classfy, atualizar os contratos do web e reconstruir a experiência para celular.
YouTube serve de referência para navegação, continuidade e ergonomia. Estudo,
Classy e conquistas continuam sendo parte da identidade Classfy.

## O que significa mais inteligente

- Usar interesses reais para ordenar a descoberta, sem inventar recomendações.
- Retomar conteúdos e estudos existentes, preservando contexto ao navegar.
- Resolver acesso e compra com o estado real da conta.
- Apresentar ferramentas de estudo no contexto do conteúdo.
- Tratar carregamento e falhas com recuperação, sem substituir dados por mocks.

## Primeira entrega local

Início com catálogo real e cartões virtualizados individualmente; filtros;
atualização ao puxar; busca dedicada; navegação inferior fixa; área Você com
biblioteca/conta; abertura guiada pela sessão, sem espera decorativa.

O catálogo de visitantes usa `get_public_home_catalog`, como o web, e não expõe
fontes de playback. Conteúdos e cursos autenticados são carregados separadamente:
falha em um preserva o outro. Cards passam a decisão de acesso para Watch;
visitantes entram pelo login, com destino de conteúdo preservado.

Creators continuam acessíveis por uma faixa compacta depois do catálogo. O
painel anterior de perfil/progresso foi preservado em `/profile-progress`.
Mensagens mantêm contador de não lidas. Continue de onde parou recarrega ao
retornar à tela e limpa dados na troca de usuário.

## Mapa de atualização

| Área | Situação e próximo trabalho |
| --- | --- |
| Catálogo, Home e busca de conteúdo | Primeira versão implementada; falta paginação do servidor e busca avançada de creators |
| Navegação e Você | Primeira versão implementada; biblioteca e configurações ainda usam fluxos anteriores |
| Autenticação | Entrada/retorno revisados; validar login completo, troca de conta, Google, onboarding e recuperação |
| Watch e miniplayer | Sessão única com expo-video, miniplayer com pausa/fechar/retorno, posição/velocidade preservadas e fullscreen centralizado; QA nativo com vídeo HLS público |
| Resolução de mídia | `video-playback` resolve media_asset_id após acesso autorizado, incluindo aulas de curso; validar fontes reais autenticadas e renovação de links expirados |
| Progresso e recompensas | Contratos `record_content_progress_v2` / `record_course_lesson_progress_v1` do web; retomada separada de tempo observado, feedback por recibos do servidor e reversão econômica; QA econômico com contas reais pendente |
| Classy e estudo | Removida persistência duplicada de chat; contexto de aula/curso e transcrição pendente alinhados; quiz usa plano real. Redesign completo do chat e modos/referências da barra global seguem para próxima rodada |
| Shorts, podcasts e lives | Revisar experiência e suporte por formato; não considerar aprovados só por existir rota |
| Mensagens e notificações | Conferir sincronização, retorno de push e estados de leitura; Expo Push preservado |
| Compra/plano e distribuição | Validar conclusão/retorno e definir fluxo de cada plataforma antes de publicação |
| Studio e administração | Mapear necessidade de experiência mobile própria; páginas web não são automaticamente convertidas |

## Validação

- `npm run typecheck`
- `npm run check:dependencies`
- `npm run test:catalog` (Node 22.18+ / 24; regras de normalização e feed)
- `npm run test:playback` (retomada, seeks, pausa/background, velocidade e IDs de sessão)
- `npm run test:rewards` (recibos antes da montagem, deduplicação, conta e expiração)
- Exportação iOS e inspeção nativa no simulador, além do iPhone para usos reais.

A primeira rodada verificou catálogo público, filtros, busca com recuperação de
falha, retorno de busca/login e área Você. Contas autenticadas, pagamentos,
recompensas com contas reais e Android precisam de QA próprio. A segunda rodada verificou
reprodução HLS, minimizar/expandir, pausa preservada, avanço de posição e fullscreen
com faixas simétricas; a saída do app pausou a sessão. Builds iOS para simulador e
iPhone foram compiladas e instaladas. O teste de reprodução não escreveu progresso
ou Points. O fluxo autenticado de compra, cursos, Classy e economia continua pendente.
A entrega local está pronta para a primeira revisão visual do Fabio. Doze testes
automatizados passaram (4 catálogo, 5 playback, 3 recibos). Exportação de
JavaScript não substitui uma build instalada nem valida esses fluxos.

Desenvolvimento local em branch isolada. Nenhum push, deploy ou publicação nas
lojas faz parte dessa primeira entrega.

## Contratos e limites da bateria de player

- A regra de negócio continua no mesmo backend do web. O mobile não escreve
  diretamente conclusão de curso nem progresso econômico.
- O provider permanece montado ao navegar e mantém uma única VideoView por
  apresentação. Aulas preservam lessonId e studyId ao expandir.
- `RewardFeedback` usa IDs de reward_events para deduplicar recibos locais e
  realtime; preserva recibos de login recebidos antes da montagem; reconcilia o ledger no retorno e a cada 30s enquanto o app está ativo.
  A migration existente inclui a publicação; a aplicação dela em produção e a
  entrega entre contas ainda precisam de verificação com sessão autenticada.
- A sessão tenta checkpoints novamente enquanto ativa; não há fila offline
  durável. Encerrar o processo sem conectividade pode perder o último trecho.
- `/dev/player` existe somente como tela utilizável em __DEV__, com stream público
  de teste da Mux e tracking desativado. Builds de distribuição redirecionam para Home.
- Expo Push normal foi preservado; a exceção da equipe Apple pessoal continua
  limitada ao Classfy Dev local.

Referências técnicas: [Expo Video SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/video/)
e [streams públicos de teste da Mux](https://test-streams.mux.dev/).
