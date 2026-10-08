import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  DeviceEventEmitter,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ClassyAvatar } from './ClassyAvatar';
import { useAuth } from '@/features/auth/authContext';
import { useMiniPlayer } from '@/features/watch/miniPlayerContext';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';

type Reference = {
  id: string;
  type: 'content' | 'lesson' | 'study' | 'creator';
  title: string;
};
type Source = {
  id: string;
  type: string;
  title: string;
  contentId?: string;
  transcriptAvailable?: boolean;
};
type Message = {
  id: string;
  content: string;
  role: string;
  metadata?: { context_sources?: Source[]; study_mode?: string };
};
type Study = { id: string; title: string };
const modes = [
  { id: 'explain', title: 'Entender' },
  { id: 'practice', title: 'Praticar' },
  { id: 'review', title: 'Revisar' },
  { id: 'plan', title: 'Planejar' },
];

export function GlobalClassy() {
  const { user } = useAuth();
  const player = useMiniPlayer();
  const { action, openClassy, closeClassy } = usePrimaryAction();
  const open = action === 'classy';
  const setOpen = (value: boolean) => (value ? openClassy() : closeClassy());
  const path = usePathname();
  const params = useGlobalSearchParams<{ studyId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [menu, setMenu] = useState<
    'studies' | 'actions' | 'mentions' | 'new' | null
  >(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [activeStudy, setActiveStudy] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState('');
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<string | undefined>();
  const [references, setReferences] = useState<Reference[]>([]);
  const [options, setOptions] = useState<Reference[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [dismissedLesson, setDismissedLesson] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const identity = useRef(user?.id);
  identity.current = user?.id;
  const conversation = useRef('');
  const scroll = useRef<ScrollView>(null);
  const savingNotes = useRef(new Set<string>());
  const restoredConversation = useRef<string | null>(null);
  const studyId =
    (path === '/study' ? activeStudy || params.studyId : undefined) || selected;
  conversation.current = studyId;
  const page =
    path === '/'
      ? 'Explorar'
      : path.startsWith('/watch/')
        ? 'Aula aberta'
        : path === '/study'
          ? 'Meu estudo'
          : path === '/shorts'
            ? 'Shorts'
            : 'Classfy';
  const lesson: Reference | null =
    player.content &&
    player.content.trackingEnabled !== false &&
    (path.startsWith('/watch/') || player.visible)
      ? {
          id: player.content.lessonId || player.content.id,
          type: player.content.lessonId ? 'lesson' : 'content',
          title: player.content.title,
        }
      : null;
  const attachedLesson = lesson?.id !== dismissedLesson ? lesson : null;
  const hidden =
    /^\/(auth|onboarding|termos|privacidade)(\/|$)/.test(path) ||
    (width > height &&
      (path.startsWith('/watch/') || path.startsWith('/dev/')));
  useEffect(() => {
    setOpen(false);
    setSelected('');
    setStudies([]);
    setDraft('');
    setMessages([]);
    setReferences([]);
    setMode(undefined);
    setNotice('');
    setSources([]);
    setSaved([]);
    setBusy(false);
    setMenu(null);
    setActiveStudy(null);
    restoredConversation.current = null;
    setOptions([]);
    setDismissedLesson(null);
  }, [user?.id]);
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'classfy:active-study',
      (event: { studyId: string | null; userId?: string }) => {
        if (event.userId === identity.current) setActiveStudy(event.studyId);
      },
    );
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let active = true;
    if (!user || !open) return;
    supabase
      .from('studies')
      .select('id,title')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('last_activity_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setNotice('Não foi possível carregar seus estudos.');
          return;
        }
        setStudies(data || []);
        setSelected((previous) =>
          data?.some((s) => s.id === previous) ? previous : data?.[0]?.id || '',
        );
      });
    return () => {
      active = false;
    };
  }, [user?.id, open, path]);
  useEffect(() => {
    let active = true;
    setMessages([]);
    setSources([]);
    setNotice('');
    setSaved([]);
    setLoading(false);
    if (!open || !user || !studyId) return;
    setLoading(true);
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      const { data, error } = await supabase
        .from('study_messages')
        .select('id,role,content,metadata')
        .eq('study_id', studyId)
        .order('created_at', { ascending: false })
        .limit(60);
      if (!active || request !== revision) return;
      if (error)
        setNotice(
          'Não foi possível carregar a conversa. Reabra a Classy para tentar novamente.',
        );
      else {
        const history = (data || []).reverse() as Message[];
        setMessages(history);
        if (restoredConversation.current !== studyId) {
          restoredConversation.current = studyId;
          const metadata = [...history]
            .reverse()
            .find((m) => m.role === 'assistant')?.metadata;
          setReferences((previous) =>
            previous.length
              ? previous
              : (metadata?.context_sources || [])
                  .filter((source) =>
                    ['content', 'lesson', 'creator', 'study'].includes(
                      source.type,
                    ),
                  )
                  .slice(0, 3)
                  .map((source) => ({
                    id: source.id,
                    type: source.type as Reference['type'],
                    title: source.title,
                  })),
          );
          setMode(
            (previous) =>
              previous ||
              (modes.some((m) => m.id === metadata?.study_mode)
                ? metadata?.study_mode
                : undefined),
          );
        }
        setSources(
          [...history].reverse().find((m) => m.role === 'assistant')?.metadata
            ?.context_sources || [],
        );
      }
      setLoading(false);
    };
    void load();
    const channel = supabase
      .channel(`classy-global-mobile-${user.id}-${studyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'study_messages',
          filter: `study_id=eq.${studyId}`,
        },
        () => {
          void load();
        },
      )
      .subscribe();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      active = false;
      subscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [open, user?.id, studyId]);
  useEffect(() => {
    let active = true;
    if (menu !== 'mentions' || !user) return;
    const timer = setTimeout(async () => {
      const term = query.trim().replace(/[%_,()]/g, '');
      const result = await supabase
        .from('contents')
        .select('id,title')
        .eq('status', 'approved')
        .ilike('title', `%${term}%`)
        .limit(15);
      if (active) {
        if (result.error) setNotice('Não foi possível buscar referências.');
        setOptions([
          ...(result.data || []).map((c) => ({
            ...c,
            type: 'content' as const,
          })),
          ...studies
            .filter((s) => s.title.toLowerCase().includes(term.toLowerCase()))
            .map((s) => ({ ...s, type: 'study' as const })),
        ]);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [menu, query, user?.id, studies]);
  async function send() {
    if (busy || loading || !draft.trim() || !user) return;
    if (!studyId) {
      setNotice('Crie ou escolha um estudo para começar.');
      setMenu('actions');
      return;
    }
    const requestUser = user.id;
    const requestStudy = studyId;
    const text = draft.trim();
    const current = () =>
      identity.current === requestUser && conversation.current === requestStudy;
    setBusy(true);
    setDraft('');
    setNotice('');
    const refs = [
      ...(attachedLesson ? [attachedLesson] : []),
      ...references,
    ].filter(
      (ref, i, all) =>
        all.findIndex((r) => r.id === ref.id && r.type === ref.type) === i,
    );
    try {
      const { data, error } = await supabase.functions.invoke('classy-chat', {
        body: {
          studyId: requestStudy,
          message: text,
          studyMode: mode,
          references: refs.map(({ id, type }) => ({ id, type })),
          pageContext: `${page}${attachedLesson ? `; ${attachedLesson.title}; reprodução em ${Math.floor(player.position)}s` : ''}`,
          activeContentId:
            refs.find((ref) => ref.type === 'content')?.id ||
            (attachedLesson?.type === 'lesson'
              ? player.content?.trackingContentId
              : undefined),
          currentVideoTime: attachedLesson ? player.position : undefined,
        },
      });
      const payload =
        data ||
        (error?.context instanceof Response
          ? await error.context.json().catch(() => null)
          : null);
      if (!current()) return;
      if (payload?.contextPending || payload?.limitReached) {
        setDraft(text);
        setSources(payload.contextSources || []);
        setNotice(payload.message || 'Não foi possível enviar agora.');
        return;
      }
      if (error || payload?.error)
        throw new Error(
          payload?.message ||
            'Não foi possível falar com a Classy. Tente novamente.',
        );
      // classy-chat persists both messages. Never insert them a second time.
      const history = await supabase
        .from('study_messages')
        .select('id,role,content,metadata')
        .eq('study_id', requestStudy)
        .order('created_at', { ascending: false })
        .limit(60);
      if (!current()) return;
      if (history.error) {
        setNotice(
          'Mensagem enviada. Reabra a conversa para atualizar o histórico.',
        );
        return;
      }
      setMessages((history.data || []).reverse() as Message[]);
      setSources(data?.contextSources || []);
    } catch (error) {
      if (current()) {
        setDraft(text);
        setNotice(error instanceof Error ? error.message : 'Tente novamente.');
      }
    } finally {
      if (identity.current === requestUser) setBusy(false);
    }
  }
  function navigateStudy(id?: string) {
    setOpen(false);
    router.push(
      user
        ? { pathname: '/study', params: id ? { studyId: id } : {} }
        : '/auth/sign-in',
    );
  }
  async function saveNote(message: Message) {
    if (
      !user ||
      saved.includes(message.id) ||
      savingNotes.current.has(message.id)
    )
      return;
    savingNotes.current.add(message.id);
    const owner = user.id;
    const contentId = message.metadata?.context_sources?.find(
      (s) => s.contentId,
    )?.contentId;
    const { error } = await supabase.from('study_notes').insert({
      study_id: studyId,
      user_id: owner,
      note_text: message.content,
      content_id: contentId || null,
      timestamp_seconds: null,
    });
    savingNotes.current.delete(message.id);
    if (identity.current !== owner || conversation.current !== studyId) return;
    if (error) Alert.alert('Classy', 'Não foi possível salvar a anotação.');
    else {
      setSaved((previous) => [...previous, message.id]);
      setNotice('Resposta salva nas anotações do estudo.');
    }
  }
  async function transcript(source: Source) {
    if (busy) return;
    const owner = user?.id;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        'transcribe-content',
        {
          body: source.contentId
            ? { contentId: source.contentId }
            : { lessonId: source.id },
        },
      );
      if (identity.current !== owner) return;
      if (error || data?.error)
        throw new Error('Não foi possível gerar a transcrição.');
      if (!data?.processing && !data?.transcription?.text) {
        setNotice('A transcrição ainda não está disponível.');
        return;
      }
      setNotice(
        data?.processing
          ? data.message || 'Transcrição em processamento.'
          : 'Transcrição pronta para sua próxima pergunta.',
      );
    } catch (error) {
      if (identity.current === owner)
        setNotice(error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      if (identity.current === owner) setBusy(false);
    }
  }
  if (hidden) return null;
  const selectedStudy = studies.find((s) => s.id === studyId);
  return (
    <>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <Pressable
            style={styles.backdrop}
            accessibilityLabel="Recolher Classy"
            onPress={() => setOpen(false)}
          />
          <View
            style={[
              styles.panel,
              {
                paddingBottom: Math.max(12, insets.bottom),
                maxHeight: height - insets.top - 20,
              },
            ]}
          >
            <View style={styles.header}>
              <ClassyAvatar />
              <View style={{ flex: 1 }}>
                <Text style={styles.heading}>Classy</Text>
                <Text style={styles.muted}>Seu espaço para aprender</Text>
              </View>
              <Pressable
                style={styles.icon}
                accessibilityLabel="Fechar Classy"
                onPress={() => setOpen(false)}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.context}>
              <Text style={styles.muted}>Com você em · {page}</Text>
              <Pressable
                disabled={
                  busy ||
                  !!(path === '/study' && (activeStudy || params.studyId))
                }
                style={styles.choice}
                onPress={() => setMenu(menu === 'studies' ? null : 'studies')}
              >
                <Text style={styles.body} numberOfLines={1}>
                  {selectedStudy?.title || 'Escolha um estudo'} ▾
                </Text>
              </Pressable>
            </View>
            {menu === 'studies' && (
              <ScrollView style={{ maxHeight: 150, flexShrink: 1 }}>
                {studies.map((s) => (
                  <Pressable
                    key={s.id}
                    style={styles.option}
                    onPress={() => {
                      setSelected(s.id);
                      setMenu(null);
                      setReferences([]);
                      setMode(undefined);
                    }}
                  >
                    <Text style={styles.body}>{s.title}</Text>
                  </Pressable>
                ))}
                {!studies.length && (
                  <Text style={styles.muted}>
                    Seus estudos aparecerão aqui.
                  </Text>
                )}
              </ScrollView>
            )}
            {menu === 'actions' && (
              <View style={styles.actions}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {modes.map((m) => (
                    <Pressable
                      key={m.id}
                      style={[
                        styles.mode,
                        mode === m.id && { borderColor: colors.accent },
                      ]}
                      onPress={() => {
                        setMode(m.id);
                        setMenu(null);
                      }}
                    >
                      <Text style={styles.body}>/{m.title}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.links}>
                  <Pressable
                    style={styles.option}
                    onPress={() => setMenu('mentions')}
                  >
                    <Text style={styles.body}>@ Adicionar referência</Text>
                  </Pressable>
                  <Pressable
                    style={styles.option}
                    onPress={() => setMenu('new')}
                  >
                    <Text style={styles.body}>＋ Criar estudo</Text>
                  </Pressable>
                </View>
              </View>
            )}
            {menu === 'new' && (
              <View style={styles.actions}>
                <Text style={styles.body}>O que você quer aprender?</Text>
                <TextInput
                  accessibilityLabel="Tema do novo estudo"
                  value={newTopic}
                  onChangeText={setNewTopic}
                  placeholder="Conte seu objetivo para a Classy"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { flex: 0 }]}
                  maxLength={180}
                />
                <Pressable
                  disabled={!newTopic.trim() || busy}
                  style={styles.option}
                  onPress={() => {
                    if (!user) {
                      setOpen(false);
                      router.push('/auth/sign-in');
                      return;
                    }
                    setOpen(false);
                    setMenu(null);
                    router.push({
                      pathname: '/study',
                      params: {
                        newTopic: newTopic.trim(),
                        newStudyRequestId: String(Date.now()),
                      },
                    });
                    setNewTopic('');
                  }}
                >
                  <Text style={{ color: colors.accent }}>
                    Criar meu estudo →
                  </Text>
                </Pressable>
              </View>
            )}
            {menu === 'mentions' && (
              <View style={styles.actions}>
                <TextInput
                  accessibilityLabel="Buscar referência para Classy"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar conteúdo ou estudo"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { flex: 0 }]}
                />
                <ScrollView style={{ maxHeight: 160, flexShrink: 1 }}>
                  {options.map((ref) => (
                    <Pressable
                      key={`${ref.type}:${ref.id}`}
                      style={styles.option}
                      onPress={() => {
                        if (references.length >= 3) {
                          setNotice('Use até três referências por mensagem.');
                          return;
                        }
                        setReferences((previous) => [
                          ...previous.filter(
                            (r) => r.id !== ref.id || r.type !== ref.type,
                          ),
                          ref,
                        ]);
                        setMenu(null);
                      }}
                    >
                      <Text style={styles.body}>{ref.title}</Text>
                      <Text style={styles.muted}>
                        {ref.type === 'study' ? 'Estudo' : 'Conteúdo'}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            <ScrollView
              ref={scroll}
              style={styles.messages}
              contentContainerStyle={{ padding: 18, gap: 16 }}
              onContentSizeChange={() =>
                scroll.current?.scrollToEnd({ animated: true })
              }
            >
              {!user ? (
                <View style={{ gap: 14 }}>
                  <Text style={styles.heading}>Vamos descobrir algo?</Text>
                  <Text style={styles.body}>
                    Entre para conversar com a Classy e manter suas conversas e
                    anotações juntas.
                  </Text>
                  <Pressable
                    style={styles.option}
                    onPress={() => {
                      setOpen(false);
                      router.push('/auth/sign-in');
                    }}
                  >
                    <Text style={{ color: colors.accent }}>
                      Entrar na Classfy →
                    </Text>
                  </Pressable>
                </View>
              ) : loading ? (
                <ActivityIndicator color={colors.accent} />
              ) : !messages.length ? (
                <View style={{ gap: 14 }}>
                  <ClassyAvatar size={48} />
                  <Text style={styles.heading}>Vamos descobrir algo?</Text>
                  <Text style={styles.muted}>
                    Escolha um estudo e me conte o que quer entender. Sua
                    conversa e suas anotações ficam juntas.
                  </Text>
                  <Pressable
                    style={styles.option}
                    onPress={() => setMenu('new')}
                  >
                    <Text style={styles.body}>＋ Criar um estudo</Text>
                  </Pressable>
                </View>
              ) : (
                messages
                  .filter((m) => m.role !== 'system')
                  .map((m) => (
                    <View
                      key={m.id}
                      style={[
                        styles.message,
                        m.role === 'user' && styles.userMessage,
                      ]}
                    >
                      <Text selectable style={styles.body}>
                        {m.content}
                      </Text>
                      {m.role === 'assistant' && (
                        <Pressable
                          disabled={saved.includes(m.id)}
                          onPress={() => saveNote(m)}
                          style={styles.option}
                        >
                          <Text style={styles.muted}>
                            {saved.includes(m.id)
                              ? 'Salvo nas anotações'
                              : 'Salvar nas anotações'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  ))
              )}
              {sources.map((source) => (
                <View key={`${source.type}:${source.id}`} style={styles.source}>
                  <Text style={styles.muted}>
                    {source.title} ·{' '}
                    {source.transcriptAvailable === undefined
                      ? 'Contexto conectado'
                      : source.transcriptAvailable
                        ? 'Transcrição conectada'
                        : 'Sem transcrição'}
                  </Text>
                  {source.transcriptAvailable === false &&
                    (source.contentId || source.type === 'lesson') && (
                      <Pressable
                        disabled={busy}
                        onPress={() => transcript(source)}
                      >
                        <Text style={{ color: colors.accent }}>
                          Gerar transcrição
                        </Text>
                      </Pressable>
                    )}
                </View>
              ))}
            </ScrollView>
            {notice ? (
              <Text
                accessibilityRole="alert"
                style={[
                  styles.muted,
                  { paddingHorizontal: 18, paddingBottom: 10 },
                ]}
              >
                {notice}
              </Text>
            ) : null}
            {attachedLesson || references.length || mode ? (
              <ScrollView
                horizontal
                style={{ maxHeight: 44 }}
                contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
              >
                {attachedLesson && (
                  <Pressable
                    style={styles.mode}
                    accessibilityLabel="Remover aula do contexto"
                    onPress={() => setDismissedLesson(attachedLesson.id)}
                  >
                    <Text style={styles.muted} numberOfLines={1}>
                      Aula · {attachedLesson.title.slice(0, 35)} ×
                    </Text>
                  </Pressable>
                )}
                {references.map((ref) => (
                  <Pressable
                    key={`${ref.type}:${ref.id}`}
                    style={styles.mode}
                    onPress={() =>
                      setReferences((previous) =>
                        previous.filter((r) => r !== ref),
                      )
                    }
                  >
                    <Text style={styles.muted}>
                      @{ref.title.slice(0, 25)} ×
                    </Text>
                  </Pressable>
                ))}
                {mode && (
                  <Pressable
                    style={styles.mode}
                    onPress={() => setMode(undefined)}
                  >
                    <Text style={styles.muted}>
                      /{modes.find((m) => m.id === mode)?.title} ×
                    </Text>
                  </Pressable>
                )}
              </ScrollView>
            ) : null}
            {user && (
              <View style={styles.composer}>
                <ClassyAvatar />
                <TextInput
                  accessibilityLabel="Mensagem para Classy"
                  placeholder="Aprender com a Classy"
                  placeholderTextColor={colors.muted}
                  value={draft}
                  maxLength={4000}
                  onChangeText={(text) => {
                    if (/(?:^|\s)@$/.test(text)) {
                      setDraft(text.replace(/@$/, ''));
                      setMenu('mentions');
                    } else if (/(?:^|\s)\/$/.test(text)) {
                      setDraft(text.replace(/\/$/, ''));
                      setMenu('actions');
                    } else setDraft(text);
                  }}
                  style={styles.input}
                  multiline
                  editable={!busy}
                />
                <Pressable
                  accessibilityLabel="Ações da Classy"
                  onPress={() => setMenu(menu === 'actions' ? null : 'actions')}
                  style={styles.icon}
                >
                  <Ionicons name="add" size={22} color={colors.text} />
                </Pressable>
                <Pressable
                  accessibilityLabel="Enviar mensagem para Classy"
                  disabled={busy || loading}
                  onPress={send}
                  style={styles.icon}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.accent} />
                  ) : (
                    <Ionicons name="arrow-up" size={22} color={colors.text} />
                  )}
                </Pressable>
              </View>
            )}
            <View style={styles.links}>
              <Pressable
                style={styles.option}
                onPress={() => {
                  setOpen(false);
                  router.navigate('/');
                }}
              >
                <Text style={styles.muted}>Explorar</Text>
              </Pressable>
              <Pressable
                style={styles.option}
                onPress={() => navigateStudy(studyId)}
              >
                <Text style={styles.muted}>
                  {studyId ? 'Abrir estudo ↗' : 'Meus estudos ↗'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#00000055',
  },
  backdrop: { flex: 1 },
  panel: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    minHeight: 360,
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  heading: { color: colors.text, fontSize: 19, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  icon: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  context: { paddingHorizontal: 18, paddingBottom: 8, gap: 8 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    padding: 10,
  },
  messages: { flexShrink: 1, minHeight: 140 },
  message: { paddingVertical: 8, gap: 6 },
  userMessage: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
  },
  source: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 26,
    minHeight: 52,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 44,
    maxHeight: 110,
    padding: 10,
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  option: { minHeight: 44, padding: 10, justifyContent: 'center' },
  actions: { padding: 12, gap: 6 },
  mode: {
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    marginRight: 8,
    justifyContent: 'center',
  },
});
