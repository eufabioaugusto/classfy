import { useEffect, useRef, useState, type RefObject } from 'react';
import { randomUUID } from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { remoteCameraDeviceId } from './remoteCameraRuntime';
import { requestStudioCameraMonitor } from './cameraMonitorApi';
import { createStudioMonitorPreviewTransport } from './cameraMonitorTransport';
import { createStudioCameraMonitorPublisher, initialStudioMonitorPublisher } from './cameraMonitorPublisher';
import { isStudioNativeCameraHandle, type StudioCaptureCameraHandle } from './StudioNativeCamera';
import type { StudioCameraMonitorState } from './cameraMonitorProtocol';
import { retainStudioMonitorScreen } from './cameraMonitorKeepAwake';

export function useStudioCameraMonitor(options: {
  ownerId?: string; projectId: string; kind?: string; title: string; active: boolean;
  premium: boolean; ready: boolean; sourceKey: string;
  camera: RefObject<StudioCaptureCameraHandle | null>; state: StudioCameraMonitorState;
}) {
  const [snapshot, setSnapshot] = useState(initialStudioMonitorPublisher);
  const current = useRef(options); current.current = options;
  const publisher = useRef<ReturnType<typeof createStudioCameraMonitorPublisher> | null>(null);
  const tag = () => isStudioNativeCameraHandle(current.current.camera.current) ? current.current.camera.current.getNativeTag() : null;
  useEffect(() => {
    if (!snapshot.enabled || !options.active || !options.ownerId) return;
    return retainStudioMonitorScreen({ ownerId: options.ownerId, projectId: options.projectId,
      activate: activateKeepAwakeAsync, deactivate: deactivateKeepAwake });
  }, [snapshot.enabled, options.active, options.ownerId, options.projectId]);
  useEffect(() => {
    const owner = options.ownerId, project = options.projectId, kind = options.kind;
    setSnapshot(initialStudioMonitorPublisher);
    if (!owner || !options.active || !options.premium || kind !== 'aula' && kind !== 'short') return;
    let mounted = true;
    const isCurrent = () => mounted && current.current.ownerId === owner && current.current.projectId === project && current.current.active && current.current.premium;
    const next = createStudioCameraMonitorPublisher({ owner, kind, title: options.title, current: isCurrent,
      uuid: randomUUID, deviceId: () => remoteCameraDeviceId(owner),
      request: (action, body) => requestStudioCameraMonitor(owner, action, body, {
        isCurrent: action === 'monitor-close' ? () => current.current.ownerId === owner : isCurrent,
      }),
      transport: createStudioMonitorPreviewTransport });
    publisher.current = next;
    const unsubscribe = next.subscribe(value => { if (isCurrent()) setSnapshot(value); });
    return () => {
      mounted = false; unsubscribe();
      if (publisher.current === next) publisher.current = null;
      void next.dispose();
    };
  }, [options.ownerId, options.projectId, options.kind, options.active, options.premium]);
  useEffect(() => {
    publisher.current?.setSource(options.ready ? tag() : null);
  }, [options.ready, options.sourceKey, options.active]);
  useEffect(() => { publisher.current?.updateState(options.state); }, [options.state.recording, options.state.elapsedSeconds,
    options.state.width, options.state.height, options.state.fps, options.state.cameraFacing]);
  return { ...snapshot,
    async enable() {
      const value = current.current;
      if (!value.active || !value.premium || !value.ready || !publisher.current) return;
      await publisher.current.enable(tag(), value.state);
    },
    disable: () => publisher.current?.disable() || Promise.resolve(),
    cameraUnavailable: () => publisher.current?.setSource(null),
    cameraReady: () => publisher.current?.setSource(tag()),
    previewFailed: (message?: string) => publisher.current?.previewFailed(message),
  };
}
