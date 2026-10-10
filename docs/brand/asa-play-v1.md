# Classfy — asa/play, versão vetorial 1

Direção aprovada em conversa em 10/10/2026. Este pacote finaliza o desenho para revisão e uso, sem alterar o produto. O conceito aprovado foi reconstruído com curvas Bézier; não é um autotrace nem uma extração idêntica dos pixels anteriores.

## Arquivos

- `svg/`: vetores editáveis; símbolo em preto, branco e vermelho; assinaturas monocromáticas e para fundos claros/escuros; app e prévias.
- `png/`: exportações geradas diretamente dos SVGs. Símbolos e assinaturas com transparência verdadeira; app com fundo opaco em 1024 × 1024.
- `prancha.png` e `prancha.svg`: apresentação, assinaturas e leitura em tamanhos reais.
- `geometria.json`: caminho do símbolo e parâmetros de construção.
- `fontes/`: Inter original, instância ExtraBold Display e licença SIL OFL.

## Construção e uso

A forma mantém três volumes conectados, uma ponta de play convexa e duas aberturas ascendentes. Curvas externas foram reconstruídas preservando a referência enviada pelo Fabio. O acabamento é óptico: não se atribui uma construção por Fibonacci a este desenho.

Usar símbolo solto junto ao nome na assinatura principal. O nome está convertido em curvas usando Inter ExtraBold (peso 800, tamanho óptico 32), com espaçamento ajustado. Esses vetores abrem sem precisar instalar a fonte. Não é uma extração do wordmark da captura de tela; é uma composição em Inter baseada na tipografia indicada.

Na assinatura, caixa do símbolo de 80 unidades, altura das maiúsculas de 68 e distância aproximada de 43 até o nome. Preservar a composição fornecida. Área livre mínima recomendada: 1/4 da altura do símbolo em todos os lados.

Não esticar, inclinar, adicionar contorno, sombras ou alterar isoladamente as aberturas. Utilizar uma cor sólida para o símbolo.

## Cores

| Uso | HEX | RGB |
| --- | --- | --- |
| Vermelho da marca | #EF5066 | 239, 80, 102 |
| Fundo escuro | #0B0D0E | 11, 13, 14 |
| Preto monocromático | #000000 | 0, 0, 0 |
| Branco | #FFFFFF | 255, 255, 255 |

O vermelho foi amostrado da aplicação enviada, não de um token do produto. O pacote não modifica cores existentes da interface. Não foi feita prova de impressão nem definida correspondência Pantone/CMYK.

## Tamanhos e conferência

- 24 px de altura: mínimo recomendado do símbolo em interface.
- 16 px: uso compacto, como favicon; a silhueta se mantém, mas as pontas das aberturas perdem detalhe.
- 32, 48 e 64 px: mesma geometria, com maior nitidez das aberturas.
- Assinatura: mínimo recomendado de 24 px de altura do símbolo, o que corresponde a aproximadamente 134 px de largura total.

SVGs verificados como XML, sem imagens raster incorporadas. PNGs monocromáticos verificados com uma só cor opaca e canal alfa variável. Ícones de app verificados em 1024 × 1024, totalmente opacos. A revisão de leitura foi feita em prancha renderizada, não em instalação real em dispositivos.

## Ícone de app

`classfy-app-vermelho.png` e `classfy-app-preto.png` são quadrados completos, com símbolo ocupando aproximadamente 64% da altura. As versões `app-preview` mostram uma máscara arredondada somente para apresentação. A integração no app deve seguir os formatos e máscaras da plataforma; o pacote não inclui camadas Icon Composer nem o conjunto Android Adaptive Icon. Não usar a prévia com cantos transparentes como arquivo de publicação.

## Pesquisa preliminar de proximidade — 10/10/2026

A combinação asa/play já aparece em acervos comerciais. Duas referências localizadas:

- [Play Phoenix Logo, Scalebranding](https://scalebranding.com/product/323019): o vendedor descreve combinação de fênix e play em desenho linear, para entretenimento.
- [Wing play logo template, VectorStock](https://www.vectorstock.com/royalty-free-vector/wing-play-logo-template-design-wings-button-vector-48007487): catálogo de símbolo asa/play publicado em julho de 2023.

Esses resultados demonstram proximidade temática; não demonstram identidade gráfica, exclusividade da Classfy, titularidade nas classes de interesse ou registrabilidade. Não foi concluída comparação visual exaustiva nem busca de anterioridade figurativa no INPI. A decisão de registro continua pendente dessa análise. [Portal oficial de marcas e busca do INPI](https://www.gov.br/inpi/pt-br/servicos/marcas).

Fonte tipográfica: [Inter, página oficial](https://rsms.me/inter/); arquivo obtido do repositório Google Fonts, pasta `ofl/inter`, com licença incluída.

## Revisão de cor — 10/10/2026

Fabio definiu #EF5066 como vermelho oficial na padronização da interface. Esta revisão substitui #EF5065 da primeira entrega, inclusive nos SVGs e PNGs do pacote.
