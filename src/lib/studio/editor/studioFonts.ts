import { getFont, saveFont, type StudioFontRecord } from './storage';

export const studioSystemFonts = [
  'System', 'Arial', 'Arial Black', 'Avenir Next', 'Baskerville', 'Calibri', 'Cambria',
  'Courier New', 'Didot', 'Futura', 'Georgia', 'Helvetica', 'Impact', 'Palatino',
  'Times New Roman', 'Trebuchet MS', 'Verdana',
];

const loaded = new Map<string, Promise<FontFace>>();
const customPrefix = 'StudioFont-';

function registerStudioFont(font: StudioFontRecord, file = font.file) {
  const existing = loaded.get(font.family);
  if (existing) return existing;
  const task = file.arrayBuffer().then(bytes => new FontFace(font.family, bytes).load()).then(face => {
    document.fonts.add(face);
    return face;
  }).catch(error => {
    loaded.delete(font.family);
    throw error;
  });
  loaded.set(font.family, task);
  return task;
}

export async function importStudioFont(ownerId: string, file: File): Promise<StudioFontRecord> {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) {
    throw new Error('Escolha um arquivo TTF, OTF, WOFF ou WOFF2 de até 20 MB.');
  }
  const font = { ownerId, family: customPrefix + crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), file };
  const face = await registerStudioFont(font).catch(() => { throw new Error('O navegador não conseguiu ler essa fonte.'); });
  try {
    await saveFont(font);
  } catch (error) {
    document.fonts.delete(face);
    loaded.delete(font.family);
    throw error;
  }
  return font;
}

export async function loadStudioCustomFont(family: string) {
  if (!family.startsWith(customPrefix)) return;
  const existing = loaded.get(family);
  if (existing) { await existing; return; }
  const font = await getFont(family);
  if (!font) throw new Error('A fonte deste projeto está indisponível neste navegador. Importe e selecione a fonte novamente para exportar.');
  await registerStudioFont(font);
}

export function studioBrowserFont(font: string) {
  const aliases: Record<string, string> = { 'System': 'system-ui, sans-serif', 'HelveticaNeue': 'Arial, sans-serif', 'HelveticaNeue-Bold': 'Arial, sans-serif', 'TimesNewRomanPSMT': '"Times New Roman", serif', 'CourierNewPSMT': '"Courier New", monospace', 'Georgia': 'Georgia, serif' };
  return aliases[font] ?? `"${font.replace(/["\\]/g, '')}", sans-serif`;
}
