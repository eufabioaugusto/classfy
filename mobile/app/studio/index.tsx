import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUpRight, ChevronRight, Film, Mic, MoreHorizontal, Plus, Video } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingImage } from '@/components/LoadingImage';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { colors } from '@/theme/colors';
import { useStudioProjects } from '@/features/studio/useStudioProjects';
import { formatStudioDuration, studioFormats, studioStateLabel, timelineDuration, type StudioKind, type StudioProject } from '@/features/studio/model';
import { StudioAccess, StudioButton, StudioLoading, studioStyles } from '@/features/studio/StudioUI';

const formatIcons = { aula: Video, short: Film, podcast: Mic };

export default function StudioScreen() {
  const router = useRouter();
  const { projects, loading, error, create, remove } = useStudioProjects();
  const [creating, setCreating] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const [selected, setSelected] = useState<StudioProject | null>(null);
  const [removing, setRemoving] = useState(false);
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const maxSheetHeight = Math.max(1, height - insets.top - 16);
  const sheetContentWidth = width > height ? Math.max(1, Math.min(width - insets.left - insets.right, maxSheetHeight * 16 / 9)) : undefined;
  const sheetContentStyle = { width: '100%' as const, maxWidth: sheetContentWidth, alignSelf: 'center' as const };
  const open = (project: StudioProject) => router.push({ pathname: '/studio/[id]', params: { id: project.id } });
  const createProject = async (kind: StudioKind) => {
    if (creating) return;
    setCreating(true);
    try { const project = await create(kind); setNewProject(false); open(project); }
    catch { Alert.alert('Seu Studio', 'Não foi possível criar o projeto. Tente novamente.'); }
    finally { setCreating(false); }
  };
  const deleteProject = (project: StudioProject) => {
    setSelected(null);
    Alert.alert('Excluir este projeto?', 'Este rascunho será removido da lista de projetos neste aparelho. Publicações já enviadas continuam na Classfy.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir projeto', style: 'destructive', onPress: () => {
        setRemoving(true); void remove(project.id).catch(() => Alert.alert('Projeto preservado', 'Não foi possível excluir o projeto. Tente novamente.')).finally(() => setRemoving(false));
      } },
    ]);
  };
  const unfinished = projects.filter(project => project.state !== 'submitted');
  const submitted = projects.filter(project => project.state === 'submitted');
  const renderProject = (project: StudioProject) => {
    const Icon = formatIcons[project.kind];
    const thumbnail = project.coverUri || project.coverUrl || project.takes.find(take => take.thumbnailUri)?.thumbnailUri;
    return <View key={project.id} style={styles.project}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${project.title || 'Projeto sem título'}, ${studioStateLabel[project.state]}`}
        onPress={() => open(project)} style={({ pressed }) => [styles.projectContent, pressed && { opacity: 0.7 }]}>
        <View style={styles.thumbnail}>{thumbnail ? <LoadingImage source={{ uri: thumbnail }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : <Icon size={26} strokeWidth={1.4} color={colors.muted} />}
          {!!project.takes.length && <Text style={styles.duration}>{formatStudioDuration(timelineDuration(project.takes))}</Text>}
        </View>
        <View style={{ flex: 1, gap: 6 }}><Text style={styles.projectTitle} numberOfLines={2}>{project.title || 'Projeto sem título'}</Text>
          <Text style={styles.projectMeta}>{studioFormats.find(format => format.kind === project.kind)?.title} · {project.takes.length} {project.takes.length === 1 ? 'take' : 'takes'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={[styles.dot, { backgroundColor: project.state === 'error' ? colors.accent : project.state === 'submitted' ? colors.free : colors.mutedDim }]} />
            <Text style={styles.projectMeta}>{studioStateLabel[project.state]}</Text>
          </View>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Opções de ${project.title || 'projeto'}`} disabled={removing} onPress={() => setSelected(project)} style={studioStyles.iconButton}>
        <MoreHorizontal size={22} color={colors.muted} strokeWidth={1.6} />
      </Pressable>
    </View>;
  };
  return <StudioAccess><AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Studio" back right={<Pressable accessibilityRole="button" accessibilityLabel="Novo projeto" onPress={() => setNewProject(true)} style={studioStyles.iconButton}><Plus color={colors.text} size={24} strokeWidth={1.6} /></Pressable>} />}>
    {loading ? <StudioLoading /> : <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 20) + 24, gap: 30 }}>
      <View style={styles.intro}>
        <Text style={studioStyles.eyebrow}>SEU ESPAÇO DE CRIAÇÃO</Text>
        <Text style={styles.headline}>Conhecimento que{ '\n' }ganha forma.</Text>
        <Text style={[studioStyles.body, { maxWidth: 330 }]}>Prepare sua aula, grave no seu ritmo e construa uma publicação com a sua assinatura.</Text>
        <StudioButton label="Novo projeto" icon={<Plus size={20} strokeWidth={1.8} color={colors.text} />} onPress={() => setNewProject(true)} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
      </View>
      {error ? <View style={studioStyles.card}><Text style={[studioStyles.body, { color: colors.accent }]}>{error}</Text></View> : null}
      {projects.length ? <>
        {!!unfinished.length && <View style={{ gap: 16 }}><View style={styles.sectionHeader}><Text style={studioStyles.sectionTitle}>Seus projetos</Text><Text style={studioStyles.hint}>{unfinished.length} {unfinished.length === 1 ? 'projeto' : 'projetos'}</Text></View>{unfinished.map(renderProject)}</View>}
        {!!submitted.length && <View style={{ gap: 16 }}><Text style={studioStyles.sectionTitle}>Enviados para curadoria</Text>{submitted.map(renderProject)}</View>}
      </> : <View style={[studioStyles.card, { padding: 24, gap: 24 }]}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}><View style={styles.emptyIcon}><Video size={28} strokeWidth={1.4} color={colors.text} /></View><View style={{ flex: 1, gap: 5 }}><Text style={styles.projectTitle}>Do primeiro take à publicação</Text><Text style={studioStyles.hint}>Tudo começa com uma ideia.</Text></View></View>
        {[
          ['01', 'Prepare', 'Defina a transformação que você quer ensinar.'],
          ['02', 'Produza', 'Grave takes ou traga um conteúdo que você já tem.'],
          ['03', 'Refine', 'Ajuste os cortes, revise e envie para curadoria.'],
        ].map(([number, title, detail]) => <View key={number} style={{ flexDirection: 'row', gap: 14 }}><Text style={styles.stepNumber}>{number}</Text><View style={{ flex: 1, gap: 4 }}><Text style={styles.stepTitle}>{title}</Text><Text style={studioStyles.hint}>{detail}</Text></View></View>)}
      </View>}
      <Text style={[studioStyles.hint, { fontSize: 11 }]}>Seus rascunhos ficam neste aparelho. Ao preparar o envio, o projeto também é sincronizado com a Classfy.</Text>
    </ScrollView>}
    <SheetModal visible={newProject} onRequestClose={() => { if (!creating) setNewProject(false); }}>
      <View style={[sheetStyles.backdrop, { paddingTop: insets.top + 16 }]}><Pressable accessibilityLabel="Fechar novo projeto" style={{ flex: 1 }} onPress={() => { if (!creating) setNewProject(false); }} />
        <View style={[sheetStyles.surface, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: maxSheetHeight }]}><View style={sheetStyles.handle} />
          <View style={[sheetStyles.header, sheetContentStyle, { flexShrink: 0 }]}><View style={{ flex: 1, gap: 5 }}><Text style={studioStyles.sectionTitle}>O que vamos criar?</Text><Text style={studioStyles.hint}>Escolha o formato do seu projeto.</Text></View><SheetCloseButton onPress={() => { if (!creating) setNewProject(false); }} /></View>
          <ScrollView style={[sheetContentStyle, { flexShrink: 1, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
            {studioFormats.map(format => { const Icon = formatIcons[format.kind]; return <Pressable accessibilityRole="button" accessibilityLabel={`Criar ${format.title}`} key={format.kind} disabled={creating} onPress={() => { void createProject(format.kind); }} style={({ pressed }) => [styles.formatOption, pressed && { backgroundColor: colors.surface }]}>
              <View style={styles.formatIcon}><Icon color={colors.text} size={24} strokeWidth={1.6} /></View><View style={{ flex: 1, gap: 5 }}><Text style={styles.stepTitle}>{format.title}</Text><Text style={studioStyles.hint}>{format.detail}</Text></View><Text style={styles.ratio}>{format.ratio}</Text><ChevronRight color={colors.mutedDim} size={17} />
            </Pressable>; })}
            {creating ? <Text style={[studioStyles.hint, { textAlign: 'center', paddingTop: 12 }]}>Criando seu projeto…</Text> : null}
          </ScrollView>
        </View>
      </View>
    </SheetModal>
    <SheetModal visible={!!selected} onRequestClose={() => setSelected(null)}>
      <View style={[sheetStyles.backdrop, { paddingTop: insets.top + 16 }]}><Pressable accessibilityLabel="Fechar opções" style={{ flex: 1 }} onPress={() => setSelected(null)} />
        <View style={[sheetStyles.surface, { paddingBottom: Math.max(insets.bottom, 16), maxHeight: maxSheetHeight }]}><View style={sheetStyles.handle} /><View style={[sheetStyles.header, sheetContentStyle, { flexShrink: 0 }]}><Text style={[studioStyles.sectionTitle, { flex: 1 }]} numberOfLines={1}>{selected?.title || 'Seu projeto'}</Text><SheetCloseButton onPress={() => setSelected(null)} /></View>
          <ScrollView style={[sheetContentStyle, { flexShrink: 1, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 10 }} showsVerticalScrollIndicator={false}><StudioButton secondary label="Abrir projeto" icon={<ArrowUpRight size={18} color={colors.text} />} onPress={() => { if (selected) open(selected); setSelected(null); }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Excluir projeto" onPress={() => { if (selected) deleteProject(selected); }} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.accent, fontSize: 14, fontWeight: '500' }}>Excluir projeto</Text></Pressable>
          </ScrollView>
        </View>
      </View>
    </SheetModal>
  </AppScreen></StudioAccess>;
}

const styles = StyleSheet.create({
  intro: { gap: 14, paddingTop: 12 },
  headline: { fontSize: 33, lineHeight: 38, fontWeight: '600', letterSpacing: -1.25, color: colors.text },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  project: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  projectContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 92 },
  thumbnail: { width: 108, height: 82, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  duration: { position: 'absolute', bottom: 6, right: 6, fontSize: 10, color: colors.text, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 4 },
  projectTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  projectMeta: { color: colors.muted, fontSize: 11 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  emptyIcon: { width: 54, height: 54, borderRadius: 15, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  stepNumber: { color: colors.mutedDim, fontSize: 11, paddingTop: 4, width: 22, fontVariant: ['tabular-nums'] },
  stepTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  formatOption: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, paddingHorizontal: 8 },
  formatIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  ratio: { color: colors.mutedDim, fontSize: 11 },
});
