import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Copy, Film, Mic, MoreHorizontal, Scissors, Trash2, Upload, Video } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingImage } from '@/components/LoadingImage';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { colors } from '@/theme/colors';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { importStudioMedia, recoverPendingStudioTakes } from '@/features/studio/media';
import { formatStudioDuration, studioFormats, timelineDuration, type StudioProject, type StudioTake } from '@/features/studio/model';
import { StudioPreview } from '@/features/studio/StudioPreview';
import { StudioTrimControl } from '@/features/studio/StudioTrimControl';
import { StudioAccess, StudioButton, StudioField, StudioFooter, StudioLoading, StudioSaveStatus, StudioSection, studioStyles, useStudioFields } from '@/features/studio/StudioUI';

export default function StudioProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, update } = useStudioProject(Array.isArray(id) ? id[0] : id || '');
  return <StudioAccess>{loading ? <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Seu projeto" back />}><StudioLoading /></AppScreen> : !project ?
    <AppScreen header={<NavigationHeader title="Seu projeto" back />}><View style={studioStyles.empty}><Text style={studioStyles.sectionTitle}>Projeto indisponível</Text><Text style={studioStyles.body}>{error || 'Este projeto não foi encontrado nesta conta e neste aparelho.'}</Text></View></AppScreen> : <ProjectEditor project={project} update={update} />}
  </StudioAccess>;
}

function ProjectEditor({ project, update }: { project: StudioProject; update: (id: string, patch: Partial<StudioProject>) => Promise<StudioProject> }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const maxSheetHeight = Math.max(1, height - insets.top - 16);
  const sheetContentWidth = width > height ? Math.max(1, Math.min(width - insets.left - insets.right, maxSheetHeight * 16 / 9)) : undefined;
  const sheetContentStyle = { width: '100%' as const, maxWidth: sheetContentWidth, alignSelf: 'center' as const };
  const { fields, setField, flush, saving, saveError } = useStudioFields(project, update);
  const [preparation, setPreparation] = useState(false);
  const [activeTakeId, setActiveTakeId] = useState(project.takes[0]?.id);
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [cutStart, setCutStart] = useState('0');
  const [cutEnd, setCutEnd] = useState('0');
  const [busy, setBusy] = useState(false);
  const format = studioFormats.find(item => item.kind === project.kind)!;
  const selectedTake = project.takes.find(take => take.id === selectedTakeId);
  const selectedIndex = project.takes.findIndex(take => take.id === selectedTakeId);
  const duration = timelineDuration(project.takes);
  const locked = ['preparing', 'uploading', 'processing', 'submitted'].includes(project.state);
  const openTakeTools = (take: StudioTake) => { setActiveTakeId(take.id); setSelectedTakeId(take.id); setCutStart(String(Math.round(take.start * 10) / 10)); setCutEnd(String(Math.round(take.end * 10) / 10)); };
  const saveTakes = async (takes: StudioTake[]) => {
    setBusy(true);
    try { await flush(); return await update(project.id, { takes }); }
    catch { Alert.alert('Edição preservada', 'Não foi possível salvar essa alteração. Tente novamente.'); }
    finally { setBusy(false); }
  };
  const addMedia = async () => {
    if (busy || locked) return;
    setBusy(true);
    try {
      const current = await flush();
      const takes = await importStudioMedia(current);
      if (!takes.length) return;
      setActiveTakeId(takes[0].id); setPreparation(false);
    } catch (error) { Alert.alert('Importar conteúdo', error instanceof Error ? error.message : 'Não foi possível importar seu conteúdo. Tente novamente.'); }
    finally { setBusy(false); }
  };
  const recoverTakes = async () => {
    if (busy || locked) return;
    setBusy(true);
    try {
      const latest = await flush();
      const result = await recoverPendingStudioTakes(latest);
      if (result.errors.length) Alert.alert('Recuperação de arquivos', result.errors.join('\n'));
      else if (!result.recovered) Alert.alert('Recuperação de arquivos', 'Nenhum arquivo foi recuperado. Seus arquivos continuam preservados.');
    } catch (error) { Alert.alert('Recuperação de arquivos', error instanceof Error ? error.message : 'Não foi possível recuperar os arquivos. Tente novamente.'); }
    finally { setBusy(false); }
  };
  const discardPending = () => {
    if (busy || locked) return;
    Alert.alert('Retirar arquivos pendentes do projeto?', 'Os takes prontos continuam preservados.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Retirar pendentes', style: 'destructive', onPress: () => {
        setBusy(true);
        void flush().then(() => update(project.id, { pendingTakes: [] }))
          .catch(() => Alert.alert('Arquivos preservados', 'Não foi possível atualizar o projeto. Tente novamente.'))
          .finally(() => setBusy(false));
      } },
    ]);
  };
  const record = async () => {
    if (busy || locked) return;
    try { await flush(); router.push({ pathname: '/studio/capture', params: { id: project.id } }); }
    catch { Alert.alert('Antes de gravar', 'Salve seu projeto para continuar. Toque no aviso de salvamento para tentar novamente.'); }
  };
  const review = async () => {
    if (busy) return;
    try { await flush(); router.push({ pathname: '/studio/review', params: { id: project.id } }); }
    catch { Alert.alert('Antes de revisar', 'Não foi possível salvar seu projeto. Tente novamente.'); }
  };
  const applyCut = async () => {
    if (!selectedTake) return;
    const start = Number(cutStart.replace(',', '.')); const end = Number(cutEnd.replace(',', '.'));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > selectedTake.duration + 0.05 || end - start < 0.1) {
      Alert.alert('Revise o corte', `Use um início e um fim entre 0 e ${Math.round(selectedTake.duration * 10) / 10} segundos. Mantenha ao menos 0,1 segundo.`); return;
    }
    const saved = await saveTakes(project.takes.map(take => take.id === selectedTake.id ? { ...take, start, end } : take));
    if (saved) setSelectedTakeId(null);
  };
  const move = async (direction: -1 | 1) => {
    if (selectedIndex < 0 || selectedIndex + direction < 0 || selectedIndex + direction >= project.takes.length) return;
    const takes = [...project.takes];
    [takes[selectedIndex], takes[selectedIndex + direction]] = [takes[selectedIndex + direction], takes[selectedIndex]];
    await saveTakes(takes);
  };
  const duplicate = async () => {
    if (!selectedTake) return;
    const takes = [...project.takes]; takes.splice(selectedIndex + 1, 0, { ...selectedTake, id: Crypto.randomUUID() });
    const saved = await saveTakes(takes); if (saved) setSelectedTakeId(null);
  };
  const deleteTake = () => {
    if (!selectedTake) return;
    const deleting = selectedTake.id;
    setSelectedTakeId(null);
    Alert.alert('Remover este take?', 'Ele sairá da montagem. Seus outros takes continuam preservados.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover take', style: 'destructive', onPress: () => { void saveTakes(project.takes.filter(take => take.id !== deleting)); } },
    ]);
  };
  return <AppScreen scroll={false} edgeToEdge header={<NavigationHeader back right={<Pressable accessibilityRole="button" accessibilityLabel="Revisar publicação" disabled={busy} onPress={() => { void review(); }} style={[studioStyles.iconButton, { width: 70 }]}><Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>Revisar</Text></Pressable>}>
    <View style={{ gap: 3 }}><Text style={styles.headerTitle}>{format.title}</Text><StudioSaveStatus saving={saving} error={saveError} onRetry={() => { void flush().catch(() => {}); }} /></View>
  </NavigationHeader>}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 28, gap: 28 }}>
        <StudioField label="Título do projeto" value={fields.title} onChangeText={value => setField('title', value)} placeholder="Dê um nome à sua ideia" maxLength={180} editable={!locked} />
        {!!project.pendingTakes?.length && <View style={[studioStyles.card, { gap: 12 }]}>
          <Text style={styles.takeName}>{project.pendingTakes.length === 1 ? 'Há 1 arquivo aguardando recuperação' : `Há ${project.pendingTakes.length} arquivos aguardando recuperação`}</Text>
          <StudioButton label="Tentar recuperar" secondary loading={busy} disabled={locked} onPress={() => { void recoverTakes(); }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Retirar arquivos pendentes do projeto" disabled={locked || busy} onPress={discardPending} style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.muted, fontSize: 12 }}>Retirar pendentes deste projeto</Text></Pressable>
        </View>}
        <View style={{ gap: 16 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={preparation ? 'Recolher preparação' : 'Abrir preparação'} accessibilityState={{ expanded: preparation }} onPress={() => setPreparation(value => !value)} style={styles.preparationToggle}>
            <View style={{ flex: 1, gap: 4 }}><Text style={studioStyles.sectionTitle}>Prepare sua ideia</Text><Text style={studioStyles.hint}>{project.objective ? project.objective : 'Um objetivo claro deixa sua aula mais forte.'}</Text></View>
            {preparation ? <ChevronDown size={20} color={colors.muted} /> : <ChevronRight size={20} color={colors.muted} />}
          </Pressable>
          {preparation ? <View style={{ gap: 18 }}>
            <StudioField label="O que a pessoa vai conseguir fazer?" value={fields.objective} onChangeText={value => setField('objective', value)} placeholder="Ex.: montar sua primeira apresentação com segurança" multiline maxLength={1000} editable={!locked} />
            <StudioField label="Para quem você está ensinando?" value={fields.audience} onChangeText={value => setField('audience', value)} placeholder="Ex.: quem está começando e precisa de um caminho claro" maxLength={500} editable={!locked} />
            <StudioField label="Seu guia de gravação" value={fields.script} onChangeText={value => setField('script', value)} placeholder={'Abertura: apresente o que será aprendido.\n\nDesenvolvimento: explique e demonstre.\n\nFechamento: proponha uma aplicação prática.'} multiline style={{ minHeight: 180 }} hint="Use tópicos ou um roteiro completo. Ele pode acompanhar você no teleprompter durante a gravação." editable={!locked} />
          </View> : null}
        </View>
        <StudioSection title="Sua montagem" detail={`${format.ratio} · ${formatStudioDuration(duration)}${project.takes.length ? ` · ${project.takes.length} ${project.takes.length === 1 ? 'take' : 'takes'}` : ''}`}>
          <StudioPreview takes={project.takes} kind={project.kind} activeTakeId={activeTakeId} onActiveTakeChange={setActiveTakeId} paused={!!selectedTakeId} />
          {!project.takes.length ? <Text style={[studioStyles.body, { textAlign: 'center' }]}>Grave seu primeiro take ou importe um conteúdo. Você pode combinar vários takes e ajustar cada corte.</Text> : null}
          {project.kind === 'short' && duration > 180 ? <View style={styles.notice}><Text style={{ color: colors.accent, fontSize: 12, lineHeight: 18 }}>Sua montagem passou de 3 minutos. Ajuste os cortes para publicar como Short.</Text></View> : null}
        </StudioSection>
        {!!project.takes.length && <StudioSection title="Takes" detail="Toque para assistir. Abra as opções para cortar e organizar.">
          <View style={{ gap: 10 }}>{project.takes.map((take, index) => <View key={take.id} style={[styles.take, activeTakeId === take.id && styles.activeTake]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Assistir take ${index + 1}, ${formatStudioDuration(take.end - take.start)}`} onPress={() => setActiveTakeId(take.id)} style={styles.takeSelection}>
              <View style={styles.takeThumb}>{take.thumbnailUri ? <LoadingImage source={{ uri: take.thumbnailUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : project.kind === 'podcast' ? <Mic size={20} color={colors.muted} strokeWidth={1.5} /> : <Film size={20} color={colors.muted} strokeWidth={1.5} />}
                <View style={styles.takeNumber}><Text style={{ color: colors.text, fontSize: 9 }}>{String(index + 1).padStart(2, '0')}</Text></View>
              </View>
              <View style={{ flex: 1, gap: 6 }}><Text style={styles.takeName} numberOfLines={1}>{take.name || `Take ${index + 1}`}</Text><Text style={studioStyles.hint}>{formatStudioDuration(take.end - take.start)}{take.start > 0 || take.end < take.duration ? ' · Corte aplicado' : ' · Original'}</Text></View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Editar take ${index + 1}`} disabled={locked || busy} onPress={() => openTakeTools(take)} style={studioStyles.iconButton}><MoreHorizontal size={21} color={locked ? colors.mutedDim : colors.textSecondary} /></Pressable>
          </View>)}</View>
        </StudioSection>}
        {locked ? <View style={styles.notice}><Text style={studioStyles.hint}>{project.state === 'submitted' ? 'Este projeto foi enviado para curadoria. Acompanhe o resultado na revisão.' : 'A montagem está sendo preparada para envio. Acompanhe o progresso na revisão.'}</Text></View> : null}
      </ScrollView>
      <StudioFooter>{locked ? <StudioButton label="Acompanhar publicação" onPress={() => { void review(); }} icon={<ChevronRight size={18} color={colors.text} />} /> : <View style={{ flexDirection: 'row', gap: 10 }}>
        <StudioButton label={project.takes.length ? 'Novo take' : 'Gravar'} icon={project.kind === 'podcast' ? <Mic size={18} color={colors.text} strokeWidth={1.7} /> : <Video size={18} color={colors.text} strokeWidth={1.7} />} onPress={() => { void record(); }} disabled={busy} style={{ flex: 1 }} />
        <StudioButton label="Importar" secondary icon={<Upload size={18} color={colors.text} strokeWidth={1.7} />} onPress={() => { void addMedia(); }} loading={busy} style={{ flex: 1 }} />
      </View>}</StudioFooter>
    </KeyboardAvoidingView>
    <SheetModal visible={!!selectedTake && !locked} onRequestClose={() => { if (!busy) setSelectedTakeId(null); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[sheetStyles.backdrop, { paddingTop: insets.top + 16 }]}><Pressable accessibilityLabel="Fechar edição de take" style={{ flex: 1 }} onPress={() => { if (!busy) setSelectedTakeId(null); }} />
        <View style={[sheetStyles.surface, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: maxSheetHeight }]}><View style={sheetStyles.handle} />
          <View style={[sheetStyles.header, sheetContentStyle, { flexShrink: 0 }]}><View style={{ flex: 1, gap: 5 }}><Text style={studioStyles.sectionTitle}>Take {selectedIndex + 1}</Text><Text style={studioStyles.hint}>Original · {formatStudioDuration(selectedTake?.duration || 0)}</Text></View><SheetCloseButton onPress={() => { if (!busy) setSelectedTakeId(null); }} /></View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={[sheetContentStyle, { flexShrink: 1, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 20, gap: 20 }}>
            <View style={{ gap: 12 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Scissors size={18} color={colors.textSecondary} /><Text style={styles.takeName}>Ajustar corte</Text></View>
              <StudioTrimControl duration={selectedTake?.duration || 0} start={Number(cutStart.replace(',', '.'))} end={Number(cutEnd.replace(',', '.'))} disabled={busy}
                onChange={(start, end) => { setCutStart(String(start)); setCutEnd(String(end)); }} />
              <View style={{ flexDirection: 'row', gap: 12 }}><View style={{ flex: 1 }}><StudioField label="Entrada (segundos)" keyboardType="decimal-pad" value={cutStart} onChangeText={setCutStart} editable={!busy} /></View><View style={{ flex: 1 }}><StudioField label="Saída (segundos)" keyboardType="decimal-pad" value={cutEnd} onChangeText={setCutEnd} editable={!busy} /></View></View>
              <Text style={studioStyles.hint}>Os cortes preservam o arquivo original e são aplicados na exportação.</Text>
              <StudioButton label="Aplicar corte" loading={busy} icon={<Check size={18} color={colors.text} />} onPress={() => { void applyCut(); }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}><StudioButton label="Antes" secondary icon={<ArrowUp size={17} color={colors.text} />} disabled={busy || selectedIndex === 0} onPress={() => { void move(-1); }} style={{ flex: 1 }} /><StudioButton label="Depois" secondary icon={<ArrowDown size={17} color={colors.text} />} disabled={busy || selectedIndex === project.takes.length - 1} onPress={() => { void move(1); }} style={{ flex: 1 }} /></View>
            <View style={{ flexDirection: 'row', gap: 10, paddingBottom: 10 }}><StudioButton label="Duplicar" secondary icon={<Copy size={17} color={colors.text} />} disabled={busy} onPress={() => { void duplicate(); }} style={{ flex: 1 }} /><StudioButton label="Remover" secondary icon={<Trash2 size={17} color={colors.text} />} disabled={busy} onPress={deleteTake} style={{ flex: 1 }} /></View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SheetModal>
  </AppScreen>;
}

const styles = StyleSheet.create({
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  preparationToggle: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48 },
  take: { borderRadius: 13, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.backgroundElevated, flexDirection: 'row', alignItems: 'center', padding: 8 },
  activeTake: { borderColor: 'rgba(225,29,72,0.65)', backgroundColor: colors.surface },
  takeSelection: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  takeThumb: { width: 66, height: 54, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  takeNumber: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3 },
  takeName: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  notice: { padding: 14, backgroundColor: colors.surface, borderRadius: 12 },
});
