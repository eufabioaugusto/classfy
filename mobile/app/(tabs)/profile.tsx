import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppScreen } from '@/components/AppScreen';
import { ContinueWatching } from '@/components/ContinueWatching';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
const library: { title: string; description: string; icon: Icon; route: Href }[] = [
  { title: 'Histórico', description: 'Volte ao que você assistiu', icon: 'time-outline', route: '/library/history' },
  { title: 'Salvos', description: 'Seu próximo aprendizado', icon: 'bookmark-outline', route: '/library/saved' },
  { title: 'Favoritos', description: 'Conteúdos que ficaram com você', icon: 'heart-outline', route: '/library/favorites' },
];

export default function YouScreen() {
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const open = (route: Href) => router.push(user ? route : '/auth/sign-in');
  const row = (label: string, icon: Icon, route: Href) => <Pressable key={label} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => open(route)}><Ionicons name={icon} size={21} color={colors.textSecondary} /><Text style={styles.rowLabel}>{label}</Text><Ionicons name="chevron-forward" size={17} color={colors.mutedDim} /></Pressable>;
  return (
    <AppScreen edgeToEdge>
      <View style={styles.header}><Text style={styles.title}>Você</Text><Pressable accessibilityRole="button" accessibilityLabel="Configurações" onPress={() => open('/settings')} style={styles.iconButton}><Ionicons name="settings-outline" size={23} color={colors.text} /></Pressable></View>
      <View style={styles.account}>
        <View style={styles.avatar}>{profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={StyleSheet.absoluteFill} /> : <Ionicons name="person-outline" size={28} color={colors.muted} />}</View>
        <View style={styles.accountCopy}><Text style={styles.name} numberOfLines={1}>{profile?.display_name || (user ? 'Sua conta' : 'Sua Classfy, do seu jeito')}</Text><Text style={styles.accountText}>{user ? 'Seus estudos e conteúdos em um só lugar.' : 'Entre para continuar de onde parou.'}</Text></View>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push(user ? '/edit-profile' : '/auth/sign-in')} style={styles.accountButton}><Text style={styles.accountButtonText}>{user ? 'Editar perfil' : 'Entrar na Classfy'}</Text></Pressable>
      <View style={styles.library}>{library.map((item) => <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.description}`} onPress={() => open(item.route)} style={({ pressed }) => [styles.libraryCard, pressed && styles.pressed]}><Ionicons name={item.icon} size={25} color={colors.text} /><Text style={styles.libraryTitle}>{item.title}</Text></Pressable>)}</View>
      {user ? <View style={styles.resume}><ContinueWatching userId={user.id} /></View> : null}
      <View style={styles.group}>
        <Text style={styles.groupTitle}>Seu espaço</Text>
        {row('Meus estudos com a Classy', 'sparkles-outline', '/study')}
        {row('Conquistas e recompensas', 'trophy-outline', '/rewards')}
        {row('Perfil e progresso', 'person-circle-outline', '/profile-progress')}
        {row('Mensagens', 'chatbubbles-outline', '/messages')}
        {row('Notificações', 'notifications-outline', '/notifications')}
        {row('Carteira', 'wallet-outline', '/carteira')}
        {row('Meu plano', 'diamond-outline', '/premium')}
      </View>
      {user ? <Pressable accessibilityRole="button" style={styles.signOut} onPress={() => Alert.alert('Sair da conta?', 'Você pode entrar novamente quando quiser.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Sair', style: 'destructive', onPress: () => { void signOut(); } }])}><Text style={styles.signOutText}>Sair da conta</Text></Pressable> : null}
    </AppScreen>
  );
}
const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  title: { color: colors.text, fontSize: 27, fontWeight: '700', letterSpacing: -0.8 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20 },
  avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  accountCopy: { flex: 1, gap: 6 },
  name: { color: colors.text, fontSize: 18, fontWeight: '600' },
  accountText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  accountButton: { alignSelf: 'flex-start', marginLeft: 96, marginTop: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, minHeight: 38, borderRadius: 19, justifyContent: 'center' },
  accountButtonText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  library: { flexDirection: 'row', gap: 10, padding: 20, marginTop: 12 },
  libraryCard: { flex: 1, backgroundColor: colors.surface, paddingVertical: 22, alignItems: 'center', gap: 10, borderRadius: 16 },
  libraryTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  resume: { paddingHorizontal: 20 },
  group: { paddingHorizontal: 20, paddingTop: 12 },
  groupTitle: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: '600', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54, borderRadius: 8 },
  rowLabel: { flex: 1, color: colors.textSecondary, fontSize: 14 },
  pressed: { backgroundColor: colors.surfaceAlt },
  signOut: { margin: 20, minHeight: 44, justifyContent: 'center' },
  signOutText: { color: colors.muted, fontSize: 13 },
});
