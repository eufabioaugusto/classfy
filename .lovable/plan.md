

## Plano: Multiplicador de Consistência + Suavização de Curva de Crescimento

### Contexto (alinhamento com sua visão)

Entendi seus pontos:
- **Meritocracia**: quem se dedica mais, ganha mais. Sem cap artificial. Correto.
- **Valor alto no início**: justo, quem está ativo merece. OK.
- **Problema real**: a **queda brusca** de ganho conforme a base cresce. Se de um mês pro outro entram 100 usuários, o valor por ponto cai drasticamente e o usuário ativo sente uma perda injusta.
- **Consistência**: recompensar quem está presente todos os dias vs. quem faz burst de ações em 2 dias.

### O que precisa ser feito

**1. Multiplicador de Consistência (processo-reward)**

Usuários ativos por 20+ dias no mês ganham 1.2x nos seus PP. Ativos 25+ dias ganham 1.3x. Isso diferencia quem é fiel da plataforma vs. quem aparece esporadicamente.

- Na `process-reward`, ao calcular `performancePoints`, verificar quantos dias distintos o usuário já tem ações no ciclo atual (query em `reward_action_tracking` com `COUNT(DISTINCT DATE(created_at))`)
- Aplicar multiplicador: 1-14 dias = 1.0x, 15-19 dias = 1.1x, 20-24 dias = 1.2x, 25+ dias = 1.3x
- Registrar o multiplicador no metadata do `reward_event` para auditoria

**2. Suavização de transição entre ciclos (close-economic-cycle)**

Para evitar que um usuário que ganhava R$ 50/mês de repente ganhe R$ 5 no mês seguinte porque a base triplicou:

- No fechamento do ciclo, calcular a variação do valor-por-ponto vs. ciclo anterior
- Se a queda for > 40%, aplicar um "amortecedor": distribuir um bônus compensatório de até 20% da diferença, usando uma reserva do pool (ex: 5% do PRM fica como buffer de transição)
- Isso é implementado no `close-economic-cycle`: antes de distribuir, separar 5% como buffer. Se não houver queda brusca, o buffer é distribuído normalmente. Se houver, ele suaviza.

**3. Migration: tabela de tracking de dias ativos**

Criar uma view ou função que conta dias ativos por usuário por ciclo, para não precisar fazer query pesada a cada reward.

```sql
-- Função para contar dias ativos do usuário no ciclo atual
CREATE FUNCTION get_user_active_days(p_user_id UUID, p_cycle_start DATE)
RETURNS INTEGER
```

### Mudanças por arquivo

| Arquivo | Mudança |
|---------|---------|
| `process-reward/index.ts` | Adicionar lookup de dias ativos + multiplicador de consistência nos PP |
| `close-economic-cycle/index.ts` | Adicionar lógica de buffer 5% + suavização de queda brusca |
| Migration SQL | Função `get_user_active_days()` |
| `PoolSimulator.tsx` | Mostrar multiplicador de consistência na simulação |

### Resultado esperado

- Usuário fiel (20+ dias/mês) ganha até 30% mais PP que um esporádico com mesma quantidade de ações
- Crescimento da base não causa choque de receita: buffer de 5% suaviza quedas > 40%
- Sistema continua 100% meritocrático, sem caps artificiais

