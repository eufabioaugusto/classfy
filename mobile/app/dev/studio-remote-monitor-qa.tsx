import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StudioRemoteCameraMonitor } from '@/features/studio/StudioRemoteCameraMonitor';
import type { RemoteCameraSnapshot } from '@/features/studio/remoteCameraController';

/** UI-only fixture. Never starts camera, microphone, pairing or a real upload. */
export default function StudioRemoteMonitorQA() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevelopmentMonitor />;
}
function DevelopmentMonitor() {
  const params = useLocalSearchParams<{ format?: string; phase?: string }>(), router = useRouter();
  const portrait = params.format !== 'landscape';
  const phase = params.phase === 'recording' ? 'recording' : params.phase === 'saving' ? 'saving' : 'ready';
  const [notice, setNotice] = useState<string | null>(null), [stopped, setStopped] = useState(false);
  const player = useVideoPlayer(portrait ? require('../../assets/studio-qa/portrait.mp4') : require('../../assets/studio-qa/landscape.mp4'), value => {
    value.loop = true; value.muted = true; value.play();
  });
  useEffect(() => {
    void ScreenOrientation.lockAsync(portrait ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE_LEFT);
    return () => { void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); };
  }, [portrait]);
  const state: RemoteCameraSnapshot = {
    phase: stopped ? 'ready' : phase, session: null, state: { width: portrait ? 2160 : 3840, height: portrait ? 3840 : 2160, fps: 30, supportsFocus: true, supportsFocusLock: true },
    error: null, previewConnected: true, uploading: params.phase === 'uploading', uploadTotalBytes: 10_000, uploadProgressBytes: 4250,
    processing: !stopped && phase === 'saving', processingProgress: .42, processingStage: 'rendering', takeCount: 1, syncUncertaintyMs: null,
  };
  return <StudioRemoteCameraMonitor state={state} active captureScope={`ui-fixture:${portrait}`} elapsed={18} error={notice} canUnpair
    audio={{ input: { name: 'Microfone do iPhone', type: 'fixture' }, channels: [{ averageDb: -27, peakDb: -9 }], status: 'live' }}
    onClose={() => router.back()} onStop={() => setStopped(true)} onReconnect={() => setNotice('Prévia de interface: nenhuma conexão real foi alterada.')}
    onUnpair={() => setNotice('Prévia de interface: nenhum vínculo real foi alterado.')} onUpload={() => setNotice('Prévia de interface: nenhum original foi enviado.')}
    onFocus={async () => ({})} onFocusError={setNotice}>
    <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
  </StudioRemoteCameraMonitor>;
}
