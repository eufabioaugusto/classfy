import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, ChevronUp, Copy, FileText, Film, Maximize2, Mic, Minimize2, Pause, Pencil, Play, Scissors, Split, Trash2, Upload, Video, X } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingImage } from '@/components/LoadingImage';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { useStudioOrientation } from '@/features/studio/useStudioOrientation';
import { importStudioMedia, recoverPendingStudioTakes } from '@/features/studio/media';
import { discardTransientStudioProject, isTransientStudioProject, mutateStudioProject } from '@/features/studio/store';
import { duplicateStudioTake, locateStudioTime, moveStudioTake, removeStudioTake, splitStudioTake } from '@/features/studio/timeline';
import { formatStudioDuration, formatStudioEditorTime, studioFormats, timelineDuration, type StudioProject, type StudioTake } from '@/features/studio/model';
import { StudioPreview, type StudioPlaybackState, type StudioPreviewHandle } from '@/features/studio/StudioPreview';
import { StudioTimeline } from '@/features/studio/StudioTimeline';
import { StudioTrimControl } from '@/features/studio/StudioTrimControl';
import { StudioAccess, StudioButton, StudioField, StudioLoading, StudioSaveStatus, studioStyles, useStudioFields } from '@/features/studio/StudioUI';

export default function StudioProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, update } = useStudioProject(Array.isArray(id) ? id[0] : id || '');
  return <StudioAccess>{loading ? <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Seu projeto" back />}><StudioLoading /></AppScreen> : !project ?
    <AppScreen header={<NavigationHeader title="Seu projeto" back />}><View style={studioStyles.empty}><Text style={studioStyles.sectionTitle}>Projeto indisponível</Text><Text style={studioStyles.body}>{error || 'Este projeto não foi encontrado nesta conta e neste aparelho.'}</Text></View></AppScreen> : <ProjectEditor key={project.id} project={project} update={update} />}
  </StudioAccess>;
}

type Panel = 'preparation' | 'cut' | 'organize' | 'recovery' | null;
function ProjectEditor({ project, update }: { project: StudioProject; update: (id: string, patch: Partial<StudioProject>) => Promise<StudioProject> }) {
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const landscape = width > height;
  const { orientationReady, orientationError } = useStudioOrientation(project.kind);
  const { user } = useAuth();
  const current = useRef({ project, owner: user?.id }); current.current = { project, owner: user?.id };
  const { fields, setField, flush, saving, saveError } = useStudioFields(project, update);
  const [panel, setPanel] = useState<Panel>(null);
  const [toolsVisible, setToolsVisible] = useState(true);
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [activeTakeId, setActiveTakeId] = useState(project.takes[0]?.id);
  const [cutStart, setCutStart] = useState('0');
  const [cutEnd, setCutEnd] = useState('0');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const mounted = useRef(true);
  const preview = useRef<StudioPreviewHandle>(null);
  const [playback, setPlayback] = useState<StudioPlaybackState>({ position: 0, sourcePosition: 0, playing: false, loading: false });
  const playbackRef = useRef(playback); playbackRef.current = playback;
  const receivePlayback = useCallback((state: StudioPlaybackState) => { setPlayback(state); }, []);
  const format = studioFormats.find(item => item.kind === project.kind)!;
  const activeTake = project.takes.find(take => take.id === activeTakeId) || project.takes[0];
  const activeIndex = project.takes.findIndex(take => take.id === activeTake?.id);
  const duration = timelineDuration(project.takes);
  const locked = ['preparing', 'uploading', 'processing', 'submitted'].includes(project.state);
  const transient = isTransientStudioProject(project.ownerId, project.id);
  const maxSheetHeight = Math.max(1, height - insets.top - 12);
  const sheetContentWidth = landscape ? Math.min(width - insets.left - insets.right, maxSheetHeight * 16 / 9) : undefined;
  const sheetContentStyle = { width: '100%' as const, maxWidth: sheetContentWidth, alignSelf: 'center' as const };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!project.takes.some(take => take.id === activeTakeId)) setActiveTakeId(project.takes[0]?.id); }, [project.takes, activeTakeId]);
  const assertOwner = () => { if (current.current.owner !== project.ownerId) throw new Error('Abra este projeto na conta que o criou.'); };
  const startWork = () => {
    if (working.current) return false;
    working.current = true; setBusy(true); preview.current?.pause(); return true;
  };
  const finishWork = () => { working.current = false; if (mounted.current) setBusy(false); };
  const editTakes = async (change: (takes: readonly StudioTake[]) => StudioTake[]) => {
    if (locked || !startWork()) return;
    try {
      await flush(); assertOwner();
      return await mutateStudioProject(project.ownerId, project.id, latest => { assertOwner(); return { takes: change(latest.takes) }; });
    } catch (error) { Alert.alert('Editar montagem', error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { finishWork(); }
  };
  const addMedia = async () => {
    if (locked || !startWork()) return;
    try {
      const latest = await flush(); assertOwner();
      const takes = await importStudioMedia(latest); assertOwner();
      if (mounted.current && takes.length) { setActiveTakeId(takes[0].id); setToolsVisible(true); }
    } catch (error) { Alert.alert('Importar conteúdo', error instanceof Error ? error.message : 'Não foi possível importar. Tente novamente.'); }
    finally { finishWork(); }
  };
  const recoverTakes = async () => {
    if (locked || !startWork()) return;
    try {
      const latest = await flush(); assertOwner();
      const result = await recoverPendingStudioTakes(latest);
      if (result.errors.length) Alert.alert('Recuperação de arquivos', result.errors.join('\n'));
      else if (!result.recovered) Alert.alert('Recuperação de arquivos', 'Nenhum arquivo foi recuperado. Seus arquivos continuam preservados.');
      else if (mounted.current) setPanel(null);
    } catch (error) { Alert.alert('Recuperação de arquivos', error instanceof Error ? error.message : 'Não foi possível recuperar seus arquivos.'); }
    finally { finishWork(); }
  };
  const discardPending = () => Alert.alert('Retirar arquivos pendentes do projeto?', 'Os takes prontos continuam preservados.', [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Retirar pendentes', style: 'destructive', onPress: () => {
      if (locked || !startWork()) return;
      void flush().then(() => { assertOwner(); return mutateStudioProject(project.ownerId, project.id, () => { assertOwner(); return { pendingTakes: [] }; }); })
        .then(() => { if (mounted.current) setPanel(null); }).catch(() => Alert.alert('Arquivos preservados', 'Não foi possível atualizar o projeto. Tente novamente.')).finally(finishWork);
    } },
  ]);
  const navigate = async (destination: 'record' | 'review' | 'back') => {
    if (working.current || (destination === 'record' && locked)) return;
    if (!startWork()) return;
    try {
      await flush(); assertOwner();
      if (!mounted.current) return;
      if (destination === 'back') { await discardTransientStudioProject(project.ownerId, project.id); if (router.canGoBack()) router.back(); else router.replace('/studio'); }
      else router.push({ pathname: destination === 'record' ? '/studio/capture' : '/studio/review', params: { id: project.id } });
    } catch (error) { Alert.alert('Seu projeto está aqui', error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { finishWork(); }
  };
  const selectTake = (take: StudioTake) => {
    setActiveTakeId(take.id);
    const index = current.current.project.takes.findIndex(item => item.id === take.id);
    preview.current?.seek(timelineDuration(current.current.project.takes.slice(0, index)));
  };
  const openPanel = (next: Panel) => {
    if (working.current) return;
    preview.current?.pause();
    if (next === 'cut' && activeTake) { setCutStart(String(Math.round(activeTake.start * 10) / 10)); setCutEnd(String(Math.round(activeTake.end * 10) / 10)); }
    setPanel(next);
  };
  const applyCut = async () => {
    if (!activeTake) return;
    const id = activeTake.id;
    const start = Number(cutStart.replace(',', '.')); const end = Number(cutEnd.replace(',', '.'));
    const saved = await editTakes(takes => takes.map(take => {
      if (take.id !== id) return take;
      if (![start, end].every(Number.isFinite) || start < 0 || end > take.duration + 0.05 || end - start < 0.1 - 1e-6) throw new Error(`Use um corte entre 0 e ${Math.round(take.duration * 10) / 10} segundos, com pelo menos 0,1 segundo.`);
      return { ...take, start, end };
    }));
    if (saved && mounted.current) setPanel(null);
  };
  const split = async () => {
    if (!activeTake) return;
    const location = locateStudioTime(project.takes, playbackRef.current.position);
    if (!location) return;
    const leftId = Crypto.randomUUID(); const rightId = Crypto.randomUUID();
    const saved = await editTakes(takes => splitStudioTake(takes, location.takeId, location.sourceSeconds, leftId, rightId));
    if (saved && mounted.current) setActiveTakeId(rightId);
  };
  const move = async (id: string, direction: -1 | 1) => editTakes(takes => {
    const index = takes.findIndex(take => take.id === id);
    if (index < 0 || index + direction < 0 || index + direction >= takes.length) return [...takes];
    return moveStudioTake(takes, id, direction < 0 ? takes[index - 1].id : takes[index + 2]?.id || null);
  });
  const duplicate = async () => {
    if (!activeTake) return;
    const id = Crypto.randomUUID(); const sourceId = activeTake.id;
    const saved = await editTakes(takes => duplicateStudioTake(takes, sourceId, id));
    if (saved && mounted.current) { setActiveTakeId(id); setPanel(null); }
  };
  const deleteTake = () => {
    if (!activeTake || busy || locked) return;
    const id = activeTake.id;
    Alert.alert('Remover este take?', 'Ele sairá da montagem. O arquivo original continua preservado.', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Remover', style: 'destructive', onPress: () => { void editTakes(takes => removeStudioTake(takes, id)); } },
    ]);
  };
  const canSplit = !locked && !!activeTake && playback.takeId === activeTake.id && playback.sourcePosition > activeTake.start + 0.1 - 1e-6 && playback.sourcePosition < activeTake.end - 0.1 + 1e-6;
  const closePanel = () => { if (!busy) setPanel(null); };
  return <View style={styles.screen}>
    <StatusBar hidden={focused} />
    <View style={StyleSheet.absoluteFillObject}>
      <StudioPreview ref={preview} takes={project.takes} kind={project.kind} activeTakeId={activeTakeId} onActiveTakeChange={setActiveTakeId} onPlaybackState={receivePlayback} paused={!!panel || busy} onCanvasPress={() => setToolsVisible(value => !value)} />
    </View>
    {toolsVisible ? <>
      <LinearGradient colors={['rgba(0,0,0,0.9)', 'rgba(0,0,0,0)']} style={[styles.headerGradient, { paddingTop: insets.top, paddingLeft: Math.max(insets.left, 12), paddingRight: Math.max(insets.right, 12) }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Voltar aos projetos" disabled={busy} onPress={() => { void navigate('back'); }} style={styles.overlayButton}><X size={22} color={colors.text} strokeWidth={1.6} /></Pressable>
          <View style={{ flex: 1, gap: 3 }}><Pressable accessibilityRole="button" accessibilityLabel="Editar título e roteiro do projeto" onPress={() => openPanel('preparation')} style={styles.projectTitle}><Text numberOfLines={1} style={styles.title}>{fields.title || `Nova ${format.title.toLowerCase()}`}</Text><Pencil size={12} color={colors.muted} strokeWidth={1.5} /></Pressable>
            <StudioSaveStatus saving={saving} error={saveError} transient={transient} onRetry={() => { void flush().catch(() => {}); }} />
          </View>
          {!!project.pendingTakes?.length ? <Pressable accessibilityRole="button" accessibilityLabel="Recuperar arquivos pendentes" onPress={() => openPanel('recovery')} style={styles.overlayButton}><Text style={{ color: colors.accent, fontWeight: '600' }}>{project.pendingTakes.length}</Text></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Prévia em tela inteira" onPress={() => setToolsVisible(false)} style={styles.overlayButton}><Maximize2 size={20} color={colors.text} strokeWidth={1.5} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={locked ? 'Acompanhar publicação' : 'Revisar publicação'} disabled={busy || transient} onPress={() => { void navigate('review'); }} style={[styles.review, (busy || transient) && { opacity: 0.5 }]}><Text style={styles.reviewText}>{locked ? 'Publicação' : 'Revisar'}</Text><ChevronRight size={16} color={colors.text} /></Pressable>
        </View>
      </LinearGradient>
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.82)']} locations={[0, 0.25, 1]} style={[styles.dock, landscape && { flexDirection: 'row', alignItems: 'flex-end', gap: 16 }, { paddingLeft: Math.max(insets.left, 16), paddingRight: Math.max(insets.right, 16), paddingBottom: Math.max(insets.bottom, 8) }]}>
        <View style={landscape ? { flex: 1 } : undefined}>
        <View style={styles.transport}>
          <Text style={styles.time}>{formatStudioEditorTime(playback.position)} <Text style={{ color: colors.mutedDim }}>/ {formatStudioEditorTime(duration)}</Text></Text>
          <Pressable accessibilityRole="button" accessibilityLabel={playback.playing ? 'Pausar montagem' : 'Reproduzir montagem'} disabled={!project.takes.length || !!panel || busy || playback.loading} onPress={() => preview.current?.togglePlayback()} style={styles.playButton}>
            {playback.loading ? <ActivityIndicator size="small" color={colors.muted} /> : playback.playing ? <Pause size={18} color={colors.text} fill={colors.text} strokeWidth={1.2} /> : <Play size={18} color={colors.text} fill={colors.text} strokeWidth={1.2} />}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={timelineVisible ? 'Recolher linha de takes' : 'Mostrar linha de takes'} accessibilityState={{ expanded: timelineVisible }} onPress={() => setTimelineVisible(value => !value)} style={styles.timelineToggle}>
            <Text numberOfLines={1} style={styles.takeLabel}>{activeTake ? `${project.takes.length} ${project.takes.length === 1 ? 'take' : 'takes'}` : format.title}</Text>{timelineVisible ? <ChevronDown size={14} color={colors.textSecondary} /> : <ChevronUp size={14} color={colors.textSecondary} />}
          </Pressable>
        </View>
        <StudioTimeline takes={project.takes} position={playback.position} activeTakeId={activeTake?.id} audio={project.kind === 'podcast'} compact={landscape} showClips={timelineVisible} onSelect={selectTake} onSeek={seconds => preview.current?.seek(seconds)} />
        {orientationError ? <Text style={styles.warning}>{orientationError}</Text> : project.kind === 'short' && duration > 180 ? <Text style={styles.warning}>Ajuste a montagem para até 3 minutos.</Text> : locked ? <Text style={styles.locked}>{project.state === 'submitted' ? 'Enviado para curadoria' : 'Montagem em preparação · acompanhe na publicação'}</Text> : null}
        </View>
        <View style={[styles.toolbar, landscape && styles.landscapeToolbar]}>
          <EditorTool label="Gravar" icon={project.kind === 'podcast' ? <Mic size={21} color={colors.text} strokeWidth={1.5} /> : <Video size={21} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy || !orientationReady} onPress={() => { void navigate('record'); }} />
          <EditorTool label="Importar" icon={<Upload size={21} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy} onPress={() => { void addMedia(); }} />
          <EditorTool label="Cortar" icon={<Scissors size={21} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy || !activeTake} onPress={() => openPanel('cut')} />
          <EditorTool label="Dividir" icon={<Split size={21} color={colors.text} strokeWidth={1.5} />} disabled={!canSplit || busy} onPress={() => { void split(); }} />
          <EditorTool label="Organizar" icon={<Film size={21} color={colors.text} strokeWidth={1.5} />} disabled={busy || !project.takes.length} onPress={() => openPanel('organize')} />
          <EditorTool label="Roteiro" icon={<FileText size={21} color={colors.text} strokeWidth={1.5} />} disabled={busy} onPress={() => openPanel('preparation')} />
        </View>
      </LinearGradient>
    </> : <View pointerEvents="box-none" style={[styles.fullscreenTools, { top: Math.max(insets.top, 12), right: Math.max(insets.right, 12) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={playback.playing ? 'Pausar montagem' : 'Reproduzir montagem'} onPress={() => preview.current?.togglePlayback()} style={styles.overlayButton}>{playback.playing ? <Pause size={20} color={colors.text} /> : <Play size={20} color={colors.text} />}</Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar às ferramentas do editor" onPress={() => setToolsVisible(true)} style={styles.overlayButton}><Minimize2 size={20} color={colors.text} strokeWidth={1.5} /></Pressable>
    </View>}
    <SheetModal visible={!!panel} onRequestClose={closePanel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[sheetStyles.backdrop, { paddingTop: insets.top + 12 }]}>
        <Pressable accessibilityLabel="Fechar painel do editor" style={{ flex: 1 }} onPress={closePanel} />
        <View style={[sheetStyles.surface, { paddingBottom: Math.max(insets.bottom, 12), maxHeight: maxSheetHeight }]}><View style={sheetStyles.handle} />
          <View onStartShouldSetResponder={() => true} style={[sheetStyles.header, sheetContentStyle, { flexShrink: 0 }]}><Text style={[studioStyles.sectionTitle, { flex: 1 }]}>{panel === 'preparation' ? 'Sua ideia' : panel === 'cut' ? `Cortar take ${activeIndex + 1}` : panel === 'organize' ? 'Seus takes' : 'Recuperar arquivos'}</Text><SheetCloseButton onPress={closePanel} /></View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={[sheetContentStyle, { flexShrink: 1, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 18 }}>
            {panel === 'preparation' ? <>
              <StudioField label="Título do projeto" value={fields.title} onChangeText={value => setField('title', value)} placeholder="Dê um nome à sua ideia" maxLength={180} editable={!locked} />
              <StudioField label="Objetivo do aprendizado" value={fields.objective} onChangeText={value => setField('objective', value)} placeholder="O que a pessoa vai conseguir fazer?" multiline maxLength={1000} editable={!locked} />
              <StudioField label="Para quem você está ensinando?" value={fields.audience} onChangeText={value => setField('audience', value)} placeholder="Descreva seu público" maxLength={500} editable={!locked} />
              <StudioField label="Guia de gravação" value={fields.script} onChangeText={value => setField('script', value)} placeholder={'Abertura\n\nExplicação e demonstração\n\nAplicação prática'} multiline style={{ minHeight: 180 }} hint="Seu guia pode acompanhar você no teleprompter." editable={!locked} />
              <StudioSaveStatus saving={saving} error={saveError} transient={transient} onRetry={() => { void flush().catch(() => {}); }} />
            </> : panel === 'cut' && activeTake ? <>
              <StudioTrimControl duration={activeTake.duration} start={Number(cutStart.replace(',', '.'))} end={Number(cutEnd.replace(',', '.'))} disabled={busy} onChange={(start, end) => { setCutStart(String(start)); setCutEnd(String(end)); }} />
              <View style={{ flexDirection: 'row', gap: 12 }}><View style={{ flex: 1 }}><StudioField label="Entrada (segundos)" keyboardType="decimal-pad" value={cutStart} onChangeText={setCutStart} editable={!busy} /></View><View style={{ flex: 1 }}><StudioField label="Saída (segundos)" keyboardType="decimal-pad" value={cutEnd} onChangeText={setCutEnd} editable={!busy} /></View></View>
              <Text style={studioStyles.hint}>Os cortes preservam seu arquivo original.</Text>
              <StudioButton label="Aplicar corte" loading={busy} icon={<Check size={18} color={colors.text} />} onPress={() => { void applyCut(); }} />
            </> : panel === 'organize' ? <>
              {project.takes.map((take, index) => <View key={take.id} style={[styles.takeRow, take.id === activeTake?.id && { borderColor: colors.textSecondary }]}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Selecionar take ${index + 1}`} onPress={() => selectTake(take)} style={styles.takeSelection}>
                  <View style={styles.thumb}>{take.thumbnailUri ? <LoadingImage source={{ uri: take.thumbnailUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : <Mic size={18} color={colors.muted} />}</View>
                  <View style={{ flex: 1, gap: 4 }}><Text style={styles.takeName} numberOfLines={1}>{take.name || `Take ${index + 1}`}</Text><Text style={studioStyles.hint}>{String(index + 1).padStart(2, '0')} · {formatStudioDuration(take.end - take.start)}</Text></View>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Mover take ${index + 1} para antes`} style={studioStyles.iconButton} disabled={locked || busy || index === 0} onPress={() => { void move(take.id, -1); }}><ArrowUp size={19} color={locked || index === 0 ? colors.mutedDim : colors.text} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Mover take ${index + 1} para depois`} style={studioStyles.iconButton} disabled={locked || busy || index === project.takes.length - 1} onPress={() => { void move(take.id, 1); }}><ArrowDown size={19} color={locked || index === project.takes.length - 1 ? colors.mutedDim : colors.text} /></Pressable>
              </View>)}
              <View style={{ flexDirection: 'row', gap: 12 }}><StudioButton label="Duplicar" secondary icon={<Copy size={17} color={colors.text} />} disabled={locked || busy} onPress={() => { void duplicate(); }} style={{ flex: 1 }} /><StudioButton label="Remover" secondary icon={<Trash2 size={17} color={colors.text} />} disabled={locked || busy} onPress={deleteTake} style={{ flex: 1 }} /></View>
              <Text style={studioStyles.hint}>Selecione um take para duplicar ou remover. Use as setas para mudar a sequência.</Text>
            </> : panel === 'recovery' ? <><Text style={studioStyles.body}>{project.pendingTakes?.length || 0} arquivo(s) aguardando recuperação.</Text><StudioButton label="Tentar recuperar" loading={busy} disabled={locked} onPress={() => { void recoverTakes(); }} /><StudioButton label="Retirar pendentes" secondary disabled={locked || busy} onPress={discardPending} /></> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SheetModal>
  </View>;
}
function EditorTool({ label, icon, onPress, disabled }: { label: string; icon: ReactNode; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tool, disabled && { opacity: 0.3 }, pressed && { opacity: 0.65 }]}>{icon}<Text style={styles.toolLabel}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerGradient: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 22 },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10 },
  overlayButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  projectTitle: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 25 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 },
  review: { minHeight: 44, borderRadius: 12, paddingHorizontal: 15, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', gap: 4 },
  reviewText: { fontSize: 13, fontWeight: '600', color: colors.text },
  dock: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 22 },
  transport: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { color: colors.textSecondary, fontSize: 11, fontVariant: ['tabular-nums'], flex: 1 },
  playButton: { width: 44, height: 36, justifyContent: 'center', alignItems: 'center' },
  takeLabel: { color: colors.textSecondary, textAlign: 'right', fontSize: 11 },
  timelineToggle: { flex: 1, minHeight: 36, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 5 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-around', gap: 0, paddingTop: 4 },
  landscapeToolbar: { width: 324, paddingBottom: 5 },
  tool: { minWidth: 54, flexGrow: 1, height: 52, alignItems: 'center', justifyContent: 'center', gap: 5 },
  toolLabel: { fontSize: 10, color: colors.textSecondary },
  warning: { color: colors.accent, fontSize: 11, lineHeight: 16, paddingBottom: 4 },
  locked: { color: colors.muted, fontSize: 11, paddingBottom: 4 },
  fullscreenTools: { position: 'absolute', flexDirection: 'row', gap: 8 },
  takeRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 6, borderWidth: 1, borderColor: colors.borderSubtle },
  takeSelection: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  thumb: { width: 64, height: 44, overflow: 'hidden', borderRadius: 6, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  takeName: { color: colors.text, fontSize: 13, fontWeight: '500' },
});
