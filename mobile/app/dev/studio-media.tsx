import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { colors } from '@/theme/colors';
import { exportTimelineAsync, generateThumbnailAsync, getMediaInfoAsync } from '../../modules/classfy-studio-media';

// Deterministic native smoke test. No account, cloud write, or publication.
// The route redirects in release builds; its small fixtures contain only colors/tones.
export default function NativeStudioSmokeTest() {
  const [result, setResult] = useState('Testando composição nativa…');
  useEffect(() => {
    if (!__DEV__) return;
    let mounted = true;
    const run = async () => {
      const directory = `${FileSystem.cacheDirectory}studio-qa-${randomUUID()}/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const source = async (module: number) => {
        const asset = Asset.fromModule(module); await asset.downloadAsync();
        if (!asset.localUri) throw new Error('Fixture indisponível');
        return asset.localUri;
      };
      const [landscape, portrait, audio] = await Promise.all([
        source(require('../../assets/studio-qa/landscape.mp4')),
        source(require('../../assets/studio-qa/portrait.mp4')),
        source(require('../../assets/studio-qa/audio.m4a')),
      ]);
      const video = await exportTimelineAsync({ requestId: randomUUID(), clips: [
        { uri: portrait, startSeconds: 0.3, endSeconds: 1.3 },
        { uri: landscape, startSeconds: 0.5, endSeconds: 1.5 },
      ], outputUri: `${directory}montage.mp4`, mediaType: 'video', aspectRatio: 'landscape' });
      if (Math.abs(video.duration - 2) > 0.05 || video.width !== 1920 || video.height !== 1080 || !video.hasAudio) throw new Error('Composição divergente');
      const short = await exportTimelineAsync({ requestId: randomUUID(), clips: [{ uri: landscape, startSeconds: 0.2, endSeconds: 1.2 }],
        outputUri: `${directory}short.mp4`, mediaType: 'video', aspectRatio: 'portrait' });
      if (short.width !== 1080 || short.height !== 1920 || Math.abs(short.duration - 1) > 0.05) throw new Error('Short divergente');
      const podcast = await exportTimelineAsync({ requestId: randomUUID(), clips: [{ uri: audio, startSeconds: 0.3, endSeconds: 1.3 }],
        outputUri: `${directory}podcast.m4a`, mediaType: 'audio', aspectRatio: 'landscape' });
      if (!podcast.hasAudio || podcast.hasVideo || Math.abs(podcast.duration - 1) > 0.08) throw new Error('Podcast divergente');
      const thumbnail = await generateThumbnailAsync(video.uri, `${directory}cover.jpg`, 0.5);
      const original = await getMediaInfoAsync(landscape);
      const report = { passed: true, video, short, podcast, thumbnail, originalDuration: original.duration };
      await FileSystem.writeAsStringAsync(`${FileSystem.cacheDirectory}classfy-studio-qa-result.json`, JSON.stringify(report));
      if (mounted) setResult('OK · cortes, montagem, orientação, áudio e capa no iOS.');
    };
    void run().catch(async error => {
      const message = error instanceof Error ? error.message : 'Falha na exportação';
      await FileSystem.writeAsStringAsync(`${FileSystem.cacheDirectory}classfy-studio-qa-result.json`, JSON.stringify({ passed: false, error: message }));
      if (mounted) setResult(message);
    });
    return () => { mounted = false; };
  }, []);
  if (!__DEV__) return <Redirect href="/" />;
  return <AppScreen header={<NavigationHeader title="QA Studio nativo" back />}><View style={{ padding: 20, gap: 12 }}>
    <Text style={{ color: colors.text, fontSize: 18 }}>{result}</Text>
    <Text style={{ color: colors.muted }}>Teste local. Nenhum conteúdo enviado.</Text>
  </View></AppScreen>;
}
