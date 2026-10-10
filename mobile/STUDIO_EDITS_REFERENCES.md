# Studio: mapa dos 27 prints do Edits

Rodada de 10/10/2026, organizada na sequência enviada pelo Fabio. Os prints são referência de interação e catálogo: não demonstram o algoritmo interno do Edits, condições comerciais ou paridade de qualidade. Este documento relaciona o que foi observado à implementação do Classfy; **implementado no código** não significa aceite por toque no iPhone.

O contrato de gestos e jornadas permanece em [STUDIO_EDITOR_INTERACTIONS.md](STUDIO_EDITOR_INTERACTIONS.md). A arquitetura, exportação e limites estão em [STUDIO_PREMIUM.md](STUDIO_PREMIUM.md). Recursos dependentes do novo motor iOS são liberados por capacidade versionada; o binário anterior recebe orientação para atualizar, sem apresentar um controle inoperante.

## Sequência e cobertura real

| Print | Observação de referência | Estado no Classfy nesta rodada | Limite ou pendência |
| --- | --- | --- | --- |
| 1 | Conteúdo, teclado, abas e aplicar estilo à faixa | Edição inline do texto com abas; aplicação do estilo aos textos da mesma faixa, preservando conteúdo, IDs e tempos. | Resolver draft antes de trocar alvo/sair; jornada com teclado físico ainda exige aceite. |
| 2 | Catálogo e categorias de fontes | Catálogo de 12 famílias iOS, nomes PostScript e variantes disponíveis; categorias simples, serifadas, mono e destaque. | Usa fontes do sistema; não é a biblioteca completa do Edits. |
| 3 | Busca de fontes e seleção atual | Busca, indicação da fonte escolhida e prévia tipográfica. | Conferir acentos, quebra de linha e métricas no arquivo exportado. |
| 4 | Confirmação de fonte salva | Favoritar fonte e feedback da ação. | Preferência local por usuário; não há sincronização remota. |
| 5 | Fontes salvas e menu | Favoritas/recentes persistidas localmente e ações do catálogo. | Não há importação de fontes externas. |
| 6 | Cores primária/secundária, sólido e gradiente | Cor sólida, secundária de contorno/fundo e gradiente linear de duas cores na receita e motor. | Não há gradiente com múltiplas paradas ou editor de ângulo. |
| 7 | Animações de texto | Sem animação, máquina de escrever, pop, bounce, fade, zoom e slide-right. | Entradas predefinidas; sem keyframes livres. |
| 8 | Seleção, demonstração e favorito de animação | Seleção e prévia das animações implementadas. | Favoritos de animação e biblioteca integral pendentes. |
| 9 | Sombras, bloco, neon, brilho e halo | Sem efeito, sombra suave/forte, bloco, neon, glow e halo; CoreText/Core Image no motor compartilhado. | Não confundir o catálogo próprio com todas as variações do Edits. |
| 10 | Contorno/inverso e fundo/inverso | Cinco decorações: nenhuma, outline, outline-inverse, background e background-inverse. | Contraste e rasterização em resolução de saída exigem comparação visual. |
| 11 | Texto contextual: dividir, editar, copiar, duplicar, excluir e opacidade | Seleção contextual, edição, divisão, duplicação, exclusão e opacidade; originais e receita preservados. | Clipboard entre projetos não está implementado; dividir dentro de rampas de fade é bloqueado explicitamente. |
| 12 | Slider de opacidade e mesclagem | Opacidade reversível já existente e mantida na prévia/exportação. | Modos de mesclagem pendentes. |
| 13 | Desseleção e retorno à toolbar global | Regra preexistente: toque vazio resolve draft/remove seleção sem mover cursor; ferramentas acompanham o alvo. | Fluxo integrado por toque físico permanece separado dos testes. |
| 14 | Narração, roteiro e contagem de três segundos | Painel local com roteiro, contagem, gravar/descartar/usar e journal; duração conferida no arquivo M4A após parada e recuperação de leitura sem regravar; uma entrada por gravação aceita. | Prévia pausada durante a narração em binários anteriores à API de ferramentas para preservar o microfone. Não há melhora automática de voz; permissão, interrupção e áudio físico exigem QA. |
| 15 | Filtros com thumbnail do projeto | Nove receitas de cor reais: Natural, Studio, Cinema, Quente, Frio, Preto e branco, Vivo, Suave e Dourado; thumbnails derivados do quadro do projeto. | Cinema é tratamento de cor; não cria profundidade ou cenário. Câmera continua com os três presets originais. |
| 16 | Busca e categorias de efeitos | Busca/categorias e cinco motions: entrada suave, saída suave, zoom-in, pulse e blink, além de nenhum. | Catálogo reduzido a efeitos implementados no motor; sem controles fictícios. |
| 17 | Resolução, FPS e SDR/HDR | Preexistente: Original/HD/2K/4K, 24/30/60 FPS e SDR Rec.709; Original conserva cadências compatíveis e metadados reais. | HDR de saída pendente; conversão HDR→SDR avisada. Capacidade depende do aparelho/binário. |
| 18 | Vídeo contextual: dividir, volume, velocidade, efeitos e excluir | Ferramentas para principal/camadas, cortes não destrutivos, volume, velocidade constante, mirror/motion e exclusão. | Seleção mantém tempo; não há reverse, curva de velocidade ou keyframes. |
| 19 | Volume, aplicar a todos, equalizar/melhorar e fades | Gain e fades reais, inclusive principal; aplicar ajuste de áudio aos clips da sequência principal. | EQ, normalização, dinâmica, redução de ruído e enhance voice pendentes. |
| 20 | Slider de velocidade com 1× | Velocidade constante de 0,25× a 4× em vídeo/áudio; altera duração, mapeamento da fonte e ripple da sequência. | Não há curva de velocidade. Imagem/texto usam duração, sem velocidade de reprodução. |
| 21 | Piscar/pulsar e exposição | Blink/pulse no motion do clip; exposição reversível no grade. | Não inclui todos os efeitos da referência; efeitos de cor não modificam o original. |
| 22 | Retoque e aplicação ampla | Ajustes de cor/iluminação existentes. | Retoque de pele/geometria/beleza ausente; não anunciar iluminação Studio como retoque facial. |
| 23 | Crop, grade, proporções e rotação | Canvas por formato, contain/cover, transformação direta e giro de 90° no painel. | Grade de crop dedicada e catálogo completo de presets de recorte pendentes. |
| 24 | Flip H/V, transformação, overlay, máscara e opacidade | Flip horizontal/vertical reversível, arraste/pinça/alças preexistentes, vídeo/imagem sobrepostos e opacidade. | Máscaras, chroma e recorte automático de fundo pendentes. |
| 25 | Deslizar, extrair áudio, efeitos de voz, fades e freeze | Extração do áudio confirmado de um vídeo, reutilizando o mesmo original e zerando gain do vídeo; gain/fades reais. | Extração cria áudio independente no tempo absoluto. Slip, efeitos de voz e freeze-frame pendentes. Antes de separar, exige confirmação de uma pista real. Projeto legado recebe novo registro de asset dos mesmos bytes, sem reescrever o original; ausência de áudio bloqueia a ação. |
| 26 | Reverse, chroma e retirar silêncio com confirmação | Nenhum desses três recursos foi implementado. | Não exibir toast de silêncio removido/não encontrado sem análise real. |
| 27 | Hold: renomear, duplicar, fixar, selecionar, pastas e lixeira | Menu por hold, mantendo os três pontos; abrir, renomear, duplicar arquivos/receita em novo projeto e excluir, com escopo de dono e estado de envio. | Fixar, seleção múltipla, pastas e lixeira recuperável pendentes. Exclusão usa a política explícita existente, sem prometer recuperação de lixeira. |

## Contrato que acompanha as ferramentas

- Schema/receita continuam v2. Campos opcionais ausentes mantêm o comportamento anterior; o `takes` é derivado da sequência canônica.
- `playbackRate` entre 0,25 e 4 preserva `sourceStartTicks/sourceEndTicks` reais. Duração na timeline é `round(sourceSpan / rate)` em timebase de 120.000 ticks. Fonte, asset e bytes permanecem imutáveis.
- Alterar taxa do principal reconcilia ripple e converte vínculos antigos de offset para âncoras na fonte. Legendas seguem os frames da fonte; mídia sobreposta mantém sua própria taxa e os limites do seu arquivo. Música absoluta não é movida silenciosamente.
- Cortes/divisões conservam os offsets de animação/motion. O schema atual de fades não representa uma rampa interrompida em dois clips: divisão dentro de entrada/saída suave recebe erro explícito; divisões na região constante conservam as rampas das bordas.
- Espelhamento, estilo, cor, motion, velocidade e áudio entram na assinatura do render. Alterar apenas título não invalida a composição; um artefato antigo não certifica uma edição nova.
- Prévia de fallback aplica taxa real sem iniciar playback ao alterar um clip pausado. A receita/exportação continuam a fonte de verdade dos efeitos, com gate de capacidade no binário anterior.

## Evidência e próximos critérios

Rodada final de 10/10/2026: `npm run test:studio:headless` passou nas 12 etapas, com **822/822 testes do Studio**, 3/3 de navegação, typecheck e contratos nativos de captura, mídia, composição, recuperação, perfis de saída, primeiro frame, interação e transcrição. A fonte permaneceu inalterada durante a execução, fingerprint `8579fb72a8960c1bcc75c519e7fb98918bcdf15af2e5484d09283a7e33a63a26`. Relatório: `/var/folders/q2/8n5frlfj0bl65qtj7nmcdhlc0000gn/T/classfy-studio-headless-fikXdn/report.json`.

A fixture de ferramentas gerou **48 arquivos reais**, verificando pixels, texto, efeitos, transforms, defaults antigos, preview/export e áudio. Os 26 M4A também foram decodificados para PCM por um segundo decoder. Uma cauda AAC variável no áudio acelerado foi corrigida por remux passthrough para a duração canônica, preservando pitch e o guard do arquivo final. Cancelamento na transição entre fases, colisão de destino e retry passaram. Artefatos: `/var/folders/q2/8n5frlfj0bl65qtj7nmcdhlc0000gn/T/classfy-studio-editor-tools.iHhEZ9/report.json`.

Builds Debug para Simulator e iPhone compilaram. A build final está instalada no simulador CREATOR; o iPhone não foi atualizado nesta rodada. Na cópia `QA Edits • Recursos`, foram inspecionados hold, duplicação independente, renomeação, reabertura, fontes/animação, thumbnails reais dos nove filtros, velocidade 2× com duração e undo, espelhamento persistido e undo, abertura/cancelamento da narração. Após instalar a build final, o projeto e o menu por hold foram conferidos novamente.

O túnel ngrok existente atingiu seu limite de tráfego (`ERR_NGROK_725`); o simulador foi conectado ao Metro local em `localhost:8082`, mantendo o servidor anterior. Esse acesso local não restabelece o teste remoto no iPhone.

Os testes de domínio/tempo e callbacks reais de `StudioTimeline`/`StudioPreview` substituem fronteiras RN/OS. Cobrem rates 0,25–4, ripple/anchors, source bounds, split/fades, trim temporal, estilo/gradiente, clone imutável, extração sem ganho duplicado, filmstrip e setters do player. A biblioteca de fontes também cobre storage lento, falha de leitura e respostas de contas anteriores: favoritos só podem ser substituídos depois de leitura bem-sucedida. Essa evidência não substitui validação física nem comparação da aula longa no iPhone.

```bash
node --experimental-strip-types --test src/features/studio/editingFeatures.test.mjs
node --experimental-strip-types --test src/features/studio/previewInteraction.test.mjs src/features/studio/timelineInteraction.test.mjs
npm run typecheck
```

Aceite físico ainda necessário: abrir cada ferramenta com o mesmo conteúdo, confirmar/cancelar, undo/redo, reabrir o projeto e comparar preview/export no mesmo instante. Verificar gravação/sincronismo/interrupções do microfone, voz em 0,25×/4×, texto animado cortado, gradiente/contorno em 4K, teclado com seleção e duas fontes de vídeo no iPhone. Esta matriz registra build instalada no simulador, sem afirmar aceite físico ou paridade completa com o Edits.
