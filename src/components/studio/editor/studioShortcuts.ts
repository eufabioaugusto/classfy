export const studioShortcuts = [
  ['split', 'Dividir no cursor', 'mod+b'],
  ['trimStart', 'Encurtar o início', 'q'],
  ['trimEnd', 'Encurtar o final', 'w'],
  ['select', 'Ferramenta de seleção', 'a'],
  ['trim', 'Deslizar, encurtar e rolar', 't'],
  ['blade', 'Ferramenta lâmina', 'b'],
  ['hand', 'Ferramenta manual', 'h'],
  ['annotation', 'Adicionar anotação de texto', ''],
  ['duplicate', 'Duplicar', 'mod+d'],
  ['remove', 'Excluir', 'backspace'],
  ['nextClip', 'Pular para o próximo clipe', 'arrowdown'],
  ['previousClip', 'Pular para o clipe anterior', 'arrowup'],
  ['nextFrame', 'Avançar um quadro', 'arrowright'],
  ['previousFrame', 'Retroceder um quadro', 'arrowleft'],
  ['nextTen', 'Avançar dez quadros', 'shift+arrowright'],
  ['previousTen', 'Retroceder dez quadros', 'shift+arrowleft'],
  ['play', 'Reproduzir ou pausar', 'space'],
  ['restart', 'Reproduzir do início', 'enter'],
  ['loop', 'Ativar ou desativar loop', 'mod+l'],
  ['reverse', 'Reproduzir para trás', 'j'],
  ['pause', 'Parar reprodução', 'k'],
  ['forward', 'Reproduzir para frente', 'l'],
  ['selectAt', 'Selecionar no cursor', 'd'],
  ['selectAll', 'Selecionar tudo', 'mod+a'],
  ['similar', 'Selecionar clipes do mesmo tipo', 'ctrl+meta+a'],
  ['selectAfter', 'Selecionar clipes para frente', ']'],
  ['selectBefore', 'Selecionar clipes para trás', '['],
  ['clear', 'Desmarcar', 'escape'],
  ['clearAll', 'Desmarcar tudo', 'mod+shift+a'],
  ['copy', 'Copiar', 'mod+c'],
  ['cut', 'Recortar', 'mod+x'],
  ['paste', 'Colar', 'mod+v'],
  ['undo', 'Desfazer', 'mod+z'],
  ['redo', 'Refazer', 'mod+shift+z'],
  ['group', 'Agrupar', 'mod+g'],
  ['ungroup', 'Desagrupar', 'mod+shift+g'],
  ['timelineIn', 'Aumentar zoom da timeline', 'mod+='],
  ['timelineOut', 'Diminuir zoom da timeline', 'mod+-'],
  ['timelineFit', 'Ajustar à timeline', 'mod+0'],
  ['previewIn', 'Aumentar zoom da prévia', 'alt+shift+='],
  ['previewOut', 'Diminuir zoom da prévia', 'alt+shift+-'],
  ['previewFit', 'Ajustar prévia', 'mod+alt+0'],
  ['previewActual', 'Prévia em tamanho real', 'mod+alt+1'],
  ['guides', 'Mostrar ou ocultar guias', 'mod+alt+g'],
  ['search', 'Pesquisar ferramentas', 'mod+f'],
  ['audio', 'Áudio', 'mod+alt+a'],
  ['voice', 'Gravar narração', 'mod+alt+v'],
  ['sounds', 'Efeitos sonoros', 'mod+alt+b'],
  ['filters', 'Filtros', 'mod+alt+f'],
  ['transitions', 'Transições', 'mod+alt+x'],
  ['adjustments', 'Ajustar', 'mod+alt+j'],
  ['import', 'Importar mídia', 'mod+i'],
  ['export', 'Exportar', 'mod+e'],
] as const;

export type StudioShortcut = typeof studioShortcuts[number][0];

export function studioShortcutFor(event: KeyboardEvent): StudioShortcut | undefined {
  const key = ({ Equal: '=', Minus: '-', Digit0: '0', Digit1: '1', Space: 'space' } as Record<string, string>)[event.code]
    ?? (event.altKey && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase());
  const modifier = event.ctrlKey && event.metaKey ? 'ctrl+meta+' : event.ctrlKey || event.metaKey ? 'mod+' : '';
  const chord = modifier + (event.altKey ? 'alt+' : '') + (event.shiftKey ? 'shift+' : '') + key;
  return studioShortcuts.find(([, , binding]) => binding === chord)?.[0]
    ?? ({ 'shift+?': 'search', '?': 'search', delete: 'remove', s: 'split', 'mod+y': 'redo', 'alt+shift+a': 'similar', 'mod+shift+l': 'loop' } as const)[chord];
}

export function studioShortcutLabel(chord: string) {
  const mac = /Mac|iPhone|iPad/i.test(navigator.platform);
  return chord ? chord.split('+').map(key => ({
    mod: mac ? '⌘' : 'Ctrl', meta: '⌘', ctrl: 'Ctrl', alt: mac ? '⌥' : 'Alt', shift: 'Shift',
    space: 'Espaço', enter: 'Enter', escape: 'Esc', backspace: 'Backspace',
    arrowright: '→', arrowleft: '←', arrowup: '↑', arrowdown: '↓',
  } as Record<string, string>)[key] ?? key.toUpperCase()).join(' + ') : 'Sem atalho';
}
