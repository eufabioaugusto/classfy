/** Reuse disk-backed bytes; exporting a copy must never read a long take into RAM. */
export function downloadStudioOriginal(file: Blob, name: string) {
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = Array.from(name, character => character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '-' : character).join('') || 'original-classfy.mov';
  try { link.click(); }
  catch (error) { URL.revokeObjectURL(url); throw error; }
  // The browser owns its download after the gesture; retain its source briefly.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
