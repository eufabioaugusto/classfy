# Mini player flutuante do Watch

## Objetivo e estado da entrega

Permitir que uma pessoa inicie um conteúdo no Watch e continue assistindo ou ouvindo enquanto usa outra aba ou aplicação. A referência de interação é o mini player do Spotify: imagem limpa durante a reprodução, comandos no hover/foco e título/criador sempre visíveis, com identidade Classfy.

Registro de 15/10/2026. Implementação no worktree `/Users/fabio/.codex/worktrees/studio-web-editor/classfy`, branch `codex/watch-floating-player`, a partir de `1e556a44b779a4de14d77a83851be73d5c8261d7`. A validação Chrome descrita abaixo usa fixture sintética local, sem conta autenticada; não comprova crédito de consumo em produção.

## Contrato da reprodução

- `src/hooks/useWatchFloatingPlayer.tsx` abre uma janela Document Picture-in-Picture e adota **o mesmo `HTMLVideoElement` ou `HTMLAudioElement`** do player existente. Não cria outro elemento de reprodução, outra conexão HLS ou outro hook de métricas.
- O player principal continua responsável por fonte, HLS, acesso e progresso. Posição, mute, volume, velocidade e play/pause são observados nos eventos nativos; mudanças no mini player refletem nos controles principais e na MediaSession.
- `src/components/watch/WatchFloatingControls.tsx` só controla a mídia recebida. O `mediaMount` fornece o ponto de adoção; a interface não carrega fonte ou registra consumo. Podcast usa a mesma mídia de áudio e uma capa visual.
- Hover, `focus-within`, pausa e dispositivos sem hover tornam os comandos acessíveis. Há play/pause, voltar/avançar 10 segundos, volume/mute, velocidade, progresso arrastável, tempos, voltar ao Watch e fechar. Espaço/K, esquerda/direita e M funcionam sem interceptar inputs, selects ou botões focados.
- Falha de `play()` é capturada e exibida; o estado não presume sucesso da promessa. Não se registra consumo em `timeupdate` quando a mídia está pausada ou buscando outra posição.
- O botão “Mini player” do Watch desktop é disponibilizado após a fonte anexada e o primeiro pedido explícito de reprodução. Não começa a reproduzir apenas por abrir o Watch ou montar o hook.

## Janela, posse e restauração do DOM

Um lease guarda janela, mídia, pai original e comentário de âncora. A abertura pendente usa geração, escopo e identidade da mídia para rejeitar respostas antigas após troca de conteúdo, conta, acesso ou desmontagem. Pedidos repetidos compartilham a abertura pendente; depois, o botão manual foca a janela já existente.

`pagehide` devolve a mídia à sua posição original. O fechamento por código também restaura o nó **sincronamente**, antes de fechar a janela. A limpeza em `useLayoutEffect` devolve a mídia antes de React remover o pai original. Não alterar a fonte, clonar a mídia ou remontar o player para trocar de janela.

Fechar a janela ou “Trazer de volta” preserva reprodução e posição. Fechar o mini player interno da Classfy mantém seu contrato anterior de encerrar a própria reprodução. Sair da rota ou trocar a fonte fecha a janela pertencente ao player anterior.

`src/components/MiniPlayer.tsx` oferece a janela externa também no mini player interno desktop. O handoff desktop em `src/pages/Watch.tsx` passa o estado observado de reprodução a `startMiniPlayer`: conteúdo pausado continua pausado ao sair do Watch. Chamadores mobile existentes continuam com seu comportamento anterior quando não informam esse argumento. A interface do mobile não foi substituída nesta entrega.

O `MiniPlayerProvider` oculto não limpa mais a MediaSession pertencente ao Watch. Quando ativo, ele libera a própria sessão ao fechar. Uma troca direta de `user.id`, inclusive sem um estado intermediário nulo, fecha a reprodução do proprietário anterior; renovar o token da mesma conta não encerra o conteúdo. O escopo do mini player desktop inclui a identidade do usuário. O handler opcional `enterpictureinpicture` do hook tem proprietário local à aba: a limpeza de um hook antigo não remove o handler instalado por outro player Watch mais recente.

## APIs e compatibilidade

- [Document Picture-in-Picture — Chrome](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/): permite HTML e controles próprios em janela sobre as outras aplicações. Os estilos são carregados separadamente por CSS inline; a posição final da janela é decisão do navegador. A janela não sobrevive ao fechamento da aba e não pode entrar em fullscreen; o retorno abre os controles completos no Watch.
- [requestWindow — MDN](https://developer.mozilla.org/en-US/docs/Web/API/DocumentPictureInPicture/requestWindow): requer contexto seguro, documento principal e ativação transitória. O pedido manual ocorre na chamada original do clique, antes de qualquer `await`. A integração detecta capacidades, sem escolher navegador por user agent.
- [AutoPiP para reprodução — Chrome](https://developer.chrome.com/blog/automatic-picture-in-picture-media-playback): a abertura automática usa apenas o callback autorizado `MediaSession.enterpictureinpicture`. Exige elegibilidade e permissão/engajamento avaliados pelo navegador, com mídia em reprodução, audível recentemente e com foco de áudio. **Não há tentativa de abrir janela em `visibilitychange`**. Trocar de aba não garante abertura automática em toda instalação; o botão manual continua disponível.
- [Picture-in-Picture de vídeo — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API): quando Document PiP não existe, vídeo pode usar PiP nativo. Nesse fallback, a aparência e os controles pertencem ao navegador, sem promessa de nosso hover HTML.
- [Controles PiP Safari — Apple](https://developer.apple.com/documentation/webkitjs/adding_picture_in_picture_to_your_safari_media_controls): o fallback também considera `webkitSupportsPresentationMode`/`webkitSetPresentationMode`. Podcast não anuncia fallback de vídeo quando Document PiP está ausente.
- [Especificação WICG](https://wicg.github.io/document-picture-in-picture/): o pedido pertence ao contexto principal, embora a janela possa conter iframes. Os players Classfy desta integração usam mídia direta, não clonam um iframe de provedor.
- [Compatibilidade MDN](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/DocumentPictureInPicture.json): consulta de 15/10/2026 lista Chrome/Edge e Firefox 151 para Document PiP, sem Safari. A detecção em runtime é a regra de funcionamento; suporte e políticas podem variar.

Não confundir suporte à API com permissão para abrir automaticamente. Recusar uma abertura mantém mídia, fonte e posição no Watch e informa o problema.

## Validação registrada

Comandos para repetir no worktree web:

```sh
npx vitest run src/hooks/useWatchFloatingPlayer.test.tsx src/components/unified/UnifiedVideoPlayer.floating.test.tsx src/contexts/MiniPlayerContext.test.tsx --environment jsdom
npx eslint src/components/watch/WatchFloatingControls.tsx src/hooks/useWatchFloatingPlayer.tsx
npm run build
npm test
npx tsc -p tsconfig.app.json --noEmit --pretty false
```

- Última rodada direcionada: **38/38 testes** em três arquivos, incluindo mídia única/HLS único, restauração/posse, abertura tardia, fallback, podcast, erros, sincronização e `timeupdate` pausado ou em seek sem novo consumo. Log: `/tmp/classfy-watch-floating-integration-tests.log`.
- Build de produção passou. Log final: `/tmp/classfy-watch-floating-final-build.log`. Os avisos de tamanho de chunks não impedem o build.
- Rodada web final: **126 arquivos e 1.157 testes passaram**, usando `npx vitest run --exclude 'supabase/functions/_shared/referral-payments.test.ts' --environment jsdom`. Log: `/tmp/classfy-watch-floating-web-tests.log`. O comando `npm test` também descobre uma suite destinada ao Deno e falha com `ReferenceError: Deno is not defined`; essa mesma falha foi reproduzida no baseline em `/tmp/classfy-watch-floating-baseline-deno-test.log`. A exclusão limita somente esse arquivo de outro runtime, sem ocultar falhas dos testes web.
- TypeScript global: 19 diagnósticos idênticos entre worktree e baseline, sem diagnóstico novo nos arquivos desta entrega. Comparação literal das linhas de erro de `/tmp/classfy-watch-floating-final-typecheck.log` e `/tmp/classfy-watch-floating-baseline-typecheck.log`.
- QA local em Chrome real, comunicado pelo coordenador da execução: fixture com `UnifiedVideoPlayer` e `hls.js` reais adotou o mesmo nó DOM e permaneceu com uma mídia; tempo avançou de aproximadamente 36 para 78 segundos. Pausa no PiP refletiu no principal; ±10s, scrubber, volume zero e velocidade 1,5× sincronizaram. Retorno ao Watch conservou aproximadamente 37 segundos. Uma outra aba ficou aberta e a reprodução continuou. Captura: `/tmp/classfy-watch-floating-controls.png`.
- Podcast no mesmo Chrome real: uma única mídia `HTMLAudioElement`/HLS, abertura da janela, retorno ao início com Home e Play após chegar ao fim. Fechar pelo controle do navegador restaurou o mesmo áudio ao Watch; a reprodução continuou (`paused=false`, posição aproximadamente 12 segundos). O teste não cria vídeo substituto para áudio.

O teste real de desmontar o player com a janela aberta também passou: a janela foi fechada, nenhuma mídia ficou na página e não houve `NotFoundError`. Fixtures locais e arquivos `__watch-floating-qa` foram preservados em `/tmp/classfy-watch-floating-browser-fixture` e removidos do código e do build final.

## Pendências de aceite neste registro

- Troca de conteúdo e rejeição da API foram verificadas por testes controlados; comparar essas combinações em outros navegadores reais. Vídeo, podcast, retorno, fechamento externo e desmontagem passaram no Chrome local.
- Verificar em conta real continuidade do progresso de Watch/curso sem emissões duplicadas; a fixture não autentica nem credita Points.
- Safari/WebKit real e AutoPiP segundo a política efetiva do navegador permanecem aceite específico, separado do teste de janela manual no Chrome.
