# Assinaturas web com Stripe Elements

O checkout de `/planos`, Conta, ofertas de upgrade e Cenas Premium abre um modal central da Classfy. A assinatura nova usa Checkout Sessions com `ui_mode: custom`; o upgrade Pro → Premium apresenta a prévia proporcional antes da confirmação explícita. O gerenciamento avançado continua no Customer Portal da Stripe, na mesma aba.

## Contrato e segurança

- `web-subscription-checkout`: ações `prepare`, `confirm_upgrade`, `status` e `cancel`, sempre autenticadas e vinculadas ao usuário.
- Valores e IDs de preços são definidos no servidor. A prévia vence em cinco minutos; a Checkout Session vence em uma hora.
- Uma trava por usuário e um registro durável das operações compartilham idempotência com `create-subscription-checkout`, que mantém o contrato de URL para consumidores antigos.
- Pagamentos e 3DS pendentes retomam a mesma operação. A interface libera o plano somente após a confirmação do servidor; resultado do SDK sozinho não concede acesso.
- Troca de conta descarta resultados antigos. O retorno consulta a sessão, PaymentIntent/assinatura ou assinatura existente e limpa os parâmetros de pagamento da URL.
- O modal cede foco ao iframe bancário e sai de fullscreen antes da autenticação, preservando o formulário e a sessão.
- Downgrade Premium → Pro futuro preserva os campos pendentes e não oferece outro upgrade pago no intervalo.

## Dependências de produção

1. Aplicar `20261011150000_web_subscription_checkout_operations.sql` antes dos dois endpoints.
2. Configurar `STRIPE_PUBLISHABLE_KEY`, da mesma conta e modo da `STRIPE_SECRET_KEY`. Nunca registrar valores de chaves em documentação.
3. Publicar `web-subscription-checkout` e `create-subscription-checkout` antes do frontend.

O SDK servidor é Stripe 18.5/API `2025-08-27.basil`; frontend React Stripe 5.4.1/Stripe.js 8.7.0. Não trocar `custom` pelo nome encontrado em documentação de uma versão diferente sem migrar o contrato inteiro.

Na implantação inicial havia uma migration local antiga não aplicada (`20261004120000`). Um diretório temporário manteve todos os arquivos correspondentes ao histórico remoto, omitiu somente essa pendência e acrescentou a migration nova. O `db push --dry-run` confirmou exatamente um arquivo antes da aplicação. Não aplicar pendências históricas junto com este checkout nem reparar o histórico para contornar divergências.

## Validação

```sh
npx vitest run src shared/studio --environment jsdom
deno test --allow-env supabase/functions/_shared/web-subscription-checkout_test.ts supabase/functions/_shared/stripe-subscription_test.ts
deno check supabase/functions/web-subscription-checkout/index.ts supabase/functions/create-subscription-checkout/index.ts
npm run build
```

O comando Vitest é escopado ao frontend porque `npm test` também encontra um arquivo de teste Deno preexistente. O typecheck global tem erros preexistentes em outros módulos; comparar com `main` e verificar os arquivos de cobrança separadamente.

QA de navegador usa rede e Stripe sintéticos: recusa/retry, 3DS, confirmação pendente, troca de usuário, upgrade, retorno, quatro entradas, mobile e fullscreen. Esses testes não comprovam uma cobrança real. Nenhuma compra real deve ser feita automaticamente.

O aplicativo mobile terá faturamento oficial das lojas em uma integração separada; este checkout é web.
