let keepAwakeSequence = 0;

/** Each display session owns one tag; stale completion never releases another. */
export function retainStudioMonitorScreen(options: {
  ownerId: string; projectId: string;
  activate: (tag: string) => Promise<void>;
  deactivate: (tag: string) => Promise<void> | void;
}) {
  const tag = `studio-camera-monitor:${options.ownerId}:${options.projectId}:${++keepAwakeSequence}`;
  let ended = false;
  const release = async () => { try { await options.deactivate(tag); } catch {} };
  void (async () => {
    try { await options.activate(tag); if (ended) await release(); } catch {}
  })();
  return () => { ended = true; void release(); };
}
