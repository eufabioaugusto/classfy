import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Bold, Check, Copy, Italic, Pencil, Scissors, SlidersHorizontal, Trash2, Type, Volume2, Blend } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { patchStudioLayerItem, studioSeconds, studioTicks, type StudioEditing, type StudioLayerItem } from './model';
import { StudioControlSlider } from './StudioControlSlider';

export type StudioTextEditRequest = { id: string; sequence: number };
type Props = {
  editing: StudioEditing; item: StudioLayerItem; disabled?: boolean; canvasEditing?: boolean;
  editTextRequest?: StudioTextEditRequest; onTextEditConsumed?: (request: StudioTextEditRequest) => void;
  onPreview: (editing?: StudioEditing) => void; onApply: (editing: StudioEditing) => Promise<void>;
  onRemove: () => void; onClose: () => void; onDuplicate?: () => void | Promise<void>;
  onSplit?: () => void | Promise<void>; canSplit?: boolean; onTreatment?: () => void; onEditingChange?: (expanded: boolean) => void;
};
type Mode = 'tools' | 'text' | 'opacity' | 'audio';
type TextTab = 'text' | 'fonts' | 'color' | 'style';
const palette = ['#FFFFFF', '#000000', '#EF154A', '#FF6258', '#F59E0B', '#F7D658', '#A3E635', '#22C55E', '#14B8A6', '#38BDF8', '#3B82F6', '#A78BFA', '#EC4899', '#803DFF', '#D4D4D4'];
const fonts = [
  { title: 'Padrão', regular: 'System', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', both: 'Helvetica-BoldOblique' },
  { title: 'Avenir', regular: 'AvenirNext-Regular', bold: 'AvenirNext-DemiBold', italic: 'AvenirNext-Italic', both: 'AvenirNext-DemiBoldItalic' },
  { title: 'Clássica', regular: 'Georgia', bold: 'Georgia-Bold', italic: 'Georgia-Italic', both: 'Georgia-BoldItalic' },
  { title: 'Editorial', regular: 'TimesNewRomanPSMT', bold: 'TimesNewRomanPS-BoldMT', italic: 'TimesNewRomanPS-ItalicMT', both: 'TimesNewRomanPS-BoldItalicMT' },
  { title: 'Mono', regular: 'Menlo-Regular', bold: 'Menlo-Bold', italic: 'Menlo-Italic', both: 'Menlo-BoldItalic' },
  { title: 'Texto', regular: 'Verdana', bold: 'Verdana-Bold', italic: 'Verdana-Italic', both: 'Verdana-BoldItalic' },
];
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function StudioLayerPanel(props: Props) {
  const { editing, item, disabled = false, editTextRequest, onTextEditConsumed } = props;
  const [draft, setDraft] = useState(item), [mode, setMode] = useState<Mode>('tools'), [textTab, setTextTab] = useState<TextTab>('text'), [audioFade, setAudioFade] = useState<'in' | 'out' | undefined>(undefined);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  const live = useRef(props); live.current = props;
  const draftRef = useRef(draft), textInput = useRef<TextInput>(null), consumedTextEdit = useRef<number | undefined>(undefined);
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { draftRef.current = item; setDraft(item); }, [item]);
  useEffect(() => { setMode('tools'); setTextTab('text'); setAudioFade(undefined); setError(undefined); }, [item.id]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; live.current.onEditingChange?.(false); }; }, []);
  useEffect(() => { live.current.onEditingChange?.(mode !== 'tools'); }, [mode]);
  // Open the text editor first. A separate render mounts its input before focus.
  useEffect(() => {
    if (!editTextRequest || editTextRequest.id !== item.id || !item.text || disabled || saving || consumedTextEdit.current === editTextRequest.sequence) return;
    if (mode !== 'text' || textTab !== 'text') { setMode('text'); setTextTab('text'); return; }
    const request = editTextRequest;
    const frame = requestAnimationFrame(() => {
      const current = live.current;
      if (current.disabled || writing.current || current.item.id !== request.id || current.editTextRequest?.sequence !== request.sequence || !textInput.current) return;
      consumedTextEdit.current = request.sequence;
      textInput.current.focus(); current.onTextEditConsumed?.(request);
    });
    return () => cancelAnimationFrame(frame);
  }, [editTextRequest, item.id, disabled, saving, mode, textTab, onTextEditConsumed]);
  const blocked = disabled || saving;
  const update = (patch: Partial<StudioLayerItem>) => {
    if (live.current.disabled || writing.current || live.current.item.id !== item.id) return;
    const next = { ...draftRef.current, ...patch }; draftRef.current = next; setDraft(next); setError(undefined);
    live.current.onPreview(patchStudioLayerItem(live.current.editing, live.current.item.id, next));
  };
  const text = (patch: Partial<NonNullable<StudioLayerItem['text']>>) => {
    const current = draftRef.current.text; if (current) update({ text: { ...current, ...patch } });
  };
  const perform = async (operation: () => void | Promise<void>) => {
    if (live.current.disabled || writing.current) return;
    writing.current = true; setSaving(true); setError(undefined);
    try { await operation(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { writing.current = false; if (mounted.current) setSaving(false); }
  };
  const apply = () => perform(() => {
    const current = live.current; return current.onApply(patchStudioLayerItem(current.editing, current.item.id, draftRef.current));
  });
  const title = item.kind === 'caption' ? 'Legenda' : item.kind === 'text' ? 'Texto' : item.kind === 'video' ? 'Vídeo' : item.kind === 'image' ? 'Imagem' : 'Áudio';
  const family = fonts.find(font => [font.regular, font.bold, font.italic, font.both].includes(draft.text?.fontFamily || '')) ?? fonts[0];
  const bold = draft.text?.fontFamily === family.bold || draft.text?.fontFamily === family.both;
  const italic = draft.text?.fontFamily === family.italic || draft.text?.fontFamily === family.both;
  const setFontStyle = (nextBold: boolean, nextItalic: boolean) => text({ fontFamily: nextBold ? nextItalic ? family.both : family.bold : nextItalic ? family.italic : family.regular });
  return <View style={s.panel}>
    {mode === 'tools' ? <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.tools}>
      <Tool label="Voltar" accessibilityLabel="Cancelar edição da camada" icon={ArrowLeft} disabled={blocked} onPress={props.onClose} />
      {props.onSplit && <Tool label="Dividir" icon={Scissors} disabled={blocked || !props.canSplit} onPress={() => { void perform(props.onSplit!); }} />}
      <Tool label="Editar" accessibilityLabel={draft.text ? 'Editar texto' : 'Editar camada'} icon={Pencil} disabled={blocked} onPress={() => { setTextTab('text'); setMode(draft.text ? 'text' : item.kind === 'audio' ? 'audio' : 'opacity'); }} />
      {props.onDuplicate && <Tool label="Duplicar" icon={Copy} disabled={blocked} onPress={() => { void perform(props.onDuplicate!); }} />}
      <Tool label="Excluir" accessibilityLabel="Excluir camada" icon={Trash2} disabled={blocked} onPress={props.onRemove} />
      {item.kind !== 'audio' && <Tool label="Opacidade" icon={Blend} disabled={blocked} onPress={() => setMode('opacity')} />}
      {item.kind === 'video' && <Tool label="Volume" icon={Volume2} disabled={blocked} onPress={() => setMode('audio')} />}
      {(item.kind === 'video' || item.kind === 'image') && props.onTreatment && <Tool label="Ajustar" icon={SlidersHorizontal} disabled={blocked} onPress={props.onTreatment} />}
      <Tool label="Concluir" accessibilityLabel="Aplicar edição da camada" icon={Check} accent disabled={blocked} busy={saving} onPress={() => { void apply(); }} />
    </ScrollView> : <>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar às ferramentas da camada" disabled={blocked} onPress={() => setMode('tools')} style={s.icon}><ArrowLeft size={24} color={colors.text} strokeWidth={1.7} /></Pressable>
        <Text style={s.title}>{mode === 'text' ? title : mode === 'opacity' ? 'Opacidade' : 'Áudio'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Aplicar edição da camada" accessibilityState={{ disabled: blocked, busy: saving }} disabled={blocked} onPress={() => { void apply(); }} style={s.icon}>{saving ? <ActivityIndicator size="small" color={colors.accent} /> : <Check size={26} color={colors.accent} strokeWidth={1.8} />}</Pressable>
      </View>
      {mode === 'text' && draft.text ? <>
        <View style={s.tabs}>{(['text', 'fonts', 'color', 'style'] as const).map(tab => <Pressable key={tab} accessibilityRole="button" accessibilityLabel={tab === 'text' ? 'Editar conteúdo do texto' : tab === 'fonts' ? 'Fontes do texto' : tab === 'color' ? 'Cor do texto' : 'Estilo do texto'} accessibilityState={{ selected: textTab === tab }} disabled={blocked} onPress={() => setTextTab(tab)} style={[s.tab, textTab === tab && s.selected]}><Text style={[s.tabLabel, textTab === tab && s.selectedLabel]}>{tab === 'text' ? 'Texto' : tab === 'fonts' ? 'Fontes' : tab === 'color' ? 'Cor' : 'Estilo'}</Text></Pressable>)}</View>
        {textTab === 'text' ? <TextInput ref={textInput} accessibilityLabel="Texto da camada" value={draft.text.content} editable={!blocked} onChangeText={content => text({ content })} multiline placeholder="Digite seu texto" placeholderTextColor={colors.muted} maxLength={1000} style={s.input} /> : textTab === 'fonts' ? <View style={s.fonts}>{fonts.map(font => <Pressable key={font.regular} accessibilityRole="button" accessibilityLabel={`Fonte ${font.title}`} accessibilityState={{ selected: family === font }} disabled={blocked} onPress={() => text({ fontFamily: font.regular })} style={[s.font, family === font && s.fontSelected]}><Text style={[s.fontSample, { fontFamily: font.regular === 'System' ? undefined : font.regular }]}>{font.title}</Text></Pressable>)}</View> : textTab === 'color' ? <View style={s.palette}>{palette.map(color => <Pressable key={color} accessibilityRole="button" accessibilityLabel={`Cor ${color}`} accessibilityState={{ selected: draft.text?.color === color }} disabled={blocked} onPress={() => text({ color })} style={s.swatchTouch}><View style={[s.swatch, { backgroundColor: color }, draft.text?.color === color && s.swatchSelected]}>{draft.text?.color === color && <Check size={18} color={color === '#FFFFFF' || color === '#F7D658' || color === '#D4D4D4' ? '#111111' : '#FFFFFF'} />}</View></Pressable>)}</View> : <View style={s.styleOptions}>
          {([{ id: 'left', Icon: AlignLeft }, { id: 'center', Icon: AlignCenter }, { id: 'right', Icon: AlignRight }] as const).map(({ id, Icon }) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Alinhar texto ${id === 'left' ? 'à esquerda' : id === 'right' ? 'à direita' : 'ao centro'}`} accessibilityState={{ selected: draft.text?.alignment === id }} disabled={blocked} onPress={() => text({ alignment: id })} style={[s.styleButton, draft.text?.alignment === id && s.selected]}><Icon size={24} color={colors.text} strokeWidth={1.7} /></Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel="Negrito" accessibilityState={{ selected: bold }} disabled={blocked} onPress={() => setFontStyle(!bold, italic)} style={[s.styleButton, bold && s.selected]}><Bold size={24} color={colors.text} strokeWidth={1.7} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Itálico" accessibilityState={{ selected: italic }} disabled={blocked} onPress={() => setFontStyle(bold, !italic)} style={[s.styleButton, italic && s.selected]}><Italic size={24} color={colors.text} strokeWidth={1.7} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Fundo do texto" accessibilityState={{ selected: draft.text.backgroundColor !== '#00000000' }} disabled={blocked} onPress={() => text({ backgroundColor: draftRef.current.text?.backgroundColor === '#00000000' ? '#000000AA' : '#00000000' })} style={[s.styleButton, draft.text.backgroundColor !== '#00000000' && s.selected]}><Type size={24} color={colors.text} strokeWidth={1.7} /></Pressable>
        </View>}
      </> : mode === 'opacity' ? <StudioControlSlider label="Opacidade" value={draft.opacity ?? 1} min={0} max={1} step={0.01} disabled={blocked} formatValue={percent} onChange={opacity => update({ opacity })} /> : mode === 'audio' ? <>
        <StudioControlSlider label="Volume" value={draft.gain ?? 1} min={0} max={2} step={0.05} disabled={blocked} formatValue={percent} onChange={gain => update({ gain })} />
        <View style={s.audioTabs}>{(['in', 'out'] as const).map(edge => <Pressable key={edge} accessibilityRole="button" accessibilityLabel={edge === 'in' ? 'Entrada suave do áudio' : 'Saída suave do áudio'} disabled={blocked} onPress={() => setAudioFade(previous => previous === edge ? undefined : edge)} style={[s.tab, audioFade === edge && s.selected]}><Text style={s.tabLabel}>{edge === 'in' ? 'Entrada suave' : 'Saída suave'}</Text></Pressable>)}</View>
        {audioFade && <StudioControlSlider label={audioFade === 'in' ? 'Entrada suave' : 'Saída suave'} value={studioSeconds((audioFade === 'in' ? draft.fadeInTicks : draft.fadeOutTicks) ?? 0)} min={0} max={studioSeconds(Math.floor(draft.durationTicks / 2))} step={0.1} disabled={blocked} formatValue={value => `${value.toFixed(1)} s`} onChange={value => update(audioFade === 'in' ? { fadeInTicks: studioTicks(value) } : { fadeOutTicks: studioTicks(value) })} />}
      </> : null}
    </>}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </View>;
}
function Tool({ label, accessibilityLabel, icon: Icon, disabled, onPress, accent, busy }: { label: string; accessibilityLabel?: string; icon: typeof Check; disabled?: boolean; onPress: () => void; accent?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.tool, pressed && s.pressed, disabled && s.disabled]}>{busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon size={26} color={accent ? colors.accent : colors.text} strokeWidth={1.6} />}<Text style={[s.toolLabel, accent && { color: colors.accent }]}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingBottom: 6 },
  tools: { paddingHorizontal: 6, paddingTop: 4, gap: 2 }, tool: { width: 66, height: 72, justifyContent: 'center', alignItems: 'center', gap: 7, borderRadius: 12 },
  toolLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' }, pressed: { backgroundColor: colors.surfaceMuted }, disabled: { opacity: 0.35 },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5 }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  tabs: { flexDirection: 'row', paddingHorizontal: 12, gap: 4 }, tab: { minHeight: 36, flex: 1, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, tabLabel: { color: colors.muted, fontSize: 13, fontWeight: '500' }, selected: { backgroundColor: colors.surfaceMuted }, selectedLabel: { color: colors.text },
  input: { marginHorizontal: 12, marginTop: 8, marginBottom: 4, minHeight: 64, maxHeight: 82, borderRadius: 12, backgroundColor: colors.surfaceAlt, color: colors.text, fontSize: 18, paddingHorizontal: 14, paddingVertical: 10, textAlignVertical: 'top' },
  fonts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, rowGap: 10 }, font: { width: '48%', height: 64, borderRadius: 10, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center', alignItems: 'center', gap: 3, backgroundColor: colors.surfaceAlt }, fontSelected: { borderColor: colors.text }, fontSample: { color: colors.text, fontSize: 24 }, fontName: { color: colors.textSecondary, fontSize: 11 },
  palette: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 6, justifyContent: 'center' }, swatchTouch: { width: '20%', height: 56, alignItems: 'center', justifyContent: 'center' }, swatch: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#555555', alignItems: 'center', justifyContent: 'center' }, swatchSelected: { borderWidth: 2, borderColor: colors.text },
  styleOptions: { flexDirection: 'row', justifyContent: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 12 }, styleButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  audioTabs: { flexDirection: 'row', paddingHorizontal: 14, gap: 6 }, error: { color: colors.accent, fontSize: 12, paddingHorizontal: 14, paddingVertical: 6 },
});
