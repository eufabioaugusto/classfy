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
| Watch e miniplayer | Cards não antecipam checkout; reconstruir sessão única, controles, gestos, fullscreen e continuidade |
| Resolução de mídia | Portar contrato autorizado do web (`usePlaybackSource`), cobrindo providers e formatos vigentes |
| Progresso e recompensas | Comparar RPCs atuais do web; separar playhead e tempo qualificado; testar idempotência e contas diferentes |
| Classy e estudo | Reorganizar chat, estudos recentes e ferramentas em módulos menores; conferir contratos das funções atuais |
| Shorts, podcasts e lives | Revisar experiência e suporte por formato; não considerar aprovados só por existir rota |
| Mensagens e notificações | Conferir sincronização, retorno de push e estados de leitura; Expo Push preservado |
| Compra/plano e distribuição | Validar conclusão/retorno e definir fluxo de cada plataforma antes de publicação |
| Studio e administração | Mapear necessidade de experiência mobile própria; páginas web não são automaticamente convertidas |

## Validação

- `npm run typecheck`
- `npm run check:dependencies`
- `npm run test:catalog` (Node 22.18+ / 24; regras de normalização e feed)
- Exportação iOS e inspeção nativa no simulador, além do iPhone para usos reais.

A primeira rodada verificou catálogo público, filtros, busca com recuperação de
falha, retorno de busca/login e área Você. Contas autenticadas, pagamentos,
reprodução contínua, recompensa e Android precisam de QA próprio. Exportação de
JavaScript não substitui uma build instalada nem valida esses fluxos.

Desenvolvimento local em branch isolada. Nenhum push, deploy ou publicação nas
lojas faz parte dessa primeira entrega.
