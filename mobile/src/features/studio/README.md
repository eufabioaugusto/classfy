# Studio nativo para iPhone

O botão central de criar, o aviso de aprovação de creator e a entrada “Meu Studio” em Você abrem `/studio` dentro do aplicativo. Esta versão oferece Aula, Short e Podcast. Curso estruturado, transmissão ao vivo, fundos, filtros, legendas e assistência de IA são etapas posteriores; não aparecem como funções prontas.

## Experiência entregue

- Workspace com grade regular de capas 4:5, busca local, ordenação, Rascunhos/Enviados e retomada dos projetos deste aparelho. O formato de gravação não altera o tamanho do card.
- Preparação opcional: título, objetivo de aprendizado, público e guia de gravação.
- Câmera imersiva: Aula em horizontal 16:9, Short em vertical 9:16, controles sobre a imagem e botão explícito de alternar câmera. Podcast grava áudio com nível real do microfone.
- No iPhone com o binário atualizado, a ponte consulta os formatos da câmera efetivamente aberta: qualidade até 4K e 24/30/60 FPS conforme suporte. Toques alternam qualidade/FPS; segurar abre os ajustes. Configuração precisa ser confirmada antes de liberar REC.
- Zoom por dial/arraste, pinça e pressão contínua; foco por toque, trava por gesto longo quando suportada e compensação de exposição EV. A abertura é exibida como informação fixa da lente. Não há controle fictício de abertura, ISO/obturador manual ou HDR.
- Contagem regressiva, takes e teleprompter com texto editável na própria câmera, velocidade e pausa.
- Importação pelo seletor do sistema, com cópia para Documents antes de confirmar salvamento. Importações parciais preservam os takes válidos.
- Editor em retrato para todos os formatos: prévia de Aula 16:9 ou Short 9:16 acima da timeline sempre visível. Tela inteira é uma prévia opcional; ao fechar, as ferramentas retornam ao retrato. A captura de Aula continua horizontal.
- Timeline com duração proporcional, régua, cursor fixo, rolagem para navegar e zoom por pinça ou botões. Selecionar um take abre ferramentas contextuais; arrastar suas bordas corta com prévia simultânea, sem modal sobre o vídeo. Divisão, ordem, duplicação e retirada preservam os originais.
- Desfazer/refazer das alterações de takes na sessão do editor, com até 50 etapas. O histórico só confirma uma alteração depois de persistir e é reiniciado em importações ou mudanças externas da montagem, troca de conta/projeto ou fechamento do editor. Não desfaz textos, captura nem publicação.
- Exportação AVFoundation de cortes e montagem reais para MP4/M4A, orientação normalizada, imagem contida e centralizada, áudio preservado, progresso e cancelamento. Preserva fontes UHD e cadência até 60 FPS; usa HEVC acima de 30 FPS e verifica o resultado antes de concluir.
- Revisão com capa, descrição, tags, acesso gratuito/Pro/Premium/avulso, preço e checklist; coroas e controles comuns do app.
- Upload PUT ou TUS conforme destino retornado pelo servidor, verificação de processamento e envio para curadoria, sem aprovação automática.

## Recuperação e isolamento

`store.ts` serializa alterações por conta e só anuncia salvamento depois da escrita. `useStudioFields` mantém texto pendente, salva no background e aguarda a escrita ao voltar; uma falha mantém a tela para tentar novamente. Dados de outra conta não entram no workspace.

O editor usa um único bloqueio de saída para texto e montagem; o gesto de voltar fica indisponível durante escrita ou corte ativo. O corte congela take, origem, limites e prefixo da montagem; mudanças conflitantes cancelam o gesto ou impedem a confirmação após a fila de salvamento. Importar novos takes depois do alvo não invalida um corte em andamento.

Abrir câmera ou galeria cria uma sessão temporária em memória, fora da grade e do AsyncStorage. O primeiro take copiado promove o mesmo projeto para rascunho durável, incluindo o journal de recuperação. Cancelar sem mídia não cria card. Editar somente o roteiro durante essa sessão também não afirma salvamento no aparelho; rascunhos vazios de versões antigas permanecem preservados.

Os originais permanecem em `Documents/classfy-studio/{owner}/{project}/`. `pendingTakes` registra arquivos copiados antes de ler metadados; o editor oferece recuperação ou retirada explícita da lista de pendentes. Retirar um take ou projeto do índice não apaga automaticamente seus arquivos. Os caminhos são recuperados quando o iOS muda o container numa atualização.

Edição invalida a exportação/upload quando takes ou cortes mudam. Arquivos não podem ser alterados durante preparação/envio/processamento. Cancelamento aguarda o job encerrar antes de liberar novo envio. Encerrar o processo JavaScript transforma transferências locais interrompidas em estado recuperável, nunca em sucesso.

A assinatura de renderização inclui a versão do exportador. Arquivos preparados pelo exportador antigo de 1080p/30 são invalidados na próxima preparação explícita, mesmo que os cortes não mudem; projetos já enviados continuam imutáveis.

O miniplayer global fecha ao entrar no Studio para não interferir no áudio. Projetos enviados ficam imutáveis no índice local.

## Contratos existentes

São reutilizados `save_publication_draft`, `video-create-upload`, `media_assets` e `submit_standalone_publication`. Destino de mídia: `${kind}:primary`; capa JPEG no bucket `contents`, caminho `thumbnails/{owner}/{uuid}.jpg`. O serviço exige conta proprietária, papel creator aprovado ou admin e mídia pronta antes de submeter.

O payload mantém os campos do Studio web. `_mobileStudio` leva objetivo, público, roteiro e fingerprint estável da montagem; não envia caminhos locais nem destinos assinados. Resposta perdida de save/submissão é reconciliada antes de repetir. O controle de conflitos usa o timestamp remoto existente; o backend ainda não fornece trava atômica de revisão.

## Validação

Na pasta `mobile`:

```sh
npm run typecheck
npm run test:studio
npm run test:catalog
npm run test:navigation
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run test:studio:media
```

A suíte Swift requer Xcode e FFmpeg locais e verifica cortes, ordem por pixels, rotação por metadados, centralização, áudio com takes silenciosos, thumbnail, UHD, 24/25/30/60 FPS, mistura de formatos, proteção do original e cancelamento. `/dev/studio-media` executa o teste da ponte nativa e exportação dentro do simulador com cores e tons sintéticos; redireciona em release e não faz chamadas de publicação.

## Limites desta entrega

Exportação nativa está implementada para iOS. O Android mostra a indisponibilidade antes de abrir a produção; seu exportador ainda deve ser desenvolvido. A orientação padrão do Android permanece em retrato.

Transferência requer o app aberto; TUS retoma do offset confirmado e PUT pode reenviar o arquivo. Não há promessa de gravação/envio continuado depois de o iOS encerrar o app. Projetos ficam neste aparelho; a sincronização do payload acontece ao preparar/submeter, e os originais locais não viram um editor em nuvem.

Captura e reprodução com vídeo/áudio no iPhone foram confirmadas por Fabio na primeira versão. A nova ponte de câmera exige binário atualizado e nova validação física de 4K/FPS, exposição, foco e gestos. Upload/processamento/curadoria com mídia real continuam como QA posterior; nenhum conteúdo de teste foi publicado em produção.

Rodada de 08/10/2026: typecheck e 76 testes do Studio passaram; suíte Swift com fontes UHD/FPS passou. Os builds de iPhone e simulador foram compilados e instalados, e o diagnóstico `/dev/studio-media` confirmou a ponte/exportação no binário novo. No simulador, câmera → teleprompter → voltar manteve a contagem de projetos. A parada imediata após REC conserva a intenção por operação, com confirmação nativa, timeout e regressões de início atrasado/troca de câmera.

Rodada seguinte de 08/10/2026: editor reorganizado em retrato com corte inline e histórico. Typecheck e 95 testes passaram. No simulador foram conferidos Aula/Short, corte por acessibilidade, divisão, ordem, duplicação, desfazer/refazer, zoom preservando o segundo sob o cursor, reprodução e retomada. Câmera de Aula e prévia inteira retornam ao editor em retrato. A automação de mouse não confirmou arraste contínuo/pinça; precisão desses gestos aguarda teste físico no iPhone. Nenhuma mudança Swift ou publicação nesta rodada.

Retorno físico de 08/10/2026: Fabio encontrou erro ao dividir (`touches.length` em evento de encerramento sem `touches`) e cursor voltando ao início após cortar. Os responders agora normalizam os toques e usam a contagem do gesto quando o evento não fornece uma lista; pinça exige coordenadas válidas. A timeline realinha a rolagem ao tempo de reprodução depois de encolher o conteúdo. O player respeita o seek pendente do mesmo take/origem e, ao mudar os limites, prende a posição à borda mais próxima em vez de reiniciar o trecho. Typecheck e 101 testes passaram. No simulador, divisão em 2,5 s seguida de corte do fim manteve o cursor em 2,9 s, alinhado à borda; a montagem sintética foi restaurada por desfazer. O gesto físico que causou o erro ainda precisa ser repetido no iPhone com a correção. Atualização JavaScript via Metro, sem novo build nativo ou publicação.

Documentação usada: [Expo Camera SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/camera/), [ImagePicker](https://docs.expo.dev/versions/v54.0.0/sdk/imagepicker/), [FileSystem](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem-legacy/) e [ScreenOrientation](https://docs.expo.dev/versions/v54.0.0/sdk/screen-orientation/).
