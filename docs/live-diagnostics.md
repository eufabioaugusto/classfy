# Diagnóstico das lives (beta)

O botão **Diagnóstico da live** aparece nas telas de host e visitante. Cada aparelho cria uma sessão própria e salva um resumo no Supabase a cada 12 segundos, no primeiro vídeo, em uma troca de rota e no encerramento. O botão **Copiar diagnóstico** permite compartilhar o mesmo relatório sem abrir o banco.

## O que medir no próximo teste

1. Abrir o host no computador e o visitante no celular; confirmar que o painel do visitante diz **Tempo real** ou **Reserva**.
2. Ativar o som no visitante, dizer uma frase curta e contar o tempo até ouvi-la no celular. Não usar o som do próprio computador como referência de qualidade.
3. Enviar uma mensagem única do celular, por exemplo `teste live 1`. Observar quando ela aparece no chat do host e quanto o painel registra para resposta do servidor e chegada da mensagem. Responder em voz alta e anotar o atraso ouvido no celular.
4. Encerrar logo depois de uma última frase e verificar se ela chega inteira ao visitante.
5. Copiar o diagnóstico dos dois aparelhos se algo falhar. O ID da live e os IDs das mensagens permitem cruzar os registros. O conteúdo das mensagens não é armazenado no diagnóstico.

## Leitura rápida

- **Tempo real**: vídeo direto pela sala LiveKit. A métrica de rede mostra perda de pacotes, oscilação e quadros perdidos. Não mede sozinha o atraso completo entre câmera e tela.
- **Reserva**: player HLS. O campo **Motivo da reserva** mostra por que a conexão direta falhou; **Atraso do player** mostra a distância estimada do vídeo à borda da live quando disponível.
- A reserva pode entrar após 8 segundos sem primeiro quadro, mas a tentativa direta continua. Se o vídeo direto chegar depois, o player volta para **Tempo real**. Compare os eventos **Acesso direto solicitado/pronto**, **Conectando à sala**, **Conexão direta estabelecida** e **Primeiro quadro direto** para localizar a demora.
- **Acesso à sala** mede a resposta do serviço que gera o acesso; **Conexão à sala** mede a entrada no LiveKit; **Vídeo direto recebido** mede o tempo desde a tentativa até a assinatura da faixa de vídeo. Uma etapa ausente indica onde a tentativa parou.
- **Primeiro vídeo**: tempo entre a página detectar `live` e reproduzir o primeiro quadro no aparelho.
- **Chat**: o horário do servidor é a referência comum. A chegada após registro é uma estimativa corrigida por uma sondagem do relógio; rede assimétrica e relógios de aparelhos ainda podem introduzir erro.
- **Até ficar ao vivo** (host): tempo entre o clique em iniciar e o status público confirmado.

## Consulta no Supabase

```sql
select
  created_at, updated_at, role, route,
  report->>'deviceClass' as aparelho,
  report->>'fallbackReason' as motivo_reserva,
  report->'metrics'->>'firstFrameMs' as primeiro_video_ms,
  report->'metrics'->>'packetsLost' as pacotes_perdidos,
  report->'metrics'->>'playbackLatencySeconds' as atraso_player_s,
  report->'lastChatSent'->>'messageId' as ultima_mensagem_enviada,
  report->'lastChatReceived'->>'messageId' as ultima_mensagem_recebida
from public.live_diagnostic_sessions
where live_id = '<id-da-live>'
order by created_at;
```

A tabela tem RLS sem política de leitura para navegador. A função `live-control` valida o usuário e salva apenas métricas, horários e IDs. Não salva áudio, vídeo, texto de chat, IP ou chaves de transmissão.
