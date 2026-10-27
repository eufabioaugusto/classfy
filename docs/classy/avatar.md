# Avatar compartilhado da Classy

## Identidade e tamanhos

`src/components/classy/ClassyAvatar.tsx` substitui a personagem antiga com óculos pelo rosto 3D de cabelo vermelho/coque e sorriso da identidade aprovada em 27/10/2026.

- Base: `/public/classy/classy-head-v1.webp` (384×384, alfa, aproximadamente 26 KB).
- A cabeça sem traços faciais foi preparada com geração/edição de imagem a partir da prancha fornecida pelo Fabio; olhos e boca são vetores independentes.
- A mesma base atende todos os estados. Não se alternam recortes de tamanhos diferentes nem se anima uma imagem inteira para simular o olhar.
- Barra global: **26×26 px**, painel: **32×32 px**, abertura de conversa: **56×56 px**. Tamanhos preexistentes preservados.
- Onboarding reutiliza o componente no espaço de avatar existente (40 px).

## Comportamento

- `idle`: olhos/pause, sorriso/play e piscada a cada 7 segundos.
- `attentive`: mesma expressão normal, acompanha painel aberto/rascunho.
- `thinking`: olhos em alturas diferentes e boca pensativa; aguardar histórico, resposta ou transcrição.
- `happy`: olhos sorrindo e sorriso mais aberto, durante 1,8 segundo após salvar uma anotação com sucesso.
- `speaking`: boca com animação leve, disponível para futura saída de voz. Não é acionada por texto sendo digitado nem pelo ditado do usuário.

O olhar acompanha ponteiros finos próximos (raio de 220 px), com deslocamento limitado e atualização via requestAnimationFrame. Retorna ao centro ao sair da janela/perder foco/ocultar a página; listeners e frame pendente são removidos ao desmontar. Não há acompanhamento por toque. `prefers-reduced-motion` desliga piscada, movimento dos olhos e fala, inclusive se a preferência mudar com a página aberta.

O SVG é decorativo (`aria-hidden`, sem foco); nomes acessíveis permanecem nos botões. Expressões não substituem mensagens de status, carregamento ou erros da interface.

## Verificação

- `npm test -- src/components/classy/ClassyAvatar.test.tsx src/components/classy/useClassyDictation.test.tsx`
- `npx eslint src/components/classy/ClassyAvatar.tsx src/components/classy/GlobalClassy.tsx src/components/onboarding/ClassyChatDemo.tsx`
- `npm run build`

Conferir visualmente nos temas claro/escuro, a 26/32/56 px, e no mobile. Na interface global, abrir/recolher o painel; uma requisição em andamento deve usar thinking e sucesso ao salvar anotação deve usar happy.
