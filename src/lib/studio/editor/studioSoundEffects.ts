export const studioSounds = [
  { id: 'click', name: 'Clique', duration: .12 },
  { id: 'chime', name: 'Sino suave', duration: .55 },
  { id: 'sweep', name: 'Passagem', duration: .4 },
] as const;

export function studioSoundFile(sound: typeof studioSounds[number]) {
  const rate = 24000, samples = Math.round(sound.duration * rate);
  const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
  const tag = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true);
  tag(8, 'WAVE'); tag(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) {
    const t = index / rate, progress = t / sound.duration;
    const envelope = Math.min(1, t * 250) * (1 - progress) ** 2;
    const tone = sound.id === 'sweep' ? Math.sin(2 * Math.PI * (180 * t + 1700 * t ** 2)) * Math.sin(Math.PI * progress)
      : sound.id === 'chime' ? .7 * Math.sin(2 * Math.PI * 660 * t) + .3 * Math.sin(2 * Math.PI * 990 * t)
      : Math.sin(2 * Math.PI * 1250 * t) * Math.exp(-t * 80);
    view.setInt16(44 + index * 2, Math.round(tone * envelope * 14000), true);
  }
  return new File([buffer], sound.name + '.wav', { type: 'audio/wav' });
}
