import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown, Eye, Minus, Plus } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { patchStudioClipGrade, studioGrade, type StudioEditing, type StudioGrade, type StudioEffect } from './model';

type Props = {
  editing: StudioEditing; targetId: string; disabled?: boolean;
  onPreview: (editing: StudioEditing | undefined) => void;
  onApply: (editing: StudioEditing) => Promise<void>;
  onClose: () => void; onBefore?: (original: boolean) => void;
};
type Parameter = Exclude<keyof StudioGrade, 'preset'>;
const presets: { id: StudioEffect; title: string }[] = [{ id: 'natural', title: 'Natural' }, { id: 'studio', title: 'Studio' }, { id: 'cinematic', title: 'Cinema' }];
const parameters: { id: Parameter; title: string; min: number; max: number; step: number }[] = [
  { id: 'intensity', title: 'Intensidade', min: 0, max: 1, step: 0.05 },
  { id: 'exposure', title: 'Exposição', min: -2, max: 2, step: 0.1 },
  { id: 'contrast', title: 'Contraste', min: -1, max: 1, step: 0.05 },
  { id: 'saturation', title: 'Saturação', min: -1, max: 1, step: 0.05 },
  { id: 'temperature', title: 'Temperatura', min: -1, max: 1, step: 0.05 },
];
function gradeFor(editing: StudioEditing, targetId: string): StudioGrade {
  const clip = editing.main.find(item => item.id === targetId) ?? editing.layers.flatMap(layer => layer.items).find(item => item.id === targetId);
  return { ...studioGrade(clip?.effect), ...clip?.grade };
}

/** Local color edits preview immediately; only Apply writes a history entry. */
export function StudioTreatmentPanel({ editing, targetId, disabled = false, onPreview, onApply, onClose, onBefore }: Props) {
  const [draft, setDraft] = useState(() => gradeFor(editing, targetId));
  const [parameter, setParameter] = useState<Parameter>('intensity');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [trackWidth, setTrackWidth] = useState(1);
  const live = useRef({ editing, targetId, disabled, onPreview, onApply, onClose, onBefore });
  live.current = { editing, targetId, disabled, onPreview, onApply, onClose, onBefore };
  const draftRef = useRef(draft), mounted = useRef(true), writing = useRef(false), originalHeld = useRef(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPreview = useRef(0);
  const clearTimer = () => { if (previewTimer.current) clearTimeout(previewTimer.current); previewTimer.current = null; };
  const publishPreview = () => {
    clearTimer(); lastPreview.current = Date.now();
    const current = live.current;
    if (!mounted.current || current.disabled || writing.current || originalHeld.current) return;
    current.onPreview(patchStudioClipGrade(current.editing, current.targetId, draftRef.current));
  };
  const original = (held: boolean) => {
    if (held && (live.current.disabled || writing.current)) return;
    originalHeld.current = held; clearTimer();
    if (live.current.onBefore) live.current.onBefore(held);
    else live.current.onPreview(held ? patchStudioClipGrade(live.current.editing, live.current.targetId, studioGrade())
      : patchStudioClipGrade(live.current.editing, live.current.targetId, draftRef.current));
  };
  useEffect(() => {
    clearTimer(); originalHeld.current = false; live.current.onBefore?.(false); live.current.onPreview(undefined);
    const next = gradeFor(editing, targetId); draftRef.current = next; setDraft(next); setError(undefined);
  }, [editing, targetId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimer(); live.current.onBefore?.(false); live.current.onPreview(undefined); };
  }, []);
  useEffect(() => { if (disabled && originalHeld.current) original(false); }, [disabled]);
  const update = (patch: Partial<StudioGrade>) => {
    if (live.current.disabled || writing.current) return;
    const next = { ...draftRef.current, ...patch }; draftRef.current = next; setDraft(next); setError(undefined);
    const delay = Math.max(0, 40 - (Date.now() - lastPreview.current));
    if (!delay) publishPreview(); else if (!previewTimer.current) previewTimer.current = setTimeout(publishPreview, delay);
  };
  const apply = async () => {
    if (live.current.disabled || writing.current) return;
    clearTimer(); originalHeld.current = false; live.current.onBefore?.(false); writing.current = true; setSaving(true); setError(undefined);
    const current = live.current;
    try { await current.onApply(patchStudioClipGrade(current.editing, current.targetId, draftRef.current)); }
    catch { if (mounted.current) setError('Não foi possível salvar. Tente novamente.'); }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };
  const active = parameters.find(item => item.id === parameter)!;
  const value = draft[parameter], progress = (value - active.min) / (active.max - active.min);
  const change = (next: number) => update({ [parameter]: Math.round(Math.max(active.min, Math.min(active.max, next)) * 1000) / 1000 });
  const touch = (x: number) => { if (Number.isFinite(x) && trackWidth > 1) change(active.min + Math.max(0, Math.min(1, x / trackWidth)) * (active.max - active.min)); };
  const blocked = disabled || saving;
  return <View style={s.panel}>
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar tratamento" disabled={saving} onPress={onClose} style={s.icon}><ChevronDown size={20} color={colors.text} /></Pressable>
      <Text style={s.title}>Tratamento</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Segure para comparar com o original" disabled={blocked} onPressIn={() => original(true)} onPressOut={() => original(false)} style={({ pressed }) => [s.original, pressed && s.active]}><Eye size={15} color={colors.textSecondary} /><Text style={s.label}>Original</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Aplicar tratamento" accessibilityState={{ busy: saving, disabled: blocked }} disabled={blocked} onPress={() => { void apply(); }} style={s.icon}>{saving ? <ActivityIndicator size="small" color={colors.accent} /> : <Check size={22} color={colors.accent} />}</Pressable>
    </View>
    <View style={s.presets}>{presets.map(preset => <Pressable key={preset.id} accessibilityRole="button" accessibilityState={{ selected: draft.preset === preset.id, disabled: blocked }} disabled={blocked} onPress={() => update({ preset: preset.id })} style={[s.preset, draft.preset === preset.id && s.active]}><Text style={[s.presetLabel, draft.preset === preset.id && { color: colors.text }]}>{preset.title}</Text></Pressable>)}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>{parameters.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: parameter === item.id }} onPress={() => setParameter(item.id)} style={[s.tab, parameter === item.id && s.selectedTab]}><Text style={[s.tabLabel, parameter === item.id && { color: colors.text }]}>{item.title}</Text></Pressable>)}</ScrollView>
    <View style={[s.adjustment, blocked && { opacity: 0.45 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Diminuir ${active.title}`} disabled={blocked} onPress={() => change(value - active.step)} style={s.icon}><Minus size={17} color={colors.text} /></Pressable>
      <View accessibilityRole="adjustable" accessibilityLabel={active.title} accessibilityValue={{ min: active.min, max: active.max, now: value }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => { if (!blocked) change(value + (event.nativeEvent.actionName === 'increment' ? active.step : -active.step)); }}
        onLayout={event => setTrackWidth(event.nativeEvent.layout.width)} onStartShouldSetResponder={() => !blocked} onMoveShouldSetResponder={() => !blocked}
        onResponderGrant={event => touch(event.nativeEvent.locationX)} onResponderMove={event => touch(event.nativeEvent.locationX)} onResponderRelease={publishPreview} onResponderTerminate={publishPreview} style={s.slider}>
        <View pointerEvents="none" style={s.track}><View style={[s.fill, { width: `${progress * 100}%` }]} /><View style={[s.knob, { left: Math.max(0, Math.min(trackWidth - 12, progress * trackWidth - 6)) }]} /></View>
      </View>
      <Text style={s.value}>{parameter === 'intensity' ? `${Math.round(value * 100)}%` : `${value > 0 ? '+' : ''}${value.toFixed(2)}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Aumentar ${active.title}`} disabled={blocked} onPress={() => change(value + active.step)} style={s.icon}><Plus size={17} color={colors.text} /></Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </View>;
}
const s = StyleSheet.create({
  panel: { backgroundColor: '#151A1F', borderTopWidth: 1, borderTopColor: '#252B32', paddingBottom: 4 },
  header: { height: 40, flexDirection: 'row', alignItems: 'center' }, title: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
  icon: { width: 42, height: 40, alignItems: 'center', justifyContent: 'center' },
  original: { minHeight: 30, paddingHorizontal: 9, gap: 5, borderRadius: 5, flexDirection: 'row', alignItems: 'center' },
  label: { color: colors.textSecondary, fontSize: 10 },
  presets: { paddingHorizontal: 14, flexDirection: 'row', gap: 6 }, preset: { flex: 1, minHeight: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#20272F' },
  presetLabel: { color: colors.muted, fontSize: 12, fontWeight: '500' }, active: { backgroundColor: '#343E49' },
  tabs: { paddingHorizontal: 12, paddingTop: 7, gap: 2 }, tab: { paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: 'transparent' }, selectedTab: { borderBottomColor: colors.textSecondary },
  tabLabel: { color: colors.muted, fontSize: 10 }, adjustment: { height: 46, flexDirection: 'row', alignItems: 'center' },
  slider: { flex: 1, minHeight: 42, justifyContent: 'center' }, track: { height: 2, backgroundColor: '#3D4853', borderRadius: 1 },
  fill: { height: 2, backgroundColor: '#D6DEE6', borderRadius: 1 }, knob: { position: 'absolute', width: 12, height: 12, top: -5, borderRadius: 6, backgroundColor: '#F5F7FA' },
  value: { width: 49, marginLeft: 10, color: colors.textSecondary, fontSize: 11, textAlign: 'center', fontVariant: ['tabular-nums'] },
  error: { paddingHorizontal: 14, paddingBottom: 5, color: colors.accent, fontSize: 11 },
});
