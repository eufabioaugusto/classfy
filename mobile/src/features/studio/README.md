# Studio nativo — primeira versão para iPhone

O botão central de criar, o aviso de aprovação de creator e a entrada “Meu Studio” em Você abrem `/studio` dentro do aplicativo. Esta versão oferece Aula, Short e Podcast. Curso estruturado, transmissão ao vivo, fundos, filtros, legendas e assistência de IA são etapas posteriores; não aparecem como funções prontas.

## Experiência entregue

- Workspace com projetos deste aparelho, estados reais e retomada.
- Preparação opcional: título, objetivo de aprendizado, público e guia de gravação.
- Câmera 1080p, frontal/traseira, contagem regressiva, timer, takes, teleprompter com velocidade e pausa; gravação de podcast em áudio. Aula admite aparelho horizontal e Short mantém orientação vertical.
- Importação pelo seletor do sistema, com cópia para Documents antes de confirmar salvamento. Importações parciais preservam os takes válidos.
- Prévia de takes e da montagem, corte visual com dois controles e precisão numérica, ordem, duplicação e retirada de takes.
- Exportação AVFoundation de cortes e montagem reais para MP4/M4A, orientação normalizada, imagem contida e centralizada, áudio preservado, progresso e cancelamento.
- Revisão com capa, descrição, tags, acesso gratuito/Pro/Premium/avulso, preço e checklist; coroas e controles comuns do app.
- Upload PUT ou TUS conforme destino retornado pelo servidor, verificação de processamento e envio para curadoria, sem aprovação automática.

## Recuperação e isolamento

`store.ts` serializa alterações por conta e só anuncia salvamento depois da escrita. `useStudioFields` mantém texto pendente, salva no background e aguarda a escrita ao voltar; uma falha mantém a tela para tentar novamente. Dados de outra conta não entram no workspace.

Os originais permanecem em `Documents/classfy-studio/{owner}/{project}/`. `pendingTakes` registra arquivos copiados antes de ler metadados; o editor oferece recuperação ou retirada explícita da lista de pendentes. Retirar um take ou projeto do índice não apaga automaticamente seus arquivos. Os caminhos são recuperados quando o iOS muda o container numa atualização.

Edição invalida a exportação/upload quando takes ou cortes mudam. Arquivos não podem ser alterados durante preparação/envio/processamento. Cancelamento aguarda o job encerrar antes de liberar novo envio. Encerrar o processo JavaScript transforma transferências locais interrompidas em estado recuperável, nunca em sucesso.

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

A suíte Swift requer Xcode e FFmpeg locais e verifica cortes, ordem por pixels, rotação por metadados, centralização, áudio com takes silenciosos, thumbnail, proteção do original e cancelamento. `/dev/studio-media` executa o teste da ponte nativa e exportação dentro do simulador com cores e tons sintéticos; redireciona em release e não faz chamadas de publicação.

## Limites desta entrega

Exportação nativa está implementada para iOS. O Android mostra a indisponibilidade antes de abrir a produção; seu exportador ainda deve ser desenvolvido. A orientação padrão do Android permanece em retrato.

Transferência requer o app aberto; TUS retoma do offset confirmado e PUT pode reenviar o arquivo. Não há promessa de gravação/envio continuado depois de o iOS encerrar o app. Projetos ficam neste aparelho; a sincronização do payload acontece ao preparar/submeter, e os originais locais não viram um editor em nuvem.

Build de simulador, testes de contratos/transporte com mocks e exportação local foram verificados. Captura no iPhone físico e upload/processamento/curadoria com mídia real ainda precisam de QA; nenhum conteúdo de teste foi publicado em produção. Um binário novo é necessário para as dependências e o módulo nativos.

Documentação usada: [Expo Camera SDK 54](https://docs.expo.dev/versions/v54.0.0/sdk/camera/), [ImagePicker](https://docs.expo.dev/versions/v54.0.0/sdk/imagepicker/), [FileSystem](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem-legacy/) e [ScreenOrientation](https://docs.expo.dev/versions/v54.0.0/sdk/screen-orientation/).
