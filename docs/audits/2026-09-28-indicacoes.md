# Auditoria do programa de indicações — 28/09/2026

## Resultado

Foram encontradas falhas reais de autorização, atribuição e contabilização. O modal foi redesenhado e as correções de banco e funções foram aplicadas ao Supabase vinculado. Links, conversões e saldos anteriores foram preservados; nenhum pagamento real foi criado para QA.

## Achados e correções

| Área | Evidência anterior | Correção |
| --- | --- | --- |
| Autorização — alta | RPC `get_or_create_referral_link` tinha EXECUTE público/anon e não validava `auth.uid() = p_user_id`; política UPDATE de referral_links usava `true` e INSERT permitia contadores arbitrários. Confirmado no catálogo remoto. | RPC restrita ao próprio usuário; inserção/alteração/exclusão do cliente revogadas; novos códigos aleatórios sem prefixo de ID do usuário. Links antigos mantidos. |
| Cadastro — alta | Signup invocava conversão antes de ter sessão e apagava o código mesmo quando `invoke` retornava erro. Confirmação por e-mail podia perder a indicação. | Código enviado nos metadados iniciais; trigger captura uma atribuição privada no INSERT de auth.users e finaliza após confirmação de e-mail/telefone, independentemente do navegador que confirma. |
| Atribuição — alta | Qualquer conta autenticada ainda sem conversão podia declarar um código depois de criada. | A função de conversão ignora IDs/códigos do corpo. Só a captura original e imutável do cadastro é elegível. Não atribui retroativamente contas antigas. |
| Contadores — média | Clique e conversão usavam leitura seguida de escrita de contador; acessos concorrentes podiam sobrescrever incrementos. | Incrementos atômicos em transação; conversão única por indicado e finalização idempotente. |
| Limite de cliques — média | Map em memória reiniciava entre instâncias/cold starts; IP era registrado em logs. | Janela persistente por hash salgado de IP + código, máximo de 5 cliques/hora; dados de janelas antigas removidos; sem log/armazenamento de IP bruto. |
| URL — média | Limpeza de `ref` removia também parâmetros como modo e o hash de autenticação, além do estado do router. | Remove somente `ref`, preservando query, hash e estado do histórico. Link de compartilhamento sempre público: https://classfy.com.br/. |
| Comissão — alta | Checkout era tratado como compra mesmo sem conferir pagamento; primeira cobrança após trial não atribuía comissão. Assinatura era gravada com ID `sub_`, incompatível com estorno por PaymentIntent. | Compras só após pagamento confirmado; assinatura no evento `invoice.payment_succeeded`, usando PaymentIntent; RPC continua atômica e paga apenas a primeira compra. Fallback de dono por metadata da assinatura para eventos fora de ordem. |
| Estornos — alta | Refund e chargeback revertiam receita/vendas, mas não a comissão da indicação. | RPC de estorno proporcional/cumulativo, com débito auditável na carteira e idempotência. Comissão líquida descontada do cálculo de receita elegível. Refund anterior ao evento de pagamento também é reconciliado. |
| Configuração — média | Taxa 0 provocava `zero_commission`, podendo travar retries de uma compra paga. Modal exibia 10% fixos. | Taxa 0 consome a primeira compra sem criar crédito zero. Modal lê o percentual vigente do banco. |
| UX — média | Emojis, títulos exagerados, R$ com ponto decimal, cópia sem aguardar resultado e materiais textuais sem arquivo apareciam “Em breve”. | Identidade Classfy, vermelho e cartões neutros, sheet mobile, loading/erro/retry, cancelamento de respostas antigas, BRL pt-BR, cópia confirmada, textos com link prontos. Links externos apenas HTTPS, com noopener. |
| Promessas — média | Promessa automática de acesso ao pool e “te paga por estudar”. | Texto descreve comissão na primeira compra paga e qualificação do pool conforme regras, sem prometer elegibilidade automática. |

## Validação executada

- Vitest: 4 testes de atribuição (preservação de URL/hash, expiração, formato e domínio público), mais regressão do hook de mini player.
- PostgreSQL isolado via PGlite: migrações reais executadas sobre fixtures mínimas; permissões de RPC, bloqueio de UPDATE, limite persistente, captura e confirmação de cadastro, imutabilidade diante de edição de metadata, idempotência, comissão única, refund parcial/total/duplicado, taxa zero e exclusão em cascata.
- Deno: 3 testes de processamento financeiro; pagamento incompleto/gratuito não credita, assinatura paga usa PaymentIntent, refund anterior é reconciliado, chargeback encaminha o estorno. Type check das 3 funções alteradas passou.
- Build Vite passou. O type check global ainda contém erros anteriores em outras áreas; nenhuma falha nas alterações de App, AuthContext, AffiliateModal ou attribution.
- Browser autenticado com dados reais: modal, URL pública, percentual vigente, métricas preservadas, cópia de link e de convite com feedback, kit de dois textos. Layout mobile sem overflow horizontal e com rolagem interna; emulação removida após QA.
- Produção: RPC anônima de criação de link retornou 401; clique inválido 400; código inexistente sintético 200 sem criar registros; conversão sem sessão válida 401. Migrações e funções implantadas via CLI vinculada.

## Limites e próximos passos

1. Cliques são uma métrica aproximada: IP compartilhado/NAT, cabeçalhos e robôs não equivalem a visitantes únicos. O limite reduz abuso básico; não substitui proteção de tráfego distribuída.
2. Confirmar um cadastro não impede alguém de criar várias contas. Para remuneração/qualificação de pool, convém avaliar contas relacionadas, compras legítimas e sinais de abuso antes de liberar saques. Não há garantia de ausência de fraude.
3. O convite é mantido neste navegador por 30 dias antes do cadastro, com a última indicação sintaticamente válida prevalecendo. Depois do cadastro, a captura no servidor permite confirmação por e-mail em outro dispositivo. Uma visita em um dispositivo seguida de cadastro independente em outro não é vinculada automaticamente. Bloqueio de storage permite retenção apenas na página atual.
4. Google/Apple estão desativados na tela atual. Ao implementar OAuth, encaminhar a atribuição inicial por um fluxo autenticado próprio; não aceitar atribuição retroativa por metadados editáveis.
5. Conversões antigas, códigos antigos e contadores não foram recalculados. Cadastros pendentes anteriores sem captura confiável não podem ser reconstruídos automaticamente. IDs históricos `sub_` de comissões não foram convertidos em PaymentIntents nem estornados retroativamente.
6. Os testes financeiros foram isolados. Não foi feita compra, refund, chargeback ou criação de usuário/e-mail reais como QA. Antes de lançamento amplo, executar roteiro integrado com Stripe em modo teste, webhook configurado e confirmação real por e-mail. Se habilitar métodos assíncronos, incluir `checkout.session.async_payment_succeeded` na assinatura do endpoint Stripe.
7. O fluxo atual de assinatura usa cartão e uma cobrança principal por invoice. Antes de habilitar faturas com múltiplos pagamentos/parcelas, modelar o vínculo de cada pagamento com a comissão; a seleção atual de PaymentIntent mantém o formato de cobrança existente.
8. Chargebacks são debitados na criação, como já ocorre com vendas. Recuperação após disputa vencida exige uma política e um fluxo de restauração para receita e comissão; não foi introduzida uma política nova nesta revisão.

## Arquivos principais

- src/components/AffiliateModal.tsx e AffiliateModal.css
- src/lib/referrals/attribution.ts e attribution.test.ts
- src/App.tsx; src/contexts/AuthContext.tsx; src/integrations/supabase/types.ts
- supabase/functions/track-referral-click; track-referral-conversion; stripe-webhook
- supabase/functions/_shared/referral-payments.ts e .test.ts
- supabase/migrations/20260928160000*, 20260928160100*, 20260928160200*
- scripts/qa/referrals-db.mjs

Para repetir a verificação SQL, instalar `@electric-sql/pglite` em diretório temporário e executar:

```sh
node scripts/qa/referrals-db.mjs /caminho/temporario/node_modules/@electric-sql/pglite/dist/index.js
```

Referência primária para a separação de checkout e pagamento: [Stripe — fulfillment de Checkout](https://docs.stripe.com/checkout/fulfillment).
