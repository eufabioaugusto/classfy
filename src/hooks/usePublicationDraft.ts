import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatSaveStatus,
  publicationDraftService,
  type PublicationDraftRecord,
  type PublicationKind,
  type PublicationSaveState,
} from "@/lib/studio/publication";

export function usePublicationDraft<TPayload>({
  userId,
  draftKey,
  kind,
  sourceType = null,
  sourceId = null,
  payload,
  enabled = true,
  onRestore,
}: {
  userId?: string;
  draftKey: string;
  kind: PublicationKind;
  sourceType?: "content" | "course" | null;
  sourceId?: string | null;
  payload: TPayload;
  enabled?: boolean;
  onRestore: (payload: TPayload, record: PublicationDraftRecord<TPayload>) => void;
}) {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [state, setState] = useState<PublicationSaveState>("loading");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const hydratedRef = useRef(false);
  const payloadRef = useRef(payload);
  const restoreRef = useRef(onRestore);
  payloadRef.current = payload;
  restoreRef.current = onRestore;

  useEffect(() => {
    hydratedRef.current = false;
    if (!enabled || !userId) { setState("saved"); return; }
    let cancelled = false;
    setState("loading");
    publicationDraftService.load<TPayload>(userId, draftKey).then((record) => {
      if (cancelled) return;
      if (record) {
        setDraftId(record.id);
        setSavedAt(new Date(record.updated_at));
        restoreRef.current(record.payload, record);
      }
      hydratedRef.current = true;
      setState("saved");
    }).catch(() => {
      hydratedRef.current = true;
      setState("error");
    });
    return () => { cancelled = true; };
  }, [draftKey, enabled, userId]);

  const saveNow = useCallback(async () => {
    if (!enabled || !userId || !hydratedRef.current) return null;
    setState("saving");
    try {
      const result = await publicationDraftService.save({
        ownerId: userId, draftKey, kind, sourceType, sourceId, payload: payloadRef.current,
      });
      setDraftId(result.record.id);
      setSavedAt(new Date(result.record.updated_at));
      setState(result.remote ? "saved" : "offline");
      return result.record;
    } catch {
      setState("error");
      return null;
    }
  }, [draftKey, enabled, kind, sourceId, sourceType, userId]);

  useEffect(() => {
    if (!enabled || !userId || !hydratedRef.current) return;
    const timer = window.setTimeout(() => { void saveNow(); }, 900);
    return () => window.clearTimeout(timer);
  }, [enabled, payload, saveNow, userId]);

  const discard = useCallback(async () => {
    if (!userId) return;
    await publicationDraftService.discard(userId, draftKey);
    setDraftId(null);
    setSavedAt(null);
    setState("saved");
  }, [draftKey, userId]);

  const clearLocal = useCallback(() => {
    if (userId) publicationDraftService.clearLocal(userId, draftKey);
  }, [draftKey, userId]);

  const label = useMemo(() => formatSaveStatus(state, savedAt), [savedAt, state]);
  return { draftId, state, savedAt, label, saveNow, discard, clearLocal };
}
