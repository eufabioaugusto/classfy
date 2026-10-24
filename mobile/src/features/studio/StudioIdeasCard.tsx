import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, ChevronRight, FileText, Film, Lightbulb, Mic, Minus, Plus, RefreshCw, Sparkles, Video } from 'lucide-react-native';
import { ClassyAvatar } from '@/components/ClassyAvatar';
import { SheetCloseButton, SheetModal as NativeSheetModal, sheetStyles } from '@/components/SheetModal';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';
import { useStudioIdeas } from './useStudioIdeas';
import { studioEntrySizes, studioEntryStyles } from './studioEntryStyles';
import { validateStudioIdeaDraft, type StudioIdeaDraft, type StudioIdeaKind } from './studioIdeas';

const formats = [{ kind: 'aula', label: 'Aula', icon: Video }, { kind: 'short', label: 'Short', icon: Film }, { kind: 'podcast', label: 'Podcast', icon: Mic }] as const;
const brand = '#EF5066';
export type StudioIdeasCardProps = {
  active: boolean; disabled?: boolean;
  onUseScript: (draft: StudioIdeaDraft) => boolean | Promise<boolean>;
  onSheetDismiss: () => void; onBusyChange?: (busy: boolean) => void;
};
export function StudioIdeasCard({ active, disabled = false, onUseScript, onSheetDismiss, onBusyChange }: StudioIdeasCardProps) {
  const { user } = useAuth();
  const ideas = useStudioIdeas(user?.id, active, disabled);
  const { width, height } = useWindowDimensions(), insets = useSafeAreaInsets();
  const viewportHeight = useRef(height); viewportHeight.current = height;
  const [keyboardHeight, setKeyboardHeight] = useState(0), [applying, setApplying] = useState(false), [applyError, setApplyError] = useState('');
  const contentScroll = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Partial<Record<'editorial' | 'title' | 'script', number>>>({});
  const focusedField = useRef<'editorial' | 'title' | 'script' | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const keyboardOpen = keyboardHeight > 0;
  const applyingRef = useRef(false), mounted = useRef(true), showed = useRef(false);
  const handoffEpoch = useRef(0);
  const previousOwner = useRef(user?.id);
  const context = useRef({ owner: user?.id, active, disabled });
  if (context.current.owner !== user?.id || context.current.active !== active || context.current.disabled !== disabled) handoffEpoch.current++;
  context.current = { owner: user?.id, active, disabled };
  const callbacks = useRef({ onUseScript, onSheetDismiss, onBusyChange }); callbacks.current = { onUseScript, onSheetDismiss, onBusyChange };
  const revealFocusedField = () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const field = focusedField.current, offset = field ? fieldOffsets.current[field] : undefined;
      if (mounted.current && field && offset !== undefined) contentScroll.current?.scrollTo({ y: Math.max(0, offset - 12), animated: true });
    });
  };
  const focusField = (field: NonNullable<typeof focusedField.current>) => { focusedField.current = field; revealFocusedField(); };
  const blurField = (field: NonNullable<typeof focusedField.current>) => { if (focusedField.current === field) focusedField.current = null; };
  const layoutField = (field: NonNullable<typeof focusedField.current>, offset: number) => { fieldOffsets.current[field] = offset; if (focusedField.current === field) revealFocusedField(); };
  const ready = !!ideas.context?.editorial.ready && !ideas.reconciling;
  const title = ideas.categoriesVisible ? 'Seu contexto de criação' : ideas.draft ? 'Seu roteiro está pronto' : ideas.selected ? 'Prepare seu roteiro' : 'Ideias para sua próxima criação';
  const blocked = ideas.busy || applying || disabled;
  const sheetWidth = width > height ? Math.min(width - Math.max(insets.left, 18) - Math.max(insets.right, 18), height * 16 / 9) : Math.min(width, 650);
  // KeyboardAvoidingView raises the bottom edge, while this bound also shrinks
  // the sheet itself. Its header must stay below the safe top edge.
  const maxSheetHeight = Math.max(1, height - Math.max(insets.top, 16) - keyboardHeight - 16);
  const close = () => { if (!applyingRef.current) { setApplyError(''); ideas.close(); } };
  const dismissed = () => { if (showed.current) { showed.current = false; callbacks.current.onSheetDismiss(); } };
  useEffect(() => {
    mounted.current = true;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => setKeyboardHeight(Math.max(0, event.endCoordinates.height)));
    const change = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidChangeFrame', event => setKeyboardHeight(Math.max(0, viewportHeight.current - event.endCoordinates.screenY)));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0));
    const activity = AppState.addEventListener('change', state => { if (state !== 'active') { handoffEpoch.current++; applyingRef.current = false; setApplying(false); } });
    return () => { mounted.current = false; if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current); show.remove(); change.remove(); hide.remove(); activity.remove(); callbacks.current.onBusyChange?.(false); };
  }, []);
  useEffect(() => {
    callbacks.current.onBusyChange?.(ideas.visible || applying);
    if (ideas.visible) showed.current = true;
    else if (Platform.OS !== 'ios') dismissed();
  }, [ideas.visible, applying]);
  useEffect(() => {
    if (!ideas.visible) focusedField.current = null;
    else revealFocusedField();
  }, [ideas.visible, keyboardHeight]);
  useEffect(() => { setApplyError(''); }, [user?.id, ideas.selected?.id, ideas.draft?.title, ideas.draft?.script]);
  useEffect(() => {
    if (previousOwner.current !== user?.id || !active || disabled) { applyingRef.current = false; setApplying(false); }
    previousOwner.current = user?.id;
  }, [user?.id, active, disabled]);
  const applyScript = async () => {
    if (applyingRef.current || blocked || !ideas.draft || !ideas.canUseDraft() || !active || !user?.id) return;
    let draft: StudioIdeaDraft;
    try { draft = validateStudioIdeaDraft(ideas.draft); }
    catch { setApplyError('Preencha o título e o roteiro antes de gravar.'); return; }
    const owner = user.id, token = handoffEpoch.current;
    applyingRef.current = true; setApplying(true); setApplyError(''); Keyboard.dismiss();
    try {
      const accepted = await callbacks.current.onUseScript(draft);
      if (!mounted.current || handoffEpoch.current !== token || context.current.owner !== owner || !context.current.active || context.current.disabled || AppState.currentState !== 'active') return;
      if (accepted) ideas.close();
      else setApplyError('Não foi possível abrir a gravação agora. Seu roteiro permanece aqui.');
    } catch (cause) {
      if (mounted.current && handoffEpoch.current === token && context.current.owner === owner && context.current.active) setApplyError(cause instanceof Error ? cause.message : 'Não foi possível salvar o roteiro. Tente novamente.');
    } finally { if (handoffEpoch.current === token) { applyingRef.current = false; if (mounted.current) setApplying(false); } }
  };
  if (!user) return null;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Abrir Classy para criar"
      accessibilityHint="Veja suas ideias, contexto e roteiros."
      accessibilityState={{ disabled: disabled || ideas.busy, busy: ideas.loading || ideas.busy, expanded: ideas.visible }}
      disabled={disabled || ideas.busy} onPress={ideas.open}
      style={({ pressed }) => [studioEntryStyles.row, disabled && s.disabled, pressed && s.pressed]}>
      <View style={[studioEntryStyles.icon, s.avatar]}><ClassyAvatar size={studioEntrySizes.glyph} /></View>
      <View style={studioEntryStyles.copy}><Text style={studioEntryStyles.title}>Classy para criar</Text><Text style={studioEntryStyles.hint}>Ideias e roteiros para você</Text></View>
      <View style={studioEntryStyles.accessory}>{ideas.loading || ideas.busy ? <ActivityIndicator size="small" color={colors.muted} /> : <ChevronRight size={studioEntrySizes.chevron} color={colors.muted} />}</View>
    </Pressable>
    <NativeSheetModal visible={ideas.visible} onRequestClose={close} onDismiss={dismissed}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={sheetStyles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel={keyboardOpen ? 'Recolher teclado do roteiro' : 'Fechar sugestões da Classy'} onPress={() => keyboardOpen ? Keyboard.dismiss() : close()} style={StyleSheet.absoluteFill} />
          <View style={[sheetStyles.surface, s.sheet, { width: sheetWidth, maxHeight: maxSheetHeight }]}>
            <View onStartShouldSetResponder={() => true} onTouchEnd={Keyboard.dismiss}>
              <View style={sheetStyles.handle} />
              <View style={[sheetStyles.header, s.sheetHeader]}>
                <View style={s.sheetBrand}><ClassyAvatar size={30} /><Text style={s.sheetBrandLabel}>Criar com a Classy</Text></View>
                <View style={s.row}>{keyboardOpen ? <Pressable accessibilityRole="button" accessibilityLabel="Concluir digitação do roteiro" onPress={Keyboard.dismiss} style={s.done}><Text style={s.doneLabel}>Concluir</Text></Pressable> : null}
                  <SheetCloseButton onPress={close} label="Fechar sugestões da Classy" /></View>
              </View>
            </View>
            <ScrollView ref={contentScroll} accessibilityLabel="Conteúdo das sugestões da Classy" style={s.sheetScroll} contentContainerStyle={[s.sheetContent, { paddingBottom: ideas.draft ? 22 : Math.max(insets.bottom, 20) + 12 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onScrollBeginDrag={Keyboard.dismiss} onLayout={revealFocusedField}>
              <Text style={s.sheetTitle}>{title}</Text>
              {ideas.categoriesVisible ? <>
                <Text style={s.hint}>Escolha sua área e conte o que você ensina. Esse é o ponto de partida para sugestões que fazem sentido para você.</Text>
                <Text style={s.label}>Área principal</Text>
                <View style={s.categories}>{ideas.context?.categories.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Área principal: ${item.name}`} accessibilityState={{ selected: ideas.editorialCategory === item.id }} disabled={blocked} onPress={() => ideas.chooseCategory(item.id)} style={[s.category, ideas.editorialCategory === item.id && s.categorySelected]}><Text style={s.categoryLabel}>{item.name}</Text>{ideas.editorialCategory === item.id ? <Check size={15} color={brand} /> : null}</Pressable>)}</View>
                {!ideas.context?.categories.length && !ideas.loading ? <Text style={s.hint}>Não foi possível carregar as categorias agora. Tente novamente.</Text> : null}
                <View style={s.field} onLayout={event => layoutField('editorial', event.nativeEvent.layout.y)}><Text style={s.label}>Sobre o que você ensina?</Text><TextInput accessibilityLabel="Sobre o que você ensina?" value={ideas.teachingFocus} onChangeText={ideas.editTeachingFocus} onFocus={() => focusField('editorial')} onBlur={() => blurField('editorial')} editable={!blocked} maxLength={280} multiline style={[s.input, s.editorialInput]} placeholder="Ex.: Ensino finanças pessoais para iniciantes, com passos simples para organizar o mês." placeholderTextColor={colors.mutedDim} /><Text style={s.characterCount}>{ideas.teachingFocus.length}/280</Text></View>
                <Text style={s.hint}>Sua bio e publicações também ajudam a Classy a conhecer seu conteúdo.</Text>
                {ideas.context?.editorial.ready ? <Pressable accessibilityRole="button" accessibilityLabel="Voltar às sugestões" disabled={blocked} onPress={ideas.back} style={s.secondary}><ArrowLeft size={17} color={colors.muted} /><Text style={s.hint}>Voltar às sugestões</Text></Pressable> : null}
              </> : ideas.selected ? <>
                {!ideas.draft ? <>
                  <Text style={s.pickedTitle}>{ideas.selected.title}</Text>
                  <Text style={s.summary}>{ideas.selected.summary}</Text>
                  <View style={s.reason}><Lightbulb size={18} color={brand} /><View style={s.flex}><Text style={s.reasonTitle}>{ideas.context?.source.label || 'Uma pauta para seu público'}</Text><Text style={s.hint}>{ideas.selected.objective}</Text></View></View>
                </> : null}
                {ideas.draft ? <>
                  <Text style={s.draftMeta}>{formats.find(item => item.kind === ideas.draft?.kind)?.label} · cerca de {ideas.draft.durationMinutes} min</Text>
                  <View style={s.field} onLayout={event => layoutField('title', event.nativeEvent.layout.y)}><Text style={s.label}>Título</Text><TextInput accessibilityLabel="Título do roteiro da Classy" value={ideas.draft.title} onChangeText={value => ideas.edit('title', value)} onFocus={() => focusField('title')} onBlur={() => blurField('title')} editable={!blocked} maxLength={150} style={s.input} placeholderTextColor={colors.mutedDim} /></View>
                  <View style={s.field} onLayout={event => layoutField('script', event.nativeEvent.layout.y)}><Text style={s.label}>Roteiro para o teleprompter</Text><TextInput accessibilityLabel="Roteiro da Classy" value={ideas.draft.script} onChangeText={value => ideas.edit('script', value)} onFocus={() => focusField('script')} onBlur={() => blurField('script')} editable={!blocked} maxLength={50000} multiline scrollEnabled style={[s.input, s.script, { minHeight: width > height ? 130 : 250 }]} placeholderTextColor={colors.mutedDim} /></View>
                  <Text style={s.hint}>Ajuste o texto para soar como você. O roteiro acompanha a gravação e fica salvo no projeto.</Text>
                </> : <>
                  <Text style={s.label}>Formato</Text><View style={s.formats}>{formats.map(item => { const Icon = item.icon; return <Pressable key={item.kind} accessibilityRole="button" accessibilityLabel={`Roteiro de ${item.label}`} accessibilityState={{ selected: ideas.kind === item.kind }} disabled={blocked} onPress={() => ideas.setKind(item.kind as StudioIdeaKind)} style={[s.format, ideas.kind === item.kind && s.categorySelected]}><Icon size={18} color={ideas.kind === item.kind ? brand : colors.muted} /><Text style={s.categoryLabel}>{item.label}</Text></Pressable>; })}</View>
                  <View style={s.duration}><View style={s.flex}><Text style={s.label}>Tempo de leitura</Text><Text style={s.hint}>{ideas.kind === 'short' ? 'Até 3 minutos' : 'De 1 a 10 minutos'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Diminuir duração do roteiro" disabled={blocked || ideas.minutes <= 1} onPress={() => ideas.setMinutes(ideas.minutes - 1)} style={s.step}><Minus size={19} color={colors.text} /></Pressable><Text style={s.minutes}>{ideas.minutes} min</Text><Pressable accessibilityRole="button" accessibilityLabel="Aumentar duração do roteiro" disabled={blocked || ideas.minutes >= (ideas.kind === 'short' ? 3 : 10)} onPress={() => ideas.setMinutes(ideas.minutes + 1)} style={s.step}><Plus size={19} color={colors.text} /></Pressable></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Gerar roteiro com a Classy" accessibilityState={{ disabled: blocked, busy: ideas.busy }} disabled={blocked} onPress={() => { void ideas.generateScript(); }} style={({ pressed }) => [s.primary, blocked && s.disabled, pressed && s.pressed]}>{ideas.busy ? <ActivityIndicator color="#19080D" size="small" /> : <Sparkles size={19} color="#19080D" />}<Text style={s.primaryLabel}>{ideas.busy ? 'Escrevendo seu roteiro…' : 'Gerar roteiro'}</Text></Pressable>
                </>}
                <Pressable accessibilityRole="button" accessibilityLabel="Escolher outra pauta" disabled={blocked} onPress={ideas.back} style={s.secondary}><ArrowLeft size={17} color={colors.muted} /><Text style={s.hint}>Escolher outra pauta</Text></Pressable>
              </> : <>
                <Text style={s.hint}>{ideas.context?.source.label || 'Três caminhos para transformar seu conhecimento em conteúdo.'}</Text>
                {ideas.context?.suggestions.map((idea, index) => <Pressable key={idea.id} accessibilityRole="button" accessibilityLabel={`Criar roteiro: ${idea.title}`} disabled={blocked} onPress={() => ideas.choose(idea)} style={s.sheetIdea}><Text style={s.ideaNumber}>0{index + 1}</Text><View style={s.flex}><Text style={s.ideaTitle}>{idea.title}</Text><Text style={s.summary}>{idea.summary}</Text><Text style={s.ideaMeta}>{formats.find(item => item.kind === idea.kind)?.label} · {idea.durationMinutes} min</Text></View><ChevronRight size={18} color={brand} /></Pressable>)}
                {ideas.busy ? <View style={s.loading}><ActivityIndicator color={brand} size="small" /><Text style={s.hint}>A Classy está preparando suas sugestões…</Text></View> : null}
                <View style={s.sheetActions}><Pressable accessibilityRole="button" accessibilityLabel="Seu contexto de criação" disabled={blocked} onPress={ideas.showCategories} style={s.sourceAction}><FileText size={16} color={colors.muted} /><Text style={s.hint}>Seu contexto</Text></Pressable>
                  {!!ideas.context?.suggestions.length && <Pressable accessibilityRole="button" accessibilityLabel="Gerar novas sugestões" disabled={blocked} onPress={ideas.refresh} style={s.sourceAction}><RefreshCw size={16} color={colors.muted} /><Text style={s.hint}>Novas sugestões</Text></Pressable>}</View>
              </>}
              {applyError || ideas.error ? <View style={s.errorBox}><Text accessibilityRole="alert" style={s.error}>{applyError || ideas.error}</Text>{ideas.error && !applying ? <Pressable accessibilityRole="button" accessibilityLabel="Tentar pedido da Classy novamente" disabled={ideas.busy} onPress={ideas.retry} style={s.retry}><Text style={s.retryLabel}>Tentar novamente</Text></Pressable> : null}</View> : null}
              {ideas.loading && ideas.categoriesVisible ? <ActivityIndicator color={brand} /> : null}
            </ScrollView>
            {ideas.categoriesVisible ? <View accessibilityLabel="Ação do contexto" style={[s.draftFooter, { paddingBottom: keyboardOpen ? 14 : Math.max(insets.bottom, 18) }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Salvar contexto e gerar sugestões" accessibilityState={{ disabled: blocked || !ideas.editorialCategory || ideas.teachingFocus.trim().length < 12, busy: ideas.busy }} disabled={blocked || !ideas.editorialCategory || ideas.teachingFocus.trim().length < 12} onPress={() => { void ideas.saveEditorial(); }} style={({ pressed }) => [s.primary, (blocked || !ideas.editorialCategory || ideas.teachingFocus.trim().length < 12) && s.disabled, pressed && s.pressed]}>{ideas.busy ? <ActivityIndicator color="#19080D" size="small" /> : <Sparkles size={19} color="#19080D" />}<Text style={s.primaryLabel}>{ideas.busy ? 'Salvando seu contexto…' : 'Salvar e gerar sugestões'}</Text></Pressable>
            </View> : ideas.draft && ready ? <View accessibilityLabel="Ação do roteiro" style={[s.draftFooter, { paddingBottom: keyboardOpen ? 14 : Math.max(insets.bottom, 18) }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Gravar com este roteiro" accessibilityState={{ disabled: blocked || !ideas.draft.title.trim() || !ideas.draft.script.trim(), busy: applying }} disabled={blocked || !ideas.draft.title.trim() || !ideas.draft.script.trim()} onPress={() => { void applyScript(); }} style={({ pressed }) => [s.primary, (blocked || !ideas.draft?.title.trim() || !ideas.draft?.script.trim()) && s.disabled, pressed && s.pressed]}>{applying ? <ActivityIndicator color="#19080D" size="small" /> : <Video size={19} color="#19080D" />}<Text style={s.primaryLabel}>{applying ? 'Salvando seu roteiro…' : 'Gravar com este roteiro'}</Text></Pressable>
            </View> : null}
          </View>
      </KeyboardAvoidingView>
    </NativeSheetModal>
  </>;
}
const s = StyleSheet.create({
  flex: { flex: 1, gap: 5 }, row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar: { backgroundColor: '#211A27' },
  ideaNumber: { color: brand, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }, ideaTitle: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600', letterSpacing: -0.2 }, ideaMeta: { color: '#CE98A5', fontSize: 11, lineHeight: 17 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, minHeight: 44 },
  sheet: { alignSelf: 'center' }, sheetHeader: { paddingTop: 0 }, sheetBrand: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 }, sheetBrandLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' }, sheetScroll: { flexShrink: 1 }, sheetContent: { paddingHorizontal: 22, paddingTop: 10, gap: 17 }, sheetTitle: { color: colors.text, fontSize: 25, lineHeight: 30, fontWeight: '600', letterSpacing: -0.7 }, hint: { color: colors.muted, fontSize: 13, lineHeight: 20 }, pickedTitle: { color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '600' }, summary: { color: colors.textSecondary, fontSize: 13, lineHeight: 21 },
  reason: { borderLeftWidth: 2, borderLeftColor: '#704354', paddingVertical: 10, paddingLeft: 13, flexDirection: 'row', gap: 10 }, reasonTitle: { color: '#D49CA9', fontSize: 12, fontWeight: '600' }, categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, category: { flexDirection: 'row', alignItems: 'center', minHeight: 45, paddingHorizontal: 15, paddingVertical: 10, gap: 7, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, categorySelected: { borderColor: '#A8455A', backgroundColor: '#2A1720' }, categoryLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' }, formats: { flexDirection: 'row', gap: 9 }, format: { flex: 1, minHeight: 58, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 6 }, duration: { flexDirection: 'row', alignItems: 'center', gap: 8 }, step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.surfaceAlt }, minutes: { color: colors.text, fontSize: 15, fontWeight: '600', minWidth: 46, textAlign: 'center' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 54, borderRadius: 15, backgroundColor: brand, gap: 9, paddingHorizontal: 16 }, primaryLabel: { color: '#19080D', fontSize: 15, fontWeight: '700' }, secondary: { minHeight: 44, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }, sourceAction: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, sourceLabel: { color: brand, fontSize: 13 }, sheetActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, sheetIdea: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 17 },
  field: { gap: 8 }, input: { color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 15, minHeight: 54, fontSize: 15, lineHeight: 23 }, script: { textAlignVertical: 'top', maxHeight: 350 }, draftMeta: { color: '#CE98A5', fontSize: 12 }, done: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, doneLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  draftFooter: { paddingHorizontal: 22, paddingTop: 13, borderTopWidth: 1, borderTopColor: colors.borderSubtle, backgroundColor: colors.backgroundElevated, flexShrink: 0 },
  editorialInput: { minHeight: 114, maxHeight: 180, textAlignVertical: 'top' }, characterCount: { color: colors.mutedDim, fontSize: 11, textAlign: 'right' },
  error: { color: '#FFA5B5', fontSize: 13, lineHeight: 20, paddingHorizontal: 18 }, errorBox: { paddingVertical: 12, borderRadius: 14, backgroundColor: '#2A111B', gap: 7 }, retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18 }, retryLabel: { color: colors.text, fontSize: 13, fontWeight: '600' }, disabled: { opacity: 0.5 }, pressed: { opacity: 0.75 },
});
