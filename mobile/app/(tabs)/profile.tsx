import { NavigationHeader } from '@/components/NavigationHeader';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, Bookmark, ChartNoAxesCombined, Clock3, Crown, Heart, LogOut, MessageCircle, Settings, Sparkles, Trophy, UserRound, Video, Wallet, type LucideIcon } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { ContinueWatching } from '@/components/ContinueWatching';
import { DataAction, DataCard, DataRow, DataSection } from '@/components/data/DataUI';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { useAuth } from '@/features/auth/authContext';
import { dataTheme as t } from '@/theme/data';

const library: { title: string; icon: LucideIcon; route: Href }[] = [
  { title: 'Histórico', icon: Clock3, route: '/library/history' },
  { title: 'Salvos', icon: Bookmark, route: '/library/saved' },
  { title: 'Favoritos', icon: Heart, route: '/library/favorites' },
];

export default function YouScreen() {
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const { canPublish } = usePrimaryAction();
  const open = (route: Href) => router.push(user ? route : '/auth/sign-in');
  return <AppScreen edgeToEdge header={<NavigationHeader title="Você" right={<Pressable accessibilityRole="button" accessibilityLabel="Configurações" onPress={() => open('/settings')} style={styles.iconButton}><Settings size={23} strokeWidth={t.stroke} color={t.ink} /></Pressable>} />}>
    <View style={styles.content}>
      <View style={styles.account}>
        <View style={styles.avatar}>{profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={StyleSheet.absoluteFill} /> : <UserRound size={28} strokeWidth={t.stroke} color={t.muted} />}</View>
        <View style={styles.accountCopy}><Text style={styles.name}>{profile?.display_name || (user ? 'Sua conta' : 'Sua Classfy, do seu jeito')}</Text><Text style={styles.accountText}>{user ? 'Seus estudos e conteúdos em um só lugar.' : 'Entre para continuar de onde parou.'}</Text></View>
      </View>
      <DataAction label={user ? 'Editar perfil' : 'Entrar na Classfy'} variant="secondary" onPress={() => router.push(user ? '/edit-profile' : '/auth/sign-in')} />
      <DataSection title="Sua biblioteca">
        <View style={styles.library}>{library.map(({ title, icon: Icon, route }) => <Pressable key={title} accessibilityRole="button" onPress={() => open(route)} style={({ pressed }) => [styles.libraryCard, pressed && styles.pressed]}><Icon size={22} strokeWidth={t.stroke} color={t.secondary} /><Text style={styles.libraryTitle}>{title}</Text></Pressable>)}</View>
      </DataSection>
      {user ? <ContinueWatching userId={user.id} /> : null}
      <DataSection title="Sua atividade">
        <DataCard style={styles.group}>
          {canPublish ? <DataRow title="Meu Studio" icon={Video} onPress={() => open('/studio')} /> : null}
          <DataRow title="Meus estudos com a Classy" icon={Sparkles} onPress={() => open('/study')} />
          <DataRow title="Perfil e progresso" icon={ChartNoAxesCombined} onPress={() => open('/profile-progress')} />
          <DataRow title="Conquistas e recompensas" icon={Trophy} onPress={() => open('/rewards')} last />
        </DataCard>
      </DataSection>
      <DataSection title="Sua conta">
        <DataCard style={styles.group}>
          <DataRow title="Carteira" subtitle="Saldo e movimentações" icon={Wallet} onPress={() => open('/carteira')} />
          <DataRow title="Meu plano" icon={Crown} onPress={() => open('/premium')} />
          <DataRow title="Mensagens" icon={MessageCircle} onPress={() => open('/messages')} />
          <DataRow title="Notificações" icon={Bell} onPress={() => open('/notifications')} last />
        </DataCard>
      </DataSection>
      {user ? <DataRow title="Sair da conta" icon={LogOut} destructive last onPress={() => Alert.alert('Sair da conta?', 'Você pode entrar novamente quando quiser.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Sair', style: 'destructive', onPress: () => { void signOut(); } }])} /> : null}
    </View>
  </AppScreen>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 24 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: t.raised, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  accountCopy: { flex: 1, minWidth: 0, gap: 4 },
  name: { color: t.ink, fontSize: 20, fontWeight: '600', letterSpacing: -0.4 },
  accountText: { color: t.muted, fontSize: 13, lineHeight: 19 },
  library: { flexDirection: 'row', gap: 8 },
  libraryCard: { flex: 1, minWidth: 0, backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, paddingVertical: 20, paddingHorizontal: 4, alignItems: 'center', gap: 12, borderRadius: t.cardRadius },
  libraryTitle: { color: t.secondary, fontSize: 12, fontWeight: '500', textAlign: 'center' },
  group: { paddingVertical: 0 },
  pressed: { opacity: 0.7 },
});
