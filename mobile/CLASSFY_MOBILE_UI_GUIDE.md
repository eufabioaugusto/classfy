# Classfy Mobile UI Guide

## Origem visual

O mobile deve derivar da linguagem atual da Classfy web, nao de componentes copiados.

Sinais extraidos da web:

- base cinematica escura: preto puro, superficies em cinza muito escuro e bordas discretas;
- acento principal vermelho Classfy, usado com parcimonia para estado ativo, destaque e conversao;
- badges por plano/status: free verde, pro roxo, premium dourado, hot laranja;
- cards de conteudo com thumbnail dominante, `16:9`, cantos de aproximadamente `12px`, overlay escuro e metadados compactos;
- feed de exploracao inspirado em consumo de video: seco, denso, escaneavel;
- acoes horizontais em chips/botoes arredondados no Watch;
- bottom navigation fixa, translucida, com blur/borda superior discreta;
- tipografia de sistema, forte, com hierarquia clara e pouco texto institucional.

## Direcao de produto

A Classfy mobile e um app premium de consumo de video, estudo e recompensa. A experiencia deve parecer mais proxima de YouTube/Netflix/MasterClass do que de dashboard SaaS.

O usuario deve abrir o app e ver conteudo imediatamente. A Home nao deve vender a Classfy com um hero grande; ela deve mostrar feed, categorias e formatos.

## Home

- Usar header compacto: marca, saudacao/contexto curto e icones de busca/notificacao.
- Evitar hero institucional grande.
- Primeira dobra deve conter chips horizontais e conteudo em destaque/feed.
- Feed vertical com cards `16:9`, titulo forte, creator, views, duracao e badge de acesso.
- Shorts devem aparecer em rail horizontal com cards `9:16`.
- Secoes devem ser simples: titulo, opcional acao curta, lista.
- Nao usar cards dentro de cards.

## Watch

- Player e conteudo sao prioridade.
- Controles e acoes devem ser compactos e horizontais.
- Notas, comentarios, Classy e recompensas entram como camadas acessorias, nao como blocos explicativos grandes.
- Sempre preservar sensacao de consumo continuo.

## Navegacao

- Bottom tabs fixa.
- Fundo escuro/translucido, borda superior sutil.
- Icones claros, texto pequeno, estado ativo com acento.
- Evitar esconder navegacao na Home, Explore, Rewards e Profile.

## Tokens

- Fundo principal: preto cinematico.
- Superficies: cinzas entre preto e grafite.
- Bordas: baixa opacidade, quase invisiveis.
- Acento: vermelho Classfy, nunca usado como fundo dominante da tela.
- Raios: `8px`, `12px`, `16px`; cards de video usam `12px`.
- Espacamento mobile: base 4, com passos de 8, 12, 16, 20, 24, 32.
- Tipografia: sistema nativa, pesos fortes, tamanhos controlados.

## Regras praticas

- Nao copiar shadcn/Radix/web components para React Native.
- Nao criar landing page dentro do app.
- Nao usar hero institucional grande na Home.
- Nao usar gradientes genericos como identidade principal.
- Nao dominar a UI com uma unica cor alem do preto/cinza base.
- Nao usar textos longos para explicar features em tela principal.
- Priorizar conteudo real ou mockado como conteudo real.
- Se faltar dado, usar placeholder de conteudo, nao bloco explicativo.

## Regras de Gesto e Layout em Modais / Bottom Sheets

- Ao implementar modais deslizáveis contendo ScrollView ou FlatList internos no React Native:
  1. Defina `onStartShouldSetPanResponder: () => false` e `onStartShouldSetPanResponderCapture: () => false` no PanResponder do container pai para permitir a rolagem livre.
  2. Adicione `onStartShouldSetResponder={() => true}` na View que envolve o cabeçalho/alça (header/handle) do modal, garantindo que o início do toque em áreas estáticas crie uma sessão de gestos capturada pelo PanResponder para o swipe-down de fechar.
  3. No modo horizontal (landscape), certifique-se de que a altura máxima (`maxSheetHeight`) calculada permaneça sempre positiva.
  4. No modo horizontal, limite a largura interna do conteúdo ao tamanho proporcional do player (aspectRatio `16:9`) centralizando-o com `alignSelf: 'center'` para evitar que o conteúdo fique atrás da câmera notch lateral, mantendo o background da aba ocupando `100%` da largura física da tela.
  5. Use `flexShrink: 1` em ScrollViews dentro de modais para evitar o colapso de layout (altura zero) no modo horizontal.
