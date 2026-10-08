import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';

export function useUnreadMessages() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    let revision = 0;
    setCount(0);
    if (!user) return;
    const fetchCount = async () => {
      const current = ++revision;
      const { data: participants, error } = await supabase.from('conversation_participants').select('conversation_id,last_read_at').eq('user_id', user.id);
      if (!active || error || current !== revision) return;
      if (!participants?.length) { setCount(0); return; }
      const { data: messages, error: messagesError } = await supabase.from('messages').select('conversation_id,created_at').in('conversation_id', participants.map((p) => p.conversation_id)).neq('sender_id', user.id);
      if (!active || messagesError || current !== revision) return;
      const reads = new Map(participants.map((p) => [p.conversation_id, new Date(p.last_read_at || 0).getTime()]));
      setCount((messages || []).filter((message) => new Date(message.created_at).getTime() > (reads.get(message.conversation_id) || 0)).length);
    };
    void fetchCount();
    const channel = supabase.channel(`mobile-unread-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => { void fetchCount(); }).on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${user.id}` }, () => { void fetchCount(); }).subscribe();
    return () => { active = false; revision++; void supabase.removeChannel(channel); };
  }, [user?.id]);
  return count;
}
