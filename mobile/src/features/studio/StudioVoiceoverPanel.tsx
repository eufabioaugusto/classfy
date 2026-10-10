import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { ArrowLeft, Check, FileText, Mic, Square, Trash2 } from 'lucide-react-native';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';
import { compileStudioRecipe, formatStudioEditorTime, studioSeconds, type StudioProject } from './model';
import { persistStudioVoiceover, type StudioVoiceoverPersistScope } from './media';
import { prepareStudioVoiceoverRecording, StudioVoiceoverReadError, type StudioVoiceoverAudio, type StudioVoiceoverRecording } from './voiceoverRecording';

type Props = {
  project: StudioProject; positionSeconds: number; disabled?: boolean; canCommit?: () => boolean;
  onClose: () => void; onSaved: (itemId: string) => void; onActivityChange?: (active: boolean) => void;
  onRecordingChange?: (recording: boolean, position: number) => void;
  onBeforePersist?: StudioVoiceoverPersistScope['onBeforePersist'];
  onPersisted?: StudioVoiceoverPersistScope['onPersisted'];
  onPersistError?: StudioVoiceoverPersistScope['onPersistError'];
};
type Phase = 'idle' | 'preparing' | 'countdown' | 'recording' | 'stopping' | 'recovering' | 'ready' | 'saving';
export function StudioVoiceoverPanel({ project, positionSeconds, disabled = false, canCommit, onClose, onSaved, onActivityChange, onRecordingChange, onBeforePersist, onPersisted, onPersistError }: Props) {
  const { user } = useAuth();
  const focused = useIsFocused();
  const [phase, setPhase] = useState<Phase>('idle'), [countdown, setCountdown] = useState(3), [duration, setDuration] = useState(0), [metering, setMetering] = useState<number>();
  const [error, setError] = useState<string>(), [scriptVisible, setScriptVisible] = useState(false);
  const current = useRef({ owner: user?.id, project, positionSeconds, disabled, focused, canCommit, onClose, onSaved, onActivityChange, onRecordingChange, onBeforePersist, onPersisted, onPersistError });
  const epoch = useRef(0), operation = useRef(0), mounted = useRef(true), foreground = useRef(AppState.currentState === 'active'), appState = useRef(AppState.currentState);
  if (current.current.owner !== user?.id || current.current.project.id !== project.id || current.current.focused !== focused || current.current.disabled !== disabled) epoch.current++;
  current.current = { owner: user?.id, project, positionSeconds, disabled, focused, canCommit, onClose, onSaved, onActivityChange, onRecordingChange, onBeforePersist, onPersisted, onPersistError };
  const session = useRef<StudioVoiceoverRecording | undefined>(undefined), preparing = useRef<Promise<StudioVoiceoverRecording> | undefined>(undefined);
  const recording = useRef<StudioVoiceoverAudio | undefined>(undefined), savingTask = useRef<Promise<unknown> | undefined>(undefined), timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const interruptionNotice = useRef<string | undefined>(undefined);
  const writing = useRef(false), closing = useRef(false), phaseRef = useRef<Phase>(phase), recordLimit = useRef(0), recordAt = useRef(positionSeconds), savedItem = useRef<string | undefined>(undefined);
  phaseRef.current = phase;
  const clearTimer = () => { if (timer.current !== undefined) clearInterval(timer.current); timer.current = undefined; };
  const canAct = () => mounted.current && (foreground.current || appState.current === 'inactive' && phaseRef.current === 'preparing') && current.current.focused && !current.current.disabled
    && current.current.owner === current.current.project.ownerId && (current.current.canCommit?.() ?? true);
  const scopeFor = (token: number, generation: number) => () => canAct() && operation.current === token && epoch.current === generation;
  const cleanup = async () => {
    clearTimer(); operation.current++;
    if (preparing.current) await preparing.current.catch(() => undefined);
    if (savingTask.current) await savingTask.current.catch(() => undefined);
    await session.current?.cancel(); session.current = undefined; recording.current = undefined; savedItem.current = undefined;
  };
  const cancel = async (leave: boolean) => {
    if (closing.current) return;
    closing.current = true; clearTimer(); if (mounted.current) setPhase('stopping');
    try {
      await cleanup();
      interruptionNotice.current = undefined;
      if (mounted.current) { setPhase('idle'); setDuration(0); setMetering(undefined); setError(undefined); }
      if (leave && mounted.current) current.current.onClose();
    } catch (cause) { if (mounted.current) { setPhase('idle'); setError(cause instanceof Error ? cause.message : 'Não foi possível encerrar a gravação. Tente novamente.'); } }
    finally { closing.current = false; writing.current = false; }
  };
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      appState.current = state;
      foreground.current = state === 'active';
      // The microphone permission dialog can make iOS briefly inactive. It has
      // not started recording; actual background and active recording cancel.
      if (state === 'background' || state === 'inactive' && phaseRef.current !== 'preparing') { epoch.current++; void cancel(false); }
    });
    return () => { mounted.current = false; epoch.current++; subscription.remove(); void cleanup().catch(() => undefined); current.current.onActivityChange?.(false); current.current.onRecordingChange?.(false, recordAt.current); };
  }, []);
  useEffect(() => {
    if (phaseRef.current !== 'idle' && (!focused || disabled || user?.id !== project.ownerId || canCommit && !canCommit())) void cancel(false);
  });
  useEffect(() => { onActivityChange?.(phase !== 'idle'); }, [phase, onActivityChange]);
  useEffect(() => { current.current.onRecordingChange?.(phase === 'recording', recordAt.current); }, [phase]);
  const stop = async () => {
    if (!canAct() || writing.current || !session.current || !['recording', 'recovering'].includes(phaseRef.current)) return;
    writing.current = true; clearTimer(); setPhase('stopping'); phaseRef.current = 'stopping';
    const token = operation.current, generation = epoch.current, isCurrent = scopeFor(token, generation);
    try {
      const audio = await session.current.finish();
      if (!isCurrent()) return;
      recording.current = audio; setDuration(Math.min(audio.duration, recordLimit.current)); setError(interruptionNotice.current); setPhase('ready'); phaseRef.current = 'ready';
    } catch (cause) {
      if (isCurrent()) { const next = cause instanceof StudioVoiceoverReadError ? 'recovering' : 'idle'; setError(cause instanceof Error ? cause.message : 'Não foi possível gravar. Tente novamente.'); setPhase(next); phaseRef.current = next; }
    } finally { writing.current = false; }
  };
  const begin = async () => {
    if (!canAct() || writing.current || closing.current || phaseRef.current !== 'idle') return;
    const remaining = studioSeconds(compileStudioRecipe(current.current.project).durationTicks) - current.current.positionSeconds;
    if (!Number.isFinite(remaining) || remaining < .1) { setError('Posicione o cursor antes do fim do vídeo.'); return; }
    recordLimit.current = remaining; recordAt.current = current.current.positionSeconds; savedItem.current = undefined; interruptionNotice.current = undefined; writing.current = true; setError(undefined); setPhase('preparing'); phaseRef.current = 'preparing';
    const token = ++operation.current, generation = epoch.current, isCurrent = scopeFor(token, generation);
    try {
      // A previous failed validation can still own a temporary original. A
      // deliberate new recording releases it before replacing the session.
      if (session.current) { await session.current.cancel(); session.current = undefined; recording.current = undefined; }
      if (!isCurrent()) return;
      const pending = prepareStudioVoiceoverRecording({ isCurrent, onStatus: status => {
        if (!isCurrent()) return;
        setDuration(Math.min(status.duration, recordLimit.current)); setMetering(status.metering);
        if (status.interrupted && phaseRef.current === 'recording') {
          interruptionNotice.current = 'O microfone foi interrompido. Confira o trecho gravado antes de usar.';
          setError(interruptionNotice.current);
          void stop(); return;
        }
        if (status.recording && status.duration >= recordLimit.current) void stop();
      } });
      preparing.current = pending;
      const prepared = await pending; session.current = prepared;
      if (!isCurrent()) { await prepared.cancel(); return; }
      let seconds = 3; setCountdown(seconds); setDuration(0); setPhase('countdown'); phaseRef.current = 'countdown';
      timer.current = setInterval(() => {
        if (!isCurrent()) { clearTimer(); void cancel(false); return; }
        seconds--; setCountdown(seconds);
        if (seconds > 0) return;
        clearTimer();
        void prepared.start().then(() => {
          if (isCurrent()) { writing.current = false; setPhase('recording'); phaseRef.current = 'recording'; }
        }).catch(cause => { if (isCurrent()) { writing.current = false; setError(cause instanceof Error ? cause.message : 'Não foi possível começar a gravação.'); setPhase('idle'); phaseRef.current = 'idle'; } });
      }, 1000);
    } catch (cause) { if (isCurrent()) { writing.current = false; setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o microfone.'); setPhase('idle'); phaseRef.current = 'idle'; } }
    finally { preparing.current = undefined; }
  };
  const save = async () => {
    if (!canAct() || writing.current || phaseRef.current !== 'ready' || !recording.current) return;
    interruptionNotice.current = undefined; writing.current = true; setPhase('saving'); phaseRef.current = 'saving'; setError(undefined);
    const token = operation.current, generation = epoch.current, isCurrent = scopeFor(token, generation), ownerProject = current.current.project;
    try {
      if (!savedItem.current) {
        const task = persistStudioVoiceover(ownerProject, recording.current, recordAt.current, { isCurrent,
          onBeforePersist: current.current.onBeforePersist, onPersisted: current.current.onPersisted, onPersistError: current.current.onPersistError });
        savingTask.current = task;
        const saved = await task; savedItem.current = saved.itemId;
      }
      if (!isCurrent()) return;
      await session.current?.cancel(); session.current = undefined; recording.current = undefined;
      if (isCurrent() && savedItem.current) current.current.onSaved(savedItem.current);
    } catch (cause) { if (isCurrent()) { setPhase('ready'); phaseRef.current = 'ready'; setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a narração. Tente novamente.'); } }
    finally { savingTask.current = undefined; writing.current = false; }
  };
  const waiting = ['preparing', 'stopping', 'saving'].includes(phase);
  const level = Number.isFinite(metering) ? Math.max(0, Math.min(1, ((metering ?? -60) + 60) / 60)) : 0;
  return <View style={s.panel}>
    <View style={s.header}><Pressable accessibilityRole="button" accessibilityLabel="Fechar narração" disabled={closing.current || phase === 'saving'} onPress={() => { void cancel(true); }} style={s.icon}><ArrowLeft size={20} color={colors.text} strokeWidth={1.6} /></Pressable><Text style={s.title}>Narração</Text>
      {!!project.script.trim() && <Pressable accessibilityRole="button" accessibilityLabel={scriptVisible ? 'Ocultar roteiro' : 'Mostrar roteiro'} onPress={() => setScriptVisible(value => !value)} style={s.icon}><FileText size={18} color={scriptVisible ? colors.text : colors.muted} /></Pressable>}
      <Text style={s.position}>em {formatStudioEditorTime(phase === 'idle' ? positionSeconds : recordAt.current)}</Text>
    </View>
    {scriptVisible && <ScrollView style={s.script} showsVerticalScrollIndicator={false}><Text style={s.scriptText}>{project.script}</Text></ScrollView>}
    <View style={s.body}>
      <View style={s.time}><Text accessibilityLiveRegion="polite" style={s.timer}>{phase === 'countdown' ? countdown : formatStudioEditorTime(duration)}</Text><Text style={s.caption}>{phase === 'countdown' ? 'Prepare-se' : phase === 'recording' ? 'Gravando' : phase === 'ready' ? 'Narração pronta' : phase === 'saving' ? 'Salvando áudio…' : phase === 'preparing' ? 'Preparando microfone…' : phase === 'stopping' ? 'Encerrando microfone…' : 'Grave sua voz sobre o vídeo'}</Text></View>
      {waiting ? <ActivityIndicator accessibilityLabel="Aguarde a narração" color={colors.accent} /> : phase === 'recovering' ? <View style={s.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Descartar narração" disabled={disabled} onPress={() => { void cancel(false); }} style={s.icon}><Trash2 size={20} color={colors.muted} strokeWidth={1.6} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Recuperar narração" disabled={disabled} onPress={() => { void stop(); }} style={s.use}><Check size={19} color={colors.text} /><Text style={s.useLabel}>Recuperar</Text></Pressable>
      </View> : phase === 'ready' && savedItem.current ? <Pressable accessibilityRole="button" accessibilityLabel="Concluir narração" disabled={disabled} onPress={() => { void save(); }} style={s.use}><Check size={19} color={colors.text} /><Text style={s.useLabel}>Concluir</Text></Pressable> : phase === 'ready' ? <View style={s.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Descartar narração" disabled={disabled} onPress={() => { void cancel(false); }} style={s.icon}><Trash2 size={20} color={colors.muted} strokeWidth={1.6} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Usar narração" disabled={disabled} onPress={() => { void save(); }} style={s.use}><Check size={19} color={colors.text} /><Text style={s.useLabel}>Usar narração</Text></Pressable>
      </View> : <Pressable accessibilityRole="button" accessibilityLabel={phase === 'recording' ? 'Parar narração' : phase === 'countdown' ? 'Cancelar contagem' : 'Gravar narração'} disabled={disabled} onPress={() => { if (phase === 'recording') void stop(); else if (phase === 'countdown') void cancel(false); else void begin(); }} style={({ pressed }) => [s.record, pressed && { opacity: .7 }, disabled && { opacity: .4 }]}>{phase === 'recording' || phase === 'countdown' ? <Square size={19} fill={colors.text} color={colors.text} /> : <Mic size={23} color={colors.text} strokeWidth={1.7} />}</Pressable>}
    </View>
    {phase === 'recording' ? <View accessibilityLabel="Nível do microfone" style={s.level}><View style={[s.levelValue, { width: `${Math.round(level * 100)}%` }]} /></View> : null}
    {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
}
const s = StyleSheet.create({
  panel: { backgroundColor: colors.backgroundElevated, borderTopWidth: 1, borderColor: colors.borderSubtle, paddingHorizontal: 10, paddingBottom: 8 },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '500' }, position: { color: colors.mutedDim, fontSize: 10, fontVariant: ['tabular-nums'], paddingRight: 10 },
  body: { minHeight: 82, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, time: { flex: 1, gap: 5 },
  timer: { fontSize: 27, color: colors.text, fontWeight: '500', fontVariant: ['tabular-nums'] }, caption: { color: colors.muted, fontSize: 11 },
  record: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 }, use: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: colors.accent }, useLabel: { color: colors.text, fontSize: 11, fontWeight: '500' },
  level: { height: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginHorizontal: 15, marginBottom: 8, borderRadius: 2 }, levelValue: { height: '100%', backgroundColor: colors.accent },
  script: { maxHeight: 70, marginHorizontal: 15, paddingVertical: 5 }, scriptText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 }, error: { color: colors.accent, fontSize: 11, lineHeight: 16, marginHorizontal: 15, paddingVertical: 6 },
});
