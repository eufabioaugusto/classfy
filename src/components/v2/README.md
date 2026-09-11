# Classfy Web V2

Esta pasta contém a fundação visual aprovada da Classfy Web. A adoção é propositalmente gradual: envolver uma tela ou região com `ClassfyV2Scope` ativa os tokens e primitives V2 sem modificar páginas legadas.

## Fonte de verdade

- Tokens semânticos, temas, espaçamento, tipografia e estilos-base: `src/styles/classfy-v2.css`.
- Componentes reutilizáveis: `src/components/v2/ClassfyV2.tsx`.
- Shell e ritmo de página: `src/components/layout/AppShell.tsx` e `src/components/layout/Page.tsx`.
- Navegação compartilhada entre Header e Sidebar: `src/config/navigation.ts`.
- Referência visual viva: `/lab/front-v2`.

Não duplicar cores ou decisões visuais em páginas. Quando uma necessidade recorrente não estiver representada, ela deve entrar primeiro na fundação e depois ser consumida pela tela.

## Princípios de aplicação

1. Pessoas e conteúdo carregam a presença visual; a interface organiza e recua.
2. Fotografia editorial e thumbnails reais têm prioridade sobre ilustrações ou gradientes decorativos.
3. Cor indica marca, plano ou estado. Não usar conjuntos de ícones coloridos apenas para ornamentar.
4. Áreas de consumo podem ser densas e práticas; páginas de decisão recebem mais respiro.
5. Dark e light devem ser tratados como experiências completas, não como simples inversão.
6. Comportamento acessível de dialog, sheet, menu e tooltip continua apoiado nos primitives Radix existentes; a V2 fornece a superfície visual.

## Estrutura oficial

- Páginas comuns usam `AppShell`, que centraliza `SidebarProvider`, `AppSidebar`, `Header` e o escopo V2.
- `PageContainer` controla largura e respiro; `PageHeader` e `SectionHeader` controlam hierarquia.
- Estados recorrentes usam `LoadingState`, `ErrorState` e `EmptyState`.
- Cards, métricas, badges, tabelas, dialogs e sheets devem ser importados de `@/components/v2` quando a página for migrada.
- Watch, Shorts, Study, Auth e Lives mantêm shells próprios por serem experiências imersivas.
- `AdminLayout` existe apenas como adaptador temporário para páginas administrativas antigas; não deve ser usado em novas páginas.

## Identidade dos creators

Nos cards, heroes e páginas editoriais, a identidade cadastrada pelo Admin continua soberana. `background_image_url`, `featured_image_url`, `badge_text` e demais materiais do creator não devem ser substituídos por tipografia genérica. A V2 define enquadramento, contraste, espaçamento, hierarquia e responsividade ao redor desses ativos.

## Migração de telas

Cada tela deve ser revisada antes da migração. O processo esperado é:

1. preservar regras e interações funcionais;
2. envolver a superfície em `ClassfyV2Scope`;
3. substituir padrões locais por primitives V2;
4. remover hardcodes visuais apenas daquela tela;
5. validar dark, light e responsividade;
6. manter o laboratório atualizado quando surgir um padrão realmente reutilizável.
