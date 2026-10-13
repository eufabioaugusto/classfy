import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Check, Contrast, Droplets, Eye, Sun, Thermometer, WandSparkles, ScanFace, RotateCcw } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { patchStudioClipGrade, patchStudioClipEnhancement, patchStudioClipPortrait, studioGrade, type StudioEditing, type StudioGrade, type StudioEnhancement, type StudioPortrait } from './model';
import { analyzeStudioSceneAsync, getStudioEnhancementCapabilitiesAsync } from '../../../modules/classfy-studio-media';
import { suggestStudioEnhancement } from './autoEnhance';
import { studioSceneAnalysisRequest } from './sceneTreatments';
import { StudioControlSlider } from './StudioControlSlider';
import { LoadingImage } from '@/components/LoadingImage';
import { prepareStudioFilterPreviews } from './filterPreviews';
import { studioFilterPresets as presets, studioSelectedFilter } from './filterCatalog';

type Props = {
  editing: StudioEditing; targetId: string; disabled?: boolean; initialTab?: 'filters' | 'adjust' | 'scene'; previewsEnabled?: boolean; positionSeconds?: number;
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
  const target = editing.main.find(item => item.id === targetId) ?? editing.layers.flatMap(layer => layer.items).find(item => item.id === targetId);
  const [enhancement, setEnhancement] = useState<StudioEnhancement | undefined>(target?.enhancement);
  const [portrait, setPortrait] = useState<StudioPortrait | undefined>(target?.portrait);
  const enhancementRef = useRef(enhancement), portraitRef = useRef(portrait);
  const [treatmentsAvailable, setTreatmentsAvailable] = useState(false), [analyzing, setAnalyzing] = useState(false);
  const analysisGeneration = useRef(0);
  const analysisActive = useRef(false);
  useEffect(() => { let active = true; void getStudioEnhancementCapabilitiesAsync().then(value => { if (active) setTreatmentsAvailable(value.available); }); return () => { active = false; }; }, []);
  const [tab, setTab] = useState<'filters' | 'adjust' | 'scene'>(initialTab), [parameter, setParameter] = useState<Parameter>('exposure');
  const [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  const live = useRef({ editing, targetId, disabled, onPreview, onApply, onClose, onBefore });
  live.current = { editing, targetId, disabled, onPreview, onApply, onClose, onBefore };
  const draftRef = useRef(draft), mounted = useRef(true), writing = useRef(false), originalHeld = useRef(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null), lastPreview = useRef(0);
  const clearTimer = () => { if (previewTimer.current) clearTimeout(previewTimer.current); previewTimer.current = null; };
  const currentDraft = (untreated = false) => {
    const current = live.current;
    let next = patchStudioClipGrade(current.editing, current.targetId, untreated ? studioGrade() : draftRef.current);
    next = patchStudioClipEnhancement(next, current.targetId, untreated ? null : enhancementRef.current ?? null);
    return patchStudioClipPortrait(next, current.targetId, untreated ? null : portraitRef.current ?? null);
  };
  const publishPreview = () => {
    clearTimer(); lastPreview.current = Date.now();
    const current = live.current;
    if (!mounted.current || current.disabled || writing.current || originalHeld.current) return;
    current.onPreview(currentDraft());
  };
  const original = (held: boolean) => {
    if (held && (live.current.disabled || writing.current)) return;
    originalHeld.current = held; clearTimer();
    if (live.current.onBefore) live.current.onBefore(held);
    else live.current.onPreview(currentDraft(held));
  };
  useEffect(() => {
    clearTimer(); originalHeld.current = false; live.current.onBefore?.(false); live.current.onPreview(undefined);
    const next = gradeFor(editing, targetId); draftRef.current = next; setDraft(next); setError(undefined);
    enhancementRef.current = target?.enhancement; portraitRef.current = target?.portrait;
    setEnhancement(target?.enhancement); setPortrait(target?.portrait); analysisGeneration.current++; analysisActive.current = false; setAnalyzing(false);
  }, [editing, targetId]);
  useEffect(() => { setTab(initialTab); }, [targetId, initialTab]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; analysisGeneration.current++; analysisActive.current = false; clearTimer(); live.current.onBefore?.(false); live.current.onPreview(undefined); };
  }, []);
  useEffect(() => { if (disabled && originalHeld.current) original(false); }, [disabled]);
  useEffect(() => { if (disabled) { analysisGeneration.current++; analysisActive.current = false; setAnalyzing(false); } }, [disabled]);
  const updateTreatment = (kind: 'enhancement' | 'portrait', value: StudioEnhancement | StudioPortrait | undefined, flush = false) => {
    if (live.current.disabled || writing.current || live.current.targetId !== targetId) return;
    if (kind === 'enhancement') { enhancementRef.current = value as StudioEnhancement | undefined; setEnhancement(enhancementRef.current); }
    else { portraitRef.current = value as StudioPortrait | undefined; setPortrait(portraitRef.current); }
    setError(undefined);
    const delay = Math.max(0, 40 - (Date.now() - lastPreview.current));
    if (flush || !delay) publishPreview(); else if (!previewTimer.current) previewTimer.current = setTimeout(publishPreview, delay);
  };
  const improveScene = async () => {
    if (!treatmentsAvailable || analysisActive.current || live.current.disabled || writing.current) return;
    const generation = ++analysisGeneration.current, snapshot = live.current, id = snapshot.targetId;
    analysisActive.current = true;
    setAnalyzing(true); setError(undefined);
    try {
      const request = studioSceneAnalysisRequest(snapshot.editing, id);
      const samples = await analyzeStudioSceneAsync(request);
      if (!mounted.current || generation !== analysisGeneration.current || live.current.disabled || live.current.targetId !== id || live.current.editing !== snapshot.editing) return;
      updateTreatment('enhancement', suggestStudioEnhancement(samples), true);
    } catch (cause) { if (mounted.current && generation === analysisGeneration.current) setError(cause instanceof Error ? cause.message : 'Não foi possível analisar esta cena.'); }
    finally { if (mounted.current && generation === analysisGeneration.current) { analysisActive.current = false; setAnalyzing(false); } }
  };
  const update = (patch: Partial<StudioGrade>) => {
    if (live.current.disabled || writing.current || live.current.targetId !== targetId) return;
    const next = { ...draftRef.current, ...patch }; draftRef.current = next; setDraft(next); setError(undefined);
    const delay = Math.max(0, 40 - (Date.now() - lastPreview.current));
    if (!delay) publishPreview(); else if (!previewTimer.current) previewTimer.current = setTimeout(publishPreview, delay);
  };
  const apply = async () => {
    if (live.current.disabled || writing.current || analyzing) return;
    clearTimer(); originalHeld.current = false; live.current.onBefore?.(false); writing.current = true; setSaving(true); setError(undefined);
    try { await live.current.onApply(currentDraft()); }
    catch { if (mounted.current) setError('Não foi possível salvar. Tente novamente.'); }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };
  const active = parameters.find(item => item.id === parameter)!;
  const blocked = disabled || saving || analyzing;
  return <View style={s.panel}>
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar tratamento" disabled={disabled || saving} onPress={() => { analysisGeneration.current++; onClose(); }} style={s.icon}><ArrowLeft size={22} color={colors.text} strokeWidth={1.7} /></Pressable>
      <View style={s.tabs}>{(['scene', 'filters', 'adjust'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'scene' ? 'Cena' : value === 'filters' ? 'Filtros' : 'Ajustes'} accessibilityState={{ selected: tab === value, disabled: blocked }} disabled={blocked} onPress={() => setTab(value)} style={[s.tab, tab === value && s.selectedTab]}><Text style={[s.tabLabel, tab === value && s.selectedLabel]}>{value === 'scene' ? 'Cena' : value === 'filters' ? 'Filtros' : 'Ajustes'}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="Segure para comparar com o original" disabled={blocked} onPressIn={() => original(true)} onPressOut={() => original(false)} style={({ pressed }) => [s.icon, pressed && s.pressed]}><Eye size={21} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Aplicar tratamento" accessibilityState={{ busy: saving, disabled: blocked }} disabled={blocked} onPress={() => { void apply(); }} style={s.icon}>{saving ? <ActivityIndicator size="small" color={colors.accent} /> : <Check size={24} color={colors.accent} strokeWidth={1.8} />}</Pressable>
    </View>
    {tab === 'scene' ? <ScrollView style={s.sceneScroll} contentContainerStyle={s.sceneContent} showsVerticalScrollIndicator={false}>
      <Text style={s.sceneCaption}>Sua cena, com equilíbrio e naturalidade.</Text>
      {!treatmentsAvailable ? <Text style={s.notice}>Atualize o Classfy para usar os tratamentos neste aparelho.</Text> : null}
      <View style={s.treatmentCard}>
        <View style={s.treatmentTitle}><WandSparkles size={19} color={colors.accent} /><Text style={s.treatmentLabel}>Melhorar cena</Text><Pressable accessibilityRole="button" accessibilityLabel="Remover melhoria da cena" disabled={blocked || !enhancement} onPress={() => updateTreatment('enhancement', undefined, true)} style={s.reset}><RotateCcw size={17} color={colors.textSecondary} /></Pressable></View>
        <Text style={s.sceneDetail}>Luz, cor e contraste a partir do seu original. Sem alterar o arquivo.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Analisar e melhorar cena" accessibilityState={{ busy: analyzing, disabled: blocked || !treatmentsAvailable }} disabled={blocked || !treatmentsAvailable} onPress={() => { void improveScene(); }} style={[s.improve, (blocked || !treatmentsAvailable) && s.disabled]}>{analyzing ? <ActivityIndicator size="small" color={colors.text} /> : <WandSparkles size={17} color={colors.text} />}<Text style={s.improveLabel}>{analyzing ? 'Analisando sua cena…' : enhancement ? 'Analisar novamente' : 'Melhorar cena'}</Text></Pressable>
        <StudioControlSlider label="Intensidade da melhoria" value={enhancement?.strength ?? 0} min={0} max={1} step={0.05} disabled={blocked || !enhancement || !treatmentsAvailable} formatValue={value => `${Math.round(value*100)}%`} onChange={strength => enhancementRef.current && updateTreatment('enhancement', { ...enhancementRef.current, strength })} onInteractionEnd={publishPreview} />
      </View>
      <View style={s.treatmentCard}>
        <View style={s.treatmentTitle}><ScanFace size={19} color={colors.accent} /><Text style={s.treatmentLabel}>Retoque natural</Text><Pressable accessibilityRole="button" accessibilityLabel="Remover retoque natural" disabled={blocked || !portrait} onPress={() => updateTreatment('portrait', undefined, true)} style={s.reset}><RotateCcw size={17} color={colors.textSecondary} /></Pressable></View>
        <Text style={s.sceneDetail}>Suaviza levemente a pele, preservando olhos, boca e traços. Sem mudar seu rosto.</Text>
        <StudioControlSlider label="Intensidade do retoque" value={portrait?.strength ?? 0} min={0} max={1} step={0.05} disabled={blocked || !treatmentsAvailable} formatValue={value => `${Math.round(value*100)}%`} onChange={strength => updateTreatment('portrait', { version: 1, strength })} onInteractionEnd={publishPreview} />
        <Text style={s.sceneHint}>Só atua quando há um rosto identificado no quadro.</Text>
      </View>
    </ScrollView> : tab === 'filters' ? <>
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
  sceneScroll: { maxHeight: 290, flexShrink: 1 }, sceneContent: { paddingHorizontal: 14, paddingBottom: 8, gap: 9 }, sceneCaption: { color: colors.textSecondary, fontSize: 12, paddingTop: 4 },
  treatmentCard: { backgroundColor: colors.surfaceAlt, borderRadius: 13, borderWidth: 1, borderColor: colors.borderSubtle, paddingHorizontal: 10, paddingTop: 7 },
  treatmentTitle: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 32 }, treatmentLabel: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 }, reset: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sceneDetail: { color: colors.textSecondary, fontSize: 11, lineHeight: 16 }, sceneHint: { color: colors.muted, fontSize: 10, lineHeight: 14, paddingBottom: 8 }, notice: { color: colors.accent, fontSize: 11, lineHeight: 16 },
  improve: { minHeight: 42, borderRadius: 9, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 9 }, improveLabel: { color: colors.text, fontSize: 12, fontWeight: '600' }, disabled: { opacity: 0.45 },
});
