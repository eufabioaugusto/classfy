import { studioGrade, type StudioGrade } from './model';
export const studioFilterPresets: { id: string; title: string; grade: StudioGrade; shades: [string, string, string]; preserveAdjustments?: boolean }[] = [
  { id: 'natural', title: 'Natural', grade: studioGrade(), shades: ['#7D8271', '#C8B7A7', '#9E725B'], preserveAdjustments: true },
  { id: 'studio', title: 'Studio', grade: studioGrade('studio'), shades: ['#666B62', '#DAC0AA', '#A45E4E'], preserveAdjustments: true },
  { id: 'cinematic', title: 'Cinema', grade: studioGrade('cinematic'), shades: ['#354C55', '#BFA889', '#705E5A'], preserveAdjustments: true },
  { id: 'warm', title: 'Quente', grade: { ...studioGrade(), temperature: 0.4, saturation: 0.1 }, shades: ['#795643', '#E2BD90', '#BC7751'] },
  { id: 'cool', title: 'Frio', grade: { ...studioGrade(), temperature: -0.4, contrast: 0.1 }, shades: ['#3C5A76', '#B7CEDC', '#74848B'] },
  { id: 'mono', title: 'Preto e branco', grade: { ...studioGrade(), saturation: -1, contrast: 0.2 }, shades: ['#383838', '#BDBDBD', '#777777'] },
  { id: 'vivid', title: 'Vivo', grade: { ...studioGrade(), saturation: 0.4, contrast: 0.15 }, shades: ['#5C6939', '#DBAD82', '#BF5143'] },
  { id: 'soft', title: 'Suave', grade: { ...studioGrade(), contrast: -0.2, saturation: -0.15, exposure: 0.1 }, shades: ['#929285', '#D2C6BC', '#A28C82'] },
  { id: 'golden', title: 'Dourado', grade: { ...studioGrade(), temperature: 0.6, exposure: 0.1, contrast: 0.1, saturation: 0.15 }, shades: ['#6C5735', '#EDCA7C', '#BA894A'] },
];
export function studioSelectedFilter(grade: StudioGrade) {
  return studioFilterPresets.find(preset => !preset.preserveAdjustments && (['preset', 'exposure', 'contrast', 'saturation', 'temperature'] as const).every(key => grade[key] === preset.grade[key]))?.id || grade.preset;
}
