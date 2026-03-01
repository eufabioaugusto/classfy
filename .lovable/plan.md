

## Problema identificado

O simulador atual é uma barra genérica que diz apenas "Simulador" — sem contexto do que simula. O texto é pequeno, técnico, e o slider sem label não comunica nada ao usuário. Além disso, na linha 328 do `Recompensas.tsx` ainda aparece "Performance Points" em vez de "Pontos".

## Plano de redesign

### 1. Reescrever `PoolSimulator.tsx` com UX clara

**Novo layout — tudo em 2 linhas compactas com fundo `bg-foreground`:**

```text
Linha 1: 💰 Se você engajar +[slider]% mais este mês...
Linha 2: Você ganharia R$ X,XX (↑ R$ Y,YY a mais)
```

Mudanças específicas:
- Trocar "Simulador" por frase descritiva: **"Se você engajar"** `[slider]` **"% mais este mês..."**
- O slider fica inline na frase, tornando a interação auto-explicativa
- Segunda linha mostra o resultado: **"Você ganharia R$ X,XX"** com o delta verde ao lado
- Remover labels "Atual" / "Projeção" separados — integrar tudo na frase natural
- Manter o fundo `bg-foreground` com texto `text-background` para contraste
- Slider com cor accent na barra e thumb

### 2. Corrigir "Performance Points" em `Recompensas.tsx`

- Linha 328: trocar `"Performance Points"` por `"Pontos"`.

### Arquivos editados
- `src/components/PoolSimulator.tsx` — redesign completo do UX
- `src/pages/Recompensas.tsx` — corrigir label "Performance Points" → "Pontos"

