# Live beta: LiveKit → Mux

## Fluxo

1. Criador aprovado prepara a live no Studio. `live-control` cria o recurso Mux e guarda a chave de ingestão em `live_stream_secrets` (sem leitura pelo navegador).
2. O navegador publica câmera e microfone na sala LiveKit. O Egress envia RTMPS ao Mux. O webhook Mux confirma quando o vídeo está no ar.
3. O espectador autenticado recebe um HLS assinado do backend. O chat continua no Supabase.
4. Encerrar desativa a ingestão Mux e para o Egress. O Mux finaliza o asset gravado.
5. O criador envia o replay para a fila existente de aprovação. Após aprovação, ele fica disponível como conteúdo `live`.

## Configuração de produção

- Mux em Pay as you go, com token de API de Video Read/Write e chave de assinatura já usados pelo VOD.
- Webhook Mux existente deve entregar `video.live_stream.active`, `video.live_stream.idle` e `video.asset.live_stream_completed` ao `mux-webhook`. O endpoint valida `mux-signature`.
- Projeto LiveKit Cloud com `LIVEKIT_URL` (formato `wss://...livekit.cloud`), `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` como secrets das Edge Functions no Supabase. Nunca colocar o segredo em `VITE_*`.
- Aplicar `20260923220000_live_mux_beta.sql`, implantar `mux-webhook` e `live-control`, depois publicar o frontend.

## Teste de aceite

1. Entrar como creator aprovado, criar live e permitir câmera e microfone.
2. Iniciar, aguardar indicação **Ao vivo** confirmada pelo webhook e assistir em outra conta.
3. Enviar mensagem no chat, encerrar e aguardar a gravação aparecer no Studio.
4. Enviar para revisão, aprovar como admin e assistir ao replay como usuário comum.
5. Confirmar que o Egress terminou, o stream Mux está desativado e não ficou transmissão em aberto.

## Limites do beta

- Uma transmissão por criador por vez; duração máxima de 60 minutos no Mux.
- Sem presentes pagos. A interface deixa isso explícito.
- LiveKit Build tem limite mensal de transcodificação; quando esgotado, novas transmissões falham sem gerar excedente no LiveKit.
