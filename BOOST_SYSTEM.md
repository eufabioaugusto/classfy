# Sistema de Boost (Anúncios)

## Visão Geral
Sistema de impulsionamento de conteúdo e perfil, similar ao Instagram Ads. Permite creators promoverem seu conteúdo para aparecer nas primeiras posições.

## Funcionalidades

### Fluxo de Criação (5 Etapas)
1. **Objetivo**: Escolher entre impulsionar perfil ou conteúdo específico
2. **Público**: Automático (algoritmo) ou segmentado
3. **Orçamento**: R$ 1 a R$ 1000 por dia
4. **Duração**: 1 a 30 dias
5. **Pagamento**: Integração com Stripe

### Tabelas
- `boosts`: Armazena campanhas de boost
  - Controle de orçamento (diário e total)
  - Status do boost (pending_payment, active, paused, completed, cancelled)
  - Métricas (impressões, cliques)
  - Datas de início e fim

### Componentes
- `BoostModal`: Modal com 5 etapas para criar boost
- `StudioBoosts`: Página de gerenciamento de boosts ativos
- `BoostSuccess`: Página de confirmação após pagamento

### Edge Functions
- `create-boost-payment`: Cria sessão de pagamento Stripe
- `activate-boost`: Ativa boost após pagamento confirmado

### Priorização
- Conteúdo impulsionado aparece com badge "Anúncio"
- Queries priorizam conteúdo boosted
- Function `is_content_boosted()` verifica status

## Integração Stripe
- Pagamento único por campanha (total_budget = daily_budget × duration_days)
- Valores em BRL (centavos)
- Checkout em nova aba
