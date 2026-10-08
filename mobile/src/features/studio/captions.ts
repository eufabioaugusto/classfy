import { addStudioLayerItem, createStudioTextItem, studioTicks, type StudioEditing } from './model.ts';
export type StudioCaptionCue = { start: number; end: number; text: string };
function time(value: string) {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) throw new Error('A legenda contém um tempo inválido.');
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}
export function parseStudioCaptions(source: string, duration: number): StudioCaptionCue[] {
  if (source.length > 2_000_000) throw new Error('Escolha uma legenda com até 2 MB.');
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: StudioCaptionCue[] = [];
  for (const block of normalized.split(/\n\s*\n/)) {
    const lines = block.split('\n'); const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) continue;
    const [left, right] = lines[index].split('-->');
    const start = time(left); const end = time(right.trim().split(/\s+/)[0]);
    const text = lines.slice(index + 1).join('\n').replace(/<[^>]*>/g, '').trim();
    if (!text) continue;
    if (end <= start || start < 0 || end > duration + 0.05) throw new Error('Os tempos da legenda precisam estar dentro do original selecionado.');
    cues.push({ start, end, text });
  }
  if (!cues.length) throw new Error('Não encontramos legendas SRT ou VTT neste arquivo.');
  if (cues.length > 10_000) throw new Error('Este arquivo tem mais de 10 mil legendas.');
  return cues.sort((a, b) => a.start - b.start);
}
// Cues attach to source time. Trimming/reordering never requires transcription
// again, and restoring a cut restores the original words at the same frame.
export function addStudioCaptionCues(editing: StudioEditing, clipId: string, cues: StudioCaptionCue[], id: () => string) {
  const clip = editing.main.find(item => item.id === clipId);
  if (!clip) throw new Error('Selecione um take para legendar.');
  let next = editing;
  for (const cue of cues) {
    const item = createStudioTextItem({ id: id(), content: cue.text, kind: 'caption', durationTicks: studioTicks(cue.end - cue.start) });
    item.anchor = { clipId, sourceStartTicks: studioTicks(cue.start), sourceEndTicks: studioTicks(cue.end) };
    item.text = { ...item.text!, backgroundColor: '#000000AA', fontSize: 0.045 };
    next = addStudioLayerItem(next, item, 'layer:caption');
  }
  return next;
}

export function studioTranscriptCues(segments: { text: string; startSeconds: number; endSeconds: number; words: { text: string; startSeconds: number; endSeconds: number }[] }[], duration: number): StudioCaptionCue[] {
  const cues: StudioCaptionCue[] = [];
  for (const segment of segments) {
    const words = segment.words.filter(word => word.text.trim() && Number.isFinite(word.startSeconds) && Number.isFinite(word.endSeconds) && word.endSeconds > word.startSeconds);
    if (!words.length) { if (segment.text.trim() && segment.endSeconds > segment.startSeconds) cues.push({ text: segment.text.trim(), start: Math.max(0, segment.startSeconds), end: Math.min(duration, segment.endSeconds) }); continue; }
    let group: typeof words = [];
    const flush = () => { if (group.length) cues.push({ text: group.map(word => word.text.trim()).join(' '), start: Math.max(0, group[0].startSeconds), end: Math.min(duration, group[group.length - 1].endSeconds) }); group = []; };
    for (const word of words) { if (group.length && (group.length >= 7 || [...group, word].map(w => w.text.trim()).join(' ').length > 42 || word.startSeconds - group[group.length - 1].endSeconds > 0.6)) flush(); group.push(word); }
    flush();
  }
  return cues.filter(cue => cue.end > cue.start);
}
