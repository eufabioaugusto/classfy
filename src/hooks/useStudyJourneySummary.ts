import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchStudyJourneySummary,
  type StudyJourneySummary,
  type StudyJourneySummaryOverrides,
} from "@/lib/study/getStudyJourneySummary";

interface UseStudyJourneySummaryInput {
  studyId?: string | null;
  userId?: string | null;
  title?: string | null;
  overrides?: StudyJourneySummaryOverrides;
  enabled?: boolean;
}

export function useStudyJourneySummary(input: UseStudyJourneySummaryInput) {
  const { studyId, userId, title, overrides, enabled = true } = input;
  const [summary, setSummary] = useState<StudyJourneySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const inFlightRef = useRef<Promise<StudyJourneySummary | null> | null>(null);
  const lastResolvedRef = useRef<{
    key: string;
    summary: StudyJourneySummary | null;
    timestamp: number;
  } | null>(null);
  const activeMode = overrides?.activeMode ?? null;
  const currentFocus = overrides?.currentFocus ?? null;
  const nextBestAction = overrides?.nextBestAction ?? null;
  const requestKey = JSON.stringify({
    studyId,
    userId,
    title: title?.trim() || "",
    activeMode,
    currentFocus,
    nextBestAction,
  });

  const load = useCallback(async () => {
    if (!enabled || !studyId || !userId || !title?.trim()) {
      setSummary(null);
      lastResolvedRef.current = null;
      return null;
    }

    const cached = lastResolvedRef.current;
    if (
      cached &&
      cached.key === requestKey &&
      Date.now() - cached.timestamp < 1500
    ) {
      setSummary(cached.summary);
      return cached.summary;
    }
    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    setLoading(true);
    setError(null);

    const request = (async () => {
      try {
        const nextSummary = await fetchStudyJourneySummary({
          studyId,
          userId,
          title,
          overrides: {
            activeMode,
            currentFocus,
            nextBestAction,
          },
        });

        setSummary(nextSummary);
        lastResolvedRef.current = {
          key: requestKey,
          summary: nextSummary,
          timestamp: Date.now(),
        };
        return nextSummary;
      } catch (nextError: any) {
        setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
        return null;
      } finally {
        inFlightRef.current = null;
        setLoading(false);
      }
    })();

    inFlightRef.current = request;
    return request;
  }, [activeMode, currentFocus, enabled, nextBestAction, requestKey, studyId, title, userId]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    summary,
    loading,
    error,
    refetch: load,
  };
}
