export function parseDesktopCaptions(value: string) {
  const time = (text: string) => {
    const parts = text.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
    if (!parts || +parts[2] > 59 || +parts[3] > 59) throw new Error('O arquivo de legendas contém um tempo inválido.');
    return +parts[1] * 3600 + +parts[2] * 60 + +parts[3] + +parts[4].padEnd(3, '0') / 1000;
  };
  const blocks = value.replace(/^\uFEFF/, '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  if (!value.trim() || blocks.length > 5000) throw new Error('Escolha um arquivo SRT com até 5.000 legendas.');
  return blocks.map(block => {
    const lines = block.split('\n'), index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) throw new Error('Escolha um arquivo de legendas no formato SRT.');
    const [from, to] = lines[index].split('-->'), start = time(from), end = time(to.trim().split(/\s+/)[0]);
    const text = lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '').trim();
    if (!text || end - start < .1) throw new Error('Revise o texto e a duração das legendas.');
    return { start, end, text };
  });
}
