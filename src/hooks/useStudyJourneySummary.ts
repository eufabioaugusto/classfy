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
  const activeMode = overrides?.activeMode ?? null;
  const currentFocus = overrides?.currentFocus ?? null;
  const nextBestAction = overrides?.nextBestAction ?? null;

  const load = useCallback(async () => {
    if (!enabled || !studyId || !userId || !title?.trim()) {
      setSummary(null);
      return null;
    }

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    const request = (async () => {
      setLoading(true);
      setError(null);

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
        return nextSummary;
      } catch (nextError: any) {
        setError(nextError instanceof Error ? nextError : new Error(String(nextError)));
        return null;
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    return request;
  }, [activeMode, currentFocus, enabled, nextBestAction, studyId, title, userId]);

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
