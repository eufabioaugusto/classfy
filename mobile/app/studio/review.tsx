import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Check, CheckCircle2, ChevronRight, Circle, Download, ImagePlus, RefreshCw, Send } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingImage } from '@/components/LoadingImage';
import { PlanCrown } from '@/components/PlanCrown';
import { colors } from '@/theme/colors';
import { useAuth } from '@/features/auth/authContext';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { useStudioOrientation } from '@/features/studio/useStudioOrientation';
import { cancelStudioExport, exportStudioProject, importStudioCover } from '@/features/studio/media';
import { prepareStudioUpload, submitStudioProject, refreshStudioUpload, cancelStudioUpload } from '@/features/studio/backend';
import { compileStudioRecipe, formatStudioDuration, publicationIssues, studioFormats, studioSeconds, studioStateLabel, timelineSignature, validateStudioRecipe, type StudioProject, type StudioVisibility } from '@/features/studio/model';
import { StudioAccess, StudioButton, StudioField, StudioFooter, StudioLoading, StudioSaveStatus, studioStyles, useStudioFields } from '@/features/studio/StudioUI';
import { StudioCompositionPreview } from '@/features/studio/StudioCompositionPreview';

const accessOptions: { key: StudioVisibility; title: string; detail: string }[] = [
  { key: 'free', title: 'Gratuito', detail: 'Aberto a todos' },
  { key: 'pro', title: 'Pro', detail: 'Para membros Pro' },
  { key: 'premium', title: 'Premium', detail: 'Para membros Premium' },
  { key: 'paid', title: 'Avulso', detail: 'Compra individual' },
];

export default function StudioReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  useStudioOrientation('short');
  useFocusEffect(useCallback(() => { StatusBar.setHidden(false, 'fade'); StatusBar.setBarStyle('light-content'); }, []));
  const { project, loading, error, update } = useStudioProject(Array.isArray(id) ? id[0] : id || '');
  return <StudioAccess>{loading ? <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Revisar publicação" back />}><StudioLoading /></AppScreen> : !project ?
    <AppScreen header={<NavigationHeader title="Revisar publicação" back />}><View style={studioStyles.empty}><Text style={studioStyles.sectionTitle}>Projeto indisponível</Text><Text style={studioStyles.body}>{error || 'Abra este projeto na conta que o criou.'}</Text></View></AppScreen> : <PublicationReview key={project.id} project={project} update={update} />}
  </StudioAccess>;
}

function PublicationReview({ project, update }: { project: StudioProject; update: (id: string, patch: Partial<StudioProject>) => Promise<StudioProject> }) {
  const router = useRouter();
  const { profile } = useAuth();
  const { fields, setField, flush, saving, saveError } = useStudioFields(project, update);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [liveProgress, setLiveProgress] = useState<number | null>(null);
  const [preparedFile, setPreparedFile] = useState<{ uri: string; signature: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const mounted = useRef(true);
  const working = useRef(false);
  const cancelled = useRef(false);
  const preparationEpoch = useRef(0);
  const workKind = useRef<'export' | 'upload' | null>(null);
  const projectRef = useRef(project); projectRef.current = project;
  const inflight = ['preparing', 'uploading', 'processing'].includes(project.state);
  const locked = inflight || project.state === 'submitted' || busy;
  const cover = project.coverUri || project.coverUrl;
  // Schema 2 exposes takes through a non-enumerable adapter. A spread preserves
  // editing but drops that getter; retain the real takes for this view-model.
  const effective = { ...project, ...fields, takes: project.takes, tags: fields.tags.split(',').map(tag => tag.trim()).filter(Boolean) };
  const issues = publicationIssues(effective);
  const fileReady = !!preparedFile && preparedFile.signature === timelineSignature(project);
  const progress = liveProgress ?? (fileReady && !inflight ? 100 : project.progress);
  const showPreparation = stage !== null || inflight || project.state === 'ready' || fileReady;
  const recipe = useMemo(() => compileStudioRecipe(project), [project.editing, project.kind, project.takes]);
  const exportBlocked = !project.takes.length || !!project.pendingTakes?.length || validateStudioRecipe(recipe).length > 0;
  const { width } = useWindowDimensions();
  const previewRatio = project.kind === 'podcast' ? 1 : recipe.output.width / recipe.output.height;
  // Scroll padding, card padding and border are outside the preview's frame.
  const previewWidth = Math.max(1, Math.min(width - 78, 240 * previewRatio));
  const stageProgress = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const format = studioFormats.find(item => item.kind === project.kind)!;
  const checks = [
    { title: 'Conteúdo gravado e montagem válida', valid: !!project.takes.length && !project.pendingTakes?.length && !issues.some(issue => issue.includes('takes') || issue.includes('cortes') || issue.includes('3 minutos')) },
    { title: 'Título da publicação', valid: !!fields.title.trim() },
    ...(project.kind !== 'short' ? [{ title: 'Descrição do aprendizado', valid: !!fields.description.trim() }] : []),
    { title: 'Capa escolhida', valid: !!cover },
    ...(project.visibility === 'paid' ? [{ title: 'Preço definido', valid: !issues.some(issue => issue.includes('preço')) }] : []),
  ];
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      const latest = projectRef.current;
      if (state === 'active' && latest.state === 'processing') void refreshStudioUpload(latest).catch(() => {});
    });
    return () => listener.remove();
  }, []);
  const saveMetadata = flush;
  const startWork = () => { if (working.current) return false; working.current = true; setBusy(true); return true; };
  const finishWork = () => { working.current = false; if (mounted.current) setBusy(false); };
  const chooseCover = async () => {
    if (locked || !startWork()) return;
    try { const latest = await saveMetadata(); const coverUri = await importStudioCover(latest); if (coverUri) await update(latest.id, { coverUri }); }
    catch (error) { Alert.alert('Capa da publicação', error instanceof Error ? error.message : 'Não foi possível selecionar a capa. Tente novamente.'); }
    finally { finishWork(); }
  };
  const useTakeCover = async () => {
    const thumbnail = project.takes.find(take => take.thumbnailUri)?.thumbnailUri;
    if (!thumbnail || locked || !startWork()) return;
    try { await update(project.id, { coverUri: thumbnail }); }
    catch { Alert.alert('Sua capa', 'Não foi possível salvar a imagem. Tente novamente.'); }
    finally { finishWork(); }
  };
  const changeAccess = async (visibility: StudioVisibility) => {
    if (locked || !startWork()) return;
    try { await saveMetadata(); await update(project.id, { visibility }); }
    catch { Alert.alert('Acesso da publicação', 'Não foi possível salvar essa alteração. Tente novamente.'); }
    finally { finishWork(); }
  };
  const prepare = async () => {
    if (inflight || project.state === 'submitted' || issues.length || !startWork()) return;
    const epoch = ++preparationEpoch.current;
    workKind.current = 'upload';
    cancelled.current = false; setLocalError(null); setLiveProgress(0); setStage('Preparando sua montagem');
    try {
      const latest = await saveMetadata();
      if (cancelled.current || !mounted.current) return;
      await prepareStudioUpload(latest, (value, nextStage) => { if (mounted.current && working.current && preparationEpoch.current === epoch && !cancelled.current) { setLiveProgress(value); setStage(nextStage || 'Preparando envio'); } });
    } catch (error) {
      if (mounted.current && !cancelled.current) setLocalError(error instanceof Error ? error.message : 'O envio foi interrompido. Seu projeto continua salvo.');
    } finally { if (preparationEpoch.current === epoch) { preparationEpoch.current += 1; workKind.current = null; } finishWork(); if (mounted.current) { setStage(null); setLiveProgress(null); } }
  };
  const exportFile = async (share = false) => {
    if (locked || exportBlocked || !startWork()) return;
    const epoch = ++preparationEpoch.current;
    workKind.current = 'export'; cancelled.current = false;
    setExporting(true); setPreparedFile(null); setLocalError(null); setStage(share ? 'Verificando arquivo' : 'Exportando arquivo'); setLiveProgress(0);
    try {
      const latest = await saveMetadata();
      const signature = timelineSignature(latest);
      const canContinue = () => mounted.current && working.current && !cancelled.current && preparationEpoch.current === epoch
        && projectRef.current.id === latest.id && timelineSignature(projectRef.current) === signature;
      if (!canContinue()) return;
      const result = await exportStudioProject(latest, value => { if (canContinue()) { setStage('Exportando arquivo'); setLiveProgress(value * 100); } }, canContinue);
      if (!canContinue()) return;
      setPreparedFile({ uri: result.uri, signature }); setLiveProgress(100); setStage('Arquivo preparado');
      if (share && Platform.OS === 'ios') await Share.share({ url: result.uri }, { subject: latest.title.trim() || 'Classfy Studio' });
    } catch (error) {
      if (mounted.current && !cancelled.current) setLocalError(error instanceof Error ? error.message : 'Não foi possível preparar o arquivo. Seus originais continuam salvos.');
    } finally {
      if (preparationEpoch.current === epoch) { preparationEpoch.current += 1; workKind.current = null; }
      finishWork(); if (mounted.current) { setExporting(false); setStage(null); setLiveProgress(null); }
    }
  };
  const submit = async () => {
    if (issues.length || !startWork()) return;
    setLocalError(null);
    try { const latest = await saveMetadata(); await submitStudioProject(latest); }
    catch (error) { if (mounted.current) setLocalError(error instanceof Error ? error.message : 'Não foi possível confirmar o envio. Tente novamente.'); }
    finally { finishWork(); }
  };
  const refresh = async () => {
    if (!startWork()) return;
    setLocalError(null);
    try { await refreshStudioUpload(project); }
    catch (error) { if (mounted.current) setLocalError(error instanceof Error ? error.message : 'Não foi possível atualizar o processamento.'); }
    finally { finishWork(); }
  };
  const cancel = () => {
    const epoch = preparationEpoch.current, kind = workKind.current, target = projectRef.current;
    Alert.alert(exporting ? 'Interromper a exportação?' : 'Interromper o envio?', 'Sua montagem e seus takes continuam salvos. Você pode retomar a preparação depois.', [
      { text: 'Continuar', style: 'cancel' },
      { text: 'Interromper', onPress: () => {
        // The operation may finish while the confirmation is still on screen.
        if (!mounted.current || preparationEpoch.current !== epoch || workKind.current !== kind || projectRef.current.id !== target.id || projectRef.current.ownerId !== target.ownerId) return;
        cancelled.current = true;
        const stop = kind === 'export' ? cancelStudioExport : cancelStudioUpload;
        void stop(target).catch(() => { if (mounted.current && preparationEpoch.current === epoch) setLocalError('Não foi possível interromper a preparação. Tente novamente.'); });
      } },
    ]);
  };
  return <AppScreen scroll={false} edgeToEdge header={<NavigationHeader back>
    <View style={{ gap: 3 }}><Text style={styles.headerTitle}>Revisar publicação</Text><StudioSaveStatus saving={saving} error={saveError} onRetry={() => { void flush().catch(() => {}); }} /></View>
  </NavigationHeader>}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingTop: 12, paddingBottom: 24, gap: 24 }}>
        {showPreparation ? <View style={[studioStyles.card, styles.preparation]}>
          <View style={[styles.preview, { width: previewWidth, height: previewWidth / previewRatio }]} accessibilityLabel="Prévia da montagem em preparação">
            <StudioCompositionPreview project={project} recipe={recipe} paused />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={[styles.accessTitle, { flex: 1 }]}>{stage || (fileReady && !inflight && project.state !== 'ready' ? 'Arquivo preparado' : studioStateLabel[project.state])}</Text>
            {project.state !== 'processing' ? <Text style={studioStyles.hint}>{Math.round(stageProgress)}% da etapa</Text> : null}
          </View>
          {project.state !== 'processing' ? <View accessibilityRole="progressbar" accessibilityLabel={stage || (fileReady && project.state !== 'ready' ? 'Arquivo preparado' : studioStateLabel[project.state])} accessibilityValue={{ min: 0, max: 100, now: Math.round(stageProgress) }} style={styles.progressTrack}>
            <View style={[styles.progress, { width: `${stageProgress}%` }]} />
          </View> : null}
          <Text style={studioStyles.hint}>{stage === 'Arquivo preparado' || fileReady && stage === null ? 'Seu arquivo está preparado. Escolha onde salvar ou compartilhar pela folha do iPhone.' : exporting ? 'Mantenha o aplicativo aberto até o arquivo ficar pronto. A exportação prepara um arquivo local da montagem.' : project.state === 'processing' ? 'Seu arquivo foi enviado e está sendo preparado para reprodução. Você pode sair desta tela e consultar novamente depois.' : project.state === 'ready' && stage === null ? 'A montagem foi preparada. Envie para curadoria quando terminar a revisão.' : 'Mantenha o aplicativo aberto durante a preparação e o envio. O percentual mostra a etapa atual; seu rascunho continua salvo.'}</Text>
          {(stage !== null || ['preparing', 'uploading'].includes(project.state)) && stage !== 'Arquivo preparado' && project.state !== 'processing' && (project.state !== 'ready' || exporting) ? <Pressable accessibilityRole="button" accessibilityLabel={exporting ? 'Interromper exportação' : 'Interromper envio'} onPress={cancel} style={{ minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' }}><Text style={{ color: colors.muted, fontSize: 12 }}>{exporting ? 'Interromper exportação' : 'Interromper envio'}</Text></Pressable> : null}
          {fileReady && Platform.OS === 'ios' && !stage ? <StudioButton secondary label="Salvar/compartilhar" disabled={locked} onPress={() => { void exportFile(true); }} /> : null}
        </View> : null}
        {project.state === 'submitted' ? <View style={styles.success}>
          <CheckCircle2 size={23} strokeWidth={1.5} color={colors.free} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.sectionLabel}>Enviado para curadoria</Text><Text style={studioStyles.hint}>Sua publicação foi recebida e passa pela curadoria antes de aparecer no catálogo.</Text></View>
        </View> : null}
        <View style={styles.summary}>
          <Pressable accessibilityRole="button" accessibilityLabel={cover ? 'Trocar capa da publicação' : 'Escolher capa da publicação'} disabled={locked} onPress={() => { void chooseCover(); }}
            style={({ pressed }) => [styles.cover, project.kind === 'short' && { aspectRatio: 9 / 16, width: 76 }, project.kind === 'podcast' && { aspectRatio: 1, width: 100 }, pressed && { opacity: 0.75 }]}>
            <ImagePlus color={colors.mutedDim} size={25} strokeWidth={1.4} />
            {cover ? <LoadingImage source={{ uri: cover }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : null}
          </Pressable>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryMeta}>{format.title} · {formatStudioDuration(studioSeconds(recipe.durationTicks))} · {format.ratio}</Text>
            <Text style={styles.summaryTitle} numberOfLines={2}>{fields.title.trim() || `${format.title} sem título`}</Text>
            {project.state !== 'submitted' ? <Pressable accessibilityRole="button" accessibilityLabel={cover ? 'Trocar capa da publicação' : 'Escolher capa da publicação'} disabled={locked} onPress={() => { void chooseCover(); }}
              style={({ pressed }) => [styles.coverAction, pressed && { backgroundColor: colors.surfaceAlt }, locked && { opacity: 0.45 }]}><ImagePlus size={15} color={colors.textSecondary} strokeWidth={1.5} /><Text style={styles.coverActionText}>{cover ? 'Trocar capa' : 'Escolher capa'}</Text></Pressable> : null}
            {!cover && project.takes.some(take => take.thumbnailUri) ? <Pressable accessibilityRole="button" accessibilityLabel="Usar imagem do take como capa" disabled={locked} onPress={() => { void useTakeCover(); }} style={({ pressed }) => [styles.takeCoverAction, pressed && { opacity: 0.7 }, locked && { opacity: 0.45 }]}><Text style={studioStyles.hint}>Usar imagem do take</Text></Pressable> : null}
          </View>
        </View>
        <View style={{ gap: 17 }}>
          <StudioField label="Título" value={fields.title} onChangeText={value => setField('title', value)} placeholder="Um título claro e específico" maxLength={180} editable={!locked} />
          <StudioField label={project.kind === 'short' ? 'Descrição (opcional)' : 'O que a pessoa vai aprender?'} value={fields.description} onChangeText={value => setField('description', value)} placeholder="Apresente o conteúdo e o resultado que ele entrega." multiline style={{ minHeight: 96 }} maxLength={5000} editable={!locked} />
          <StudioField label="Tags (opcional)" value={fields.tags} onChangeText={value => setField('tags', value)} onBlur={() => { if (!locked) void flush().catch(() => {}); }} placeholder="Ex.: design, apresentação, criatividade" hint="Separe os temas por vírgula." maxLength={400} editable={!locked} autoCapitalize="none" />
        </View>
        <View style={{ gap: 13 }}><Text style={styles.sectionLabel}>Quem pode acessar</Text>
          <View style={styles.accessGrid}>{accessOptions.map(option => <Pressable accessibilityRole="radio" accessibilityLabel={`${option.title}, ${option.detail}`} accessibilityState={{ selected: project.visibility === option.key, disabled: locked }} key={option.key} disabled={locked} onPress={() => { void changeAccess(option.key); }}
            style={({ pressed }) => [styles.accessCard, project.visibility === option.key && styles.accessSelected, pressed && { opacity: 0.75 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{option.key === 'pro' || option.key === 'premium' ? <PlanCrown plan={option.key} size={13} /> : null}<Text style={styles.accessTitle}>{option.title}</Text>{project.visibility === option.key ? <Check size={13} color={colors.text} style={{ marginLeft: 'auto' }} /> : null}</View><Text style={styles.accessDetail}>{option.detail}</Text>
          </Pressable>)}</View>
          {project.visibility === 'paid' ? <StudioField label="Preço (R$)" value={fields.price} onChangeText={value => setField('price', value)} placeholder="0,00" keyboardType="decimal-pad" editable={!locked} /> : null}
        </View>
        {project.state !== 'submitted' ? <View style={{ gap: 12 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={styles.sectionLabel}>Revisão final</Text><Text style={styles.summaryMeta}>{checks.filter(item => item.valid).length}/{checks.length}</Text></View>
          <View style={[studioStyles.card, { gap: 11, padding: 15 }]}>{checks.map(item => <View key={item.title} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>{item.valid ? <CheckCircle2 size={16} color={colors.textSecondary} strokeWidth={1.5} /> : <Circle size={16} color={colors.mutedDim} strokeWidth={1.5} />}<Text style={{ color: item.valid ? colors.textSecondary : colors.muted, fontSize: 12, flex: 1 }}>{item.title}</Text></View>)}</View>
          {!!issues.length && <Text style={studioStyles.hint}>{issues[0]}</Text>}
          {profile?.creator_status && !['approved', ''].includes(profile.creator_status) ? <Text style={studioStyles.hint}>Seus projetos podem ser preparados agora. A permissão para enviar é verificada antes da publicação.</Text> : null}
        </View> : null}
        {localError || project.error ? <View style={[studioStyles.card, { borderColor: 'rgba(225,29,72,0.3)', gap: 8 }]}><Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '500' }}>Seu projeto continua salvo</Text><Text style={studioStyles.hint}>{localError || project.error}</Text></View> : null}
      </ScrollView>
      <StudioFooter>
        {project.state !== 'submitted' && !inflight ? <StudioButton secondary label="Exportar arquivo" icon={<Download size={17} color={colors.text} strokeWidth={1.7} />} disabled={locked || exportBlocked} loading={exporting} onPress={() => { void exportFile(); }} /> : null}
        {project.state === 'submitted' ? <StudioButton label="Voltar ao Studio" icon={<ChevronRight size={18} color={colors.text} />} onPress={() => router.replace('/studio')} /> : project.state === 'ready' ? <>
          <StudioButton label="Enviar para curadoria" icon={<Send size={17} color={colors.text} strokeWidth={1.7} />} loading={busy && !exporting} disabled={!!issues.length || exporting} onPress={() => { void submit(); }} />
          <Text style={[studioStyles.hint, { fontSize: 10, textAlign: 'center' }]}>A publicação aparece no catálogo após aprovação.</Text>
        </> : project.state === 'processing' ? <StudioButton secondary label="Verificar processamento" icon={<RefreshCw size={18} color={colors.text} strokeWidth={1.6} />} loading={busy} onPress={() => { void refresh(); }} /> : <>
          <StudioButton label={project.state === 'preparing' ? 'Preparando montagem…' : project.state === 'uploading' ? 'Enviando conteúdo…' : project.state === 'error' ? 'Retomar envio' : 'Preparar envio'} loading={busy && !exporting || ['preparing', 'uploading'].includes(project.state)} disabled={!!issues.length || inflight || exporting} onPress={() => { void prepare(); }} />
          {!inflight ? <Text style={[studioStyles.hint, { fontSize: 10, textAlign: 'center' }]}>A montagem e a capa serão enviadas à sua conta.</Text> : null}
        </>}
      </StudioFooter>
    </KeyboardAvoidingView>
  </AppScreen>;
}

const styles = StyleSheet.create({
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sectionLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: '500' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  summaryCopy: { flex: 1, gap: 7 },
  summaryMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  summaryTitle: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  cover: { width: 130, aspectRatio: 16 / 9, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  coverAction: { alignSelf: 'flex-start', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: colors.surface },
  coverActionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  takeCoverAction: { minHeight: 36, justifyContent: 'center' },
  accessGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  accessCard: { width: '48%', flexGrow: 1, gap: 7, backgroundColor: colors.backgroundElevated, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 13, minHeight: 70 },
  accessSelected: { borderColor: colors.textSecondary, backgroundColor: colors.surface },
  accessTitle: { color: colors.textSecondary, fontWeight: '500', fontSize: 14 },
  accessDetail: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  preparation: { gap: 12, padding: 15 },
  preview: { alignSelf: 'center', overflow: 'hidden', borderRadius: 8, backgroundColor: '#000000' },
  progressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.border },
  progress: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  success: { flexDirection: 'row', gap: 13, padding: 16, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'flex-start' },
});
