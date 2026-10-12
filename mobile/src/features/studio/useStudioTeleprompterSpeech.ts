import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  isStudioNativeCameraSpeechAvailable, requestStudioCaptureSpeechPermissionAsync,
  type StudioCaptureSpeechEvent,
} from '../../../modules/classfy-studio-media';
import { createStudioTeleprompterMatcher } from './StudioTeleprompterTracking';

type Options = {
  ownerId?: string; projectId?: string; script: string; active: boolean;
  isFocused: boolean; foreground: boolean; resetKey: string | number; generation?: number;
};
type Permission = 'undetermined' | 'requesting' | 'granted' | 'denied';
type Status = 'paused' | 'connecting' | 'listening' | 'unavailable' | 'denied' | 'error';
let sessionSerial = 0;
const nextSession = () => `studio-reader-${++sessionSerial}`;
const sameIdentity = (a: Options, b: Options) => a.ownerId === b.ownerId && a.projectId === b.projectId && a.script === b.script && a.resetKey === b.resetKey;
function speechMessage(status: Status, code?: string) {
  if (status === 'denied') return 'Permita o reconhecimento de voz nos Ajustes para acompanhar sua leitura.';
  if (status === 'paused' && code === 'awaiting_speech') return 'Aguardando sua voz.';
  if (status === 'unavailable') {
    if (code === 'on_device_unavailable' || code === 'speech_locale_unavailable') return 'O reconhecimento em português não está disponível neste aparelho. Escolha a rolagem automática.';
    if (code === 'capture_audio_unavailable') return 'O áudio da câmera não está disponível para acompanhar sua voz. Confira o microfone ou escolha a rolagem automática.';
    return 'A voz não está disponível nesta versão do app. Atualize o Classfy ou escolha a rolagem automática.';
  }
  if (status === 'error') return 'A leitura por voz foi interrompida. Pause e ative novamente para continuar, ou escolha a rolagem automática.';
  return '';
}

/** Receives the camera's existing audio samples; never opens or changes its microphone. */
export function useStudioTeleprompterSpeech(options: Options) {
  const available = isStudioNativeCameraSpeechAvailable();
  const [permission, setPermission] = useState<Permission>('undetermined');
  const [readWordCount, setReadWordCount] = useState(0);
  const [status, setStatus] = useState<Status>(available ? 'paused' : 'unavailable');
  const [message, setMessage] = useState(available ? '' : speechMessage('unavailable'));
  const [, refresh] = useState(0);
  const mounted = useRef(true), current = useRef(options), backgroundEpoch = useRef(0), permissionEpoch = useRef(0);
  const matcher = useRef<ReturnType<typeof createStudioTeleprompterMatcher>>(null!);
  if (!matcher.current) matcher.current = createStudioTeleprompterMatcher(options.script);
  const fault = useRef(false), request = useRef<{ identity: Options; epoch: number; scopeEpoch: number; promise: Promise<boolean> } | null>(null);
  const stream = useRef<{ id: string; enabled: boolean; generation?: number; sequence: number }>(null!);
  if (!stream.current) stream.current = { id: nextSession(), enabled: false, generation: undefined, sequence: -1 };
  const changed = !sameIdentity(current.current, options);
  const resuming = options.active && !current.current.active;
  if (changed || options.isFocused !== current.current.isFocused) permissionEpoch.current++;
  if (changed) {
    matcher.current = createStudioTeleprompterMatcher(options.script);
    fault.current = false;
    stream.current = { id: nextSession(), enabled: false, generation: undefined, sequence: -1 };
  }
  if (resuming) fault.current = false;
  current.current = options;
  const speechEnabled = available && permission === 'granted' && !!options.ownerId && !!options.projectId
    && options.isFocused && options.foreground && AppState.currentState === 'active' && options.active && !!matcher.current.tokens.length && !fault.current;
  // Synchronous invalidation prevents a queued event from the previous camera,
  // pause, owner or take advancing the new render before passive effects run.
  if (speechEnabled !== stream.current.enabled || options.generation !== undefined && options.generation !== stream.current.generation) {
    stream.current = { id: nextSession(), enabled: speechEnabled, generation: options.generation, sequence: -1 };
  }
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', value => {
      // iOS becomes inactive for the permission sheet; that is not a user
      // leaving the app, and a granted result must survive that transition.
      if (value === 'background') backgroundEpoch.current++;
      if (value !== 'active') stream.current.enabled = false;
      refresh(value => value + 1);
    });
    return () => { mounted.current = false; backgroundEpoch.current++; stream.current.enabled = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    setReadWordCount(matcher.current.reset().readWordCount);
    setStatus(available ? 'paused' : 'unavailable');
    setMessage(available ? '' : speechMessage('unavailable'));
  }, [options.ownerId, options.projectId, options.script, options.resetKey]);
  useEffect(() => {
    if (fault.current) return;
    setStatus(speechEnabled ? 'connecting' : available ? 'paused' : 'unavailable');
    setMessage(available ? '' : speechMessage('unavailable'));
  }, [speechEnabled, stream.current.id, available]);

  const requestPermission = (): Promise<boolean> => {
    const identity = current.current;
    if (!mounted.current || !identity.ownerId || !identity.projectId || !identity.isFocused || !identity.foreground) return Promise.resolve(false);
    if (!available) { setStatus('unavailable'); setMessage(speechMessage('unavailable')); return Promise.resolve(false); }
    if (permission === 'granted') { fault.current = false; refresh(value => value + 1); return Promise.resolve(true); }
    if (request.current && sameIdentity(request.current.identity, identity)) return request.current.promise;
    const epoch = backgroundEpoch.current;
    setPermission('requesting'); setMessage('');
    const owned = { identity: { ...identity }, epoch, scopeEpoch: permissionEpoch.current, promise: Promise.resolve(false) };
    const live = () => mounted.current && request.current === owned && sameIdentity(owned.identity, current.current)
      && current.current.isFocused && backgroundEpoch.current === epoch && permissionEpoch.current === owned.scopeEpoch;
    owned.promise = (async () => {
      try {
        const result = await requestStudioCaptureSpeechPermissionAsync();
        if (!live()) return false;
        fault.current = !result.granted;
        setPermission(result.granted ? 'granted' : 'denied');
        setStatus(result.granted ? 'paused' : 'denied'); setMessage(result.granted ? '' : speechMessage('denied'));
        return result.granted;
      } catch {
        if (live()) { setPermission('undetermined'); setStatus('error'); setMessage(speechMessage('error')); }
        return false;
      } finally {
        if (request.current === owned) {
          request.current = null;
          // An interrupted permission request must leave the next owner/take
          // able to request again, never stuck showing "requesting".
          if (mounted.current && !sameIdentity(owned.identity, current.current)) setPermission('undetermined');
          else if (mounted.current && (backgroundEpoch.current !== epoch || permissionEpoch.current !== owned.scopeEpoch)) setPermission('undetermined');
        }
      }
    })();
    request.current = owned;
    return owned.promise;
  };
  const onSpeech = (event: StudioCaptureSpeechEvent) => {
    const live = current.current, owned = stream.current;
    if (!mounted.current || fault.current || !owned.enabled || AppState.currentState !== 'active' || !live.active || !live.isFocused || !live.foreground
      || event.sessionId !== owned.id || !Number.isSafeInteger(event.sequence) || event.sequence < 0
      || !Number.isSafeInteger(event.generation) || event.generation < 0
      || live.generation !== undefined && event.generation !== live.generation
      || owned.generation !== undefined && event.generation < owned.generation) return;
    if (owned.generation !== event.generation) { owned.generation = event.generation; owned.sequence = -1; }
    if (event.sequence <= owned.sequence) return;
    owned.sequence = event.sequence;
    if (event.type === 'status') {
      if (!event.status) return;
      if (event.status === 'denied') setPermission('denied');
      if (event.status === 'error' || event.status === 'unavailable' || event.status === 'denied') fault.current = true;
      setStatus(event.status); setMessage(speechMessage(event.status, event.code));
      return;
    }
    if (event.type !== 'result' || typeof event.transcript !== 'string' || !event.transcript.trim()
      || !Number.isSafeInteger(event.segmentId) || event.segmentId < 0) return;
    const result = matcher.current.follow({ text: event.transcript, final: event.isFinal === true, segmentId: `${owned.id}:${event.generation}:${event.segmentId}` });
    if (result.matched) setReadWordCount(result.readWordCount);
    setStatus('listening'); setMessage('');
  };
  const reset = () => {
    matcher.current.reset(); setReadWordCount(0); fault.current = false;
    stream.current = { id: nextSession(), enabled: false, generation: current.current.generation, sequence: -1 };
    refresh(value => value + 1);
  };
  return { available, permission, status, message, readWordCount: changed ? 0 : readWordCount,
    words: matcher.current.tokens, speechSessionId: stream.current.id, speechEnabled, onSpeech, requestPermission, reset };
}
