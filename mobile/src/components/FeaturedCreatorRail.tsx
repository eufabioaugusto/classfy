import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';

type Creator = { id: string; slug: string; description: string | null; background_image_url: string | null; featured_image_url: string | null; profiles: { display_name: string | null; creator_channel_name: string | null } | null };
export function FeaturedCreatorRail() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    supabase.from('featured_creators').select('id,slug,description,background_image_url,featured_image_url,profiles:creator_id(display_name,creator_channel_name)').eq('show_on_home', true).order('order_index', { ascending: true }).then(({ data, error }) => {
      if (active && !error) setCreators((data || []) as unknown as Creator[]);
    });
    return () => { active = false; };
  }, []);
  if (!creators.length) return null;
  return <View style={styles.section}><Text style={styles.title}>Creators para conhecer</Text><FlatList horizontal data={creators} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Conhecer ${item.profiles?.creator_channel_name || item.profiles?.display_name || item.description || 'creator'}`} onPress={() => router.push({ pathname: '/creator/featured/[slug]', params: { slug: item.slug } })} style={styles.card}><View style={styles.imageWrap}>{item.background_image_url ? <Image source={{ uri: item.background_image_url }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}{item.featured_image_url ? <Image source={{ uri: item.featured_image_url }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}</View><View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{item.profiles?.creator_channel_name || item.profiles?.display_name || item.description || 'Creator Classfy'}</Text><Text numberOfLines={2} style={styles.description}>Conhecer conteúdos</Text></View></Pressable>} /></View>;
}
const styles = StyleSheet.create({
  section: { paddingVertical: 16 },
  title: { color: colors.text, fontWeight: '600', fontSize: 18, marginHorizontal: 16, marginBottom: 16 },
  rail: { paddingHorizontal: 16, gap: 12 },
  card: { width: 210, backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden' },
  imageWrap: { height: 140, backgroundColor: colors.surfaceAlt },
  copy: { padding: 12, gap: 6 },
  name: { color: colors.text, fontWeight: '600', fontSize: 14 },
  description: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
