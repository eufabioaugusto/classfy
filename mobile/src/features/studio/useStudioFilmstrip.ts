import { useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { generateThumbnailAsync, isStudioMediaAvailable } from '../../../modules/classfy-studio-media';
import type { StudioTake } from './model';
import { createStudioFilmstripCache, mapStudioFilmstripSamples, normalizeStudioFilmstripSamples, studioFilmstripSampleWindow, STUDIO_FILMSTRIP_VERSION, type StudioFilmstripSample } from './studioFilmstripCache';

const sourceHashes = new Map<string, Promise<string>>();
function sourceHash(uri: string) {
  let hash = sourceHashes.get(uri);
  if (!hash) {
    hash = digestStringAsync(CryptoDigestAlgorithm.SHA256, uri).catch(cause => {
      if (sourceHashes.get(uri) === hash) sourceHashes.delete(uri);
      throw cause;
    });
    sourceHashes.set(uri, hash);
    if (sourceHashes.size > 128) sourceHashes.delete(sourceHashes.keys().next().value!);
  }
  return hash;
}
const cache = createStudioFilmstripCache({
  info: uri => FileSystem.getInfoAsync(uri),
  makeDirectory: uri => FileSystem.makeDirectoryAsync(uri, { intermediates: true }),
  remove: uri => FileSystem.deleteAsync(uri, { idempotent: true }),
  move: (from, to) => FileSystem.moveAsync({ from, to }),
  generate: generateThumbnailAsync,
  uniqueId: randomUUID,
});
type FilmstripResults = { sourceUri: string; frames: Record<string, string> };
const empty: Readonly<Record<string, string>> = Object.freeze({});

/** samples.seconds is absolute in the original, including after a trim/split. */
export function useStudioFilmstrip(take: StudioTake, samples: readonly StudioFilmstripSample[], enabled = true): Readonly<Record<string, string>> {
  const requests = studioFilmstripSampleWindow(samples, take.duration);
  const normalized = normalizeStudioFilmstripSamples(samples, take.duration);
  const sourceUri = take.uri;
  const canRead = enabled && !!FileSystem.cacheDirectory && isStudioMediaAvailable() && sourceUri.startsWith('file://')
    && !(take.width === 0 || take.height === 0) && normalized.length > 0;
  const signature = JSON.stringify([sourceUri, requests.map(frame => [frame.key, frame.timestampMs]), canRead]);
  const latest = useRef(signature); latest.current = signature;
  const [results, setResults] = useState<FilmstripResults>({ sourceUri, frames: {} });

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    const subscriptions: (() => void)[] = [];
    const expected = signature;
    void sourceHash(sourceUri).then(hash => {
      if (!active || latest.current !== expected) return;
      const directory = `${FileSystem.cacheDirectory}classfy-studio-filmstrip/${STUDIO_FILMSTRIP_VERSION}/${hash}/`;
      for (const { timestampMs } of normalized) {
        subscriptions.push(cache.subscribe({ sourceUri, directory, seconds: timestampMs / 1000, outputUri: `${directory}${timestampMs}.jpg` }, uri => {
          if (!active || latest.current !== expected) return;
          setResults(previous => {
            const retained: Record<string, string> = {};
            if (previous.sourceUri === sourceUri) for (const frame of normalized) {
              const key = String(frame.timestampMs);
              const uri = previous.frames[key];
              if (typeof uri === 'string' && uri) retained[key] = uri;
            }
            retained[String(timestampMs)] = uri;
            return { sourceUri, frames: retained };
          });
        }, () => active && latest.current === expected));
      }
    }).catch(() => undefined);
    return () => { active = false; for (const unsubscribe of subscriptions) unsubscribe(); };
  }, [signature, canRead, sourceUri]);

  return useMemo(() => {
    if (!canRead || results.sourceUri !== sourceUri) return empty;
    return mapStudioFilmstripSamples(requests, normalized, results.frames);
  }, [signature, canRead, sourceUri, results]);
}
