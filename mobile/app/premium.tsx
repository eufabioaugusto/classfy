import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Crown, Check, X } from 'lucide-react-native';
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

interface FAQItem {
  question: string;
  answer: string;
}

export default function PremiumScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const currentPlan = (profile?.plan || 'free') as 'free' | 'pro' | 'premium';

  // Configure navigation options imperatively
  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  const handleSubscribe = async (planType: 'pro' | 'premium') => {
    if (!user) {
      router.push('/auth/sign-in');
      return;
    }

    try {
      setLoadingPlan(planType);

      // If user already has this plan, open customer portal to manage
      if (currentPlan === planType) {
        const { data, error } = await supabase.functions.invoke('customer-portal', {});
        if (error) throw error;
        if (data?.url) {
          await WebBrowser.openBrowserAsync(data.url);
          await refreshProfile();
        } else {
          Alert.alert('Erro', 'Não foi possível carregar o portal de gerenciamento.');
        }
        return;
      }

      // Otherwise, create subscription checkout session
      const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
        body: { plan: planType },
      });

      if (error) throw error;
      if (data?.url) {
        await WebBrowser.openBrowserAsync(data.url);
        await refreshProfile();
      } else {
        Alert.alert('Erro', 'Não foi possível iniciar o checkout.');
      }
    } catch (e: any) {
      console.error('Error initiating subscription:', e);
      Alert.alert('Erro', e.message || 'Erro ao processar assinatura.');
    } finally {
      setLoadingPlan(null);
    }
  };

  const faqData: FAQItem[] = [
    {
      question: 'Qual a diferença entre o Pro e o Premium?',
      answer: 'O Pro remove os anúncios, libera o download de áudios (offline) e dá acesso ilimitado ao Classy Chat. O Premium adiciona a visualização de cursos completos com certificado oficial, modo offline para vídeos, reprodução em segundo plano e copiloto IA avançado no player.',
    },
    {
      question: 'Como funciona a cobrança e o cancelamento?',
      answer: 'A assinatura é mensal e renovada automaticamente. Você pode cancelar a qualquer momento sem custos adicionais acessando o painel de gerenciamento (via Stripe Portal) direto no aplicativo.',
    },
    {
      question: 'Como funciona a reprodução em segundo plano?',
      answer: 'Com o Classfy Premium ativo, os vídeos e áudios continuam reproduzindo quando você minimiza o aplicativo ou desliga a tela do celular, ideal para escutar aulas como podcast.',
    },
    {
      question: 'Os certificados são reconhecidos?',
      answer: 'Sim! Os certificados gerados na conclusão dos cursos Premium atestam a carga horária estudada e podem ser compartilhados no LinkedIn ou anexados ao seu currículo.',
    },
  ];

  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  const renderPlanCard = (plan: 'pro' | 'premium') => {
    const isPremium = plan === 'premium';
    const planTitle = isPremium ? 'Classfy Premium' : 'Classfy Pro';
    const planPrice = isPremium ? 'R$ 39,90' : 'R$ 19,90';
    const isCurrent = currentPlan === plan;
    const isLoading = loadingPlan === plan;
    const planColor = isPremium ? colors.accent : '#f59e0b'; // Premium = Red, Pro = Yellow

    const features = isPremium
      ? [
          'Tudo do plano Pro incluso',
          'Cursos Completos & Certificados',
          'Modo Offline para Vídeos',
          'Reprodução em Segundo Plano',
          'Copiloto Classfy IA de Estudo',
          'Suporte prioritário 24/7',
        ]
      : [
          'Assistir aulas sem Anúncios',
          'Classy Chat (IA) ilimitado',
          'Downloads ilimitados de áudio',
          'Acesso a toda a biblioteca',
          'Apoie criadores de conteúdo',
        ];

    return (
      <View style={[styles.planCard, isPremium ? styles.premiumCardBorder : styles.proCardBorder]}>
        {isPremium ? (
          <LinearGradient
            colors={['rgba(226,29,72,0.12)', 'rgba(0,0,0,0.8)']}
            style={StyleSheet.absoluteFillObject}
          />
        ) : (
          <LinearGradient
            colors={['rgba(245,158,11,0.06)', 'rgba(0,0,0,0.8)']}
            style={StyleSheet.absoluteFillObject}
          />
        )}

        <View style={styles.planHeader}>
          <View style={styles.planTitleContainer}>
            <Text style={[styles.planTitle, { color: planColor }]}>
              {planTitle}
            </Text>
            {isPremium && (
              <View style={styles.popularBadge}>
                <Text style={styles.popularBadgeText}>RECOMENDADO</Text>
              </View>
            )}
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{planPrice}</Text>
            <Text style={styles.pricePeriod}>/mês</Text>
          </View>
        </View>

        <View style={styles.featuresList}>
          {features.map((feature, idx) => (
            <View key={idx} style={styles.featureItem}>
              <Check
                size={16}
                color={planColor}
                style={styles.featureIcon}
              />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => handleSubscribe(plan)}
          disabled={loadingPlan !== null}
          style={({ pressed }) => [
            styles.subscribeBtn,
            { backgroundColor: planColor },
            isCurrent && styles.currentPlanBtn,
            pressed && { opacity: 0.8 },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={[styles.subscribeBtnText, isCurrent && styles.currentPlanBtnText]}>
              {isCurrent ? 'Gerenciar Assinatura' : `Assinar ${isPremium ? 'Premium' : 'Pro'}`}
            </Text>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <AppScreen scroll={false}>
      {/* Header Bar */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Classfy Premium</Text>
        <View style={styles.headerRight}>
          <Ionicons name="gift-outline" size={22} color={colors.accent} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <LinearGradient
            colors={['rgba(226,29,72,0.15)', 'transparent']}
            style={styles.heroGradient}
          />
          <View style={styles.crownContainer}>
            <Crown size={32} color={colors.accent} />
          </View>
          <Text style={styles.heroTitle}>Eleve seu aprendizado</Text>
          <Text style={styles.heroSubtitle}>
            Estude com a inteligência do Classfy IA copiloto, sem anúncios e com certificados oficiais.
          </Text>

          {/* Current Plan Indicator */}
          <View style={styles.statusIndicator}>
            <Text style={styles.statusLabel}>Seu plano atual:</Text>
            <View style={[styles.statusBadge, currentPlan !== 'free' && styles.statusBadgeActive]}>
              <Text style={[styles.statusBadgeText, currentPlan !== 'free' && styles.statusBadgeTextActive]}>
                {currentPlan === 'free' ? 'Classfy Gratuito' : currentPlan === 'pro' ? 'Classfy Pro 🚀' : 'Classfy Premium 🌟'}
              </Text>
            </View>
          </View>
        </View>

        {/* Plans Section */}
        <View style={styles.plansSection}>
          {renderPlanCard('premium')}
          {renderPlanCard('pro')}
        </View>

        {/* Comparison Section */}
        <View style={styles.compareSection}>
          <Text style={styles.sectionTitle}>Compare os Planos</Text>
          <View style={styles.compareTable}>
            <View style={[styles.tableRow, styles.tableHeaderRow]}>
              <Text style={[styles.tableCol, styles.tableColLeft, styles.tableHeaderCol]}>Recurso</Text>
              <Text style={[styles.tableCol, styles.tableHeaderCol, { color: '#f59e0b' }]}>Pro</Text>
              <Text style={[styles.tableCol, styles.tableHeaderCol, { color: colors.accent }]}>Premium</Text>
            </View>

            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Vídeos sem anúncios</Text>
              <View style={styles.tableColCell}>
                <Check size={14} color="#f59e0b" />
              </View>
              <View style={styles.tableColCell}>
                <Check size={14} color={colors.accent} />
              </View>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>IA Chat Copiloto</Text>
              <Text style={styles.tableCol}>Ilimitado</Text>
              <Text style={[styles.tableCol, { color: colors.accent }]}>Ilimitado</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Downloads offline</Text>
              <Text style={styles.tableCol}>Áudio</Text>
              <Text style={[styles.tableCol, { color: colors.accent }]}>Vídeo & Áudio</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Cursos & Certificados</Text>
              <View style={styles.tableColCell}>
                <X size={14} color={colors.mutedDim} />
              </View>
              <View style={styles.tableColCell}>
                <Check size={14} color={colors.accent} />
              </View>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Segundo Plano</Text>
              <View style={styles.tableColCell}>
                <X size={14} color={colors.mutedDim} />
              </View>
              <View style={styles.tableColCell}>
                <Check size={14} color={colors.accent} />
              </View>
            </View>
          </View>
        </View>

        {/* FAQ Section */}
        <View style={styles.faqSection}>
          <Text style={styles.sectionTitle}>Perguntas Frequentes</Text>
          <View style={styles.faqList}>
            {faqData.map((faq, index) => {
              const isExpanded = expandedFaq === index;
              return (
                <View key={index} style={styles.faqItem}>
                  <Pressable onPress={() => toggleFaq(index)} style={styles.faqHeader}>
                    <Text style={styles.faqQuestion}>{faq.question}</Text>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.muted}
                    />
                  </Pressable>
                  {isExpanded && (
                    <View style={styles.faqAnswerContainer}>
                      <Text style={styles.faqAnswer}>{faq.answer}</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Stripe Disclaimer */}
        <View style={styles.disclaimerSection}>
          <Ionicons name="shield-checkmark" size={16} color={colors.muted} />
          <Text style={styles.disclaimerText}>
            Pagamento 100% seguro processado via Stripe. Cancele quando quiser nas configurações da conta.
          </Text>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    backgroundColor: '#000',
  },
  backBtn: {
    padding: 4,
    marginLeft: -4,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: typography.weightBold,
  },
  headerRight: {
    padding: 4,
    marginRight: -4,
  },
  scrollContent: {
    paddingBottom: 60,
  },
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    position: 'relative',
  },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 200,
  },
  crownContainer: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: 'rgba(226,29,72,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderColor: 'rgba(226,29,72,0.2)',
    borderWidth: 1,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: typography.weightBold,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 11,
    marginRight: 6,
  },
  statusBadge: {
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weightBold,
  },
  statusBadgeActive: {
    backgroundColor: 'rgba(226,29,72,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  statusBadgeTextActive: {
    color: colors.accent,
  },
  plansSection: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  planCard: {
    backgroundColor: '#111',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  premiumCardBorder: {
    borderColor: 'rgba(226,29,72,0.25)',
  },
  proCardBorder: {
    borderColor: 'rgba(245,158,11,0.25)',
  },
  planHeader: {
    marginBottom: spacing.lg,
  },
  planTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  planTitle: {
    fontSize: 18,
    fontWeight: typography.weightBold,
  },
  popularBadge: {
    backgroundColor: colors.accent,
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  popularBadgeText: {
    color: '#FFF',
    fontSize: 8,
    fontWeight: '900',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  price: {
    color: colors.text,
    fontSize: 26,
    fontWeight: typography.weightBold,
  },
  pricePeriod: {
    color: colors.muted,
    fontSize: 12,
    marginLeft: 2,
  },
  featuresList: {
    gap: 10,
    marginBottom: spacing.xl,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    marginRight: spacing.sm,
  },
  featureText: {
    color: colors.text,
    fontSize: 12.5,
  },
  subscribeBtn: {
    height: 44,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subscribeBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  currentPlanBtn: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
  },
  currentPlanBtnText: {
    color: colors.text,
  },
  compareSection: {
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    marginBottom: spacing.md,
  },
  compareTable: {
    backgroundColor: '#111',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.02)',
  },
  tableHeaderRow: {
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  tableCol: {
    flex: 1,
    color: colors.text,
    fontSize: 11,
    textAlign: 'center',
  },
  tableColCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tableColLeft: {
    flex: 2,
    textAlign: 'left',
    paddingLeft: spacing.md,
    color: colors.muted,
  },
  tableHeaderCol: {
    fontWeight: typography.weightBold,
    fontSize: 11,
  },
  faqSection: {
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  faqList: {
    gap: spacing.sm,
  },
  faqItem: {
    backgroundColor: '#111',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  faqQuestion: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weightBold,
    flex: 1,
    paddingRight: spacing.sm,
  },
  faqAnswerContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.01)',
    paddingTop: spacing.xs,
  },
  faqAnswer: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  disclaimerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
    gap: 6,
  },
  disclaimerText: {
    color: colors.mutedDim,
    fontSize: 9,
    textAlign: 'center',
    flex: 1,
    lineHeight: 13,
  },
});
