import { useCallback, useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Cloud, LockKeyhole } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { SkeletonBlock, SkeletonGroup } from '@/components/LoadingPlaceholder';
import { useAuth } from '@/features/auth/authContext';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';
import type { StudioProject } from './model';
import { isStudioMediaAvailable } from '../../../modules/classfy-studio-media';

export function StudioButton({ label, onPress, icon, secondary = false, loading = false, disabled = false, style }: {
  label: string; onPress: () => void; icon?: ReactNode; secondary?: boolean; loading?: boolean; disabled?: boolean; style?: ViewStyle;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || loading, busy: loading }}
    disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [studioStyles.button,
      secondary ? studioStyles.secondaryButton : studioStyles.primaryButton, style,
      (disabled || loading) && { opacity: 0.45 }, pressed && { opacity: 0.75 }]}>
    {loading ? <ActivityIndicator color={colors.text} size="small" /> : icon}
    <Text style={studioStyles.buttonText}>{label}</Text>
  </Pressable>;
}

export function StudioField({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={{ gap: 8 }}>
    <Text style={studioStyles.fieldLabel}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={colors.mutedDim}
      style={[studioStyles.input, props.multiline && { minHeight: 100, textAlignVertical: 'top' }, props.style]} />
    {hint ? <Text style={studioStyles.hint}>{hint}</Text> : null}
  </View>;
}

export function StudioSection({ title, detail, right, children }: PropsWithChildren<{ title: string; detail?: string; right?: ReactNode }>) {
  return <View style={{ gap: 16 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 5 }}><Text style={studioStyles.sectionTitle}>{title}</Text>
        {detail ? <Text style={studioStyles.hint}>{detail}</Text> : null}</View>{right}
    </View>{children}
  </View>;
}

export function StudioFooter({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return <View style={[studioStyles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>{children}</View>;
}

export function StudioLoading() {
  return <SkeletonGroup label="Abrindo seus projetos" style={{ padding: 20, gap: 20 }}>
    <SkeletonBlock style={{ width: '75%', height: 32 }} /><SkeletonBlock style={{ width: '55%', height: 14 }} />
    <SkeletonBlock style={{ aspectRatio: 16 / 9, borderRadius: 16 }} />
    <SkeletonBlock style={{ height: 20, width: '65%' }} /><SkeletonBlock style={{ height: 100, borderRadius: 16 }} />
  </SkeletonGroup>;
}

export function StudioAccess({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const { canPublish, roleLoading } = usePrimaryAction();
  const router = useRouter();
  if (roleLoading) return <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Studio" back />}><StudioLoading /></AppScreen>;
  if (canPublish && isStudioMediaAvailable()) return <>{children}</>;
  if (canPublish) return <AppScreen header={<NavigationHeader title="Studio" back />}>
    <View style={[studioStyles.empty, { marginTop: 48 }]}><Text style={studioStyles.sectionTitle}>{Platform.OS === 'android' ? 'O Studio está chegando ao Android' : 'Seu Studio precisa da versão atual'}</Text>
      <Text style={[studioStyles.body, { textAlign: 'center' }]}>{Platform.OS === 'android' ? 'A primeira versão de gravação e edição está disponível no iPhone. Estamos preparando essa experiência para o seu aparelho.' : 'Atualize o aplicativo para abrir seus projetos e usar a gravação e a edição de takes.'}</Text>
    </View>
  </AppScreen>;
  return <AppScreen header={<NavigationHeader title="Studio" back />}>
    <View style={[studioStyles.empty, { marginTop: 48 }]}><LockKeyhole color={colors.muted} size={32} strokeWidth={1.5} />
      <Text style={studioStyles.sectionTitle}>{user ? 'Um espaço para creators' : 'Seu conhecimento merece um Studio'}</Text>
      <Text style={[studioStyles.body, { textAlign: 'center' }]}>{user ? 'O Studio está disponível para contas com acesso de creator.' : 'Entre na sua conta de creator para gravar, editar e organizar suas publicações.'}</Text>
      {!user ? <StudioButton label="Entrar na Classfy" onPress={() => router.push('/auth/sign-in')} /> : null}
    </View>
  </AppScreen>;
}

type EditableField = 'title' | 'description' | 'objective' | 'audience' | 'script' | 'price' | 'tags';
type Fields = Pick<StudioProject, Exclude<EditableField, 'tags'>> & { tags: string };
const fieldsFrom = (project: StudioProject): Fields => ({ title: project.title, description: project.description, objective: project.objective, audience: project.audience, script: project.script, price: project.price, tags: project.tags.join(', ') });
function projectPatch(fields: Partial<Fields>): Partial<StudioProject> {
  const { tags, ...text } = fields;
  return tags === undefined ? text : { ...text, tags: [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 20) };
}

// Text remains responsive while writes are serialized. A failed save keeps its
// pending patch so retry/navigation cannot silently drop the creator's work.
export function useStudioFields(project: StudioProject, update: (id: string, patch: Partial<StudioProject>) => Promise<StudioProject>) {
  const [fields, setFields] = useState<Fields>(() => fieldsFrom(project));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const navigation = useNavigation();
  const leaving = useRef(false);
  const patch = useRef<Partial<Fields>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Promise<StudioProject> | null>(null);
  const projectRef = useRef(project); projectRef.current = project;
  const mounted = useRef(true);
  const updateRef = useRef(update); updateRef.current = update;
  const flush = useCallback(async (): Promise<StudioProject> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    for (;;) {
      // Another flush can drain a newer patch while this caller waits. Recheck
      // the active write before allowing navigation, rather than returning the
      // older saved snapshot while that newer text is still in flight.
      while (pending.current) await pending.current;
      const next = patch.current;
      if (!Object.keys(next).length) return projectRef.current;
      patch.current = {};
      if (mounted.current) { setSaving(true); setSaveError(null); }
      const work = updateRef.current(projectRef.current.id, projectPatch(next));
      pending.current = work;
      let failed = false;
      try { projectRef.current = await work; }
      catch (error) { failed = true; patch.current = { ...next, ...patch.current }; if (mounted.current) setSaveError('Não foi possível salvar. Toque para tentar novamente.'); throw error; }
      finally { pending.current = null; if (mounted.current) setSaving(!failed && Object.keys(patch.current).length > 0); }
    }
  }, []);
  usePreventRemove(saving || !!saveError || Object.keys(patch.current).length > 0, ({ data }) => {
    if (leaving.current) return;
    leaving.current = true;
    void flush().then(() => {
      if (mounted.current) navigation.dispatch(data.action);
    }).catch(() => {
      // The screen and pending text remain available. The existing save-status
      // action retries without introducing a routine navigation confirmation.
    }).finally(() => { leaving.current = false; });
  });
  const setField = (name: EditableField, value: string) => {
    setFields(previous => ({ ...previous, [name]: value }));
    setSaving(true);
    patch.current[name] = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 500);
  };
  useEffect(() => {
    setFields(previous => {
      const latest = fieldsFrom(project);
      for (const key of Object.keys(latest) as EditableField[]) if (key in patch.current || pending.current) latest[key] = previous[key];
      return latest;
    });
  }, [project]);
  useEffect(() => {
    mounted.current = true;
    const appState = AppState.addEventListener('change', state => { if (state !== 'active') void flush().catch(() => {}); });
    return () => { appState.remove(); mounted.current = false; void flush().catch(() => {}); };
  }, [flush]);
  return { fields, setField, flush, saving, saveError };
}

export function StudioSaveStatus({ saving, error, onRetry, remote = false }: { saving?: boolean; error?: string | null; onRetry?: () => void; remote?: boolean }) {
  return <Pressable disabled={!error || !onRetry} onPress={onRetry} accessibilityRole={error ? 'button' : undefined}
    accessibilityLabel={error || (saving ? 'Salvando projeto' : remote ? 'Rascunho sincronizado' : 'Salvo neste aparelho')}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    {saving ? <ActivityIndicator size={10} color={colors.muted} /> : remote ? <Cloud size={12} color={colors.muted} /> : <Check size={12} color={error ? colors.accent : colors.muted} />}
    <Text style={{ color: error ? colors.accent : colors.muted, fontSize: 11 }}>{error ? 'Falha ao salvar · tentar novamente' : saving ? 'Salvando…' : remote ? 'Rascunho sincronizado' : 'Salvo neste aparelho'}</Text>
  </Pressable>;
}

export const studioStyles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: controls.buttonRadius, paddingHorizontal: 18, gap: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: colors.accent },
  secondaryButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.borderSubtle, backgroundColor: colors.backgroundElevated, gap: 10 },
  sectionTitle: { color: colors.text, fontWeight: '600', fontSize: 20, letterSpacing: -0.5 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  fieldLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  input: { backgroundColor: colors.surface, borderRadius: controls.buttonRadius, borderWidth: 1, borderColor: colors.border, minHeight: 48, paddingHorizontal: 14, paddingVertical: 13, color: colors.text, fontSize: 15, lineHeight: 22 },
  empty: { padding: 24, alignItems: 'center', gap: 16 },
  card: { padding: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.backgroundElevated },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: colors.muted, fontSize: 10, letterSpacing: 1.8, fontWeight: '600', textTransform: 'uppercase' },
});
