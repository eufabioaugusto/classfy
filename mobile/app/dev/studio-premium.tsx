import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { colors } from '@/theme/colors';
import { StudioCompositionPreview } from '@/features/studio/StudioCompositionPreview';
import { StudioTimeline } from '@/features/studio/StudioTimeline';
import { StudioTreatmentPanel } from '@/features/studio/StudioTreatmentPanel';
import { StudioLayerPanel } from '@/features/studio/StudioLayerPanel';
import type { StudioPlaybackState, StudioPreviewHandle } from '@/features/studio/StudioPreview';
import { addStudioLayerItem, compileStudioRecipe, createStudioTextItem, emptyStudioEditing, formatStudioEditorTime, patchStudioLayerItem, removeStudioLayerItem,
  studioSeconds, studioTicks, validateStudioRecipe, withStudioTakes, type StudioAsset, type StudioEditing, type StudioProject } from '@/features/studio/model';
import { cancelExportAsync, exportRecipeAsync, generateThumbnailAsync, getMediaInfoAsync, isStudioCompositionAvailable } from '../../modules/classfy-studio-media';

const reportURI = () => `${FileSystem.cacheDirectory}classfy-studio-premium-qa-result.json`;

// Development-only local fixture viewer. It deliberately bypasses auth, project
// storage and publication: only cache files and the native compositor are used.
export default function StudioPremiumQA() {
  const [project, setProject] = useState<StudioProject>();
  const [draft, setDraft] = useState<StudioEditing>();
  const [selectedTakeId, setSelectedTakeId] = useState('main-landscape');
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const [treatment, setTreatment] = useState(false);
  const [before, setBefore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Abrindo fixtures locais…');
  const [playback, setPlayback] = useState<StudioPlaybackState>({ position: 0, sourcePosition: 0, playing: false, loading: true });
  const preview = useRef<StudioPreviewHandle>(null);
  const mounted = useRef(true), job = useRef<string | undefined>(undefined), working = useRef(false);
  const current = useRef(project); current.current = project;
  useEffect(() => {
    if (!__DEV__) return;
    mounted.current = true;
    const run = async () => {
      if (!FileSystem.cacheDirectory || !isStudioCompositionAvailable()) throw new Error('Instale o binário atual do Classfy Dev com o motor de composição.');
      const directory = `${FileSystem.cacheDirectory}classfy-premium-qa-${randomUUID()}/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const load = async (module: number, name: string) => {
        const fixture = Asset.fromModule(module); await fixture.downloadAsync();
        if (!fixture.localUri) throw new Error(`Fixture ${name} indisponível.`);
        const uri = `${directory}${name}`; await FileSystem.copyAsync({ from: fixture.localUri, to: uri }); return uri;
      };
      const [landscape, portrait, audio] = await Promise.all([
        load(require('../../assets/studio-qa/landscape.mp4'), 'landscape.mp4'), load(require('../../assets/studio-qa/portrait.mp4'), 'portrait.mp4'), load(require('../../assets/studio-qa/audio.m4a'), 'audio.m4a'),
      ]);
      const [wideInfo, tallInfo, audioInfo] = await Promise.all([getMediaInfoAsync(landscape), getMediaInfoAsync(portrait), getMediaInfoAsync(audio)]);
      const source = (id: string, uri: string, kind: StudioAsset['kind'], info: typeof wideInfo): StudioAsset => ({ id, uri, kind, name: id, durationTicks: studioTicks(info.duration), width: info.width, height: info.height, frameRate: info.frameRate, sourceStage: 'standard' });
      const wide = source('wide', landscape, 'video', wideInfo), tall = source('tall', portrait, 'video', tallInfo), sound = source('sound', audio, 'audio', audioInfo);
      for (const asset of [wide, tall]) {
        try { asset.thumbnailUri = (await generateThumbnailAsync(asset.uri, `${directory}${asset.id}.jpg`, 0.5)).uri; } catch { /* Canvas can still render the original. */ }
      }
      const mainLength = Math.min(studioTicks(1.5), wide.durationTicks - studioTicks(0.2), tall.durationTicks - studioTicks(0.2));
      if (mainLength < studioTicks(0.5)) throw new Error('Fixtures curtas demais para o diagnóstico.');
      let editing = emptyStudioEditing('aula');
      editing = { ...editing, assets: [wide, tall, sound], main: [
        { id: 'main-landscape', assetId: wide.id, sourceStartTicks: studioTicks(0.2), sourceEndTicks: studioTicks(0.2) + mainLength },
        { id: 'main-portrait', assetId: tall.id, sourceStartTicks: studioTicks(0.2), sourceEndTicks: studioTicks(0.2) + mainLength },
      ] };
      const overlayLength = Math.min(studioTicks(1), mainLength - studioTicks(0.25), tall.durationTicks - studioTicks(0.3));
      editing = addStudioLayerItem(editing, { id: 'pip', kind: 'video', assetId: tall.id, atTicks: 0, durationTicks: overlayLength, sourceStartTicks: studioTicks(0.3), sourceEndTicks: studioTicks(0.3) + overlayLength,
        anchor: { clipId: 'main-landscape', offsetTicks: studioTicks(0.25) }, rect: { x: 0.65, y: 0.08, width: 0.28, height: 0.72 }, fit: 'contain', gain: 0 });
      editing = addStudioLayerItem(editing, { ...createStudioTextItem({ id: 'title', content: 'Classfy Studio · preview = export', durationTicks: mainLength, clipId: 'main-landscape' }), rect: { x: 0.05, y: 0.75, width: 0.85, height: 0.18 }, text: { content: 'Classfy Studio · preview = export', fontFamily: 'System', fontSize: 0.055, color: '#FFFFFF', backgroundColor: '#111111BB', alignment: 'center' } });
      const audioLength = Math.min(mainLength * 2, sound.durationTicks);
      editing = addStudioLayerItem(editing, { id: 'audio-bed', kind: 'audio', assetId: sound.id, atTicks: 0, durationTicks: audioLength, sourceStartTicks: 0, sourceEndTicks: audioLength, gain: 0.2, fadeInTicks: Math.min(studioTicks(0.2), Math.floor(audioLength / 2)), fadeOutTicks: Math.min(studioTicks(0.2), Math.floor(audioLength / 2)) });
      const now = new Date().toISOString();
      const fixtureProject = withStudioTakes({ version: 2, id: 'premium-qa', ownerId: 'local-qa', kind: 'aula', title: 'Studio Premium QA', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '', editing, createdAt: now, updatedAt: now, revision: 1, state: 'draft', progress: 0 });
      const issues = validateStudioRecipe(compileStudioRecipe(fixtureProject)); if (issues.length) throw new Error(issues.join(' '));
      if (mounted.current) { setProject(fixtureProject); setMessage('Pronto · 2 vídeos + texto + áudio. Edição local em cache.'); }
    };
    void run().catch(cause => { if (mounted.current) setMessage(cause instanceof Error ? cause.message : 'Falha ao abrir as fixtures.'); });
    return () => { mounted.current = false; if (job.current) void cancelExportAsync(job.current); };
  }, []);
  if (!__DEV__) return <Redirect href="/" />;
  const closePanel = () => { setDraft(undefined); setSelectedLayerId(undefined); setTreatment(false); setBefore(false); };
  const apply = async (editing: StudioEditing) => {
    const previous = current.current; if (!previous || working.current) throw new Error('Aguarde a operação local terminar.');
    working.current = true; setBusy(true); preview.current?.pause();
    try {
      const next = withStudioTakes({ ...previous, editing, revision: previous.revision + 1, updatedAt: new Date().toISOString() });
      const recipe = compileStudioRecipe(next); const errors = validateStudioRecipe(recipe); if (errors.length) throw new Error(errors[0]);
      await FileSystem.writeAsStringAsync(`${FileSystem.cacheDirectory}classfy-studio-premium-qa-editing.json`, JSON.stringify({ project: next, recipe }));
      if (mounted.current) { current.current = next; setProject(next); closePanel(); setMessage('Edição salva em cache · nenhum conteúdo publicado.'); }
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const exporting = async () => {
    const snapshot = current.current; if (!snapshot || working.current || !FileSystem.cacheDirectory) return;
    working.current = true; setBusy(true); setProgress(0); preview.current?.pause(); closePanel();
    const requestId = randomUUID(); job.current = requestId;
    const recipe = compileStudioRecipe(snapshot), outputUri = `${FileSystem.cacheDirectory}classfy-premium-export-${requestId}.mp4`;
    try {
      const result = await exportRecipeAsync({ requestId, recipeJSON: JSON.stringify(recipe), outputUri }, value => { if (mounted.current) setProgress(value); });
      const checks = { duration: Math.abs(result.duration - studioSeconds(recipe.durationTicks)) <= 1 / 30 + 0.01, size: result.width === 1920 && result.height === 1080, frameRate: Math.abs((result.frameRate ?? 0) - 30) < 0.02, audio: result.hasAudio, file: result.fileSize > 0 };
      const passed = Object.values(checks).every(Boolean);
      await FileSystem.writeAsStringAsync(reportURI(), JSON.stringify({ passed, checks, result, recipe, projectRevision: snapshot.revision, reportedAt: new Date().toISOString() }));
      if (mounted.current) setMessage(passed ? 'Export OK · 1080p30 SDR, duração e áudio verificados. JSON salvo no cache.' : `Export divergente · ${JSON.stringify(checks)}`);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Falha de exportação';
      await FileSystem.writeAsStringAsync(reportURI(), JSON.stringify({ passed: false, error, recipe }));
      if (mounted.current) setMessage(error);
    } finally { if (job.current === requestId) job.current = undefined; working.current = false; if (mounted.current) setBusy(false); }
  };
  const rendered = project && draft ? withStudioTakes({ ...project, editing: draft }) : project;
  const recipe = project ? compileStudioRecipe(project) : undefined;
  const layer = project?.editing?.layers.flatMap(track => track.items).find(item => item.id === selectedLayerId);
  return <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="QA Studio premium" back />}>
    <View style={s.body}>
      <Text accessibilityLabel="Estado do diagnóstico premium" style={s.status}>{message}</Text>
      <View style={s.canvas}>{rendered ? <StudioCompositionPreview ref={preview} project={rendered} before={before} paused={busy} onPlaybackState={setPlayback} canvasLabel="Composição de diagnóstico" /> : <ActivityIndicator color={colors.muted} />}</View>
      <View style={s.controls}><Action label={playback.playing ? 'Pausar' : 'Reproduzir'} disabled={!project || busy || playback.loading} onPress={() => preview.current?.togglePlayback()} /><Text style={s.time}>{formatStudioEditorTime(playback.position)} / {formatStudioEditorTime(recipe ? studioSeconds(recipe.durationTicks) : 0)}</Text><Action label="Exportar QA" disabled={!project || busy} onPress={() => { void exporting(); }} /></View>
      {busy && <Text style={s.status}>Exportando {Math.round(progress * 100)}%</Text>}
      {project && <StudioTimeline takes={project.takes} position={playback.position} activeTakeId={selectedTakeId} layers={recipe!.clips.filter(clip => clip.zIndex > 0)} selectedLayerId={selectedLayerId} busy={busy}
        onSelect={take => { closePanel(); preview.current?.pause(); setSelectedTakeId(take.id); }} onSeek={seconds => preview.current?.seek(seconds)} onScrubStart={() => preview.current?.pause()}
        onSelectLayer={id => { closePanel(); preview.current?.pause(); setSelectedLayerId(id); }} onMoveLayer={async (id, delta) => {
          const editing = current.current!.editing!; const item = editing.layers.flatMap(track => track.items).find(candidate => candidate.id === id)!;
          await apply(patchStudioLayerItem(editing, id, item.anchor ? { anchor: { ...item.anchor, offsetTicks: Math.max(0, (item.anchor.offsetTicks ?? 0) + studioTicks(delta)) } } : { atTicks: Math.max(0, item.atTicks + studioTicks(delta)) }));
        }} />}
      {project && layer ? <StudioLayerPanel key={layer.id} editing={project.editing!} item={layer} disabled={busy} onPreview={setDraft} onApply={apply} onClose={closePanel} onRemove={() => { void apply(removeStudioLayerItem(project.editing!, layer.id)).catch(cause => setMessage(cause instanceof Error ? cause.message : 'Falha ao salvar a edição local.')); }} /> : project && treatment ? <StudioTreatmentPanel key={selectedTakeId} editing={project.editing!} targetId={selectedTakeId} disabled={busy} onPreview={setDraft} onBefore={setBefore} onApply={apply} onClose={closePanel} /> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.toolbar}>
        <Action label="Tratamento" disabled={!project || busy} onPress={() => { closePanel(); preview.current?.pause(); setTreatment(true); }} />
        <Action label="Editar PiP" disabled={!project || busy} onPress={() => { closePanel(); setSelectedLayerId('pip'); }} />
        <Action label="Editar texto" disabled={!project || busy} onPress={() => { closePanel(); setSelectedLayerId('title'); }} />
        <Action label="Ir a 0,5s" disabled={!project || busy} onPress={() => preview.current?.seek(0.5)} /><Action label="Ir a 2s" disabled={!project || busy} onPress={() => preview.current?.seek(2)} />
      </ScrollView>}
    </View>
  </AppScreen>;
}
function Action({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, disabled && { opacity: 0.4 }, pressed && { opacity: 0.65 }]}><Text style={s.buttonLabel}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({ body: { flex: 1, backgroundColor: '#0D1117' }, status: { color: colors.muted, fontSize: 11, paddingHorizontal: 14, paddingVertical: 7 }, canvas: { flex: 1, minHeight: 160, maxHeight: 300, margin: 12, backgroundColor: '#000', justifyContent: 'center', aspectRatio: 16 / 9 }, controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 8 }, time: { flex: 1, color: colors.textSecondary, fontSize: 11, textAlign: 'center', fontVariant: ['tabular-nums'] }, toolbar: { gap: 8, padding: 12 }, button: { backgroundColor: '#28323E', minHeight: 36, borderRadius: 6, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' }, buttonLabel: { color: colors.text, fontSize: 11, fontWeight: '500' } });
