import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownWideNarrow, ArrowUpRight, Camera, Check, ChevronRight, Clock3, Film, FolderOpen, Images, Mic, MoreHorizontal, Plus, Radio, Search, Trash2, Video, X } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingImage } from '@/components/LoadingImage';
import { SkeletonBlock, SkeletonGroup } from '@/components/LoadingPlaceholder';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { useAuth } from '@/features/auth/authContext';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';
import { useStudioProjects } from '@/features/studio/useStudioProjects';
import { discardTransient, getStudioProject } from '@/features/studio/store';
import { importStudioMedia } from '@/features/studio/media';
import { compileStudioRecipe, formatStudioDuration, studioFormats, studioSeconds, studioStateLabel, type StudioKind, type StudioProject } from '@/features/studio/model';
import { StudioAccess, studioStyles } from '@/features/studio/StudioUI';
import { isStudioMediaAvailable } from '../../modules/classfy-studio-media';

const formatIcons = { aula: Video, short: Film, podcast: Mic, live: Radio };
type WorkspaceFormat = StudioKind | 'live';
type WorkspaceFilter = 'draft' | 'submitted';
type WorkspaceOrder = 'recent' | 'oldest';
type CreateRequest = { kind: StudioKind; source: 'camera' | 'gallery'; owner: string } | { kind: 'live'; source: 'live' | 'lives'; owner: string };
const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
const projectTitle = (project: StudioProject) => project.title.trim() || `${studioFormats.find(format => format.kind === project.kind)?.title} sem título`;
function projectDate(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Hoje';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? { year: '2-digit' as const } : {}) });
}

export default function StudioScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { canPublish } = usePrimaryAction();
  const isFocused = useIsFocused();
  const { projects, loading, error, create, remove, recover } = useStudioProjects();
  const [newProject, setNewProject] = useState(false);
  const [format, setFormat] = useState<WorkspaceFormat>('aula');
  const [selected, setSelected] = useState<StudioProject | null>(null);
  const [filter, setFilter] = useState<WorkspaceFilter>('draft');
  const [order, setOrder] = useState<WorkspaceOrder>('recent');
  const [sortVisible, setSortVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [launching, setLaunching] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const recoveringRef = useRef(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 3 : 2;
  const contentWidth = Math.min(1060, width - insets.left - insets.right);
  const columnWidth = Math.max(1, (contentWidth - 40 - (columns - 1) * 14) / columns);
  const mounted = useRef(true);
  const pending = useRef<CreateRequest | null>(null);
  const launchingRef = useRef(false);
  const context = useRef({ owner: user?.id, canPublish, focused: isFocused });
  context.current = { owner: user?.id, canPublish, focused: isFocused };
  const selectedId = selected?.ownerId === user?.id ? selected?.id : undefined;
  const selectedProject = selectedId ? projects.find(project => project.id === selectedId) || null : null;
  const counts = { draft: projects.filter(project => project.state !== 'submitted').length, submitted: projects.filter(project => project.state === 'submitted').length };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null; }; }, []);
  useEffect(() => {
    setNewProject(false); setSelected(null); setSortVisible(false); setSearchVisible(false); setQuery(''); setFilter('draft');
    pending.current = null;
    if (!launchingRef.current) setLaunching(false);
  }, [user?.id]);
  const open = (project: StudioProject) => {
    if (launchingRef.current || recoveringRef.current || project.ownerId !== context.current.owner) return;
    Keyboard.dismiss(); router.push({ pathname: '/studio/[id]', params: { id: project.id } });
  };
  const launchPending = useCallback(async () => {
    const request = pending.current;
    if (!request || launchingRef.current || recoveringRef.current) return;
    pending.current = null;
    if (!mounted.current || !context.current.focused || !context.current.canPublish || context.current.owner !== request.owner) { if (mounted.current) setLaunching(false); return; }
    if (request.kind === 'live') {
      setLaunching(false);
      router.push(request.source === 'live' ? '/studio/live/new' : '/studio/live');
      return;
    }
    launchingRef.current = true; setLaunching(true); Keyboard.dismiss();
    let created: StudioProject | null = null;
    let handedOff = false;
    try {
      created = await create(request.kind, { transient: true });
      if (context.current.owner !== request.owner || !context.current.canPublish) return;
      if (request.source === 'gallery') {
        await importStudioMedia(created);
        const imported = getStudioProject(request.owner, created.id);
        if (!imported || (!imported.takes.length && !imported.pendingTakes?.length)) return;
      }
      if (!mounted.current || !context.current.focused || context.current.owner !== request.owner || !context.current.canPublish) return;
      setFilter('draft'); setQuery(''); setSearchVisible(false);
      if (request.source === 'camera') router.push({ pathname: '/studio/capture', params: { id: created.id, from: 'projects' } });
      else router.push({ pathname: '/studio/[id]', params: { id: created.id } });
      handedOff = true;
    } catch (cause) {
      if (mounted.current && context.current.focused && context.current.owner === request.owner) {
        const latest = created ? getStudioProject(request.owner, created.id) : null;
        const hasMedia = latest && (latest.takes.length > 0 || !!latest.pendingTakes?.length);
        Alert.alert(hasMedia ? 'Seu projeto continua salvo' : 'Novo projeto', cause instanceof Error ? cause.message : 'Não foi possível começar o projeto. Tente novamente.');
        // A copied file may need recovery. Preserve the durable draft and open
        // its editor, while a cancelled or failed empty picker leaves no card.
        if (hasMedia && context.current.canPublish) {
          router.push({ pathname: '/studio/[id]', params: { id: latest.id } });
          handedOff = true;
        }
      }
    } finally {
      if (created && !handedOff) await discardTransient(request.owner, created.id).catch(() => undefined);
      launchingRef.current = false; if (mounted.current) setLaunching(false);
    }
  }, [create, router]);
  useEffect(() => { if (!newProject && Platform.OS !== 'ios') void launchPending(); }, [newProject, launchPending]);
  const startProject = (source: CreateRequest['source']) => {
    if (launchingRef.current || recoveringRef.current || pending.current || !user?.id || !canPublish) return;
    if (format === 'live') {
      if (source !== 'live' && source !== 'lives') return;
      pending.current = { kind: 'live', source, owner: user.id };
    } else {
      if (source !== 'camera' && source !== 'gallery') return;
      pending.current = { kind: format, source, owner: user.id };
    }
    setLaunching(true); setNewProject(false);
  };
  const deleteProject = (project: StudioProject) => {
    setSelected(null);
    Alert.alert('Excluir este projeto?', 'Este rascunho será removido da lista neste aparelho. Publicações já enviadas continuam na Classfy.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir projeto', style: 'destructive', onPress: () => {
        if (project.ownerId !== context.current.owner) return;
        setRemoving(true); void remove(project.id).catch(cause => {
          if (mounted.current && context.current.owner === project.ownerId) Alert.alert('Projeto preservado', cause instanceof Error ? cause.message : 'Não foi possível excluir o projeto. Tente novamente.');
        }).finally(() => { if (mounted.current) setRemoving(false); });
      } },
    ]);
  };
  const recoverDrafts = () => {
    const owner = context.current.owner;
    if (!owner || recoveringRef.current || launchingRef.current || !context.current.canPublish) return;
    Alert.alert('Recuperar rascunhos?', 'Vamos restaurar a lista a partir do último backup disponível neste aparelho. Edições posteriores podem não aparecer nessa lista. Os arquivos originais e uma cópia da lista atual serão preservados.', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Recuperar backup', onPress: () => {
        if (!mounted.current || context.current.owner !== owner || !context.current.canPublish || recoveringRef.current || launchingRef.current) return;
        recoveringRef.current = true; setRecovering(true);
        void recover().catch(cause => {
          if (mounted.current && context.current.owner === owner) Alert.alert('Arquivos preservados', cause instanceof Error ? cause.message : 'Não foi possível recuperar a lista. Seus originais continuam neste aparelho.');
        }).finally(() => { recoveringRef.current = false; if (mounted.current) setRecovering(false); });
      } },
    ]);
  };
  const filtered = useMemo(() => {
    const needle = normalizeSearch(query);
    return projects.filter(project => (filter === 'submitted' ? project.state === 'submitted' : project.state !== 'submitted') && (!needle || normalizeSearch([
      project.title, project.kind, project.objective, project.description, ...project.tags, ...project.takes.map(take => take.name),
    ].join(' ')).includes(needle))).sort((a, b) => {
      const difference = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
      return (order === 'recent' ? difference : -difference) || a.id.localeCompare(b.id);
    });
  }, [projects, filter, query, order]);
  // A regular gallery gives every format the same frame and keeps local search
  // and ordering readable from left to right, then top to bottom.
  const grid = useMemo(() => {
    const result: StudioProject[][] = [];
    for (let index = 0; index < filtered.length; index += columns) result.push(filtered.slice(index, index + columns));
    return result;
  }, [filtered, columns]);
  const renderProject = (project: StudioProject) => {
    const Icon = formatIcons[project.kind];
    const thumbnail = project.coverUri || project.coverUrl || project.takes.find(take => take.thumbnailUri)?.thumbnailUri;
    const pendingFiles = !!project.pendingTakes?.length;
    const state = pendingFiles ? 'Recuperar arquivos' : studioStateLabel[project.state];
    return <View key={project.id} style={[styles.project, { width: columnWidth }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${projectTitle(project)}, ${state}`} disabled={launching} onPress={() => open(project)} style={({ pressed }) => [pressed && { opacity: 0.72 }]}>
        <View style={styles.thumbnail}>
          <View style={styles.thumbnailPlaceholder}><Icon size={32} strokeWidth={1.2} color={colors.mutedDim} /></View>
          {thumbnail ? <LoadingImage source={{ uri: thumbnail }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : null}
          <View style={styles.formatBadge}><Icon size={10} color={colors.textSecondary} strokeWidth={1.6} /><Text style={styles.badgeText}>{studioFormats.find(item => item.kind === project.kind)?.title}</Text></View>
          {!!project.takes.length && <View style={styles.duration}><Text style={styles.badgeText}>{formatStudioDuration(studioSeconds(compileStudioRecipe(project).durationTicks))}</Text></View>}
        </View>
        <View style={styles.projectCopy}><Text style={styles.projectTitle} numberOfLines={2}>{projectTitle(project)}</Text>
          <View style={styles.projectState}><View style={[styles.dot, { backgroundColor: project.state === 'error' || pendingFiles ? colors.accent : project.state === 'submitted' ? colors.free : colors.mutedDim }]} /><Text style={styles.meta} numberOfLines={1}>{state}</Text></View>
          <Text style={styles.date}>{projectDate(project.updatedAt)}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Opções de ${projectTitle(project)}`} disabled={launching || removing} onPress={() => setSelected(project)} style={({ pressed }) => [styles.projectOptions, pressed && { opacity: 0.65 }]}><View style={styles.optionsCircle}><MoreHorizontal size={18} color={colors.text} strokeWidth={1.6} /></View></Pressable>
    </View>;
  };
  if (canPublish && !isStudioMediaAvailable()) return <AppScreen header={<NavigationHeader title="Studio" back />}>
    <Pressable accessibilityRole="button" accessibilityLabel="Minhas lives" onPress={() => router.push('/studio/live')} style={({ pressed }) => [styles.liveEntryFallback, pressed && { opacity: 0.7 }]}>
      <Radio size={24} color={colors.accent} strokeWidth={1.6} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.sourceTitle}>Lives</Text><Text style={studioStyles.hint}>Preparar e gerenciar transmissões</Text></View><ChevronRight size={18} color={colors.muted} />
    </Pressable><Text style={studioStyles.hint}>Atualize o aplicativo para gravar e editar projetos neste aparelho.</Text>
  </AppScreen>;
  return <StudioAccess><AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Studio" back right={<View style={{ flexDirection: 'row', gap: 2 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={searchVisible ? 'Fechar busca de projetos' : 'Buscar projetos'} disabled={launching} onPress={() => { if (searchVisible) { setQuery(''); Keyboard.dismiss(); } setSearchVisible(value => !value); }} style={({ pressed }) => [studioStyles.iconButton, pressed && { backgroundColor: colors.surface }]}>{searchVisible ? <X size={22} color={colors.text} strokeWidth={1.6} /> : <Search size={22} color={colors.text} strokeWidth={1.6} />}</Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Ordenar projetos" disabled={launching} onPress={() => { Keyboard.dismiss(); setSortVisible(true); }} style={({ pressed }) => [studioStyles.iconButton, pressed && { backgroundColor: colors.surface }]}><ArrowDownWideNarrow size={22} color={colors.text} strokeWidth={1.6} /></Pressable>
  </View>} />}>
    <View style={[styles.workspace, { maxWidth: 1060 }]}>
      {searchVisible ? <View style={styles.search}><Search size={17} color={colors.muted} strokeWidth={1.6} /><TextInput autoFocus accessibilityLabel="Buscar projetos" value={query} onChangeText={setQuery} placeholder="Buscar projetos" placeholderTextColor={colors.mutedDim} style={styles.searchInput} returnKeyType="search" autoCorrect={false} onSubmitEditing={Keyboard.dismiss} />{!!query && <Pressable accessibilityRole="button" accessibilityLabel="Limpar busca de projetos" onPress={() => setQuery('')} style={styles.clearSearch}><X size={17} color={colors.muted} /></Pressable>}</View> : null}
      <View style={styles.toolbar}><View style={styles.filters}>{([
        ['draft', 'Rascunhos'], ['submitted', 'Enviados'],
      ] as const).map(([key, title]) => <Pressable accessibilityRole="tab" accessibilityLabel={`${title}, ${counts[key]} projetos`} accessibilityState={{ selected: filter === key }} key={key} onPress={() => setFilter(key)} style={({ pressed }) => [styles.filter, filter === key && styles.filterSelected, pressed && { opacity: 0.75 }]}><Text style={[styles.filterLabel, filter === key && { color: colors.text }]}>{title}</Text>{counts[key] > 0 ? <Text style={[styles.filterCount, filter === key && { color: colors.textSecondary }]}>{counts[key]}</Text> : null}</Pressable>)}</View>
        <Pressable accessibilityRole="button" accessibilityLabel="Minhas lives" disabled={launching || recovering} onPress={() => router.push('/studio/live')} style={({ pressed }) => [styles.liveEntry, pressed && { opacity: 0.7 }]}><Radio size={16} color={colors.accent} strokeWidth={1.65} /><Text style={styles.filterLabel}>Lives</Text><ChevronRight size={13} color={colors.muted} /></Pressable>
      </View>
      <View style={styles.gridCaption}><Text style={styles.caption}>{filtered.length} {filtered.length === 1 ? 'projeto' : 'projetos'}</Text><Text style={styles.caption}>{order === 'recent' ? 'Mais recentes' : 'Mais antigos'}</Text></View>
      {error ? <View style={styles.error}><Text style={[studioStyles.hint, { color: colors.textSecondary }]}>{error}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Recuperar rascunhos do backup" accessibilityState={{ disabled: recovering || launching, busy: recovering }} disabled={recovering || launching} onPress={recoverDrafts} style={({ pressed }) => [styles.recoverButton, pressed && { opacity: 0.7 }]}>
          {recovering ? <ActivityIndicator size="small" color={colors.text} /> : null}<Text style={styles.recoverLabel}>{recovering ? 'Recuperando…' : 'Recuperar rascunhos'}</Text>
        </Pressable>
      </View> : null}
      {launching ? <View style={styles.activity}><ActivityIndicator size="small" color={colors.textSecondary} /><Text style={studioStyles.hint}>Preparando seu projeto…</Text></View> : null}
      {loading ? <SkeletonGroup label="Abrindo seus projetos" style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingTop: 8 }}>
        {Array.from({ length: columns }, (_, column) => <View key={column} style={{ flex: 1, gap: 14 }}><SkeletonBlock style={{ aspectRatio: 4 / 5, borderRadius: 13 }} /><SkeletonBlock style={{ width: '85%', height: 14 }} /><SkeletonBlock style={{ width: '55%', height: 10 }} /><SkeletonBlock style={{ aspectRatio: 4 / 5, borderRadius: 13, marginTop: 8 }} /></View>)}
      </SkeletonGroup> : filtered.length ? <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 108 }}>
        <View style={styles.grid}>{grid.map((row, index) => <View key={index} style={styles.row}>{row.map(renderProject)}</View>)}</View>
      </ScrollView> : <View style={styles.empty}><View style={styles.emptyIcon}>{query ? <Search size={29} color={colors.mutedDim} strokeWidth={1.35} /> : filter === 'submitted' ? <Check size={29} color={colors.mutedDim} strokeWidth={1.35} /> : <Video size={29} color={colors.mutedDim} strokeWidth={1.35} />}</View><Text style={styles.emptyTitle}>{query ? 'Nenhum projeto encontrado' : filter === 'submitted' ? 'Nenhum projeto enviado' : 'Seu próximo projeto'}</Text><Text style={styles.emptyText}>{query ? 'Tente outro título ou tema.' : filter === 'submitted' ? 'Seus projetos enviados à curadoria aparecem aqui.' : 'Toque no + para gravar ou importar.'}</Text></View>}
      <Pressable accessibilityRole="button" accessibilityLabel="Novo projeto" accessibilityState={{ disabled: loading || launching || recovering || !!error, busy: launching }} disabled={loading || launching || recovering || !!error} onPress={() => { Keyboard.dismiss(); setNewProject(true); }} style={({ pressed }) => [styles.fab, { bottom: Math.max(insets.bottom, 16) + 16, right: 20 }, (loading || launching || recovering || !!error) && { opacity: 0.55 }, pressed && { backgroundColor: colors.accentPressed }]}>{launching ? <ActivityIndicator color={colors.text} /> : <Plus size={29} color={colors.text} strokeWidth={1.6} />}</Pressable>
    </View>
    <WorkspaceSheet visible={newProject} title="Novo projeto" onClose={() => setNewProject(false)} onDismiss={() => { void launchPending(); }}>
      <View style={{ gap: 22 }}><View style={styles.formats}>{[...studioFormats, { kind: 'live' as const, title: 'Live' }].map(item => { const Icon = formatIcons[item.kind]; return <Pressable accessibilityRole="radio" accessibilityLabel={`Formato ${item.title}`} accessibilityState={{ selected: format === item.kind }} key={item.kind} onPress={() => setFormat(item.kind)} style={({ pressed }) => [styles.format, format === item.kind && styles.formatSelected, pressed && { opacity: 0.75 }]}><Icon size={21} color={format === item.kind ? colors.text : colors.muted} strokeWidth={1.55} /><Text style={[styles.formatTitle, format === item.kind && { color: colors.text }]}>{item.title}</Text></Pressable>; })}</View>
        {format === 'live' ? <View style={styles.sources}>
          <Pressable accessibilityRole="button" accessibilityLabel="Preparar live" onPress={() => startProject('live')} style={({ pressed }) => [styles.source, pressed && { backgroundColor: colors.surfaceAlt }]}><Radio size={28} color={colors.accent} strokeWidth={1.4} /><Text style={styles.sourceTitle}>Preparar live</Text><Text style={styles.sourceDetail}>Título, capa e prévia privada</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Ver minhas lives" onPress={() => startProject('lives')} style={({ pressed }) => [styles.source, pressed && { backgroundColor: colors.surfaceAlt }]}><Clock3 size={28} color={colors.text} strokeWidth={1.4} /><Text style={styles.sourceTitle}>Minhas lives</Text><Text style={styles.sourceDetail}>Retomar e ver gravações</Text></Pressable>
        </View> : <View style={styles.sources}><Pressable accessibilityRole="button" accessibilityLabel={format === 'podcast' ? 'Gravar podcast' : 'Gravar com a câmera'} onPress={() => startProject('camera')} style={({ pressed }) => [styles.source, pressed && { backgroundColor: colors.surfaceAlt }]}>{format === 'podcast' ? <Mic size={28} color={colors.text} strokeWidth={1.4} /> : <Camera size={28} color={colors.text} strokeWidth={1.4} />}<Text style={styles.sourceTitle}>{format === 'podcast' ? 'Gravar áudio' : 'Câmera'}</Text><Text style={styles.sourceDetail}>{format === 'podcast' ? 'Começar uma gravação' : 'Gravar um novo take'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={format === 'podcast' ? 'Importar arquivo de áudio' : 'Importar vídeos da galeria'} onPress={() => startProject('gallery')} style={({ pressed }) => [styles.source, pressed && { backgroundColor: colors.surfaceAlt }]}>{format === 'podcast' ? <FolderOpen size={28} color={colors.text} strokeWidth={1.4} /> : <Images size={28} color={colors.text} strokeWidth={1.4} />}<Text style={styles.sourceTitle}>{format === 'podcast' ? 'Arquivos' : 'Galeria'}</Text><Text style={styles.sourceDetail}>{format === 'podcast' ? 'Trazer seu áudio' : 'Trazer vídeos prontos'}</Text></Pressable></View>}
      </View>
    </WorkspaceSheet>
    <WorkspaceSheet visible={sortVisible} title="Ordenar projetos" onClose={() => setSortVisible(false)}>{([
      ['recent', 'Mais recentes', 'Últimos projetos editados primeiro'], ['oldest', 'Mais antigos', 'Primeiros projetos editados primeiro'],
    ] as const).map(([key, title, detail]) => <Pressable accessibilityRole="radio" accessibilityLabel={title} accessibilityState={{ selected: order === key }} key={key} onPress={() => { setOrder(key); setSortVisible(false); }} style={({ pressed }) => [styles.sortOption, pressed && { backgroundColor: colors.surface }]}><Clock3 size={21} color={colors.muted} strokeWidth={1.5} /><View style={{ flex: 1, gap: 5 }}><Text style={styles.sourceTitle}>{title}</Text><Text style={studioStyles.hint}>{detail}</Text></View>{order === key ? <Check size={20} color={colors.text} strokeWidth={1.6} /> : null}</Pressable>)}</WorkspaceSheet>
    <WorkspaceSheet visible={!!selectedProject} title={selectedProject ? projectTitle(selectedProject) : 'Seu projeto'} onClose={() => setSelected(null)}>
      <Pressable accessibilityRole="button" accessibilityLabel="Abrir projeto" onPress={() => { if (selectedProject) open(selectedProject); setSelected(null); }} style={({ pressed }) => [styles.sortOption, pressed && { backgroundColor: colors.surface }]}><ArrowUpRight size={21} color={colors.text} strokeWidth={1.5} /><Text style={[styles.sourceTitle, { flex: 1 }]}>Abrir projeto</Text><ChevronRight size={18} color={colors.mutedDim} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Excluir projeto" onPress={() => { if (selectedProject) deleteProject(selectedProject); }} style={({ pressed }) => [styles.sortOption, pressed && { backgroundColor: colors.surface }]}><Trash2 size={21} color={colors.accent} strokeWidth={1.5} /><Text style={[styles.sourceTitle, { color: colors.accent }]}>Excluir projeto</Text></Pressable>
    </WorkspaceSheet>
  </AppScreen></StudioAccess>;
}

function WorkspaceSheet({ visible, title, onClose, onDismiss, children }: PropsWithChildren<{ visible: boolean; title: string; onClose: () => void; onDismiss?: () => void }>) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const maxHeight = Math.max(1, height - insets.top - 16);
  const innerStyle = { width: '100%' as const, maxWidth: width > height ? Math.max(1, Math.min(width - insets.left - insets.right, maxHeight * 16 / 9)) : undefined, alignSelf: 'center' as const };
  return <SheetModal visible={visible} onRequestClose={onClose} onDismiss={onDismiss}><View style={[sheetStyles.backdrop, { paddingTop: insets.top + 16 }]}><Pressable accessibilityRole="button" accessibilityLabel="Fechar painel" style={{ flex: 1 }} onPress={onClose} />
    <View style={[sheetStyles.surface, { maxHeight, paddingBottom: Math.max(insets.bottom, 16) }]}><View style={sheetStyles.handle} /><View style={[sheetStyles.header, innerStyle, { flexShrink: 0 }]}><Text style={[studioStyles.sectionTitle, { flex: 1 }]} numberOfLines={1}>{title}</Text><SheetCloseButton onPress={onClose} /></View>
      <ScrollView keyboardShouldPersistTaps="handled" style={[innerStyle, { flexShrink: 1, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>{children}</ScrollView>
    </View>
  </View></SheetModal>;
}

const styles = StyleSheet.create({
  workspace: { flex: 1, width: '100%', alignSelf: 'center' },
  toolbar: { paddingHorizontal: 20, paddingTop: 7, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  liveEntry: { minHeight: 44, flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 5 },
  liveEntryFallback: { minHeight: 100, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: controls.buttonRadius, marginBottom: 16 },
  filters: { flexDirection: 'row', padding: 3, borderRadius: controls.buttonRadius, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderSubtle },
  filter: { minHeight: 38, borderRadius: 9, paddingHorizontal: 13, flexDirection: 'row', gap: 7, justifyContent: 'center', alignItems: 'center' },
  filterSelected: { backgroundColor: colors.surfaceAlt },
  filterLabel: { color: colors.muted, fontSize: 12, fontWeight: '500' },
  filterCount: { color: colors.mutedDim, fontSize: 10, fontVariant: ['tabular-nums'] },
  gridCaption: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 5, paddingBottom: 9 },
  caption: { color: colors.mutedDim, fontSize: 11 },
  grid: { gap: 24 },
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  project: { position: 'relative' },
  thumbnail: { width: '100%', aspectRatio: 4 / 5, borderRadius: 13, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle },
  thumbnailPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  formatBadge: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 6, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 5, backgroundColor: 'rgba(0,0,0,0.68)' },
  badgeText: { color: colors.textSecondary, fontSize: 9, fontWeight: '500', fontVariant: ['tabular-nums'] },
  duration: { position: 'absolute', bottom: 8, right: 8, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.75)' },
  projectCopy: { paddingTop: 10, gap: 6 },
  projectTitle: { color: colors.text, fontSize: 14, lineHeight: 19, height: 38, fontWeight: '500' },
  projectState: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  meta: { color: colors.muted, fontSize: 10, flex: 1 },
  date: { color: colors.mutedDim, fontSize: 10 },
  projectOptions: { position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  optionsCircle: { width: 25, height: 25, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5 },
  search: { marginHorizontal: 20, marginTop: 8, marginBottom: 8, minHeight: 46, paddingLeft: 13, paddingRight: 5, borderRadius: controls.buttonRadius, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 14, color: colors.text, paddingVertical: 10 },
  clearSearch: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, paddingBottom: 110 },
  emptyIcon: { width: 68, height: 68, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { color: colors.textSecondary, fontSize: 18, fontWeight: '500', letterSpacing: -0.3, textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 250 },
  error: { margin: 20, marginTop: 6, padding: 13, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(225,29,72,0.25)' },
  recoverButton: { minHeight: 42, marginTop: 8, borderRadius: controls.buttonRadius, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surfaceAlt },
  recoverLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  activity: { marginHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  formats: { flexDirection: 'row', gap: 8 },
  format: { flex: 1, minHeight: 76, justifyContent: 'center', alignItems: 'center', gap: 8, borderRadius: controls.buttonRadius, backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.border },
  formatSelected: { backgroundColor: colors.surface, borderColor: colors.textSecondary },
  formatTitle: { color: colors.muted, fontSize: 12, fontWeight: '500' },
  sources: { flexDirection: 'row', gap: 12 },
  source: { flex: 1, minHeight: 128, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 12, borderRadius: 14, backgroundColor: colors.surface },
  sourceTitle: { color: colors.text, fontSize: 14, fontWeight: '500' },
  sourceDetail: { color: colors.muted, fontSize: 10, textAlign: 'center', lineHeight: 15 },
  sortOption: { minHeight: 76, borderRadius: controls.buttonRadius, paddingHorizontal: 10, gap: 14, flexDirection: 'row', alignItems: 'center' },
});
