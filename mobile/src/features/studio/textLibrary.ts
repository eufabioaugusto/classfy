import AsyncStorage from '@react-native-async-storage/async-storage';

// PostScript names provided by iOS; preview and CoreText resolve the same face.
export const studioFonts = [
  { title: 'Padrão', category: 'simple', regular: 'System', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', both: 'Helvetica-BoldOblique' },
  { title: 'Avenir', category: 'simple', regular: 'AvenirNext-Regular', bold: 'AvenirNext-DemiBold', italic: 'AvenirNext-Italic', both: 'AvenirNext-DemiBoldItalic' },
  { title: 'Clássica', category: 'serif', regular: 'Georgia', bold: 'Georgia-Bold', italic: 'Georgia-Italic', both: 'Georgia-BoldItalic' },
  { title: 'Editorial', category: 'serif', regular: 'TimesNewRomanPSMT', bold: 'TimesNewRomanPS-BoldMT', italic: 'TimesNewRomanPS-ItalicMT', both: 'TimesNewRomanPS-BoldItalicMT' },
  { title: 'Mono', category: 'mono', regular: 'Menlo-Regular', bold: 'Menlo-Bold', italic: 'Menlo-Italic', both: 'Menlo-BoldItalic' },
  { title: 'Texto', category: 'simple', regular: 'Verdana', bold: 'Verdana-Bold', italic: 'Verdana-Italic', both: 'Verdana-BoldItalic' },
  { title: 'Baskerville', category: 'serif', regular: 'Baskerville', bold: 'Baskerville-Bold', italic: 'Baskerville-Italic', both: 'Baskerville-BoldItalic' },
  { title: 'Didot', category: 'serif', regular: 'Didot', bold: 'Didot-Bold', italic: 'Didot-Italic', both: 'Didot-Italic' },
  { title: 'Máquina', category: 'mono', regular: 'CourierNewPSMT', bold: 'CourierNewPS-BoldMT', italic: 'CourierNewPS-ItalicMT', both: 'CourierNewPS-BoldItalicMT' },
  { title: 'Futura', category: 'display', regular: 'Futura-Medium', bold: 'Futura-Bold', italic: 'Futura-MediumItalic', both: 'Futura-MediumItalic' },
  { title: 'Impacto', category: 'display', regular: 'Impact', bold: 'Impact', italic: 'Impact', both: 'Impact' },
  { title: 'Manuscrita', category: 'display', regular: 'ChalkboardSE-Regular', bold: 'ChalkboardSE-Bold', italic: 'ChalkboardSE-Regular', both: 'ChalkboardSE-Bold' },
] as const;
export type StudioTextLibrary = { favorites: string[]; recent: string[] };
const queues = new Map<string, Promise<void>>();
const known = new Set(studioFonts.map(font => font.regular as string));
export function normalizeStudioTextLibrary(value: unknown): StudioTextLibrary {
  const input = value as Partial<StudioTextLibrary> | null;
  const list = (source: unknown, max: number) => Array.isArray(source) ? [...new Set(source.filter((id): id is string => typeof id === 'string' && known.has(id)))].slice(0, max) : [];
  return { favorites: list(input?.favorites, studioFonts.length), recent: list(input?.recent, 12) };
}
export async function loadStudioTextLibrary(owner: string): Promise<StudioTextLibrary> {
  await queues.get(owner)?.catch(() => undefined);
  const raw = await AsyncStorage.getItem(`classfy:studio:text-library:v1:${owner}`);
  try { return normalizeStudioTextLibrary(raw ? JSON.parse(raw) : undefined); }
  catch { return normalizeStudioTextLibrary(undefined); }
}
export function saveStudioTextLibrary(owner: string, value: StudioTextLibrary): Promise<void> {
  const next = normalizeStudioTextLibrary(value);
  const pending = (queues.get(owner) || Promise.resolve()).catch(() => undefined).then(() => AsyncStorage.setItem(`classfy:studio:text-library:v1:${owner}`, JSON.stringify(next)));
  queues.set(owner, pending);
  void pending.finally(() => { if (queues.get(owner) === pending) queues.delete(owner); }).catch(() => undefined);
  return pending;
}
