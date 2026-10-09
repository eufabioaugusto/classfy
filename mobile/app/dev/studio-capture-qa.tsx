import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Camera } from 'expo-camera';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import * as ScreenOrientation from 'expo-screen-orientation';
import { randomUUID } from 'expo-crypto';
import { StudioNativeCamera, type StudioNativeCameraHandle, type StudioNativeRecordingState } from '@/features/studio/StudioNativeCamera';
import { useStudioOrientation } from '@/features/studio/useStudioOrientation';
import { compileStudioRecipe, emptyStudioEditing, normalizeStudioCaptureGrade, reconcileStudioTakes, studioGrade, validateStudioRecipe,
  type StudioGrade, type StudioTake } from '@/features/studio/model';
import { configureStudioNativeCameraAsync, getMediaInfoAsync, getStudioNativeCameraCapabilitiesAsync,
  isStudioNativeCameraAvailable, isStudioNativeCameraEffectsAvailable,
  type StudioCameraQuality, type StudioCameraState } from '../../modules/classfy-studio-media';

type RecordingProbe = {
  handle: StudioNativeCameraHandle; operationId?: string; startedMs?: number; stoppedMs?: number;
  stopTimer?: ReturnType<typeof setTimeout>; events: StudioNativeRecordingState[];
};
type DiagnosticRun = {
  id: string; startedAt: string; startedMs: number; requestedLabel: string | null;
  cancelled: boolean; cancellation?: string; listeners: Set<() => void>;
  recording?: RecordingProbe; report: Record<string, unknown>;
};
let latestRunId: string | undefined;
let reportQueue: Promise<void> = Promise.resolve();
const reportURI = () => `${FileSystem.cacheDirectory}classfy-studio-capture-qa-result.json`;
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
function assertRun(run: DiagnosticRun) {
  if (run.cancelled || latestRunId !== run.id) throw new Error(run.cancellation || 'O diagnóstico anterior foi encerrado.');
}
function stopProbe(probe?: RecordingProbe) {
  if (!probe) return;
  if (probe.stopTimer) clearTimeout(probe.stopTimer);
  probe.stopTimer = undefined;
  probe.stoppedMs ??= Date.now();
  // The wrapper retains the original operation/tag; never resolve a later ref.
  probe.handle.stopRecording();
}
function cancelRun(run: DiagnosticRun, reason: string) {
  if (run.cancelled) return;
  run.cancelled = true; run.cancellation = reason; stopProbe(run.recording);
  for (const cancel of [...run.listeners]) cancel();
}
function bounded<T>(run: DiagnosticRun, promise: Promise<T>, stage: string, timeoutMs = 8000): Promise<T> {
  assertRun(run);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (cause?: unknown, value?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); run.listeners.delete(cancel);
      if (cause !== undefined) reject(cause); else resolve(value as T);
    };
    const cancel = () => finish(new Error(run.cancellation || 'Diagnóstico cancelado.'));
    const timer = setTimeout(() => {
      const reason = `Tempo limite em ${stage}. A câmera do diagnóstico foi encerrada.`;
      cancelRun(run, reason); finish(new Error(reason));
    }, timeoutMs);
    run.listeners.add(cancel);
    promise.then(value => {
      if (run.cancelled || latestRunId !== run.id) cancel(); else finish(undefined, value);
    }, cause => finish(cause));
  });
}
function writeReport(run: DiagnosticRun, patch: Record<string, unknown>) {
  run.report = { ...run.report, ...patch, reportedAt: new Date().toISOString(), elapsedMs: Date.now() - run.startedMs };
  const snapshot = JSON.stringify(run.report);
  reportQueue = reportQueue.catch(() => undefined).then(async () => {
    if (latestRunId !== run.id || !FileSystem.cacheDirectory) return;
    await FileSystem.writeAsStringAsync(reportURI(), snapshot);
  });
  return reportQueue;
}
function supported(state: StudioCameraState, quality: StudioCameraQuality) {
  return state.qualities.some(value => value.quality === quality && value.fps.includes(30));
}
function sameGrade(left: StudioGrade | undefined, right: StudioGrade | undefined) {
  if (!left || !right) return left === right;
  return (Object.keys(right) as (keyof StudioGrade)[]).every(key => left[key] === right[key]);
}

/** Explicit development diagnostic: no auth, product drafts, journal or publication. */
export default function StudioCaptureQA() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevelopmentCaptureQA />;
}
function DevelopmentCaptureQA() {
  const params = useLocalSearchParams<{ run?: string; build?: string }>();
  const requestedRun = (Array.isArray(params.run) ? params.run[0] : params.run) === '1';
  const focused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [permission, setPermission] = useState<'checking' | 'granted' | 'blocked'>('checking');
  const [cameraReady, setCameraReady] = useState(false);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState(requestedRun ? 'Preparando diagnóstico local da câmera…' : 'Diagnóstico inativo. Use ?run=1 para autorizar os takes curtos de teste.');
  const nativeAvailable = Platform.OS === 'ios' && Device.isDevice && isStudioNativeCameraAvailable();
  const allowed = requestedRun && nativeAvailable && permission === 'granted' && focused && foreground && !finished;
  const { orientationReady, orientationError } = useStudioOrientation('aula', allowed);
  const camera = useRef<StudioNativeCameraHandle>(null);
  const mounted = useRef(true), started = useRef(false);
  const live = useRef({ focused, foreground, requestedRun }); live.current = { focused, foreground, requestedRun };
  const [run] = useState<DiagnosticRun>(() => {
    const build = Array.isArray(params.build) ? params.build[0] : params.build;
    const startedMs = Date.now(), id = randomUUID(), startedAt = new Date(startedMs).toISOString();
    return { id, startedMs, startedAt, requestedLabel: build?.slice(0, 80) || null, cancelled: false, listeners: new Set(),
      report: { reportSchema: 'classfy-studio-capture-qa', reportVersion: 1, runId: id, startedAt,
        environment: { platform: Platform.OS, osVersion: Device.osVersion ?? String(Platform.Version), physicalDevice: Device.isDevice,
          model: Device.modelName ?? null, development: __DEV__ },
        build: { nativeBuildNumber: Constants.platform?.ios?.buildNumber ?? null, configuredVersion: Constants.expoConfig?.version ?? null,
          configuredBundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? null, requestedLabel: build?.slice(0, 80) || null },
        limits: ['FPS do arquivo é nominal; este teste curto não mede estabilidade térmica de aulas longas.',
          'Cinematic é tratamento reversível de cor. Captura Cinematic com profundidade permanece desativada.',
          'O relatório confirma original separado da receita; não compara pixels de cenas diferentes.',
          'O teste não avalia por imagem o recorte adicional da estabilização do arquivo original.'] } };
  });
  const announce = (text: string) => { if (mounted.current) setMessage(text); };
  const assertLive = () => {
    assertRun(run);
    if (!mounted.current || !live.current.focused || !live.current.foreground || !live.current.requestedRun) {
      cancelRun(run, 'O diagnóstico perdeu o foco ou o aplicativo foi para segundo plano.'); assertRun(run);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', value => {
      setForeground(value === 'active');
      if (value !== 'active' && started.current) cancelRun(run, 'O aplicativo saiu do primeiro plano.');
    });
    return () => { mounted.current = false; listener.remove(); if (started.current) cancelRun(run, 'A rota do diagnóstico foi fechada.'); };
  }, [run]);
  useEffect(() => {
    if (!focused && started.current) cancelRun(run, 'A rota do diagnóstico perdeu o foco.');
  }, [focused, run]);
  useEffect(() => {
    if (!requestedRun) return;
    let active = true; latestRunId = run.id;
    const prepare = async () => {
      await writeReport(run, { passed: false, status: 'preparing', stage: 'permissions' });
      if (!nativeAvailable) throw new Error('Este diagnóstico exige iPhone físico e o binário atual da câmera nativa.');
      if (!FileSystem.cacheDirectory) throw new Error('Cache local indisponível.');
      // Permission reads only: a remote diagnostic must never authorize itself.
      const [video, audio] = await Promise.all([Camera.getCameraPermissionsAsync(), Camera.getMicrophonePermissionsAsync()]);
      if (!video.granted || !audio.granted) throw new Error('Autorize câmera e microfone no Studio antes de executar o diagnóstico.');
      if (active && mounted.current) setPermission('granted');
    };
    void prepare().catch(async cause => {
      if (!active) return;
      await writeReport(run, { passed: false, status: 'blocked', stage: 'permissions', error: errorMessage(cause) });
      if (mounted.current) { setPermission('blocked'); announce(errorMessage(cause)); }
    });
    return () => { active = false; };
  }, [requestedRun, nativeAvailable, run]);
  useEffect(() => {
    if (!orientationError || !requestedRun) return;
    void writeReport(run, { passed: false, status: 'blocked', stage: 'orientation', error: orientationError });
    announce(orientationError); setFinished(true);
  }, [orientationError, requestedRun, run]);
  useEffect(() => {
    if (!allowed || !orientationReady || cameraReady || started.current) return;
    const timer = setTimeout(() => {
      const reason = 'A câmera não confirmou a montagem em 12 segundos.';
      cancelRun(run, reason); announce(reason); setFinished(true);
      void writeReport(run, { passed: false, status: 'failed', stage: 'camera-ready', error: reason });
    }, 12000);
    return () => clearTimeout(timer);
  }, [allowed, orientationReady, cameraReady, run]);

  const handleRecordingState = (event: StudioNativeRecordingState) => {
    const probe = run.recording;
    if (!probe || probe.operationId && probe.operationId !== event.operationId) return;
    probe.operationId ??= event.operationId;
    probe.events.push(event);
    if (event.phase === 'recording' && probe.startedMs === undefined) {
      probe.startedMs = Date.now();
      if (run.cancelled) stopProbe(probe);
      else probe.stopTimer = setTimeout(() => {
        if (run.recording === probe) stopProbe(probe);
      }, 1000);
    }
    if (event.phase === 'finished' && probe.stopTimer) { clearTimeout(probe.stopTimer); probe.stopTimer = undefined; }
  };
  const execute = async (handle: StudioNativeCameraHandle) => {
    const capabilities: Partial<Record<'front' | 'back', StudioCameraState>> = {};
    const cases: Record<string, unknown>[] = [];
    const interruptions: Record<string, unknown>[] = [];
    // Kept in the report so interruptions emitted after a report write still
    // appear in the final snapshot, without recording user/account data.
    run.report = { ...run.report, capabilities, cases, interruptions };
    const folder = `${FileSystem.cacheDirectory}classfy-studio-capture-qa-${run.id}/`;
    try {
      assertLive();
      await bounded(run, FileSystem.makeDirectoryAsync(folder, { intermediates: true }), 'cache');
      const tag = handle.getNativeTag(); if (!tag) throw new Error('A câmera nativa ainda não possui uma view ativa.');
      const orientation = await bounded(run, ScreenOrientation.getOrientationAsync(), 'orientação');
      const captureOrientation = orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ? 'landscapeLeft' : 'landscapeRight';
      for (const position of ['front', 'back'] as const) {
        assertLive(); announce(`Consultando câmera ${position === 'front' ? 'frontal' : 'traseira'}…`);
        const initial = await bounded(run, configureStudioNativeCameraAsync(tag, { position, quality: '1080p', fps: 30,
          orientation: captureOrientation, cinematic: false, mirrored: false }), `preparar ${position}`);
        assertLive();
        const state = await bounded(run, getStudioNativeCameraCapabilitiesAsync(tag), `capacidades ${position}`);
        capabilities[position] = state;
        await writeReport(run, { status: 'running', stage: `capabilities-${position}` });
        if (state.position !== position || initial.position !== position) throw new Error(`A câmera ${position} não confirmou a lente solicitada.`);
        for (const testCase of [
          { name: 'natural-1080p30', quality: '1080p' as const, grade: studioGrade('natural') },
          { name: 'cinematic-4k30', quality: '2160p' as const, grade: { ...studioGrade('cinematic'), intensity: 0.5 } },
        ]) {
          assertLive();
          const label = `${position}-${testCase.name}`;
          if (!supported(state, testCase.quality) || !isStudioNativeCameraEffectsAvailable()) {
            cases.push({ name: label, status: 'skipped', reason: !supported(state, testCase.quality)
              ? `${testCase.quality}/30 não foi ofertado pela sessão.` : 'O binário não oferece confirmação da prévia processada.' });
            await writeReport(run, { stage: label }); continue;
          }
          announce(`Testando ${label} · take de 1 segundo…`);
          const configuration = await bounded(run, configureStudioNativeCameraAsync(tag, { position, quality: testCase.quality, fps: 30,
            orientation: captureOrientation, cinematic: false, mirrored: false }), `formato ${label}`);
          assertLive();
          const ack = await bounded(run, handle.setEffectAsync(testCase.grade), `prévia ${label}`);
          assertLive();
          if (configuration.generation !== ack.generation || !Number.isInteger(ack.effectRevision) || ack.effectRevision < 1
            || !sameGrade(ack.grade, testCase.grade)) throw new Error(`A prévia de ${label} confirmou revisão ou geração divergente.`);
          if (!ack.previewProcessed) {
            cases.push({ name: label, status: 'skipped', reason: 'A GPU não confirmou a prévia neste formato.', configuration, ack });
            await writeReport(run, { stage: label }); continue;
          }
          const interruptionStart = interruptions.length;
          const probe: RecordingProbe = { handle, events: [] }; run.recording = probe;
          let recording;
          try { recording = await bounded(run, handle.recordAsync(), `gravação ${label}`, 15000); }
          finally { if (probe.stopTimer) clearTimeout(probe.stopTimer); if (run.recording === probe) run.recording = undefined; }
          assertLive();
          if (!probe.startedMs || !probe.stoppedMs) throw new Error(`${label} não confirmou início e parada da gravação.`);
          const originalInfo = await bounded(run, getMediaInfoAsync(recording.uri), `metadados ${label}`);
          assertLive();
          const uri = `${folder}${label}.mov`;
          await bounded(run, FileSystem.copyAsync({ from: recording.uri, to: uri }), `cópia ${label}`);
          assertLive();
          const info = await bounded(run, getMediaInfoAsync(uri), `arquivo copiado ${label}`);
          const take: StudioTake = { id: label, name: label, uri, duration: info.duration, start: 0, end: info.duration,
            width: info.width, height: info.height, frameRate: info.frameRate, sourceKind: recording.sourceKind,
            sourceStage: recording.sourceStage, grade: recording.grade ? { ...recording.grade } : undefined };
          const editing = reconcileStudioTakes({ kind: 'aula', editing: emptyStudioEditing('aula') }, [take]);
          const recipe = compileStudioRecipe({ kind: 'aula', takes: [take], editing });
          const expectedGrade = normalizeStudioCaptureGrade(testCase.grade);
          const width = testCase.quality === '2160p' ? 3840 : 1920;
          const caseInterruptions = interruptions.slice(interruptionStart).filter(value => value.generation === undefined || value.generation === ack.generation);
          const checks = {
            configured: configuration.position === position && configuration.quality === testCase.quality && configuration.fps === 30,
            gpu: ack.previewProcessed && ack.generation === configuration.generation,
            previewStable: !caseInterruptions.some(value => value.reason === 'previewFallback'),
            // The native promise carries the final file. Event and promise
            // delivery are separate queues, so a late finished event is not
            // required to falsely reject an otherwise settled operation.
            operation: recording.operationId === probe.operationId && probe.events.some(event => event.phase === 'recording' && event.operationId === recording.operationId),
            duration: info.duration >= 0.5 && info.duration <= 3,
            size: info.width === width && info.height === width * 9 / 16,
            nominalFPS: typeof info.frameRate === 'number' && Math.abs(info.frameRate - 30) <= 0.5,
            audio: info.hasAudio && info.hasVideo, file: info.fileSize > 0,
            copy: info.fileSize === originalInfo.fileSize && info.width === originalInfo.width && info.height === originalInfo.height,
            raw: recording.sourceKind === 'standard' && recording.sourceStage === 'standard' && recipe.assets[0]?.uri === uri
              && !Object.hasOwn(recipe.assets[0] || {}, 'grade'),
            grade: sameGrade(recording.grade, expectedGrade) && sameGrade(recipe.clips[0]?.grade, expectedGrade),
            recipe: validateStudioRecipe(recipe).length === 0,
          };
          cases.push({ name: label, status: Object.values(checks).every(Boolean) ? 'passed' : 'failed', checks, configuration, ack,
            result: { ...recording, uri }, metadata: info, recipe, events: probe.events, interruptions: caseInterruptions,
            recordingStartedAt: new Date(probe.startedMs).toISOString(), stopIntentAt: new Date(probe.stoppedMs).toISOString(),
            intendedRecordingMs: probe.stoppedMs - probe.startedMs });
          await writeReport(run, { stage: label });
        }
      }
      assertLive();
      const naturalPassed = ['front-natural-1080p30', 'back-natural-1080p30'].every(name => cases.some(value => value.name === name && value.status === 'passed'));
      const passed = naturalPassed && !cases.some(value => value.status === 'failed');
      await writeReport(run, { passed, status: passed ? 'passed' : 'failed', stage: 'complete', fullyVerified: passed && cases.every(value => value.status === 'passed'),
        completedAt: new Date().toISOString(), cacheDirectory: folder });
      assertLive();
      announce(passed ? 'Diagnóstico concluído. Capacidades, prévia, originais e receitas estão no JSON do cache.' : 'Diagnóstico concluído com divergências. Consulte o JSON do cache.');
    } catch (cause) {
      stopProbe(run.recording);
      await writeReport(run, { passed: false, status: run.cancelled ? 'cancelled' : 'failed', error: errorMessage(cause), cacheDirectory: folder });
      announce(errorMessage(cause));
    } finally { if (mounted.current) setFinished(true); }
  };
  useEffect(() => {
    if (!allowed || !orientationReady || !cameraReady || started.current) return;
    // StrictMode's setup/cleanup/setup cannot launch a second hardware run.
    const timer = setTimeout(() => {
      const handle = camera.current;
      if (!handle || started.current || run.cancelled) return;
      started.current = true; void execute(handle);
    }, 0);
    return () => clearTimeout(timer);
  }, [allowed, orientationReady, cameraReady, run]);
  const previewWidth = Math.min(width, height * 16 / 9);
  return <View style={s.root}>
    {allowed && orientationReady && <StudioNativeCamera ref={camera} active={allowed} style={{ width: previewWidth, height: previewWidth * 9 / 16 }}
      onCameraReady={() => setCameraReady(true)} onRecordingState={handleRecordingState}
      onMountError={event => {
        cancelRun(run, event.message); announce(event.message);
        void writeReport(run, { passed: false, status: 'failed', stage: 'camera', error: event.message }); setFinished(true);
      }} onInterruption={event => {
        const events = run.report.interruptions;
        if (Array.isArray(events)) events.push({ ...event, at: new Date().toISOString() });
        if (event.reason !== 'previewFallback') cancelRun(run, event.message || 'A sessão de câmera foi interrompida.');
      }} />}
    <View pointerEvents="none" style={s.status}><Text style={s.title}>QA local · câmera do Studio</Text><Text style={s.message}>{message}</Text></View>
  </View>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  status: { position: 'absolute', left: 24, right: 24, bottom: 20, padding: 12, backgroundColor: '#000000CC', borderRadius: 8 },
  title: { color: '#FFF', fontSize: 13, fontWeight: '600', marginBottom: 4 }, message: { color: '#BBB', fontSize: 12 } });
