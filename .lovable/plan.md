

# Multiplicador de Consistência + Suavização de Curva — IMPLEMENTADO ✅

## O que foi feito

### 1. Função SQL `get_user_active_days` + `get_consistency_multiplier`
- Conta dias distintos com ações no ciclo atual
- Retorna multiplicador: 1.0x (<15d), 1.1x (15-19d), 1.2x (20-24d), 1.3x (25+d)

### 2. `process-reward/index.ts` — Multiplicador de Consistência
- Busca dias ativos do usuário no ciclo via RPC
- Aplica multiplicador nos Performance Points (PP) de usuário E creator
- Registra `consistency_multiplier` e `active_days` no metadata para auditoria

### 3. `close-economic-cycle/index.ts` — Buffer de Suavização
- 5% do PRM reservado como buffer de transição
- Compara valor-por-ponto com ciclo anterior
- Se queda > 40%, usa buffer para compensar até 20% da diferença
- Se não há queda brusca, buffer é redistribuído normalmente
- Resultado inclui detalhes do buffer usado

### 4. `PoolSimulator.tsx` — Simulação com Consistência
- Seletor de tier de consistência (< 15 dias, 15-19, 20-24, 25+)
- Mostra bônus de consistência separado no resultado
- Calcula PP com multiplicador aplicado
