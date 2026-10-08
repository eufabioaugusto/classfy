import { useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/authContext';
import { ConfirmedReward, subscribeConfirmedRewards, REWARDS_CHANGED } from '@/features/rewards/events';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';

/** Receipts come from the server ledger; local UI milestones never mint Points. */
export function RewardFeedback() {
  const { user, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [reward, setReward] = useState<ConfirmedReward | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setReward(null);
    if (!user) return;
    const seen = new Set<string>();
    let since = new Date().toISOString();
    let active = true;
    const receive = (event: ConfirmedReward) => {
      if (!active || event.user_id !== user.id || seen.has(event.id)) return;
      seen.add(event.id);
      if (seen.size > 200) seen.delete(seen.values().next().value!);
      DeviceEventEmitter.emit(REWARDS_CHANGED, { userId: user.id, contentId: event.content_id });
      if (Number(event.points) <= 0) return;
      setReward(event);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setReward(null), 3500);
    };
    const local = subscribeConfirmedRewards(user.id, receive);
    const channel = supabase.channel(`mobile-rewards-${user.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reward_events', filter: `user_id=eq.${user.id}` }, payload => receive(payload.new as ConfirmedReward)).subscribe();
    let checking = false;
    const reconcile = () => {
      if (!active || checking || AppState.currentState !== 'active') return;
      checking = true;
      const cursor = since;
      const next = new Date().toISOString();
      void supabase.from('reward_events').select('id,user_id,content_id,action_key,points,created_at').eq('user_id', user.id).gte('created_at', cursor).order('created_at', { ascending: true }).then(({ data, error }) => {
        checking = false;
        if (!active || error) return;
        since = new Date(Date.parse(next) - 2000).toISOString();
        data?.forEach(receive);
      });
    };
    // Reconcile the ledger even if realtime is temporarily unavailable.
    const polling = setInterval(reconcile, 30000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') reconcile(); });
    return () => { active = false; clearInterval(polling); local.remove(); foreground.remove(); void supabase.removeChannel(channel); if (timer.current) clearTimeout(timer.current); };
  }, [user?.id]);
  if (!reward) return null;
  return <Pressable accessibilityLabel={`${reward.points} Points recebidos`} onPress={() => setReward(null)} style={[styles.toast, { top: insets.top + 8 }]}>
    {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={styles.avatar} /> : <View style={styles.avatar}><Ionicons name="sparkles" size={18} color={colors.accent} /></View>}
    <View><Text style={styles.title}>+{reward.points} Points</Text><Text style={styles.caption}>Seu aprendizado vale a pena</Text></View>
    <Ionicons name="checkmark-circle" size={22} color={colors.free} />
  </Pressable>;
}
const styles = StyleSheet.create({ toast: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, maxWidth: '90%' }, avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 14, color: colors.text, fontWeight: '700' }, caption: { fontSize: 11, color: colors.muted, marginTop: 2 } });
