# Núcleo compartilhado do Studio

Extração do domínio TypeScript do Studio mobile em 11/10/2026, origem `mobile-dev-iphone`, HEAD `3b65862df5b7c1d99e5e85f387fd7d68b73aae26`. O mobile não foi alterado nesta extração. Schema v2, 120000 ticks/s e semântica de originais/cortes/âncoras preservados. A UI e os adaptadores de arquivo/renderização são de cada plataforma.

No navegador `asset.uri` é um identificador lógico `file://classfy-studio/<owner>/<project>/<assetId>/<name>`; os bytes pertencem ao IndexedDB. Não usar fetch nessa URI. `takes` é um adapter derivado de editing, recriado após leitura por withStudioTakes; não serializar como segundo estado canônico.

As funções possuem somente dependências TypeScript locais; diretivas worklet são inertes no navegador. O renderer deve resolver as fontes por ID e comprovar prévia/exportação em suas próprias fronteiras.

| Fonte mobile | SHA-256 da extração |
| --- | --- |
| model.ts | 662ec24c224425aa0162893c65923edb3eec936c80bf76e426db7c148cde4ce7 |
| timeline.ts | 314a651476777a6535c9307dc5deaf82e142db21f9ea1d1564df61658b257216 |
| editingHistory.ts | c14bccb03b489a8753fc32ef91d57e556b966c5979ca699bb7e93714d202ecb9 |
| layerActions.ts | af886dbe9154edbcd7b5719f9bcb1b082b2fb878e9ec5928dba24429185ade1d |
| layerTimelineInteraction.ts | 25e19e2aea2ad85b02f550b37b66c3fac562c4706c23afc1f3c23f6bdac01a02 |
| editorInteraction.ts | b391f05204a20fbbd1979afbc283b1a0d99add3f66cb7db16b78daacbad03364 |
| timelineLayout.ts | fe2e627312cd9df47d5be698c548e5f67dda873bdbd5c28e036fe8ab60cf23cd |
| canvasGeometry.ts | b2a6153c60d0e92dac89b66c679479212d97222b8c4265083c249df4ceb61948 |
| canvasEditing.ts | fb1cb9c95fcc6d4dadf5d97d48ce6570256357b07985da1276219834bf36ee76 |

As nove suítes puras `*.test.mjs` acompanham a extração: Vitest substitui somente o runner `node:test`; imports diretos executam o domínio compartilhado sem React Native, Expo ou filesystem mobile. Elas preservam 96 regressões de modelo, fonte/tempo, âncoras, split/trim, histórico e geometria.
