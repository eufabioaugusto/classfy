import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, FlipHorizontal2, FlipVertical2, RotateCcw, Search } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { patchStudioClipProperties, setStudioClipPlaybackRate, studioClipDurationTicks, studioSeconds, studioTicks, type StudioEditing, type StudioClipMotion } from './model';
import { StudioControlSlider } from './StudioControlSlider';

export type StudioClipPanelMode = 'volume' | 'speed' | 'mirror' | 'motion';
type Props = { editing: StudioEditing; targetId: string; mode: StudioClipPanelMode; disabled?: boolean; toolsEnabled: boolean;
  onPreview: (editing?: StudioEditing) => void; onApply: (editing: StudioEditing) => Promise<void>; onClose: () => void };
const motions: { id: StudioClipMotion; title: string; category: 'edges' | 'movement' }[] = [
  { id: 'none', title: 'Nenhum', category: 'edges' }, { id: 'fade-in', title: 'Esmaecer na entrada', category: 'edges' },
  { id: 'fade-out', title: 'Esmaecer na saída', category: 'edges' }, { id: 'zoom-in', title: 'Zoom de entrada', category: 'movement' },
  { id: 'pulse', title: 'Pulsação', category: 'movement' }, { id: 'blink', title: 'Piscar', category: 'movement' },
];

/** One local transaction for every clip tool; only the checkmark persists it. */
export function StudioClipPanel(props: Props) {
  const live = useRef(props); live.current = props;
  const [draft, setDraft] = useState(props.editing), draftRef = useRef(draft);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  const [all, setAll] = useState(false), [query, setQuery] = useState(''), [category, setCategory] = useState<'all' | 'edges' | 'movement'>('all');
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { draftRef.current = props.editing; setDraft(props.editing); setError(undefined); setAll(false); }, [props.targetId, props.mode]);
  const clip = draft.main.find(item => item.id === props.targetId) || draft.layers.flatMap(layer => layer.items).find(item => item.id === props.targetId);
  if (!clip) return null;
  const asset = draft.assets.find(item => item.id === clip.assetId), duration = 'kind' in clip ? clip.durationTicks : studioClipDurationTicks(clip, asset);
  const isMain = draft.main.some(item => item.id === props.targetId);
  const sourceSpan = (clip.sourceEndTicks ?? ((clip.sourceStartTicks ?? 0) + Math.round(duration * (clip.playbackRate ?? 1)))) - (clip.sourceStartTicks ?? 0);
  // Main clips must still occupy 0.1 seconds after retiming. Keep an existing
  // non-grid rate representable; ordinary slider increments remain 0.25x.
  const maximumRate = isMain ? Math.min(4, Math.max(clip.playbackRate ?? 1,
    Math.floor((sourceSpan / studioTicks(0.1) + 1e-9) * 4) / 4)) : 4;
  const blocked = !!props.disabled || saving;
  const publish = (next: StudioEditing) => {
    if (live.current.disabled || writing.current || props.targetId !== live.current.targetId || props.mode !== live.current.mode) return;
    draftRef.current = next; setDraft(next); setError(undefined); live.current.onPreview(next);
  };
  const change = (edit: (editing: StudioEditing) => StudioEditing) => {
    if (live.current.disabled || writing.current || props.targetId !== live.current.targetId || props.mode !== live.current.mode) return;
    try { publish(edit(draftRef.current)); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível ajustar este clip.'); }
  };
  const patch = (value: Parameters<typeof patchStudioClipProperties>[2]) => change(editing => patchStudioClipProperties(editing, props.targetId, value));
  const apply = async () => {
    if (live.current.disabled || writing.current) return;
    writing.current = true; setSaving(true); setError(undefined);
    try {
      let next = draftRef.current;
      if (all && props.mode === 'volume' && isMain) {
        const selected = next.main.find(item => item.id === props.targetId)!;
        for (const item of next.main) {
          const length = studioClipDurationTicks(item, next.assets.find(asset => asset.id === item.assetId));
          next = patchStudioClipProperties(next, item.id, { gain: selected.gain ?? 1,
            fadeInTicks: Math.min(selected.fadeInTicks ?? 0, Math.floor(length / 2)), fadeOutTicks: Math.min(selected.fadeOutTicks ?? 0, Math.floor(length / 2)) });
        }
      }
      await live.current.onApply(next);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };
  const title = props.mode === 'volume' ? 'Volume e fades' : props.mode === 'speed' ? 'Velocidade' : props.mode === 'mirror' ? 'Espelhar e girar' : 'Efeitos do vídeo';
  return <View style={s.panel}>
    <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="Cancelar ajuste do clip" disabled={blocked} onPress={props.onClose} style={s.icon}><ArrowLeft size={20} color={colors.text} /></Pressable><Text style={s.title}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Aplicar ajuste do clip" accessibilityState={{ disabled: blocked, busy: saving }} disabled={blocked} onPress={() => { void apply(); }} style={s.icon}>{saving ? <ActivityIndicator size="small" color={colors.accent} /> : <Check size={23} color={colors.accent} />}</Pressable></View>
    {props.mode === 'volume' ? <>
      {isMain && <Pressable accessibilityRole="checkbox" accessibilityLabel="Aplicar volume e fades a todos os clips" accessibilityState={{ checked: all, disabled: blocked }} disabled={blocked} onPress={() => setAll(value => !value)} style={s.all}><View style={[s.checkbox, all && { backgroundColor: colors.accent, borderColor: colors.accent }]}>{all && <Check size={14} color="#FFFFFF" />}</View><Text style={s.hint}>Aplicar a todos os clips</Text></Pressable>}
      <StudioControlSlider label="Volume do clip" value={clip.gain ?? 1} min={0} max={2} step={0.05} disabled={blocked} formatValue={value => `${Math.round(value * 100)}%`} onChange={gain => patch({ gain })} />
      {props.toolsEnabled && <View style={s.fades}>{(['in', 'out'] as const).map(edge => <StudioControlSlider key={edge} label={edge === 'in' ? 'Entrada suave' : 'Saída suave'} value={studioSeconds((edge === 'in' ? clip.fadeInTicks : clip.fadeOutTicks) ?? 0)} min={0} max={studioSeconds(Math.floor(duration / 2))} step={0.1} disabled={blocked} formatValue={value => `${value.toFixed(1)} s`} onChange={value => patch(edge === 'in' ? { fadeInTicks: studioTicks(value) } : { fadeOutTicks: studioTicks(value) })} />)}</View>}
    </> : !props.toolsEnabled ? <Text style={s.hint}>Instale o Classfy Dev atualizado para usar este recurso.</Text> : props.mode === 'speed' ? <>
      <StudioControlSlider label="Velocidade do clip" value={clip.playbackRate ?? 1} min={0.25} max={maximumRate} step={0.25} disabled={blocked} formatValue={value => `${value.toFixed(2).replace('.', ',')}×`} onChange={value => change(editing => setStudioClipPlaybackRate(editing, props.targetId, value))} />
      <Text style={s.hint}>Duração: {studioSeconds(duration).toFixed(1).replace('.', ',')} s · o original permanece preservado.</Text>
    </> : props.mode === 'mirror' ? <View style={s.transforms}>
      <Transform label="Virar horizontalmente" Icon={FlipHorizontal2} selected={!!clip.flipHorizontal} disabled={blocked} onPress={() => patch({ flipHorizontal: !clip.flipHorizontal })} />
      <Transform label="Virar verticalmente" Icon={FlipVertical2} selected={!!clip.flipVertical} disabled={blocked} onPress={() => patch({ flipVertical: !clip.flipVertical })} />
      <Transform label="Girar 90 graus" Icon={RotateCcw} disabled={blocked} onPress={() => patch({ rotationDegrees: ((clip.rotationDegrees ?? 0) + 90) % 360 })} />
    </View> : <>
      <View style={s.search}><Search size={16} color={colors.muted} /><TextInput accessibilityLabel="Pesquisar efeitos de vídeo" value={query} onChangeText={setQuery} placeholder="Pesquise efeitos" placeholderTextColor={colors.muted} style={s.input} /></View>
      <View style={s.categories}>{([['all', 'Todos'], ['edges', 'Entrada e saída'], ['movement', 'Movimento']] as const).map(([id, label]) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: category === id }} disabled={blocked} onPress={() => setCategory(id)} style={[s.category, category === id && s.selected]}><Text style={s.hint}>{label}</Text></Pressable>)}</View>
      <ScrollView style={{ maxHeight: 154, flexShrink: 1 }} contentContainerStyle={s.grid} keyboardShouldPersistTaps="handled">{motions.filter(item => (category === 'all' || item.id === 'none' || item.category === category) && item.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Efeito ${item.title}`} accessibilityState={{ selected: (clip.motion ?? 'none') === item.id }} disabled={blocked} onPress={() => patch({ motion: item.id })} style={[s.tile, (clip.motion ?? 'none') === item.id && s.tileSelected]}><Text style={s.tileLabel}>{item.title}</Text></Pressable>)}</ScrollView>
    </>}
    {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
}
function Transform({ label, Icon, selected, disabled, onPress }: { label: string; Icon: typeof Check; selected?: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[s.transform, selected && s.selected]}><Icon size={22} color={colors.text} strokeWidth={1.6} /><Text style={s.hint}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingBottom: 10 }, header: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5 }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 12, fontWeight: '600' },
  hint: { color: colors.textSecondary, fontSize: 11, paddingHorizontal: 5, lineHeight: 17 }, all: { minHeight: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 7 }, checkbox: { width: 19, height: 19, borderRadius: 5, borderWidth: 1, borderColor: colors.muted, justifyContent: 'center', alignItems: 'center' }, fades: { gap: 0 },
  transforms: { flexDirection: 'row', padding: 12, gap: 8 }, transform: { flex: 1, minHeight: 86, alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 12, backgroundColor: colors.surfaceAlt }, selected: { backgroundColor: colors.surfaceMuted }, search: { marginHorizontal: 12, paddingHorizontal: 12, height: 44, borderRadius: 12, backgroundColor: colors.surfaceAlt, flexDirection: 'row', gap: 8, alignItems: 'center' }, input: { flex: 1, color: colors.text, fontSize: 13, height: 44 }, categories: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 5, gap: 4 }, category: { minHeight: 44, paddingHorizontal: 8, borderRadius: 8, justifyContent: 'center' }, grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 }, tile: { width: '48%', height: 60, backgroundColor: colors.surfaceAlt, borderRadius: 12, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' }, tileSelected: { borderColor: colors.text }, tileLabel: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' }, error: { color: colors.accent, fontSize: 11, paddingHorizontal: 14, paddingVertical: 6 },
});
