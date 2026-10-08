import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Minus, Plus, Trash2 } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { patchStudioLayerItem, studioSeconds, studioTicks, type StudioEditing, type StudioLayerItem } from './model';

type Props = { editing: StudioEditing; item: StudioLayerItem; disabled?: boolean; onPreview: (editing?: StudioEditing) => void; onApply: (editing: StudioEditing) => Promise<void>; onRemove: () => void; onClose: () => void };
export function StudioLayerPanel({ editing, item, disabled, onPreview, onApply, onRemove, onClose }: Props) {
  const [draft, setDraft] = useState(item);
  const [tab, setTab] = useState<'content' | 'position' | 'time'>(item.text ? 'content' : 'position');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const blocked = useRef(false); blocked.current = !!disabled || saving;
  const update = (patch: Partial<StudioLayerItem>) => { if (blocked.current) return; const next = { ...draft, ...patch }; setDraft(next); onPreview(patchStudioLayerItem(editing, item.id, next)); };
  const apply = async () => { if (blocked.current) return; blocked.current = true; setSaving(true); try { await onApply(patchStudioLayerItem(editing, item.id, draft)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); } finally { blocked.current = false; setSaving(false); } };
  const rect = draft.rect || { x: 0, y: 0, width: 1, height: 1 };
  const title = item.kind === 'caption' ? 'Legenda' : item.kind === 'text' ? 'Texto' : item.kind === 'video' ? 'Vídeo sobreposto' : item.kind === 'image' ? 'Imagem' : 'Áudio';
  return <View style={s.panel}>
    <View style={s.header}><Pressable onPress={onClose} accessibilityLabel="Cancelar edição da camada" style={s.icon}><ChevronDown size={20} color={colors.text} /></Pressable><Text style={s.title}>{title}</Text><Pressable onPress={onRemove} disabled={disabled || saving} accessibilityLabel="Excluir camada" style={s.icon}><Trash2 size={18} color={colors.textSecondary} /></Pressable><Pressable accessibilityLabel="Aplicar edição da camada" disabled={disabled || saving} onPress={() => { void apply(); }} style={s.icon}><Check size={22} color={colors.accent} /></Pressable></View>
    {error && <Text style={{ color: colors.accent, fontSize: 11, paddingHorizontal: 14 }}>{error}</Text>}
    <View style={s.tabs}>{(['content','position','time'] as const).filter(t => t !== 'position' || item.kind !== 'audio').map(t => <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, t === tab && s.active]}><Text style={s.label}>{t === 'content' ? draft.text ? 'Texto' : 'Volume' : t === 'position' ? 'Posição' : 'Duração'}</Text></Pressable>)}</View>
    <ScrollView pointerEvents={disabled || saving ? "none" : "auto"} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={s.controls}>
      {tab === 'content' && draft.text ? <>
        <TextInput value={draft.text.content} editable={!disabled && !saving} onChangeText={content => update({ text: { ...draft.text!, content } })} multiline placeholder="Digite seu texto" placeholderTextColor={colors.muted} maxLength={1000} style={s.input} />
        <Step label="Tamanho" value={Math.round(draft.text.fontSize * 100)} suffix="%" onChange={value => update({ text: { ...draft.text!, fontSize: Math.min(0.15, Math.max(0.015, value / 100)) } })} />
        <View style={s.swatches}>{['#FFFFFF','#F7D658','#EF154A'].map(color => <Pressable key={color} accessibilityLabel={`Cor ${color}`} onPress={() => update({ text: { ...draft.text!, color } })} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color, borderWidth: 2, borderColor: draft.text?.color === color ? '#666' : color }} />)}<Pressable onPress={() => update({ text: { ...draft.text!, backgroundColor: draft.text?.backgroundColor === '#000000AA' ? '#00000000' : '#000000AA' } })}><Text style={s.label}>Fundo</Text></Pressable></View>
      </> : tab === 'content' ? <>
        <Step label="Volume" value={Math.round((draft.gain ?? 1) * 100)} suffix="%" step={10} onChange={value => update({ gain: Math.max(0, Math.min(2, value / 100)) })} />
        <Step label="Entrada suave" value={studioSeconds(draft.fadeInTicks || 0)} suffix="s" step={0.1} onChange={value => update({ fadeInTicks: Math.min(Math.floor(draft.durationTicks / 2), studioTicks(Math.max(0, value))) })} />
        <Step label="Saída suave" value={studioSeconds(draft.fadeOutTicks || 0)} suffix="s" step={0.1} onChange={value => update({ fadeOutTicks: Math.min(Math.floor(draft.durationTicks / 2), studioTicks(Math.max(0, value))) })} />
      </> : tab === 'position' ? <>
        <Step label="Horizontal" value={Math.round(rect.x * 100)} suffix="%" step={2} onChange={value => update({ rect: { ...rect, x: Math.max(0, Math.min(1 - rect.width, value / 100)) } })} />
        <Step label="Vertical" value={Math.round(rect.y * 100)} suffix="%" step={2} onChange={value => update({ rect: { ...rect, y: Math.max(0, Math.min(1 - rect.height, value / 100)) } })} />
        <Step label="Escala" value={Math.round(rect.width * 100)} suffix="%" step={2} onChange={value => { const width = Math.max(0.1, Math.min(1, value / 100)); const height = Math.min(1, rect.height * width / rect.width); update({ rect: { x: Math.min(rect.x, 1 - width), y: Math.min(rect.y, 1 - height), width, height } }); }} />
        <Step label="Opacidade" value={Math.round((draft.opacity ?? 1) * 100)} suffix="%" step={10} onChange={value => update({ opacity: Math.max(0, Math.min(1, value / 100)) })} />
      </> : <>
        <Step label="Início" value={studioSeconds(draft.anchor?.sourceStartTicks ?? draft.anchor?.offsetTicks ?? draft.atTicks)} suffix="s" step={0.1} onChange={value => update(draft.anchor ? { anchor: { ...draft.anchor, ...(draft.anchor.sourceStartTicks !== undefined ? { sourceStartTicks: studioTicks(Math.max(0, value)), sourceEndTicks: studioTicks(Math.max(0, value)) + draft.durationTicks } : { offsetTicks: studioTicks(Math.max(0, value)) }) } } : { atTicks: studioTicks(Math.max(0, value)) })} />
        <Step label="Duração" value={studioSeconds(draft.durationTicks)} suffix="s" step={0.1} onChange={value => { const asset = editing.assets.find(a => a.id === draft.assetId); const limit = asset && asset.kind !== 'image' ? studioSeconds(asset.durationTicks - (draft.sourceStartTicks || 0)) : 3600; const ticks = studioTicks(Math.min(limit, Math.max(0.1, value))); update({ durationTicks: ticks, ...(draft.anchor?.sourceStartTicks !== undefined ? { anchor: { ...draft.anchor, sourceEndTicks: draft.anchor.sourceStartTicks + ticks } } : {}), ...(asset && asset.kind !== 'image' ? { sourceEndTicks: (draft.sourceStartTicks || 0) + ticks } : {}) }); }} />
        <Text style={s.hint}>{draft.anchor ? 'Acompanha este take nos cortes.' : 'Posição fixa na montagem.'}</Text>
      </>}
    </ScrollView>
  </View>;
}
function Step({ label, value, suffix, step = 1, onChange }: { label: string; value: number; suffix: string; step?: number; onChange: (value: number) => void }) {
  return <View style={s.step}><Text style={s.hint}>{label}</Text><View style={s.row}><Pressable accessibilityLabel={`Diminuir ${label}`} onPress={() => onChange(value - step)} style={s.icon}><Minus size={16} color={colors.text} /></Pressable><Text style={s.value}>{Number(value.toFixed(1))}{suffix}</Text><Pressable accessibilityLabel={`Aumentar ${label}`} onPress={() => onChange(value + step)} style={s.icon}><Plus size={16} color={colors.text} /></Pressable></View></View>;
}
const s = StyleSheet.create({ panel: { backgroundColor: '#151A1F', borderTopWidth: 1, borderTopColor: '#252B32', paddingBottom: 8 }, header: { flexDirection: 'row', alignItems: 'center', height: 40 }, title: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' }, icon: { width: 42, height: 40, alignItems: 'center', justifyContent: 'center' }, tabs: { flexDirection: 'row', gap: 5, paddingHorizontal: 14 }, tab: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 }, active: { backgroundColor: '#303740' }, label: { color: colors.text, fontSize: 11 }, controls: { minHeight: 77, alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 6 }, input: { width: 170, minHeight: 50, maxHeight: 65, backgroundColor: '#242A31', color: colors.text, fontSize: 13, borderRadius: 8, padding: 10 }, swatches: { flexDirection: 'row', alignItems: 'center', gap: 8 }, step: { alignItems: 'center' }, row: { flexDirection: 'row', alignItems: 'center' }, value: { minWidth: 39, color: colors.text, fontSize: 12, textAlign: 'center', fontVariant: ['tabular-nums'] }, hint: { color: colors.muted, fontSize: 10, maxWidth: 110 } });
