# Linguagem Visual Transversal — Classfy Web V2

Esta especificação é a referência oficial para qualquer evolução visual da Classfy Web. O Design System não determina que páginas diferentes tenham o mesmo layout. Ele garante que todas usem o mesmo vocabulário visual e de interação.

**Referência:** facilidade e previsibilidade do YouTube, presença editorial e cinematográfica da MasterClass, identidade final própria da Classfy.

## 1. Camada imutável em toda a plataforma

| Elemento | Regra transversal |
| --- | --- |
| Tipografia | Sans oficial para produto, dados e navegação. Editorial apenas em identidade de creator, campanha ou título inserido na própria mídia. A hierarquia usa a escala `display / title / section / body / small / label`. |
| Espaçamento | Ritmo de 4 px e tokens `space-1` a `space-9`. Não criar valores arbitrários para resolver uma tela isolada. |
| Radius | `control` para ações e campos, `media` para thumbnails/player, `card` para unidades de conteúdo, `panel` para superfícies de decisão e `pill` apenas para controles circulares/chips. |
| Superfícies | `canvas`, `canvas-soft`, `surface`, `surface-raised` e `surface-strong` representam profundidade. Cor decorativa não cria hierarquia. |
| Bordas e sombras | Bordas separam estruturas. Sombras ficam reservadas para elevação real: menus, dialogs, sheets e painéis sobrepostos. |
| Ícones | Uma única família linear, preferencialmente Lucide, com peso visual consistente. Monocromáticos por padrão; cor apenas para marca, plano, estado ou ação destrutiva. |
| Botões | Hierarquia fixa: `primary`, `secondary`, `quiet`, `danger`; tamanhos `sm`, `md`, `lg`, `icon`. Uma ação primária evidente por contexto. |
| Inputs | Mesma altura, label, hint, erro, foco e estado disabled. Placeholder nunca substitui label quando a informação precisa permanecer visível. |
| Badges | Informam plano, estado ou categoria. Não são decoração. Texto curto, contraste validado e sem coleção de cores aleatórias. |
| Menus | Ação + contexto + consequência previsível. Itens perigosos separados e explicitamente identificados. |
| Dialogs e sheets | Radix mantém comportamento/acessibilidade; V2 mantém overlay, superfície sólida, espaçamento e hierarquia. Dialog para decisão; Sheet para contexto complementar ou edição lateral. Confirmações destrutivas usam `V2ConfirmDialog`, com consequência clara, itens afetados e ações ancoradas no rodapé. |
| Seleção de capa | Buscar um frame nunca confirma a escolha durante o arraste. A capa é uma única superfície com frame do vídeo ou imagem da galeria e sempre oferece confirmação, troca e remoção explícitas. |
| Estados | `LoadingState`, `EmptyState` e `ErrorState` preservam o espaço da experiência, explicam o estado e oferecem a próxima ação quando existe. |
| Feedback | Toast confirma ação transitória; estado persistente fica na própria tela. Erro financeiro, publicação ou permissão nunca depende apenas de toast. |
| Dark/light | Mesma hierarquia semântica nos dois temas, com valores próprios de canvas, superfície, tinta, borda, overlay e sombra. Não inverter cores mecanicamente. |
| Free / PRO / Premium | Free é neutro/verde discreto; PRO usa azul moderado; Premium usa dourado sóbrio. Plano comunica status e valor, sem contaminar toda a interface. |
| Interação | Duração curta, easing único, foco visível, hover discreto e movimento removível por `prefers-reduced-motion`. Nada essencial depende apenas de hover. |

As implementações desses contratos vivem em `src/styles/classfy-v2.css`, `src/components/v2` e nos primitives Radix já adotados.

## 2. Camada variável por experiência

Podem variar, desde que usem os contratos transversais: shell, presença ou ausência de Sidebar/Header, largura, gutter, densidade, grid, quantidade de colunas, hero, proporção de mídia, ordem da composição, navegação contextual e nível de imersividade.

O `AppShell` fornece infraestrutura quando necessário. Ele não define o layout interno nem obriga Watch, Upload, Wallet e Home a parecerem a mesma tela.

## 3. Famílias de experiência

| Família | Objetivo | Estrutura base | Densidade | Navegação | Componentes predominantes |
| --- | --- | --- | --- | --- | --- |
| Exploração | Descobrir conteúdo e pessoas | lead/hero + trilhos ou grids editoriais | respirada | AppShell + busca + navegação de seção | mídia, creators, rails, cards, section headers |
| Consumo | Manter foco no conteúdo | mídia dominante + contexto + próximo conteúdo | imersiva | shell reduzido/especial | player, controles, progresso, metadata, recomendações |
| Biblioteca | Retomar e organizar | header + filtros + coleção | confortável/compacta | AppShell + busca/filtros locais | listas, cards, tabs, empty/loading states |
| Economia | Entender valor e executar ações seguras | resumo + estado + histórico/ação | confortável | AppShell + ações explícitas | métricas, ledger, planos, badges, dialogs |
| Creator / Studio | Criar e gerir operação | contexto + toolbar + workspace + dados | compacta | AppShell ou fluxo focado | formulários, workflow, métricas, tabelas, sheets |
| Administração | Revisar, decidir e operar | toolbar/filtros + tabela/painel | compacta | AppShell administrativo | tabelas, filtros, estados, ações em lote, confirmação |

## 4. Templates base

Os templates em `src/components/templates` organizam slots de `header`, `lead`, `toolbar`, `content`, `aside` e `footer`. Eles não trazem dados, regras de negócio ou componentes específicos de uma página.

- `ExplorationTemplate`: editorial, largo e orientado a mídia.
- `ConsumptionTemplate`: full width e imersivo.
- `LibraryTemplate`: coleção escaneável com busca e filtros.
- `EconomyTemplate`: largura controlada e hierarquia de números/status.
- `CreatorTemplate`: workspace amplo e operacional.
- `AdminTemplate`: alta densidade e máxima área útil.

Cada template aceita variações justificadas de densidade e largura sem quebrar a linguagem comum.

## 5. Regra de evolução de telas

Antes de alterar uma página:

1. localizar a página em `src/config/experienceFamilies.ts`;
2. confirmar a família e o template;
3. preservar o shell especial quando indicado;
4. escolher primitives compartilhados;
5. definir apenas as decisões específicas que a função daquela tela exige;
6. validar dark, light, teclado/foco e responsividade web.

Uma nova necessidade recorrente entra primeiro na linguagem transversal. Uma necessidade exclusiva permanece na página e não vira primitive global prematuramente.

## 6. Mapa atual

| Página/rota | Família | Template | Compartilhados principais |
| --- | --- | --- | --- |
| Home, perfis públicos | Exploração | ExplorationTemplate | AppShell, MediaFrame, CreatorIdentity, SectionHeader, Badge |
| Watch, Listen, Shorts, Live, Study | Consumo | ConsumptionTemplate | Media Layer, controles, progresso, estados |
| Histórico, Favoritos, Salvos, Conta, Messages | Biblioteca | LibraryTemplate | AppShell, PageHeader, filtros, listas, EmptyState |
| Recompensas, histórico, Carteira, Planos | Economia | EconomyTemplate | AppShell, MetricCard, Table, Badge, Dialog |
| Studio, Uploads, Analytics, Boosts, Lives | Creator | CreatorTemplate | AppShell ou shell focado, PageHeader, forms, métricas, tabelas |
| `/admin/*` | Administração | AdminTemplate | AppShell, PageHeader, filtros, Table, Badge, Dialog, Sheet |
| Auth, Reset, NotFound, laboratórios | Especial | Shell próprio | tokens e primitives V2, sem template de produto obrigatório |
