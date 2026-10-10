# Live no Studio mobile

## Estrutura reutilizada

Live é um formato independente dos projetos gravados. Ela usa as mesmas linhas
da tabela `lives`, contas, permissões, chat, audiência e replays do Web. Não cria
um projeto de takes nem passa pela timeline/exportador de gravações.

O publicador é React Native/TypeScript com o SDK oficial LiveKit e WebRTC nativo.
Câmera e microfone publicam na mesma sala que o Web. O servidor `live-control`
faz a ponte LiveKit → RTMPS → Mux, grava e processa o replay. URL/token de conexão
ficam em memória. A chave RTMP não é entregue ao aplicativo.

Dependências fixadas: `@livekit/react-native` 3.0.0,
`@livekit/react-native-webrtc` 144.2.0, `livekit-client` 2.22.4, plugin Expo 1.0.3,
config plugin WebRTC 13.0.0 compatível com Expo 54. O entry `index.js` registra
os globais antes do Router, somente quando os módulos e métodos nativos existem.
Um Classfy Dev antigo continua abrindo o aplicativo e gerenciando lives; a tela
de transmissão explica a necessidade de instalar a versão atual e oferece o Web.

Fontes: [LiveKit com Expo](https://docs.livekit.io/transport/sdk-platforms/expo/),
[SDK React Native](https://github.com/livekit/client-sdk-react-native),
[Expo SDK 54](https://docs.expo.dev/versions/v54.0.0/).

## Jornada

1. Studio → Novo projeto → Live → Preparar live.
2. Título, descrição opcional e capa 16:9. A criação exige creator aprovado ou
   admin, assim como o servidor. Gerenciar uma transmissão própria continua
   possível se a aprovação mudar.
3. Ativar câmera/microfone abre somente uma **prévia privada**. As permissões
   são solicitadas antes da captura para não confundir o alerta do iOS com uma
   interrupção da transmissão.
4. Iniciar faz contagem, conecta, publica tracks e solicita a ponte. “Ao vivo”
   exige confirmação do estado público pelo servidor/Mux. Um token ou resposta
   de `start` não é prova de que o público já recebe vídeo.
5. Câmera, microfone, troca de câmera, chat, espectadores e compartilhamento
   ficam na tela de transmissão. Avisar seguidores exige ação explícita e
   confirmação; o backend impede aviso duplicado. Exclusão de mensagem usa a
   moderação existente. O aplicativo não oferece pin sem suporte de RLS.
6. Voltar durante a conexão/transmissão tem guarda. Encerrar espera a confirmação
   do servidor antes de liberar tracks. Uma resposta perdida ao iniciar conserva
   a possibilidade de a live estar no ar e oferece retomada/encerramento.
7. Sair para background ou perder a tela interrompe a captura local. Não encerra
   silenciosamente a live no servidor. Voltar reconcilia o estado; retomar câmera
   e sinal é explícito. Retomar uma live no ar avisa que substitui o host da mesma
   conta conectado em outro aparelho.
8. Minhas lives acompanha preparação, processamento, gravação pronta, envio
   para curadoria e publicação. Ver gravação usa playback assinado, inclusive
   para o owner antes da curadoria. Descartar e enviar replay exigem confirmação.
9. A audiência abre a rota `/live/[id]` no aplicativo e conserva o ID ao entrar.
   Reprodução HLS e chat reaproveitam os serviços existentes; replay não usa
   a duração fixa de uma hora devolvida pelo endpoint como duração real.
   A gravação abre com capa e Play. O vídeo aparece após confirmar avanço real
   da reprodução e mantém o frame ao pausar. Isso evita expor o frame inicial
   pausado do AVKit antes de a geometria do vídeo se estabilizar; não é uma
   correção do comportamento nativo do AVKit.

## Estado, conta e recursos

O transporte tem um único proprietário de câmera/áudio e uma fila serial. Cancelar
invalida resultados tardios, interrompe a Room e solta tracks/AudioSession. Trocar
conta, live ou foco não permite publicar com o token anterior. O controlador
de transmissão tem regressões para conta/foco, duplo toque, interrupção de câmera
durante start, terminal durante cleanup e falhas de início/encerramento.
Conectar e publicar no SDK têm teto único de 45 segundos. Cancelamento/timeout
interrompe a captura e libera a fila mesmo se o SDK nunca resolver; respostas
tardias não podem publicar tracks nem alterar uma sessão nova.

Requests usam a conta capturada com validação antes/depois dos awaits. Comandos
de gestão por live são serializados para `sync` não bloquear `end` com erro de
ocupado. A criação reserva uma operação por conta. Se a resposta da criação
se perder, uma consulta pela capa exclusiva recupera a live; cleanup só remove
uma capa sem live quando a falha é definitiva.
As requisições Live, incluindo autenticação e leitura da resposta, têm prazo
de 25 segundos e cancelamento composto. A fila é liberada mesmo se o fetch
ignorar abort. Timeout de mutação conserva o resultado desconhecido: recuperar
antes de repetir criação/início. Compensação de presença e reconciliação usam
o JWT original com prazo, sem adotar a conta nova nem depender do foco antigo.
Chat, playback e presença só autorizam formatos gratuitos ou o próprio creator;
outras contas não recebem mensagens de uma live paga/Pro antes dessa validação.

Realtime usa tópicos únicos por consumidor. Refetch conserva o host montado e
não substitui eventos novos por respostas antigas. Uma falha de refresh mostra
o erro mantendo a captura e o estado conhecido. A tela usa keep-awake enquanto
captura; libera o recurso ao interromper/sair.

## Limites atuais do servidor

- Novas lives são gratuitas, sem presentes. Pago/Pro, agendamento e pin não são
  oferecidos por esta integração; dependem de contratos/autorização adicionais.
  O viewer oferece abertura explícita no Web para uma live paga/Pro existente
  quando o serviço sinaliza acesso não suportado, mantendo o tratamento Web.
- Egress atual é **H264 720p/30 FPS** e o Mux está configurado com limite de uma
  hora. 4K/2K/24/60 FPS do editor não alteram lives.
- Tratamentos Core Image/Metal da câmera de gravação não são transportados pelo
  capturador LiveKit desta entrega. Não mostrar controles de tratamento inativos.
- Presença legada tem uma linha por conta/live, não por sessão/dispositivo, e
  não tem TTL. Leases locais evitam dupla entrada/saída entre componentes do app;
  aparelhos distintos da mesma conta ainda compartilham presença, como no Web.
- Webhook Live não tem a mesma ordenação/CAS da mídia gravada. Corrigir isso e a
  concorrência de criação entre aparelhos requer mudanças backend separadas.

## Validação

```bash
npm run typecheck
npm run test:live
npm run test:studio
npm run check:dependencies
CLASSFY_IOS_PERSONAL_TEAM=1 npx expo prebuild --platform ios --no-install
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pod install --no-repo-update --project-directory=ios
```

Os testes de backend/hook/transporte/telas substituem rede, dispositivos e SDK.
Eles verificam comportamento e recuperação; não comprovam vídeo ao vivo físico.
Os builds de simulador e iPhone compilam a integração nativa. A inspeção do
simulador cobre entrada, seletor, gerenciamento, preparação e guarda de saída
sem iniciar live. Uma gravação existente carregou capa/conversa e foi reproduzida
e pausada no player nativo; voltar conservou o histórico.

Em 10/10/2026: 130/130 testes Live e 717/717 regressões Studio passaram;
typecheck, dependências Expo e whitespace aprovados. Builds de simulador e
iPhone aprovados. Nenhum desses resultados substitui o aceite físico abaixo.

### Jornadas para o próximo aceite físico

| Jornada | Resultado esperado | Evidência nesta entrega |
| --- | --- | --- |
| L01 Entrada e preparação | Live no seletor, capa 16:9, título validado e saída de formulário com confirmação | Simulador e testes de tela; upload/criação real pendentes |
| L02 Permissão e prévia | Câmera/microfone privados, negar permissão recuperável, sem entrada pública automática | Mocks e build; frente/traseira físicas pendentes |
| L03 Entrar ao vivo | Uma operação, contagem, sinal confirmado pelo servidor e recepção por outra conta | Controlador/transporte com mocks; sinal real pendente |
| L04 Controles e conversa | Flip, mute, câmera, chat/moderação, audiência e aviso explícito aos seguidores | Contratos/tela com mocks; captura e interações reais pendentes |
| L05 Interrupção e retomada | Perda de rede/background libera captura, mantém estado público conhecido e pede retomada explícita | Regressões com mocks; rede e background físicos pendentes |
| L06 Encerrar | Falha conserva aviso de possível live no ar; sucesso libera câmera e acompanha processamento | Regressões com mocks; encerramento real pendente |
| L07 Gravação e curadoria | Capa/Play, reprodução/pausa, gravação pronta, envio confirmado à revisão | Replay existente no simulador; submissão real pendente |
| L08 Conta e compatibilidade | Troca de conta invalida resposta tardia; binário antigo explica atualização na transmissão | Testes de contrato/SDK/tela; binário antigo no iPhone pendente |

Aceite físico pendente: primeira permissão, prévia real frente/traseira, iniciar
com espectador em outra conta, sinal confirmado, flip/mute, perda/retomada de
rede, background, encerrar, processamento e conferência do replay. Este aceite
precisa do iPhone com a nova versão instalada. Nenhuma live/notificação/replay
foi publicada pela validação de desenvolvimento.
