import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Bold, Check, Copy, Italic, Pencil, Scissors, SlidersHorizontal, Trash2, Type, Volume2, Blend, Bookmark, Search, Sparkles, Gauge, FlipHorizontal2 } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { patchStudioLayerItem, studioSeconds, studioTicks, type StudioEditing, type StudioLayerItem } from './model';
import { StudioControlSlider } from './StudioControlSlider';
import { studioFonts as fonts, loadStudioTextLibrary, saveStudioTextLibrary, type StudioTextLibrary } from './textLibrary';
import type { StudioClipPanelMode } from './StudioClipPanel';

export type StudioTextEditRequest = { id: string; sequence: number };
type Props = {
  editing: StudioEditing; item: StudioLayerItem; disabled?: boolean; canvasEditing?: boolean; ownerId?: string; toolsEnabled?: boolean;
  onClipTool?: (mode: StudioClipPanelMode) => void; onExtractAudio?: () => void | Promise<void>;
  editTextRequest?: StudioTextEditRequest; onTextEditConsumed?: (request: StudioTextEditRequest) => void;
  onPreview: (editing?: StudioEditing) => void; onApply: (editing: StudioEditing) => Promise<void>;
  onRemove: () => void; onClose: () => void; onDuplicate?: () => void | Promise<void>;
  onSplit?: () => void | Promise<void>; canSplit?: boolean; onTreatment?: () => void; onEditingChange?: (expanded: boolean) => void;
};
type Mode = 'tools' | 'text' | 'opacity' | 'audio';
type TextTab = 'text' | 'fonts' | 'color' | 'style' | 'animation' | 'effects' | 'decoration';
type FontFilter = 'all' | 'saved' | 'recent' | 'simple' | 'serif' | 'display' | 'mono';
const palette = ['#FFFFFF', '#000000', '#EF154A', '#FF6258', '#F59E0B', '#F7D658', '#A3E635', '#22C55E', '#14B8A6', '#38BDF8', '#3B82F6', '#A78BFA', '#EC4899', '#803DFF', '#D4D4D4'];
const animations = [ ['none', 'Nenhuma'], ['typewriter', 'Máquina de escrever'], ['pop', 'Estourar'], ['bounce', 'Saltar'], ['fade', 'Esmaecer'], ['zoom', 'Zoom'], ['slide-right', 'Deslizar à direita'] ] as const;
const effects = [ ['none', 'Nenhum'], ['shadow-soft', 'Sombra suave'], ['shadow-strong', 'Sombra forte'], ['block', 'Deslocamento em bloco'], ['neon', 'Neon'], ['glow', 'Brilho'], ['halo', 'Halo'] ] as const;
const decorations = [ ['none', 'Nenhum'], ['outline', 'Contorno'], ['outline-inverse', 'Contorno invertido'], ['background', 'Plano de fundo'], ['background-inverse', 'Fundo invertido'] ] as const;
const percent = (value: number) => `${Math.round(value * 100)}%`;

export function StudioLayerPanel(props: Props) {
  const { editing, item, disabled = false, editTextRequest, onTextEditConsumed } = props;
  const [draft, setDraft] = useState(item), [mode, setMode] = useState<Mode>('tools'), [textTab, setTextTab] = useState<TextTab>('text'), [audioFade, setAudioFade] = useState<'in' | 'out' | undefined>(undefined);
  const [fontFilter, setFontFilter] = useState<FontFilter>('all'), [fontSearch, setFontSearch] = useState(''), [secondary, setSecondary] = useState(false);
  const [library, setLibrary] = useState<StudioTextLibrary>({ favorites: [], recent: [] }), libraryRef = useRef(library), libraryEpoch = useRef(0);
  const [libraryStatus, setLibraryStatus] = useState<'loading' | 'ready' | 'error'>(props.ownerId ? 'loading' : 'ready');
  const libraryScope = useRef<{ owner?: string; generation: number; status: 'loading' | 'ready' | 'error' }>({ owner: props.ownerId, generation: 0, status: props.ownerId ? 'loading' : 'ready' });
  if (libraryScope.current.owner !== props.ownerId) libraryScope.current = { owner: props.ownerId, generation: libraryScope.current.generation + 1, status: 'loading' };
  const libraryGeneration = libraryScope.current.generation;
  const libraryReady = libraryStatus === 'ready' && libraryScope.current.status === 'ready';
  const [notice, setNotice] = useState<string>();
  const [applyToLane, setApplyToLane] = useState(false);
  const [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  const live = useRef(props); live.current = props;
  const draftRef = useRef(draft), textInput = useRef<TextInput>(null), consumedTextEdit = useRef<number | undefined>(undefined);
  const writing = useRef(false), mounted = useRef(true);
  useEffect(() => { draftRef.current = item; setDraft(item); }, [item]);
  useEffect(() => { setMode('tools'); setTextTab('text'); setAudioFade(undefined); setApplyToLane(false); setError(undefined); }, [item.id]);
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
  useEffect(() => {
    const epoch = ++libraryEpoch.current, owner = props.ownerId;
    libraryScope.current.status = owner ? 'loading' : 'ready'; setLibraryStatus(libraryScope.current.status);
    libraryRef.current = { favorites: [], recent: [] }; setLibrary(libraryRef.current); setNotice(undefined);
    if (owner) void loadStudioTextLibrary(owner).then(value => {
      if (mounted.current && libraryEpoch.current === epoch && live.current.ownerId === owner) {
        libraryRef.current = value; setLibrary(value); libraryScope.current.status = 'ready'; setLibraryStatus('ready');
      }
    }).catch(() => {
      if (mounted.current && libraryEpoch.current === epoch && live.current.ownerId === owner) {
        libraryScope.current.status = 'error'; setLibraryStatus('error'); setNotice('Não foi possível abrir suas fontes salvas.');
      }
    });
    return () => { libraryEpoch.current += 1; };
  }, [props.ownerId]);
  const saveLibrary = (next: StudioTextLibrary, message?: string) => {
    // A replacement snapshot is safe only after this account was hydrated.
    // Font styling remains usable while storage loads or reports a read error.
    if (!mounted.current || live.current.disabled || writing.current || live.current.ownerId !== props.ownerId
      || live.current.item.id !== item.id || libraryScope.current.generation !== libraryGeneration || libraryScope.current.status !== 'ready') return;
    const owner = live.current.ownerId, epoch = ++libraryEpoch.current;
    libraryRef.current = next; setLibrary(next); setNotice(undefined);
    if (!owner) { if (message) setNotice(message); return; }
    void saveStudioTextLibrary(owner, next).then(() => {
      if (mounted.current && libraryEpoch.current === epoch && live.current.ownerId === owner && message) setNotice(message);
    }).catch(() => { if (mounted.current && libraryEpoch.current === epoch && live.current.ownerId === owner) setNotice('Não foi possível salvar a biblioteca. Tente novamente.'); });
  };
  const chooseFont = (id: string) => {
    if (!mounted.current || live.current.ownerId !== props.ownerId || live.current.item.id !== item.id || libraryScope.current.generation !== libraryGeneration) return;
    text({ fontFamily: id }); const previous = libraryRef.current;
    saveLibrary({ ...previous, recent: [id, ...previous.recent.filter(value => value !== id)].slice(0, 12) });
  };
  const favoriteFont = (id: string) => {
    const previous = libraryRef.current, saved = previous.favorites.includes(id);
    saveLibrary({ ...previous, favorites: saved ? previous.favorites.filter(value => value !== id) : [...previous.favorites, id] }, saved ? 'Fonte removida das salvas.' : 'A fonte foi salva.');
  };
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
    const current = live.current;
    let next = patchStudioLayerItem(current.editing, current.item.id, draftRef.current);
    const appearance = draftRef.current.text;
    if (applyToLane && appearance) next = { ...next, layers: next.layers.map(lane => lane.items.some(value => value.id === current.item.id)
      ? { ...lane, items: lane.items.map(value => value.text && value.kind === current.item.kind ? { ...value, text: { ...appearance, content: value.text.content } } : value) } : lane) };
    return current.onApply(next);
  });
  const title = item.kind === 'caption' ? 'Legenda' : item.kind === 'text' ? 'Texto' : item.kind === 'video' ? 'Vídeo' : item.kind === 'image' ? 'Imagem' : 'Áudio';
  const family = fonts.find(font => [font.regular, font.bold, font.italic, font.both].some(value => value === (draft.text?.fontFamily || ''))) ?? fonts[0];
  const bold = draft.text?.fontFamily === family.bold || draft.text?.fontFamily === family.both;
  const italic = draft.text?.fontFamily === family.italic || draft.text?.fontFamily === family.both;
  const setFontStyle = (nextBold: boolean, nextItalic: boolean) => text({ fontFamily: nextBold ? nextItalic ? family.both : family.bold : nextItalic ? family.italic : family.regular });
  const visibleFonts = fonts.filter(font => (fontFilter === 'all' || fontFilter === 'saved' && library.favorites.includes(font.regular) || fontFilter === 'recent' && library.recent.includes(font.regular) || font.category === fontFilter) && font.title.toLocaleLowerCase('pt-BR').includes(fontSearch.toLocaleLowerCase('pt-BR')));
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
      {(item.kind === 'video' || item.kind === 'audio') && props.onClipTool && <Tool label="Velocidade" icon={Gauge} disabled={blocked || !props.toolsEnabled} onPress={() => props.onClipTool?.('speed')} />}
      {(item.kind === 'video' || item.kind === 'image') && props.onClipTool && <><Tool label="Espelhar" icon={FlipHorizontal2} disabled={blocked || !props.toolsEnabled} onPress={() => props.onClipTool?.('mirror')} /><Tool label="Efeitos" icon={Sparkles} disabled={blocked || !props.toolsEnabled} onPress={() => props.onClipTool?.('motion')} /></>}
      {item.kind === 'video' && props.onExtractAudio && <Tool label="Extrair áudio" icon={Volume2} disabled={blocked || !props.toolsEnabled} onPress={() => { void perform(props.onExtractAudio!); }} />}
      <Tool label="Concluir" accessibilityLabel="Aplicar edição da camada" icon={Check} accent disabled={blocked} busy={saving} onPress={() => { void apply(); }} />
    </ScrollView> : <>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar às ferramentas da camada" disabled={blocked} onPress={() => setMode('tools')} style={s.icon}><ArrowLeft size={22} color={colors.text} strokeWidth={1.7} /></Pressable>
        <Text style={s.title}>{mode === 'text' ? title : mode === 'opacity' ? 'Opacidade' : 'Áudio'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Aplicar edição da camada" accessibilityState={{ disabled: blocked, busy: saving }} disabled={blocked} onPress={() => { void apply(); }} style={s.icon}>{saving ? <ActivityIndicator size="small" color={colors.accent} /> : <Check size={24} color={colors.accent} strokeWidth={1.8} />}</Pressable>
      </View>
      {mode === 'text' && draft.text ? <>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="Aplicar estilo à faixa de texto" accessibilityState={{ checked: applyToLane }} disabled={blocked} onPress={() => setApplyToLane(value => !value)} style={s.applyLane}><View style={[s.laneCheck, applyToLane && { borderColor: colors.accent, backgroundColor: colors.accent }]}>{applyToLane && <Check size={13} color="#FFFFFF" />}</View><Text style={s.tabLabel}>Aplicar estilo à faixa</Text></Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.tabs}>{([['text', 'Texto'], ['fonts', 'Fontes'], ['color', 'Cor'], ['style', 'Estilo'], ['animation', 'Animação'], ['effects', 'Efeitos'], ['decoration', 'Fundo']] as const).map(([tab, label]) => <Pressable key={tab} accessibilityRole="tab" accessibilityLabel={tab === 'text' ? 'Editar conteúdo do texto' : tab === 'fonts' ? 'Fontes do texto' : tab === 'color' ? 'Cor do texto' : tab === 'style' ? 'Estilo do texto' : tab === 'decoration' ? 'Contorno e fundo do texto' : `${label} do texto`} accessibilityState={{ selected: textTab === tab }} disabled={blocked} onPress={() => setTextTab(tab)} style={[s.textTab, textTab === tab && s.selected]}><Text style={[s.tabLabel, textTab === tab && s.selectedLabel]}>{label}</Text></Pressable>)}</ScrollView>
        {textTab === 'text' ? <TextInput ref={textInput} accessibilityLabel="Texto da camada" value={draft.text.content} editable={!blocked} onChangeText={content => text({ content })} multiline placeholder="Digite seu texto" placeholderTextColor={colors.muted} maxLength={1000} style={s.input} /> : textTab === 'fonts' ? <>
          <View style={s.search}><Search size={16} color={colors.muted} /><TextInput accessibilityLabel="Pesquisar fontes" value={fontSearch} onChangeText={setFontSearch} placeholder="Pesquise fontes" placeholderTextColor={colors.muted} style={s.searchInput} /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.fontFilters}>{([['all','Tudo'], ['saved','Salvas'], ['recent','Recentes'], ['simple','Simples'], ['serif','Serifadas'], ['display','Impacto'], ['mono','Mono']] as const).map(([id,label]) => <Pressable key={id} accessibilityRole="tab" accessibilityLabel={`Fontes ${label}`} accessibilityState={{ selected: fontFilter === id }} disabled={blocked} onPress={() => setFontFilter(id)} style={[s.textTab, fontFilter === id && s.selected]}><Text style={s.tabLabel}>{label}</Text></Pressable>)}</ScrollView>
          <ScrollView style={s.catalogScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.fonts}>{visibleFonts.map(font => <View key={font.regular} style={[s.font, family === font && s.fontSelected]}><Pressable accessibilityRole="button" accessibilityLabel={`Fonte ${font.title}`} accessibilityState={{ selected: family === font }} disabled={blocked} onPress={() => chooseFont(font.regular)} style={s.fontChoice}><Text style={[s.fontSample, { fontFamily: font.regular === 'System' ? undefined : font.regular }]}>{font.title}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${library.favorites.includes(font.regular) ? 'Remover' : 'Salvar'} fonte ${font.title}`} accessibilityState={{ selected: library.favorites.includes(font.regular), disabled: blocked || !libraryReady }} disabled={blocked || !libraryReady} onPress={() => favoriteFont(font.regular)} style={s.favorite}><Bookmark size={15} color={library.favorites.includes(font.regular) ? colors.accent : colors.muted} fill={library.favorites.includes(font.regular) ? colors.accent : 'transparent'} /></Pressable></View>)}{!visibleFonts.length && <Text style={s.notice}>{fontFilter === 'saved' ? 'Salve uma fonte pelo marcador para encontrá-la aqui.' : 'Nenhuma fonte encontrada.'}</Text>}</ScrollView>
        </> : textTab === 'color' ? <>
          <View style={s.audioTabs}><Pressable accessibilityRole="button" accessibilityLabel="Cor primária do texto" accessibilityState={{ selected: !secondary }} disabled={blocked} onPress={() => setSecondary(false)} style={[s.tab, !secondary && s.selected]}><Text style={s.tabLabel}>Primária</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Cor secundária do texto" accessibilityState={{ selected: secondary }} disabled={blocked} onPress={() => setSecondary(true)} style={[s.tab, secondary && s.selected]}><Text style={s.tabLabel}>Secundária</Text></Pressable>{props.toolsEnabled && <Pressable accessibilityRole="button" accessibilityLabel="Degradê do texto" accessibilityState={{ selected: !!draft.text.gradientColors }} disabled={blocked} onPress={() => text({ gradientColors: draft.text?.gradientColors ? undefined : [draft.text?.color || '#FFFFFF', draft.text?.secondaryColor || '#EF154A'] })} style={[s.tab, !!draft.text.gradientColors && s.selected]}><Text style={s.tabLabel}>Degradê</Text></Pressable>}</View>
          <View style={s.palette}>{palette.map(color => { const selectedColor = secondary ? draft.text?.secondaryColor || '#000000' : draft.text?.color; return <Pressable key={color} accessibilityRole="button" accessibilityLabel={`Cor ${color}`} accessibilityState={{ selected: selectedColor === color }} disabled={blocked} onPress={() => text({ ...(secondary ? { secondaryColor: color } : { color }), ...(draft.text?.gradientColors ? { gradientColors: secondary ? [draft.text.gradientColors[0], color] : [color, draft.text.gradientColors[1]] } : {}) })} style={s.swatchTouch}><View style={[s.swatch, { backgroundColor: color }, selectedColor === color && s.swatchSelected]}>{selectedColor === color && <Check size={16} color={color === '#FFFFFF' || color === '#F7D658' || color === '#D4D4D4' ? '#111111' : '#FFFFFF'} />}</View></Pressable>; })}</View>
        </> : textTab === 'style' ? <>
          <View style={s.styleOptions}>{([{ id: 'left', Icon: AlignLeft }, { id: 'center', Icon: AlignCenter }, { id: 'right', Icon: AlignRight }] as const).map(({ id, Icon }) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Alinhar texto ${id === 'left' ? 'à esquerda' : id === 'right' ? 'à direita' : 'ao centro'}`} accessibilityState={{ selected: draft.text?.alignment === id }} disabled={blocked} onPress={() => text({ alignment: id })} style={[s.styleButton, draft.text?.alignment === id && s.selected]}><Icon size={20} color={colors.text} strokeWidth={1.7} /></Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel="Negrito" accessibilityState={{ selected: bold }} disabled={blocked} onPress={() => setFontStyle(!bold, italic)} style={[s.styleButton, bold && s.selected]}><Bold size={20} color={colors.text} strokeWidth={1.7} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Itálico" accessibilityState={{ selected: italic }} disabled={blocked} onPress={() => setFontStyle(bold, !italic)} style={[s.styleButton, italic && s.selected]}><Italic size={20} color={colors.text} strokeWidth={1.7} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Fundo do texto" accessibilityState={{ selected: draft.text.backgroundColor !== '#00000000' }} disabled={blocked} onPress={() => text({ backgroundColor: draftRef.current.text?.backgroundColor === '#00000000' ? '#000000AA' : '#00000000' })} style={[s.styleButton, draft.text.backgroundColor !== '#00000000' && s.selected]}><Type size={20} color={colors.text} strokeWidth={1.7} /></Pressable></View>
          <StudioControlSlider label="Tamanho do texto" value={draft.text.fontSize * 1000} min={5} max={180} step={1} disabled={blocked} onChange={value => text({ fontSize: value / 1000 })} />
        </> : !props.toolsEnabled ? <Text style={s.notice}>Instale o Classfy Dev atualizado para usar os novos estilos e animações.</Text> : <ScrollView style={s.catalogScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.fonts}>
          {textTab === 'animation' ? animations.map(([id,label]) => <Preset key={id} label={label} selected={(draft.text?.animation || 'none') === id} disabled={blocked} onPress={() => text({ animation: id })} />) : textTab === 'effects' ? effects.map(([id,label]) => <Preset key={id} label={label} selected={(draft.text?.visualEffect || 'none') === id} disabled={blocked} onPress={() => text({ visualEffect: id })} />) : decorations.map(([id,label]) => <Preset key={id} label={label} selected={(draft.text?.decoration || 'none') === id} disabled={blocked} onPress={() => text({ decoration: id, backgroundColor: id === 'background' ? '#000000' : id === 'background-inverse' ? '#FFFFFF' : '#00000000' })} />)}
        </ScrollView>}
        {notice && <Pressable accessibilityRole="button" accessibilityLabel="Ver fontes salvas" onPress={() => { setFontFilter('saved'); setTextTab('fonts'); setNotice(undefined); }} style={s.toast}><Text accessibilityRole="alert" style={s.notice}>{notice}</Text><Text style={s.tabLabel}>Ver</Text></Pressable>}
      </> : mode === 'opacity' ? <StudioControlSlider label="Opacidade" value={draft.opacity ?? 1} min={0} max={1} step={0.01} disabled={blocked} formatValue={percent} onChange={opacity => update({ opacity })} /> : mode === 'audio' ? <>
        <StudioControlSlider label="Volume" value={draft.gain ?? 1} min={0} max={2} step={0.05} disabled={blocked} formatValue={percent} onChange={gain => update({ gain })} />
        <View style={s.audioTabs}>{(['in', 'out'] as const).map(edge => <Pressable key={edge} accessibilityRole="button" accessibilityLabel={edge === 'in' ? 'Entrada suave do áudio' : 'Saída suave do áudio'} disabled={blocked} onPress={() => setAudioFade(previous => previous === edge ? undefined : edge)} style={[s.tab, audioFade === edge && s.selected]}><Text style={s.tabLabel}>{edge === 'in' ? 'Entrada suave' : 'Saída suave'}</Text></Pressable>)}</View>
        {audioFade && <StudioControlSlider label={audioFade === 'in' ? 'Entrada suave' : 'Saída suave'} value={studioSeconds((audioFade === 'in' ? draft.fadeInTicks : draft.fadeOutTicks) ?? 0)} min={0} max={studioSeconds(Math.floor(draft.durationTicks / 2))} step={0.1} disabled={blocked} formatValue={value => `${value.toFixed(1)} s`} onChange={value => update(audioFade === 'in' ? { fadeInTicks: studioTicks(value) } : { fadeOutTicks: studioTicks(value) })} />}
      </> : null}
    </>}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </View>;
}
function Preset({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[s.font, selected && s.fontSelected]}><Text style={s.presetLabel}>{label}</Text></Pressable>;
}
function Tool({ label, accessibilityLabel, icon: Icon, disabled, onPress, accent, busy }: { label: string; accessibilityLabel?: string; icon: typeof Check; disabled?: boolean; onPress: () => void; accent?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.tool, pressed && s.pressed, disabled && s.disabled]}>{busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Icon size={20} color={accent ? colors.accent : colors.text} strokeWidth={1.6} />}<Text style={[s.toolLabel, accent && { color: colors.accent }]}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.borderSubtle, paddingBottom: 6 },
  tools: { paddingHorizontal: 8, paddingTop: 6 }, tool: { width: 64, height: 60, justifyContent: 'center', alignItems: 'center', gap: 6, borderRadius: 12 },
  toolLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' }, pressed: { backgroundColor: colors.surfaceMuted }, disabled: { opacity: 0.35 },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5 }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  tabs: { flexDirection: 'row', paddingHorizontal: 12, gap: 4 }, tab: { minHeight: 44, flex: 1, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, tabLabel: { color: colors.muted, fontSize: 11, fontWeight: '500' }, selected: { backgroundColor: colors.surfaceMuted }, selectedLabel: { color: colors.text },
  input: { marginHorizontal: 12, marginTop: 8, marginBottom: 4, minHeight: 64, maxHeight: 82, borderRadius: 12, backgroundColor: colors.surfaceAlt, color: colors.text, fontSize: 18, paddingHorizontal: 14, paddingVertical: 10, textAlignVertical: 'top' },
  textTab: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, catalogScroll: { maxHeight: 190, flexShrink: 1 }, search: { marginHorizontal: 12, marginTop: 5, paddingHorizontal: 10, height: 40, borderRadius: 10, backgroundColor: colors.surfaceAlt, flexDirection: 'row', alignItems: 'center', gap: 7 }, searchInput: { flex: 1, color: colors.text, fontSize: 12, height: 40 }, fontFilters: { paddingHorizontal: 12, gap: 2 }, fontChoice: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', paddingRight: 20 }, favorite: { position: 'absolute', right: 0, top: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, notice: { color: colors.textSecondary, fontSize: 11, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 1 }, toast: { minHeight: 44, marginHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceMuted, borderRadius: 10, paddingRight: 12 }, presetLabel: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingHorizontal: 5 }, fonts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, rowGap: 10 }, font: { width: '48%', height: 64, borderRadius: 10, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center', alignItems: 'center', gap: 3, backgroundColor: colors.surfaceAlt }, fontSelected: { borderColor: colors.text }, fontSample: { color: colors.text, fontSize: 19 }, fontName: { color: colors.textSecondary, fontSize: 11 },
  palette: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingTop: 6, justifyContent: 'center' }, swatchTouch: { width: '20%', height: 56, alignItems: 'center', justifyContent: 'center' }, swatch: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#555555', alignItems: 'center', justifyContent: 'center' }, swatchSelected: { borderWidth: 2, borderColor: colors.text },
  styleOptions: { flexDirection: 'row', justifyContent: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 12 }, styleButton: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  audioTabs: { flexDirection: 'row', paddingHorizontal: 14, gap: 6 }, error: { color: colors.accent, fontSize: 11, paddingHorizontal: 14, paddingVertical: 6 },
  applyLane: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }, laneCheck: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
});
