# Cobranças da assinatura

O endpoint `subscription-billing` fornece o histórico das assinaturas Classfy Pro e Premium, seus documentos no Stripe e um resumo da cobrança atual. É uma consulta autenticada, separada da Carteira e das compras avulsas de cursos. Não cria sessões de pagamento, não altera assinaturas e não concede acesso.

## Contrato

`POST /functions/v1/subscription-billing`, com Bearer da sessão Supabase:

```ts
type Request = {
  status?: 'all' | 'paid' | 'pending'; // padrão: all
  limit?: number; // inteiro de 1 a 25; padrão: 10
  cursor?: string; // opaco; emitido pelo servidor
};

type Response = {
  invoices: {
    id: string;
    number: string | null;
    status: 'paid' | 'open' | 'uncollectible' | 'void' | 'draft';
    plan: 'pro' | 'premium' | null;
    createdAt: string;
    dueAt: string | null;
    paidAt: string | null;
    amountDue: number;
    amountPaid: number;
    amountRemaining: number;
    currency: string;
    pdfUrl: string | null;
    hostedUrl: string | null;
  }[];
  nextCursor: string | null;
  subscription: null | {
    plan: 'pro' | 'premium';
    status: string;
    cancelAtPeriodEnd: boolean;
    periodEnd: string | null;
    nextRenewal: null | {
      at: string;
      amountDue: number | null;
      currency: string | null;
    };
    paymentMethod: null | {
      type: 'card';
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    };
  };
};
```

As datas são ISO 8601. Os valores conservam a unidade mínima devolvida pelo Stripe; BRL usa centavos. Não há conversão cambial. Os erros usam `{ code, error }`, com mensagem segura em português. Todas as respostas JSON têm `Cache-Control: no-store`.

`paid` consulta faturas pagas. `pending` inclui `open` e `uncollectible`, percorrendo o histórico completo por paginação; não inclui rascunhos nem faturas anuladas. `all` conserva os cinco estados originais do provedor. A lista segue a ordem de emissão decrescente do Stripe.

Cada chamada percorre no máximo cinco páginas brutas. Por isso, uma resposta pode trazer `invoices: []` e ainda ter `nextCursor`: o cliente deve oferecer a continuação. O cursor aponta para a última fatura percorrida, inclusive quando um registro foi excluído do filtro, sem pular os registros seguintes.

## Fronteira de conta e produto

- O usuário vem de `auth.getUser` no servidor. O corpo não aceita proprietário, customer, assinatura ou invoice IDs.
- O customer vem exclusivamente de `profiles.billing_id` da conta autenticada. Não existe descoberta por email nem criação automática de customer. Sem `billing_id`, a consulta retorna histórico vazio.
- Cada customer, assinatura, fatura e forma de pagamento deve pertencer ao customer do perfil. Metadata `user_id` divergente, quando presente, interrompe a consulta. A ausência da metadata no customer legado não substitui a vinculação protegida do perfil.
- Uma fatura precisa referenciar uma assinatura do dono e conter uma linha com um preço real do produto canônico Pro/Premium configurado em `STRIPE_PLANS`. Preços antigos desse produto são aceitos somente para leitura do histórico, preservando os valores reais da fatura. O resumo da assinatura atual continua exigindo preço **e** produto atuais exatos. Metadata `plan_type` isolada não comprova o produto. Faturas manuais e compras avulsas não entram nessa biblioteca.
- O plano histórico é determinado pelas linhas da fatura, não pelo preço atual da assinatura. Faturas de uma assinatura cancelada continuam disponíveis. Linhas com Pro e Premium na mesma fatura, ou linhas ainda paginadas, deixam `plan: null`, preservando o documento sem atribuir um único plano.
- O DTO não contém customer ID, email, endereço de cobrança, cartão completo, método de pagamento ID ou objetos brutos do Stripe. O cartão inclui apenas bandeira, quatro dígitos finais e validade confirmados.

O cursor é assinado com HMAC-SHA256, possui domínio próprio e vence em uma hora. Ele vincula usuário, customer, filtro e posição no histórico. Alteração do cursor, troca de conta/customer/filtro ou vencimento resulta em `invalid_cursor`; o cliente deve iniciar uma consulta nova. A chave existente `STRIPE_SECRET_KEY` também assina os cursors; não há nova chave pública ou migration.

## Próxima cobrança e documentos

Uma próxima renovação só aparece para uma assinatura Classfy `active` ou `trialing`, com fim de período futuro e sem cancelamento programado, pausa de cobrança ou atualização pendente. Contas gratuitas, assinaturas canceladas ou pagamentos incompletos não recebem uma mensalidade futura inventada. Mais de uma assinatura corrente gera erro explícito, em vez de escolher uma silenciosamente.

O valor vem de `invoices.createPreview`, incluindo as condições efetivas do provedor, em vez do preço fixo de catálogo. Essa API simula uma fatura e não cria uma fatura pagável nem cobra o usuário. Se a simulação não estiver disponível, o histórico permanece consultável e a data confirmada pode ser exibida com valor a confirmar.

`pdfUrl` é o `invoice_pdf` oficial e `hostedUrl` é o `hosted_invoice_url` oficial. O PDF é a fatura do Stripe, não um PDF sintetizado localmente nem uma promessa de documento fiscal brasileiro. Rascunhos não têm links de documento nesta API. URLs precisam ser HTTPS de domínio Stripe, sem credenciais ou porta; a interface restringe os hosts conhecidos para abertura externa. Links podem ser nulos e devem ser usados somente como recebidos numa consulta atual.

## Implementação e verificação

- `supabase/functions/subscription-billing/index.ts`: autenticação, perfil protegido, Stripe 18.5.0 com API `2025-08-27.basil` e timeout de rede de 20 segundos por requisição ao provedor.
- `supabase/functions/_shared/subscription-billing.ts`: DTO, ownership, preços/produtos, cursor, filtros e resumo.
- `supabase/functions/_shared/subscription-billing-http.ts`: fronteira HTTP, mensagens sanitizadas, `no-store` e fetch Supabase com timeout/abort limitado.
- `supabase/functions/_shared/subscription-billing_test.ts`: provedores injetados, sem rede ou cobranças reais. Cobre ownership/cursors, estados e documentos, produtos avulsos, assinaturas históricas/canceladas, paginação pendente, cartões, previsão de cobrança e prazos de rede.

```sh
deno test --allow-env supabase/functions/_shared/subscription-billing_test.ts
deno check supabase/functions/subscription-billing/index.ts
```

São utilizados os segredos existentes de Supabase e `STRIPE_SECRET_KEY`; não é necessário `STRIPE_PUBLISHABLE_KEY` para leitura. A publicação exige deploy da nova Edge Function e sua configuração de JWT. A validação local não confirma uma conta real, uma fatura em produção ou o deploy.

## Fontes oficiais e versão

- [Listar faturas — Basil](https://docs.stripe.com/api/invoices/list?api-version=2025-08-27.basil): filtro por customer/status e paginação `starting_after`.
- [Objeto Invoice — Basil](https://docs.stripe.com/api/invoices/object?api-version=2025-08-27.basil): estados, valores, vínculo da assinatura e documentos.
- [Simular uma fatura — Basil](https://docs.stripe.com/api/invoices/create_preview?api-version=2025-08-27.basil): previsão sem criar uma fatura pagável.
- [Objeto Subscription — Basil](https://docs.stripe.com/api/subscriptions/object?api-version=2025-08-27.basil): status, cancelamento e método de pagamento padrão.
- [Objeto PaymentMethod — Basil](https://docs.stripe.com/api/payment_methods/object?api-version=2025-08-27.basil): customer e dados parciais do cartão.
- Tipos oficiais do SDK 18.5.0: [Invoices](https://github.com/stripe/stripe-node/blob/v18.5.0/types/Invoices.d.ts), [InvoiceLineItems](https://github.com/stripe/stripe-node/blob/v18.5.0/types/InvoiceLineItems.d.ts), [Subscriptions](https://github.com/stripe/stripe-node/blob/v18.5.0/types/Subscriptions.d.ts) e [Customers](https://github.com/stripe/stripe-node/blob/v18.5.0/types/Customers.d.ts). Conferidos para `parent.subscription_details`, `pricing.price_details` e períodos dos itens da assinatura, sem copiar contratos de uma versão mais nova da API.
