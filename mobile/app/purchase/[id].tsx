import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ContentData {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  price: number;
  discount: number | null;
  creator_id: string;
  creator: {
    display_name: string | null;
    creator_channel_name: string | null;
    avatar_url: string | null;
  } | null;
}

export default function PurchaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [content, setContent] = useState<ContentData | null>(null);

  // Configure navigation options
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  useEffect(() => {
    if (id) {
      fetchContent();
    }
  }, [id]);

  const fetchContent = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contents')
        .select(`
          id,
          title,
          description,
          thumbnail_url,
          price,
          discount,
          creator_id,
          creator:profiles!creator_id (
            display_name,
            creator_channel_name,
            avatar_url
          )
        `)
        .eq('id', id)
        .single();

      if (error || !data) {
        console.error('Error fetching content:', error);
        Alert.alert('Erro', 'Conteúdo não encontrado.');
        router.back();
        return;
      }

      setContent(data as any);
    } catch (e) {
      console.error('Error loading content:', e);
      Alert.alert('Erro', 'Erro ao carregar o conteúdo.');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async () => {
    if (!user) {
      router.push('/auth/sign-in');
      return;
    }

    if (!content) return;

    try {
      setPurchasing(true);
      const discountVal = content.discount || 0;

      const { data, error } = await supabase.functions.invoke('create-content-payment', {
        body: {
          contentId: content.id,
          price: content.price,
          discount: discountVal,
        },
      });

      if (error) throw error;

      if (data?.url) {
        await WebBrowser.openBrowserAsync(data.url);
        
        Alert.alert(
          'Compra Iniciada',
          'Seu pagamento foi aberto no navegador seguro. Assim que concluir o pagamento na Stripe, volte e comece a assistir!',
          [
            {
              text: 'Começar a Assistir',
              onPress: () => {
                router.replace(`/watch/${content.id}`);
              },
            },
          ]
        );
      } else {
        throw new Error('Não foi possível obter o link de checkout.');
      }
    } catch (e: any) {
      console.error('Purchase error:', e);
      Alert.alert('Erro', e.message || 'Erro ao processar compra.');
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <AppScreen scroll={false}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </AppScreen>
    );
  }

  if (!content) return null;

  const discount = content.discount || 0;
  const finalPrice = content.price * (1 - discount / 100);
  const creatorName = content.creator?.creator_channel_name || content.creator?.display_name || 'Classfy Creator';

  return (
    <AppScreen scroll={false}>
      {/* Absolute Transparent Header with Back Button */}
      <View style={[styles.floatingHeader, { top: insets.top + spacing.xs }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtnCircle}>
          <Ionicons name="chevron-back" size={24} color="#FFF" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Full-bleed Hero Visual Cover with seamless gradient fade */}
        <View style={styles.heroWrapper}>
          {content.thumbnail_url ? (
            <Image source={{ uri: content.thumbnail_url }} style={styles.heroImage} contentFit="cover" />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="videocam" size={48} color="rgba(255,255,255,0.1)" />
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.85)', '#000000']}
            style={StyleSheet.absoluteFillObject}
          />
        </View>

        {/* Masterclass editorial details */}
        <View style={styles.contentBody}>
          <Text style={styles.creatorSubtitle}>
            POR @{creatorName.toUpperCase()}
          </Text>
          
          <Text style={styles.editorialTitle}>
            {content.title}
          </Text>

          {/* Quick specs */}
          <View style={styles.specsRow}>
            <Text style={styles.specItem}>Acesso Vitalício</Text>
            <View style={styles.specDot} />
            <Text style={styles.specItem}>Qualidade HD</Text>
            <View style={styles.specDot} />
            <Text style={styles.specItem}>Estudo Imediato</Text>
          </View>

          {/* Tagline / Course description */}
          <Text style={styles.editorialDescription}>
            {content.description || 'Aprenda os segredos da alta performance, analise seus erros de forma analítica e otimize sua rotina de aprendizado com suporte individual e exercícios estruturados do creator.'}
          </Text>

          {/* Branded Upgrade card */}
          <View style={styles.featuresCard}>
            <LinearGradient
              colors={['rgba(226,29,72,0.08)', 'rgba(255,255,255,0.01)']}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.featureRow}>
              <Ionicons name="checkbox-outline" size={18} color={colors.accent} />
              <Text style={styles.featureText}>Assista em qualquer dispositivo (Mobile, Web, TV)</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="checkbox-outline" size={18} color={colors.accent} />
              <Text style={styles.featureText}>Material de apoio para download incluso</Text>
            </View>
            <View style={styles.featureRow}>
              <Ionicons name="checkbox-outline" size={18} color={colors.accent} />
              <Text style={styles.featureText}>Acesso à comunidade privada de alunos</Text>
            </View>
          </View>

          {/* Secure Lock Statement */}
          <View style={styles.secureBadge}>
            <Ionicons name="shield-checkmark" size={14} color="#888" style={{ marginRight: 6 }} />
            <Text style={styles.secureText}>Garantia de reembolso de 7 dias e suporte 24/7</Text>
          </View>
        </View>
      </ScrollView>

      {/* Pinned conversion Sticky Footer */}
      <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.footerLeft}>
          <Text style={styles.footerPriceLabel}>ACESSO COMPLETO</Text>
          <View style={styles.footerPriceRow}>
            <Text style={styles.footerPrice}>R$ {finalPrice.toFixed(2)}</Text>
            {discount > 0 && (
              <Text style={styles.footerPriceOriginal}>
                R$ {content.price.toFixed(2)}
              </Text>
            )}
          </View>
        </View>
        <Pressable
          onPress={handlePurchase}
          disabled={purchasing}
          style={({ pressed }) => [
            styles.footerBtn,
            pressed && { opacity: 0.85 }
          ]}
        >
          {purchasing ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.footerBtnText}>Comprar Curso</Text>
          )}
        </Pressable>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  floatingHeader: {
    position: 'absolute',
    left: spacing.lg,
    zIndex: 100,
  },
  backBtnCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  scrollContent: {
    paddingBottom: 130, // Extra space to clear sticky footer
  },
  heroWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    position: 'relative',
    backgroundColor: '#000',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111',
  },
  contentBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  creatorSubtitle: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: spacing.xs,
  },
  editorialTitle: {
    color: '#FFF',
    fontSize: 26,
    fontWeight: typography.weightBlack,
    lineHeight: 32,
    marginBottom: spacing.sm,
  },
  specsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  specItem: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11.5,
    fontWeight: '700',
  },
  specDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 8,
  },
  editorialDescription: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '500',
    marginBottom: spacing.lg,
  },
  featuresCard: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(226,29,72,0.18)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: spacing.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureText: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  secureText: {
    color: '#666',
    fontSize: 10.5,
    fontWeight: '500',
  },
  stickyFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(9,9,11,0.94)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 14,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: {
    flex: 1,
  },
  footerPriceLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 2,
  },
  footerPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  footerPrice: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: typography.weightBlack,
  },
  footerPriceOriginal: {
    color: 'rgba(255,255,255,0.4)',
    textDecorationLine: 'line-through',
    fontSize: 12,
    fontWeight: '600',
  },
  footerBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
});
