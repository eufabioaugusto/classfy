# Sistema de Contagem de Views - Classfy

## 🎯 Objetivo

Implementar um sistema seguro e à prova de fraudes para contagem de visualizações de conteúdo, garantindo que:
- Creators sejam remunerados de forma justa
- A plataforma não tenha prejuízos com views falsas
- Os dados sejam precisos para analytics

## 📊 Como Funciona

### 1. Contagem de Views Únicas

**Regra Principal**: Cada usuário gera **1 view por conteúdo por dia**

- ✅ Primeira visualização do dia = +1 view global
- ❌ Visualizações subsequentes no mesmo dia = não incrementa view global
- 📊 Todas as visualizações são registradas para analytics detalhados

### 2. Estrutura de Dados

#### Tabela `content_views`
```sql
- user_id: UUID (quem assistiu)
- content_id: UUID (o que foi assistido)
- view_date: DATE (quando foi assistido)
- view_count: INTEGER (quantas vezes assistiu neste dia)
- first_viewed_at: TIMESTAMP (primeira vez que assistiu)
- last_viewed_at: TIMESTAMP (última vez que assistiu)
- total_watch_time_seconds: INTEGER (tempo total assistido)
```

**Constraint Único**: (user_id, content_id, view_date)
- Garante apenas 1 registro por usuário/conteúdo/dia

### 3. Fluxo de Contagem

```
Usuário acessa /watch/:id
    ↓
Sistema chama increment_content_view(user_id, content_id)
    ↓
Função verifica se já existe view hoje
    ↓
Se NÃO existe:
  - Cria novo registro em content_views
  - Incrementa contents.views_count (+1)
  - Retorna { is_new_view: true }
    ↓
Se JÁ existe:
  - Atualiza registro existente (view_count, last_viewed_at)
  - NÃO incrementa contents.views_count
  - Retorna { is_new_view: false }
```

### 4. Sistema de Milestones

Os creators ganham recompensas ao atingir milestones de views:

| Views | Recompensa | Action Key |
|-------|-----------|------------|
| 100   | +50 pts, +R$ 5,00 | MILESTONE_100_VIEWS |
| 500   | +100 pts, +R$ 10,00 | MILESTONE_500_VIEWS |
| 1.000 | +200 pts, +R$ 20,00 | MILESTONE_1000_VIEWS |
| 5.000 | +500 pts, +R$ 50,00 | MILESTONE_5000_VIEWS |
| 10.000 | +1000 pts, +R$ 100,00 | MILESTONE_10000_VIEWS |

**Verificação de Milestones**:
- Automática via edge function `check-view-milestones`
- Verifica se creator já recebeu recompensa (via reward_action_tracking)
- Processa apenas milestones ainda não recompensados

## 🔒 Segurança e Anti-Fraude

### Proteções Implementadas

1. **Row Level Security (RLS)**
   - Usuários só veem suas próprias views
   - Sistema pode inserir/atualizar via SECURITY DEFINER
   - Admins podem ver todas as views

2. **Função SECURITY DEFINER**
   - Executa com privilégios do owner (não do usuário)
   - Previne bypass de RLS
   - Garante lógica consistente

3. **Constraint Único**
   - Banco de dados garante unicidade
   - Impossível duplicar view no mesmo dia
   - Proteção em nível de DB (mais segura)

4. **Tracking de Recompensas**
   - Milestones verificados via reward_action_tracking
   - Impossível receber mesma recompensa duas vezes
   - Auditoria completa de todas as recompensas

## 📈 Analytics Disponíveis

Com a tabela `content_views`, é possível:

1. **Views únicas por período**
   ```sql
   SELECT COUNT(DISTINCT user_id) as unique_viewers
   FROM content_views
   WHERE content_id = 'xxx'
   AND view_date BETWEEN '2024-01-01' AND '2024-01-31'
   ```

2. **Engagement por usuário**
   ```sql
   SELECT user_id, SUM(view_count) as total_views, 
          SUM(total_watch_time_seconds) as total_time
   FROM content_views
   WHERE content_id = 'xxx'
   GROUP BY user_id
   ```

3. **Evolução temporal**
   ```sql
   SELECT view_date, COUNT(*) as unique_viewers,
          SUM(view_count) as total_views
   FROM content_views
   WHERE content_id = 'xxx'
   GROUP BY view_date
   ORDER BY view_date
   ```

## 🚀 Performance

### Índices Criados

1. `idx_content_views_user_content` - (user_id, content_id)
   - Otimiza verificação de view existente
   
2. `idx_content_views_content_date` - (content_id, view_date)
   - Otimiza queries de analytics por período
   
3. `idx_content_views_date` - (view_date)
   - Otimiza limpeza de dados antigos

### Estimativa de Crescimento

Com 10.000 usuários ativos assistindo 5 conteúdos/dia:
- 50.000 registros/dia
- 1.5M registros/mês
- 18M registros/ano

**Recomendação**: Arquivar dados com mais de 6 meses para tabela histórica.

## 🔄 Migração de Dados Existentes

Se existem views antigas sem tracking:
```sql
-- Resetar views_count (opcional, se quiser começar do zero)
UPDATE contents SET views_count = 0;

-- OU manter views antigas e começar novo tracking
-- (sistema continuará funcionando normalmente)
```

## 📝 Notas Importantes

1. **Views de Admins**: Não são contadas quando preview de conteúdo pending
2. **Views Anônimas**: Requerem autenticação (user_id obrigatório)
3. **Cooldown**: 24h (baseado em data, não timestamp)
4. **Timezone**: Sistema usa UTC (considerar ao analisar dados)

## 🛠️ Manutenção

### Limpeza de Dados Antigos (opcional)
```sql
-- Arquivar views com mais de 6 meses
INSERT INTO content_views_archive
SELECT * FROM content_views
WHERE view_date < CURRENT_DATE - INTERVAL '6 months';

DELETE FROM content_views
WHERE view_date < CURRENT_DATE - INTERVAL '6 months';
```

### Verificar Integridade
```sql
-- Verificar consistência entre views_count e content_views
SELECT 
  c.id,
  c.title,
  c.views_count as global_count,
  COUNT(DISTINCT cv.user_id) as unique_viewers,
  SUM(cv.view_count) as total_views
FROM contents c
LEFT JOIN content_views cv ON cv.content_id = c.id
GROUP BY c.id, c.title, c.views_count
HAVING c.views_count != COUNT(DISTINCT cv.user_id);
```
