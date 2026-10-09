# Classfy Mobile

- Este app usa Expo SDK 54, React Native e Expo Router.
- Consulte a documentacao versionada em https://docs.expo.dev/versions/v54.0.0/ antes de alterar dependencias Expo.
- Mantenha as rotas em `/app` e codigo compartilhado em `/src`.
- Nao altere a aplicacao web da raiz para resolver problemas do mobile sem justificativa explicita.
- Ao implementar Bottom Sheets/Modais deslizáveis com ScrollView ou FlatList internos no React Native:
  1. Defina `onStartShouldSetPanResponder: () => false` e `onStartShouldSetPanResponderCapture: () => false` no PanResponder do container pai, permitindo que a lista interna role livremente.
  2. Adicione `onStartShouldSetResponder={() => true}` no container do cabeçalho/alça (header/handle) do modal, garantindo que toques em elementos estáticos iniciem a sessão de gestos que o PanResponder captura para o swipe-down de fechar.
  3. No modo horizontal (landscape), certifique-se de que a altura máxima (`maxSheetHeight`) calculada permaneça sempre positiva.
  4. No modo horizontal, limite a largura interna do conteúdo ao tamanho proporcional do player (aspectRatio `16:9`) centralizando-o com `alignSelf: 'center'` para evitar que o conteúdo fique atrás da câmera notch lateral, enquanto o background da aba continua ocupando `100%` da largura física.
  5. Use `flexShrink: 1` em ScrollViews dentro de modais para evitar o colapso de layout (altura zero) no modo horizontal.

## Qualidade do Studio

- Antes de alterar o editor, consulte `STUDIO_EDITOR_INTERACTIONS.md`: regras compartilhadas, divergências e jornadas J01–J12. `STUDIO_EDITOR_VALIDATION_HISTORY.md` é evidência histórica, não especificação atual.
- Ao corrigir um comportamento, revise todos os tipos de elemento e pontos de entrada que usam a mesma regra. Valide a jornada completa e as vizinhas afetadas, incluindo cancelamento, undo/redo e persistência/apresentação relevantes.
- Separe teste automatizado, build, inspeção no simulador, toque físico e comparação da exportação. Contagem de testes e compilação não aprovam usabilidade; mantenha pendências explícitas e não dependa dos relatos do Fabio para descobrir regressões básicas.
