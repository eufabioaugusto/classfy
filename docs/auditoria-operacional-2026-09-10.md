# Auditoria operacional da Classfy — 10/09/2026

## 1. Veredito

**Não pronta para abrir a usuários reais.**

A plataforma já possui jornadas funcionais e uma base financeira mais estruturada do que a interface deixa aparente, mas a regra econômica declarada para checkpoints não corresponde ao motor atualmente implementado. O hardening técnico foi aplicado no Supabase de produção em 10/09/2026; ainda é necessário homologar as jornadas transacionais completas antes da abertura.

O veredito não significa que a Classfy precise de uma grande refatoração. Significa que é necessário fechar as decisões e testes listados em “Próximo passo” antes de convidar usuários reais.

## 2. Top bloqueadores

1. **P0 corrigido e aplicado:** o cliente autenticado podia inserir `purchased_contents` e, assim, autoconceder acesso a material pago. A nova migration remove essa policy.
2. **P0 corrigido e aplicado:** `process-reward`, `reverse-reward`, `activate-boost`, `record-revenue` e o fechamento de ciclo tinham caminhos que aceitavam identidade/origem insuficientemente comprovadas. As funções agora vinculam o JWT ao usuário, exigem evidência persistida ou `service_role`, e usam commits transacionais nas operações de reward.
3. **P0 corrigido e aplicado:** o webhook Stripe aceitava JSON sem assinatura quando o secret/header não estava presente. Agora falha fechado e libera o ID do evento quando uma etapa crítica falha, permitindo retry.
4. **P1 em aberto — decisão de negócio:** não existe no motor encontrado a tabela manual crescente baseada exclusivamente em usuários pagantes PRO + Premium. O código usa qualificação por atividade, multiplicadores por plano e inclui Free. Não é seguro escolher uma das regras sem decisão do negócio.
5. **P1 em aberto — homologação:** checkout, webhook, mudança de plano, compra avulsa, reward, fechamento de ciclo e saque precisam de uma rodada E2E em modo de teste com contas Free/PRO/Premium/Creator/Admin antes da abertura.

## 3. Motor de recompensas encontrado

### Fluxo real

`evento no cliente → process-reward → reward_actions_config → multiplicadores em platform_settings.economic → reward_action_tracking → reward_events → economic_cycle_users → fechamento mensal → wallet_transactions + wallets`

- Os eventos de interface passam por `src/hooks/useRewardSystem.ts` e por chamadas equivalentes no mobile.
- Os valores-base de pontos vêm de `reward_actions_config`. No snapshot de produção auditado, `value_user` e `value_creator` estavam zerados: não há crédito direto em reais por ação.
- O plano vem de `profiles.plan`; os multiplicadores econômicos vêm de `platform_settings` com fallback no código.
- `reward_action_tracking` é a chave de idempotência por usuário/ação/conteúdo/data.
- `reward_events` é o histórico de pontos/PP.
- `economic_cycle_users.performance_points` acumula a participação no ciclo.
- A receita elegível vai para `revenue_entries`; o fechamento calcula o pool usando 40% e distribui para carteira.
- A carteira possui ledger (`wallet_transactions`) e reconciliação (`v_wallet_ledger`). No snapshot auditado não havia drift diferente de zero.

### Eventos localizados

- Usuário: `DAILY_LOGIN`, `WEEKLY_STREAK`, `FIRST_CONTENT_WEEK`, `BINGE_WATCH`, `VIEW_15S`, `WATCH_50`, `WATCH_100`, `LIKE_CONTENT`, `SAVE_CONTENT`, `FAVORITE_CONTENT`, `COMMENT_CONTENT`, `SHARE_CONTENT`, `SUBSCRIBE_CREATOR`, `COMPLETE_COURSE`, `PROFILE_COMPLETE`.
- Creator: contrapartida em ações sobre conteúdo, `CONTENT_APPROVED`, `FIRST_UPLOAD`, milestones de creator e milestones de views.
- Há limites diários e retorno decrescente para ações repetíveis.

### Inconsistências e riscos

- **Regra declarada x código:** os checkpoints manuais por número de assinantes pagos não existem como fonte de verdade. O código usa checkpoints de atividade e multiplicadores Free/PRO/Premium.
- **Free participa do motor:** produção tinha multiplicador Free `0,1`; isso contradiz a regra de que Free não entra no checkpoint de pagantes, embora “checkpoint” e “participação no pool” possam ser conceitos diferentes. Requer definição explícita.
- **Múltiplas versões:** milestones de view existem em trigger SQL e em Edge Functions (`check-view-milestones`/`sync-view-milestones`) com tabelas de faixas/multiplicadores diferentes.
- **Creator em aprovação:** `CONTENT_APPROVED` é chamado com o creator como ator; a função historicamente aplica `points_user`, enquanto interfaces antigas exibiam `points_creator` e até fallback de R$ 5. A mensagem monetária falsa foi removida, mas a coluna correta precisa de decisão de negócio.
- **Idempotência anterior era parcial:** tracking, evento e acumulador eram gravados separadamente. A migration cria `commit_reward_award` e `reverse_reward_award`, ambos transacionais e exclusivos de `service_role`.
- **Evidência de ação:** o servidor agora confere a identidade e uma linha correspondente (like, comentário, follow, progresso etc.). Como parte dessas métricas ainda é escrita pelo próprio usuário, isso é proteção operacional básica, não antifraude avançado. Com 0 usuários, a recomendação é manter fechamento/pagamento manual e revisar anomalias no beta.
- **Carry-over:** o fechamento chamava uma função que varria todos os usuários dentro do loop de cada usuário, podendo somar os mesmos PP repetidamente. A chamada passou a ser única e a RPC ficou idempotente por `payout_status`.

## 4. Matriz de perfis e permissões

| Estado | Conteúdo | Planos/benefícios | Creator/publicação | Admin/financeiro | Classy |
|---|---|---|---|---|---|
| Deslogado | Nenhum conteúdo; deve ir para `/auth` | Nenhum | Nenhum | Nenhum | Nenhum |
| Free | Conteúdo `visibility=free` após login | Sem PRO/Premium | Não publica | Própria carteira/leitura | 5 estudos totais |
| PRO | Free + PRO | `profiles.plan=pro` | Igual ao papel do usuário | Própria carteira/leitura | 50 estudos totais |
| Premium | Free + PRO + Premium | `profiles.plan=premium` | Igual ao papel do usuário | Própria carteira/leitura | Ilimitado |
| Creator Free | Conforme Free | Conforme Free | Só após role `creator` + `creator_status=approved`; submissão deve entrar `pending` | Próprios ganhos/saques | 5 |
| Creator + PRO | Conforme PRO | Conforme PRO | Igual ao creator aprovado | Idem | 50 |
| Creator + Premium | Todo conteúdo por plano; compra avulsa continua registrada | Conforme Premium | Igual ao creator aprovado | Idem | Ilimitado |
| Admin | Todos os itens por regra administrativa | Pode gerir plano | Aprova/reprova/publica | Gestão protegida server-side | Conforme plano do perfil |

### Fontes de verdade e conflitos

- Papel: `user_roles.role` (`admin`, `creator`, `user`).
- Plano: `profiles.plan` e `profiles.plan_expires_at`.
- Creator: role `creator` **e** `profiles.creator_status=approved`.
- Stripe: não existe uma tabela local de assinatura completa; o webhook/sync projeta o estado em `profiles.plan`.
- `past_due` é tratado como plano ativo. Isso pode ser uma carência intencional, mas não está formalizado.
- Campos legados `is_free` e `required_plan` ainda coexistem com `visibility`; componentes diferentes podem interpretar acesso de formas diferentes.
- A migration impede alteração de `plan`, expiração, `billing_id` e transições privilegiadas de creator pelo update genérico do próprio perfil.

## 5. Financeiro

### Stripe e assinatura

- Checkout vincula o JWT ao usuário e usa preços/produtos server-side.
- Webhook agora exige assinatura Stripe; produto desconhecido deixa de cair silenciosamente em PRO.
- IDs de evento são deduplicados em `stripe_events_processed`.
- Erros críticos de compra/plano/receita deixam de ser apenas logados; o evento é liberado para retry.
- Compra avulsa usa `session.amount_total`, não o preço vindo de metadata.
- Ainda falta uma regra de ordenação/versionamento para eventos Stripe fora de ordem.
- `past_due` manter acesso é decisão pendente.

### Carteira

- Fonte contábil auditável: `wallet_transactions`; saldo materializado: `wallets`.
- Saque direto foi substituído por `request_withdrawal`, que bloqueia a carteira, considera saques pendentes e impede reserva acima do saldo.
- Aprovação usa RPC server-side com validação de admin, débito atômico e chave idempotente.
- Snapshot de produção: 14 carteiras, 3 transações, 2 saques e nenhum drift no ledger.
- Deve ser possível explicar “por que R$ X” pelo ledger após a migration; qualquer alteração manual de saldo fora das RPCs deve ser tratada como incidente.

## 6. Segurança e RLS

### P0/P1 corrigidos e aplicados

- Remoção de INSERT de compra paga pelo cliente.
- Remoção de mutações amplas em reward, tracking, ciclo, receita, creator milestone, referrals e tabelas operacionais.
- Revogação de RPCs econômicas para `anon`/`authenticated`.
- Proteção de plano/billing/creator status por trigger.
- Proteção de status/publicação/autoria de conteúdo por trigger e policies de creator aprovado.
- Views não aceitam mais `p_user_id` diferente de `auth.uid()` e view própria do creator não incrementa audiência.
- Upload Mux exige creator aprovado ou admin.
- Conteúdo, cursos e lives deixam de ser legíveis anonimamente.

### Riscos restantes

- Usuários autenticados ainda leem linhas completas de outros perfis, inclusive campos operacionais como `plan`/`billing_id`, porque a tabela mistura perfil público e billing. Separar a leitura pública em view/RPC é P1, sem necessidade de remodelar autenticação.
- Progresso e métricas de playback são client-writable. Os limites/idempotência reduzem abuso simples, mas a elegibilidade financeira baseada em playback ainda merece teste adversarial no beta.
- Policies históricas usam nomes genéricos e foram criadas em muitas migrations; a verificação pós-deploy deve confirmar a lista efetiva em `pg_policies`.

## 7. Código legado e duplicado

- Não foi encontrada dependência operacional Firebase/Firestore.
- Bunny permanece como provider legado/fallback; isso é aceitável para rollback, mas `file_url`, `video_url` e URLs Bunny ainda aparecem fora da Media Layer.
- A web usa a nova Media Layer/Mux; o mobile ainda tem caminhos diretos de `file_url` e precisa convergir antes de o app mobile ser considerado pronto.
- Transcrição automática busca `content.file_url`; itens Mux com URI `media:` podem não ser transcritos pelo caminho atual.
- `visibility`, `is_free` e `required_plan` são três representações de acesso.
- Milestones de views têm trigger SQL e Edge Functions concorrentes.
- `profiles.plan` é a projeção prática de entitlement; não existe `subscription_status` local completo. Não adicionar outro boolean: documentar e manter uma projeção única.
- `/Users/fabio/classfy-creators` contém landing estática e não participa dos fluxos operacionais auditados.

## 8. Priorização completa

### P0 — corrigidos, aplicados e verificados por smoke test

- Autoconcessão de material pago por INSERT em `purchased_contents`.
- Webhook Stripe sem assinatura em configuração incompleta.
- Ativação de boost e receita invocáveis sem comprovação de origem suficiente.
- Reward/reversão para identidade arbitrária e gravações financeiras não transacionais.
- RPCs econômicas privilegiadas expostas a papéis de cliente.

### P1 — antes dos primeiros usuários reais

- Decidir e implementar a regra oficial do checkpoint manual crescente de pagantes PRO + Premium.
- Separar campos públicos de perfil dos campos privados de billing/entitlement.
- Executar E2E financeiro/reward por persona com Stripe test mode e banco de produção controlado.
- Resolver a política para `past_due` e eventos Stripe fora de ordem.
- Unificar milestones de views e definir `points_user` x `points_creator` em aprovação.
- Ocultar/rotular Lives como indisponível enquanto transmissão e gifts forem placeholders.
- Manter a disciplina do histórico de migrations, agora reconciliado com o projeto remoto.

### P2 — durante/depois do beta

- Convergir mobile para Media Layer/Mux e remover dependência direta de URL legada.
- Adaptar transcrição para `media_assets`/provider.
- Consolidar `visibility` versus `is_free`/`required_plan`.
- Tornar métricas de playback menos confiantes no cliente se o beta mostrar abuso.
- Corrigir backlog global de lint e warnings de hooks.

### P3 — escala/refinamento

- Antifraude comportamental avançado.
- Observabilidade/analytics enterprise.
- Otimização de chunks grandes e arquitetura de escala.

## 9. Correções realizadas

- `supabase/migrations/20260910160000_prelaunch_operational_hardening.sql`: RLS, triggers, saques, views, limite Classy, rewards e carry-over transacionais.
- `supabase/functions/process-reward/index.ts`: autenticação, vínculo de identidade, evidência, limites e commit atômico.
- `supabase/functions/reverse-reward/index.ts`: autorização e reversão atômica.
- `supabase/functions/stripe-webhook/index.ts` e `_shared/stripe-subscription.ts`: assinatura obrigatória, retry seguro, valor Stripe e produto desconhecido.
- `activate-boost`, `record-revenue`, `close-economic-cycle`: origem privilegiada, validações e fechamento/carry-over seguro.
- `claim-creator-milestone` e `check-creator-milestones`: creator aprovado, progresso real, idempotência e mensagens sem promessa falsa de dinheiro direto.
- `approve-content`: remove fallback de R$ 5 e descreve corretamente PP/pool.
- `video-create-upload`: apenas creator aprovado/admin.
- Hooks/páginas de acesso: nenhum conteúdo para deslogado.
- `useStudies`: limite total, não apenas estudos ativos; banco também impõe 5/50/ilimitado.
- Carteira web/mobile: saque via RPC segura.
- Boost success: não ativa boost pelo navegador; aguarda webhook.
- Produção: migration de hardening aplicada e 10 Edge Functions críticas republicadas.
- Histórico Supabase: migrations remotas ausentes foram recuperadas no repositório e as versões locais já existentes no banco foram reconciliadas.

## 10. Testes executados

- `npm run build`: **passou**.
- `npx tsc --noEmit`: **passou**.
- `deno check` nas 10 Edge Functions alteradas/críticas: **passou**.
- ESLint apenas nos arquivos alterados: **0 erros**, warnings legados.
- ESLint global: **falhou com 21 erros e 661 warnings preexistentes**; não são causados por esta alteração e devem virar backlog P2.
- `git diff --check`: **passou**.
- Banco de produção antes do hardening: probes anon retornavam dados de `contents`, `courses`, `profiles` e `lives`, confirmando o vazamento de leitura.
- Smoke test pós-deploy: os quatro endpoints anônimos passaram a retornar `[]`; `activate-boost` e `close-economic-cycle` sem usuário retornaram 401; `process-reward` sem usuário retornou 401 para ação permitida ao cliente; webhook Stripe sem assinatura retornou 400.
- Não há suíte automatizada de testes de negócio no `package.json`.

## 11. Próximo passo (máximo 5)

1. Formalizar em uma página a regra do checkpoint: faixas, quem conta, quando sobe e como afeta Free/Creator.
2. Rodar matriz E2E em Stripe test mode: Free, PRO, Premium, Creator, Admin e usuário malicioso simples.
3. Criar uma leitura pública segura de perfil sem `billing_id`/campos financeiros.
4. Definir `past_due`, ordenação de eventos Stripe e a regra creator na aprovação/milestones.
5. Só então abrir um beta pequeno, com fechamento de ciclo e saques mantidos sob revisão manual.
