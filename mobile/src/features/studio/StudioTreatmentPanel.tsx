import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Check, Contrast, Droplets, Eye, Sun, Thermometer } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { patchStudioClipGrade, studioGrade, type StudioEditing, type StudioGrade, type StudioEffect } from './model';
import { StudioControlSlider } from './StudioControlSlider';
import { LoadingImage } from '@/components/LoadingImage';
import { prepareStudioFilterPreviews } from './filterPreviews';
import { studioFilterPresets as presets, studioSelectedFilter } from './filterCatalog';

type Props = {
  editing: StudioEditing; targetId: string; disabled?: boolean; initialTab?: 'filters' | 'adjust'; previewsEnabled?: boolean; positionSeconds?: number;
  onPreview: (editing: StudioEditing | undefined) => void;
  onApply: (editing: StudioEditing) => Promise<void>;
  onClose: () => void; onBefore?: (original: boolean) => void;
};
type Parameter = Exclude<keyof StudioGrade, 'preset' | 'intensity'>;
const parameters: { id: Parameter; title: string; min: number; max: number; step: number; Icon: typeof Sun }[] = [
  { id: 'exposure', title: 'Exposição', min: -2, max: 2, step: 0.1, Icon: Sun },
  { id: 'contrast', title: 'Contraste', min: -1, max: 1, step: 0.05, Icon: Contrast },
  { id: 'saturation', title: 'Saturação', min: -1, max: 1, step: 0.05, Icon: Droplets },
  { id: 'temperature', title: 'Temperatura', min: -1, max: 1, step: 0.05, Icon: Thermometer },
];
function gradeFor(editing: StudioEditing, targetId: string): StudioGrade {
  const clip = editing.main.find(item => item.id === targetId) ?? editing.layers.flatMap(layer => layer.items).find(item => item.id === targetId);
  return { ...studioGrade(clip?.effect), ...clip?.grade };
}

/** Local edits preview immediately; only Apply writes a history entry. */
export function StudioTreatmentPanel({ editing, targetId, disabled = false, initialTab = 'filters', previewsEnabled = false, positionSeconds = 0, onPreview, onApply, onClose, onBefore }: Props) {
  const [previews, setPreviews] = useState<Partial<Record<string, string>>>({});
  useEffect(() => {
    setPreviews({});
    if (!previewsEnabled) return;
    return prepareStudioFilterPreviews(editing, targetId, positionSeconds, (id, uri) => setPreviews(previous => ({ ...previous, [id]: uri })));
  }, [editing, targetId, previewsEnabled]);
  const [draft, setDraft] = useState(() => gradeFor(editing, targetId));
  const [tab, setTab] = useState<'filters' | 'adjust'>(initialTab), [parameter, setParameter] = useState<Parameter>('exposure');
  const [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  const live = useRef({ editing, targetId, disabled, onPreview, onApply, onClose, onBefore });
  live.current = { editing, targetId, disabled, onPreview, onApply, onClose, onBefore };
  const draftRef = useRef(draft), mounted = useRef(true), writing = useRef(false), originalHeld = useRef(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null), lastPreview = useRef(0);
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
  useEffect(() => { setTab(initialTab); }, [targetId, initialTab]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimer(); live.current.onBefore?.(false); live.current.onPreview(undefined); };
  }, []);
  useEffect(() => { if (disabled && originalHeld.current) original(false); }, [disabled]);
  const update = (patch: Partial<StudioGrade>) => {
    if (live.current.disabled || writing.current || live.current.targetId !== targetId) return;
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
  const blocked = disabled || saving;
  return <View style={s.panel}>
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar tratamento" disabled={blocked} onPress={onClose} style={s.icon}><ArrowLeft size={22} color={colors.text} strokeWidth={1.7} /></Pressable>
      <View style={s.tabs}>{(['filters', 'adjust'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'filters' ? 'Filtros' : 'Ajustes'} accessibilityState={{ selected: tab === value, disabled: blocked }} disabled={blocked} onPress={() => setTab(value)} style={[s.tab, tab === value && s.selectedTab]}><Text style={[s.tabLabel, tab === value && s.selectedLabel]}>{value === 'filters' ? 'Filtros' : 'Ajustes'}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="Segure para comparar com o original" disabled={blocked} onPressIn={() => original(true)} onPressOut={() => original(false)} style={({ pressed }) => [s.icon, pressed && s.pressed]}><Eye size={21} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Aplicar tratamento" accessibilityState={{ busy: saving, disabled: blocked }} disabled={blocked} onPress={() => { void apply(); }} style={s.icon}>{saving ? <ActivityIndicator size="small" color={colors.accent} /> : <Check size={24} color={colors.accent} strokeWidth={1.8} />}</Pressable>
    </View>
    {tab === 'filters' ? <>
      <ScrollView style={{ maxHeight: 218, flexShrink: 1 }} contentContainerStyle={s.presets} showsVerticalScrollIndicator={false}>{presets.map(preset => <Pressable key={preset.id} accessibilityRole="button" accessibilityLabel={`Filtro ${preset.title}`} accessibilityState={{ selected: studioSelectedFilter(draft) === preset.id, disabled: blocked }} disabled={blocked} onPress={() => update(preset.preserveAdjustments ? { preset: preset.grade.preset } : { ...preset.grade, intensity: draftRef.current.intensity })} style={[s.preset, studioSelectedFilter(draft) === preset.id && s.selectedPreset]}>
        <View pointerEvents="none" style={s.presetArt}>{previews[preset.id] ? <LoadingImage source={{ uri: previews[preset.id] }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : preset.shades.map((shade, index) => <View key={shade} style={[s.presetShade, { backgroundColor: shade, flex: index === 1 ? 1.3 : 1 }]} />)}</View>
        <Text style={[s.presetLabel, studioSelectedFilter(draft) === preset.id && s.selectedLabel]}>{preset.title}</Text>
      </Pressable>)}</ScrollView>
      <StudioControlSlider label="Intensidade" value={draft.intensity} min={0} max={1} step={0.05} disabled={blocked} formatValue={value => `${Math.round(value * 100)}%`} onChange={intensity => update({ intensity })} onInteractionEnd={publishPreview} />
    </> : <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.adjustments}>{parameters.map(({ id, title, Icon }) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Ajustar ${title}`} accessibilityState={{ selected: parameter === id, disabled: blocked }} disabled={blocked} onPress={() => setParameter(id)} style={[s.adjustment, parameter === id && s.selectedAdjustment]}><Icon size={23} color={parameter === id ? colors.text : colors.muted} strokeWidth={1.5} /><Text style={[s.adjustmentLabel, parameter === id && s.selectedLabel]}>{title}</Text></Pressable>)}</ScrollView>
      <StudioControlSlider label={active.title} value={draft[parameter]} min={active.min} max={active.max} step={active.step} disabled={blocked} formatValue={value => `${value > 0 ? '+' : ''}${value.toFixed(2)}`} onChange={value => update({ [parameter]: value })} onInteractionEnd={publishPreview} />
    </>}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </View>;
}
const s = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingBottom: 4 },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5 }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, pressed: { backgroundColor: colors.surfaceMuted },
  tabs: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, tab: { minHeight: 44, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, selectedTab: { backgroundColor: colors.surfaceMuted }, tabLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' }, selectedLabel: { color: colors.text },
  presets: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 10, paddingTop: 6, paddingBottom: 6 }, preset: { width: '30%', padding: 4, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: 'transparent' }, selectedPreset: { borderColor: colors.text },
  presetArt: { height: 88, borderRadius: 7, overflow: 'hidden', flexDirection: 'row' }, presetShade: { flex: 1 }, presetLabel: { color: colors.muted, fontSize: 12, fontWeight: '500', textAlign: 'center', paddingTop: 8, paddingBottom: 6 },
  adjustments: { paddingHorizontal: 10, paddingTop: 6, gap: 5 }, adjustment: { width: 83, height: 65, alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12 }, selectedAdjustment: { backgroundColor: colors.surfaceAlt }, adjustmentLabel: { color: colors.muted, fontSize: 11 },
  error: { color: colors.accent, fontSize: 11, paddingHorizontal: 14, paddingBottom: 6 },
});
