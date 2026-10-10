import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused, useNavigation, usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ArrowUpRight, ImagePlus, Radio } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingImage } from '@/components/LoadingImage';
import { useAuth } from '@/features/auth/authContext';
import { useStudioLives } from '@/features/live/useLives';
import { LiveWorkspaceAccess, LiveWorkspaceCard, LiveWorkspaceLoading, liveWorkspaceStyles } from '@/features/live/LiveWorkspaceUI';
import { StudioButton, StudioField } from '@/features/studio/StudioUI';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';

export default function PrepareLiveScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { lives, loading, error, refresh, create, canCreate, accessLoading } = useStudioLives();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [coverError, setCoverError] = useState(false);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [discardingForm, setDiscardingForm] = useState(false);
  const mounted = useRef(true);
  const pending = useRef<'cover' | 'create' | null>(null);
  const confirming = useRef(false);
  const formAccepted = useRef(false);
  const formOwner = useRef(user?.id);
  const deferredNavigation = useRef<{ owner: string; epoch: number; run: () => void } | null>(null);
  const context = useRef({ owner: user?.id, focused, canCreate, epoch: 0 });
  if (context.current.owner !== user?.id || context.current.focused !== focused) context.current.epoch++;
  context.current = { ...context.current, owner: user?.id, focused, canCreate };
  const openLive = lives.find(live => live.mux_live_stream_id && (live.status === 'waiting' || live.status === 'live'));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; context.current.epoch++; }; }, []);
  useEffect(() => {
    formOwner.current = user?.id;
    setTitle(''); setDescription(''); setCoverUri(null); setCoverError(false); setFormError(null); setDiscardingForm(false);
    formAccepted.current = false; confirming.current = false;
    deferredNavigation.current = null;
  }, [user?.id]);
  const valid = (request: { owner: string; epoch: number }) => mounted.current && context.current.focused && context.current.owner === request.owner && context.current.epoch === request.epoch;
  useEffect(() => {
    if (!discardingForm || creating) return;
    const next = deferredNavigation.current;
    deferredNavigation.current = null;
    if (next && valid(next)) next.run();
  }, [discardingForm, creating]);
  const ownsForm = formOwner.current === user?.id;
  const dirty = ownsForm && !!(title.trim() || description.trim() || coverUri);
  usePreventRemove(!discardingForm && (creating || dirty && !formAccepted.current), ({ data }) => {
    if (pending.current === 'create' || confirming.current) return;
    const owner = context.current.owner;
    if (!owner || !context.current.focused) return;
    const request = { owner, epoch: context.current.epoch };
    confirming.current = true;
    const close = () => { if (context.current.epoch === request.epoch) confirming.current = false; };
    Alert.alert('Sair da preparação?', 'O título e a capa escolhidos ainda não foram enviados.', [
      { text: 'Continuar preparando', style: 'cancel', onPress: close },
      { text: 'Sair', style: 'destructive', onPress: () => {
        close(); if (!valid(request) || pending.current === 'create') return;
        deferredNavigation.current = { ...request, run: () => navigation.dispatch(data.action) };
        setDiscardingForm(true);
      } },
    ], { cancelable: true, onDismiss: close });
  });
  const chooseCover = async () => {
    const owner = context.current.owner;
    if (!owner || !ownsForm || !focused || !canCreate || pending.current) return;
    const request = { owner, epoch: context.current.epoch };
    pending.current = 'cover'; setPicking(true); Keyboard.dismiss();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 1 });
      if (!valid(request) || !context.current.canCreate || result.canceled) return;
      const uri = result.assets[0]?.uri;
      if (!uri) throw new Error('Não foi possível abrir essa imagem. Escolha outra capa.');
      setCoverUri(uri); setCoverError(false); setFormError(null);
    } catch (cause) { if (valid(request)) setFormError(cause instanceof Error ? cause.message : 'Não foi possível abrir a galeria.'); }
    finally { pending.current = null; if (mounted.current) setPicking(false); }
  };
  const prepare = async () => {
    const owner = context.current.owner;
    if (!owner || !ownsForm || !focused || !canCreate || loading || accessLoading || error || openLive || pending.current || title.trim().length < 3 || !coverUri || coverError) return;
    const request = { owner, epoch: context.current.epoch };
    const input = { title: title.trim(), description: description.trim(), coverUri };
    pending.current = 'create'; setCreating(true); setFormError(null); Keyboard.dismiss();
    try {
      const live = await create(input, { isCurrent: () => valid(request) && context.current.canCreate });
      if (!valid(request)) return;
      formAccepted.current = true;
      deferredNavigation.current = { ...request, run: () => router.replace({ pathname: '/studio/live/[id]', params: { id: live.id } }) };
      setDiscardingForm(true);
    } catch (cause) { if (valid(request)) setFormError(cause instanceof Error ? cause.message : 'Não foi possível preparar a live. Tente novamente.'); }
    finally { pending.current = null; if (mounted.current) setCreating(false); }
  };
  const locked = picking || creating;
  const canPrepare = ownsForm && !locked && !loading && !accessLoading && !error && canCreate && !openLive && title.trim().length >= 3 && !!coverUri && !coverError;
  return <LiveWorkspaceAccess><AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Preparar live" back />}>
    <KeyboardAvoidingView style={liveWorkspaceStyles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={[liveWorkspaceStyles.content, { paddingBottom: 24 }]}>
        {loading || accessLoading ? <LiveWorkspaceLoading /> : openLive ? <>
          <Text style={liveWorkspaceStyles.detail}>Você já tem uma live aberta.</Text>
          <LiveWorkspaceCard live={openLive}><StudioButton label={openLive.status === 'live' ? 'Retomar transmissão' : 'Abrir prévia'} icon={<ArrowUpRight size={16} color={colors.text} />} onPress={() => {
            if (!pending.current && focused && openLive.creator_id === user?.id) router.replace({ pathname: '/studio/live/[id]', params: { id: openLive.id } });
          }} /></LiveWorkspaceCard>
        </> : !canCreate ? <View style={liveWorkspaceStyles.notice}><Text style={liveWorkspaceStyles.heading}>Acesso para creators aprovados</Text><Text style={liveWorkspaceStyles.detail}>A criação de lives fica disponível quando seu canal é aprovado.</Text><StudioButton label="Minhas lives" secondary onPress={() => router.replace('/studio/live')} /></View> : <>
          <Pressable accessibilityRole="button" accessibilityLabel={coverUri ? 'Trocar capa da live' : 'Escolher capa da live'} accessibilityState={{ disabled: locked, busy: picking }} disabled={locked} onPress={() => { void chooseCover(); }} style={({ pressed }) => [styles.cover, pressed && { opacity: 0.75 }]}>
            {ownsForm && coverUri ? <LoadingImage key={coverUri} source={{ uri: coverUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} onError={() => setCoverError(true)} /> : <View style={styles.coverPrompt}><ImagePlus size={28} color={colors.muted} strokeWidth={1.4} /><Text style={styles.coverLabel}>{picking ? 'Abrindo galeria…' : 'Escolher capa'}</Text><Text style={styles.coverHint}>16:9</Text></View>}
            {ownsForm && coverUri ? <View style={styles.coverAction}><ImagePlus size={14} color={colors.text} /><Text style={styles.coverActionText}>Trocar capa</Text></View> : null}
          </Pressable>
          {coverError ? <Text style={liveWorkspaceStyles.error}>Não foi possível visualizar a capa. Escolha outra imagem.</Text> : null}
          <View style={{ gap: 16 }}><StudioField label="Título" value={ownsForm ? title : ''} onChangeText={setTitle} placeholder="Sobre o que será sua live?" editable={!locked} maxLength={150} returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} />
            <StudioField label="Descrição" value={ownsForm ? description : ''} onChangeText={setDescription} placeholder="Opcional" editable={!locked} maxLength={1000} multiline style={{ minHeight: 90 }} />
          </View>
          <Text style={liveWorkspaceStyles.detail}>A câmera abre em uma prévia privada. Você escolhe quando entrar ao vivo.</Text>
        </>}
        {error ? <View style={liveWorkspaceStyles.notice}><Text style={liveWorkspaceStyles.error}>{error}</Text><StudioButton label="Tentar novamente" secondary disabled={locked} onPress={() => { void refresh(); }} /></View> : null}
        {formError ? <Text accessibilityRole="alert" style={liveWorkspaceStyles.error}>{formError}</Text> : null}
      </ScrollView>
      {!loading && !accessLoading && canCreate && !openLive ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}><StudioButton label={creating ? 'Preparando live…' : 'Abrir prévia'} loading={creating} disabled={!canPrepare} onPress={() => { void prepare(); }} icon={<Radio size={18} color={colors.text} strokeWidth={1.6} />} /></View> : null}
    </KeyboardAvoidingView>
  </AppScreen></LiveWorkspaceAccess>;
}

const styles = StyleSheet.create({
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverPrompt: { alignItems: 'center', gap: 10 },
  coverLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  coverHint: { color: colors.mutedDim, fontSize: 11 },
  coverAction: { position: 'absolute', bottom: 12, right: 12, minHeight: 32, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: controls.buttonRadius, backgroundColor: 'rgba(0,0,0,0.8)' },
  coverActionText: { color: colors.text, fontSize: 11, fontWeight: '500' },
  footer: { paddingTop: 14, paddingHorizontal: 20, borderTopWidth: 1, borderTopColor: colors.borderSubtle, backgroundColor: colors.background },
});
