# Identidade Classfy — asa/play

- [Pacote completo v1](classfy-asa-play-v1.zip): SVGs, PNGs, fonte/licença e prancha.
- [Guia original da entrega](asa-play-v1.md): construção, cores, tamanhos e pesquisa preliminar. Descreve o estado anterior à integração no produto.
- Arquivo utilizado pela interface: `public/brand/classfy-simbolo-vermelho.svg`.
- Componente compartilhado: `src/components/ClassfyLogo.tsx`.

Integrado em 10/10/2026 ao logo da barra lateral e do header mobile. A versão recolhida mostra apenas o símbolo. O nome mantém a tipografia existente do produto. O pacote arquivado contém também uma composição em Inter ExtraBold para usos externos.

Não alterar a geometria do SVG de forma independente das futuras versões do pacote.

Vermelho oficial atualizado para **#EF5066**, por definição do Fabio. Pacote e SVG de runtime sincronizados. Os estilos usam os tokens `--brand-red`, `--brand-red-rgb` e `--brand-red-hsl` de `src/index.css`.
