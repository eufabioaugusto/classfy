
# Melhorias no Upload: Thumb Automatica, Seletor de Capa, Persistencia e Icones

## Problemas Identificados

1. **Tela preta no mobile** -- O elemento `<video>` nao gera preview de thumbnail automaticamente no celular; precisa capturar um frame via `<canvas>`.
2. **Thumbnail obrigatoria** -- Atualmente `thumbnailUrl` e validado como obrigatorio no submit (linha 425 e 979). Deveria ser opcional com fallback automatico.
3. **Perda de sessao** -- Ao trocar de app e voltar no mobile, o estado do formulario se perde. Precisa de persistencia via `sessionStorage`.
4. **Icones PRO/Premium** -- PRO deveria ter coroa amarela e Premium coroa vermelha. Atualmente usa `Sparkles` azul para PRO e `Crown` amarela para Premium (invertido).

---

## Plano de Implementacao

### 1. Seletor de Capa estilo Instagram (Cover Frame Selector)

Criar um novo componente `CoverFrameSelector` que:
- Recebe o `filePreview` (URL do video) como prop
- Cria um `<video>` oculto e um `<canvas>` para captura de frames
- Exibe uma barra horizontal com preview de frames ao longo do video (tipo scrubber do Instagram)
- Ao arrastar na barra, o usuario navega pelo video e ao soltar, o frame atual e capturado como thumbnail
- Usa `canvas.toDataURL('image/jpeg', 0.9)` para gerar a imagem
- A imagem gerada e convertida em `File` e enviada ao storage
- Aparece automaticamente quando um video e carregado e nenhuma thumbnail manual foi enviada

**Comportamento:**
- Quando o video termina upload, gerar automaticamente um frame a 25% do video como thumbnail padrao
- Exibir o seletor de capa abaixo do preview do video
- O usuario pode ainda fazer upload manual de thumbnail (sobrepoe a automatica)

### 2. Thumbnail Opcional com Fallback Automatico

- Remover o `*` (asterisco) da label de Thumbnail
- Remover `!thumbnailUrl` da validacao do submit (linhas 425 e 979)
- Quando o video faz upload e nao ha thumbnail manual:
  - Auto-gerar thumbnail de um frame do video (a 25% da duracao)
  - Upload automatico para storage
  - Setar `thumbnailUrl` automaticamente
- O seletor de capa permite ao usuario ajustar qual frame usar
- Se o usuario fizer upload manual de imagem, esta tem prioridade

### 3. Persistencia de Sessao (sessionStorage)

- Salvar o estado do formulario em `sessionStorage` a cada mudanca:
  - `contentType`, `title`, `description`, `visibility`, `price`, `discount`, `tags`, `fileUrl`, `thumbnailUrl`, `duration`
- Na montagem do componente, verificar se ha dados salvos e restaurar
- Limpar `sessionStorage` ao publicar com sucesso
- **Nota:** `filePreview` e `thumbnailPreview` (blob URLs) nao sobrevivem entre sessoes, mas `fileUrl` e `thumbnailUrl` (URLs publicas do storage) sim -- se o upload ja completou, o preview pode ser recriado a partir da URL publica
- Usar uma chave como `studio-upload-draft` no sessionStorage

### 4. Corrigir Icones PRO/Premium

Na array `visibilityOptions`:
- **PRO**: Trocar `Sparkles` por `Crown`, cor amarela (`text-yellow-500`)
- **Premium**: Manter `Crown`, cor vermelha (`text-red-500`)
- **Gratuito**: Manter `Eye`, cor verde
- **Pago**: Manter `DollarSign`, cor accent

---

## Detalhes Tecnicos

### Componente CoverFrameSelector

```text
+------------------------------------------------------+
|  Capa do Video                                        |
|  [Frame atual em preview grande]                      |
|                                                       |
|  |---|---|---|---|---|---|---|---|---|---|---|---|---|  |
|  ^ barra de frames com miniatures do video           |
|  arrastar para selecionar frame                       |
+------------------------------------------------------+
```

- Gerar ~10-15 frames espacados ao longo do video para os thumbnails da barra
- Usar `requestVideoFrameCallback` ou seek manual + canvas para captura
- O frame selecionado e convertido em JPEG e feito upload automatico

### sessionStorage Schema

```text
{
  contentType: string,
  title: string,
  description: string,
  visibility: string,
  price: string,
  discount: string,
  tags: string[],
  fileUrl: string,
  thumbnailUrl: string,
  duration: number,
  savedAt: timestamp
}
```

- Expirar apos 24h (verificar `savedAt` na restauracao)
- Mostrar toast "Rascunho restaurado" quando recuperar dados

### Arquivos Modificados

1. **Novo:** `src/components/CoverFrameSelector.tsx` -- Componente do seletor de capa
2. **Editado:** `src/pages/StudioUpload.tsx` -- Integrar seletor, remover obrigatoriedade da thumb, adicionar persistencia, corrigir icones
