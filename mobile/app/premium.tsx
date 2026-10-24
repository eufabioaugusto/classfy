import { NavigationHeader } from '@/components/NavigationHeader';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { Check, X, CircleCheck, Info, ShieldCheck, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { PlanCrown } from '@/components/PlanCrown';
import { dataTheme as t } from '@/theme/data';
import { useAuth } from '@/features/auth/authContext';
import { useStoreBilling } from '@/features/billing/useStoreBilling';
import { BillingMessageDialog } from '@/features/billing/BillingMessageDialog';
import { hasPaidAccess, storeForProfile } from '@/features/billing/storeBilling';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface FAQItem {
  question: string;
  answer: string;
}

export default function PremiumScreen() {
  const { user, profile } = useAuth();
  const billing = useStoreBilling();
  const router = useRouter();
  const navigation = useNavigation();

  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const currentPlan = (profile?.plan || 'free') as 'free' | 'pro' | 'premium';
  const existingSubscription = hasPaidAccess(profile);
  const currentStore = storeForProfile(profile);
  const storeName = billing.platform === 'apple' ? 'App Store' : 'Google Play';

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

    await billing.subscribe(planType);
  };

  const faqData: FAQItem[] = [
    {
      question: 'Qual a diferença entre o Pro e o Premium?',
      answer: 'O Pro libera uma experiência sem anúncios, downloads e até 50 estudos com 30 mensagens em cada um. O Premium amplia os estudos e mensagens para uso ilimitado, além de incluir cursos completos com certificado, modo offline e reprodução em segundo plano.',
    },
    {
      question: 'Como funciona a cobrança e o cancelamento?',
      answer: 'A assinatura feita no aplicativo é mensal e renovada pela App Store ou pelo Google Play. Você pode gerenciar e cancelar nas assinaturas da loja. O acesso continua até o fim do período já pago. Assinaturas contratadas fora do app são gerenciadas na conta Classfy pelo navegador.',
    },
    {
      question: 'Já assino a Classfy. Preciso pagar novamente?',
      answer: 'Não. Entre na mesma conta Classfy para usar seu plano em todos os dispositivos. Se sua assinatura foi feita pela loja e o acesso não aparece, use Restaurar compras com a mesma conta da App Store ou do Google Play utilizada na compra.',
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
    const product = billing.products.find((item) => item.plan === plan);
    const planPrice = product?.displayPrice;
    const isCurrent = currentPlan === plan;
    const isLoading = billing.purchasingPlan === plan;
    const unavailable = !existingSubscription && Boolean(user) && (billing.status !== 'ready' || !product);
    const planColor = t.accent;

    const features = isPremium
      ? [
          'Tudo do plano Pro incluso',
          'Cursos Completos & Certificados',
          'Modo Offline para Vídeos',
          'Reprodução em Segundo Plano',
          'Copiloto Classfy IA de Estudo',
          'Estudos e mensagens ilimitados',
          'Acesso antecipado a novidades',
        ]
      : [
          'Assistir aulas sem Anúncios',
          'Até 50 estudos com a Classy',
          '30 mensagens por estudo',
          'Downloads ilimitados de áudio',
          'Suporte prioritário',
        ];

    return (
      <View style={[styles.planCard, isCurrent && styles.currentPlanCardBorder]}>
        <View style={styles.planHeader}>
          <View style={styles.planTitleContainer}>
            <View style={styles.planIdentity}><PlanCrown plan={plan} size={20} /><Text style={styles.planTitle}>{planTitle}</Text></View>
            {isPremium && (
              <View style={styles.popularBadge}>
                <Text style={styles.popularBadgeText}>Recomendado</Text>
              </View>
            )}
          </View>
          <View style={styles.priceRow}>
            <Text style={[styles.price, !planPrice && styles.priceUnavailable]}>{planPrice || (billing.status === 'loading' ? 'Consultando a loja…' : 'Preço disponível na loja')}</Text>
            {planPrice && <Text style={styles.pricePeriod}>/mês</Text>}
          </View>
        </View>

        <View style={styles.featuresList}>
          {features.map((feature, idx) => (
            <View key={idx} style={styles.featureItem}>
              <Check
                size={16}
                color={t.secondary}
                strokeWidth={t.stroke}
                style={styles.featureIcon}
              />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => handleSubscribe(plan)}
          accessibilityRole="button"
          disabled={Boolean(billing.operation) || unavailable}
          style={({ pressed }) => [
            styles.subscribeBtn,
            isPremium ? { backgroundColor: planColor } : styles.secondarySubscribeBtn,
            isCurrent && styles.currentPlanBtn,
            unavailable && { opacity: 0.45 },
            pressed && { opacity: 0.8 },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={t.ink} />
          ) : (
            <Text style={[styles.subscribeBtnText, isCurrent && styles.currentPlanBtnText]}>
              {existingSubscription ? (isCurrent ? 'Gerenciar assinatura' : 'Alterar plano na conta da compra') : unavailable ? 'Em preparação' : `Assinar ${isPremium ? 'Premium' : 'Pro'}`}
            </Text>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <AppScreen scroll={false} edgeToEdge>
      {/* Header Bar */}
      <NavigationHeader title="Planos" back />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>Seu próximo passo</Text>
          <Text style={styles.heroSubtitle}>
            Estude com a inteligência do Classfy IA copiloto, sem anúncios e com certificados oficiais.
          </Text>

          {/* Current Plan Indicator */}
          <View style={styles.statusIndicator}>
            <Text style={styles.statusLabel}>Seu plano atual:</Text>
            <View style={styles.statusBadge}>
              {currentPlan !== 'free' ? <PlanCrown plan={currentPlan} size={14} /> : null}
              <Text style={styles.statusBadgeText}>
                {currentPlan === 'free' ? 'Classfy Gratuito' : currentPlan === 'pro' ? 'Classfy Pro' : 'Classfy Premium'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.billingStatus}>
          {existingSubscription ? (
            <>
              <CircleCheck size={22} strokeWidth={t.stroke} color={t.positive} />
              <Text style={styles.billingStatusText}>{currentStore ? `Sua assinatura é gerenciada ${currentStore === 'apple' ? 'pela App Store' : 'pelo Google Play'}.` : 'Sua assinatura contratada fora do app continua válida aqui. Você pode gerenciá-la na sua conta pelo navegador.'}</Text>
            </>
          ) : billing.status === 'loading' ? (
            <><ActivityIndicator color={t.secondary} /><Text style={styles.billingStatusText}>Consultando os planos disponíveis na loja…</Text></>
          ) : billing.reason ? (
            <><Info size={22} strokeWidth={t.stroke} color={t.muted} /><Text style={styles.billingStatusText}>{billing.reason}</Text></>
          ) : (
            <><ShieldCheck size={22} strokeWidth={t.stroke} color={t.secondary} /><Text style={styles.billingStatusText}>Assinatura mensal com pagamento e renovação pela {storeName}.</Text></>
          )}
          {billing.status === 'error' && <Pressable accessibilityRole="button" onPress={billing.retry}><Text style={styles.billingLink}>Tentar novamente</Text></Pressable>}
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
              <Text style={[styles.tableCol, styles.tableHeaderCol]}>Pro</Text>
              <Text style={[styles.tableCol, styles.tableHeaderCol, { color: t.secondary }]}>Premium</Text>
            </View>

            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Vídeos sem anúncios</Text>
              <View style={styles.tableColCell}>
                <Check size={14} color={t.secondary} />
              </View>
              <View style={styles.tableColCell}>
                <Check size={14} color={t.secondary} />
              </View>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Estudos com a Classy</Text>
              <Text style={styles.tableCol}>Até 50</Text>
              <Text style={[styles.tableCol, { color: t.secondary }]}>Ilimitado</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Mensagens por estudo</Text>
              <Text style={styles.tableCol}>Até 30</Text>
              <Text style={[styles.tableCol, { color: t.secondary }]}>Ilimitadas</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Downloads offline</Text>
              <Text style={styles.tableCol}>Áudio</Text>
              <Text style={[styles.tableCol, { color: t.secondary }]}>Vídeo & Áudio</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Cursos & Certificados</Text>
              <View style={styles.tableColCell}>
                <X size={14} color={colors.mutedDim} />
              </View>
              <View style={styles.tableColCell}>
                <Check size={14} color={t.secondary} />
              </View>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCol, styles.tableColLeft]}>Segundo Plano</Text>
              <View style={styles.tableColCell}>
                <X size={14} color={colors.mutedDim} />
              </View>
              <View style={styles.tableColCell}>
                <Check size={14} color={t.secondary} />
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
                    {isExpanded ? <ChevronUp size={18} strokeWidth={t.stroke} color={t.muted} /> : <ChevronDown size={18} strokeWidth={t.stroke} color={t.muted} />}
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

        <View style={styles.billingActions}>
          <Pressable accessibilityRole="button" disabled={Boolean(billing.operation)} onPress={() => user ? void billing.restore() : router.push('/auth/sign-in')} style={styles.restoreButton}>
            {billing.operation === 'restore' ? <ActivityIndicator size="small" color={colors.text} /> : <RotateCcw size={18} strokeWidth={t.stroke} color={t.ink} />}
            <Text style={styles.restoreText}>Restaurar compras</Text>
          </Pressable>
          {existingSubscription && <Pressable accessibilityRole="button" disabled={Boolean(billing.operation)} onPress={() => void billing.manage()}><Text style={styles.billingLink}>Gerenciar assinatura</Text></Pressable>}
        </View>

        <View style={styles.disclaimerSection}>
          <ShieldCheck size={16} strokeWidth={t.stroke} color={t.muted} />
          <Text style={styles.disclaimerText}>
            A confirmação do valor e das condições ocorre na loja antes de concluir. A renovação é automática até o cancelamento nas configurações da sua assinatura.
          </Text>
        </View>
        <View style={styles.legalLinks}>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://classfy.com.br/termos')}><Text style={styles.legalText}>Termos de uso</Text></Pressable>
          <Text style={styles.legalText}>·</Text>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://classfy.com.br/privacidade')}><Text style={styles.legalText}>Privacidade</Text></Pressable>
        </View>
      </ScrollView>
      <BillingMessageDialog message={billing.message} onClose={billing.dismissMessage} />
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
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
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
    textAlign: 'left',
    marginBottom: spacing.sm,
  },
  heroSubtitle: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'left',
    lineHeight: 21,
    marginBottom: spacing.md,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    borderColor: t.border,
    borderWidth: 1,
    borderRadius: t.controlRadius,
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  statusLabel: {
    color: colors.muted,
    fontSize: 11,
    marginRight: 6,
  },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
    backgroundColor: t.surface,
    borderRadius: t.cardRadius,
    borderWidth: 1,
    padding: spacing.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  currentPlanCardBorder: { borderColor: t.accent },
  secondarySubscribeBtn: { backgroundColor: t.raised, borderColor: t.border, borderWidth: 1 },
  planIdentity: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  planHeader: {
    marginBottom: spacing.lg,
  },
  planTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
    flexWrap: 'wrap',
  },
  planTitle: {
    color: t.ink,
    flexShrink: 1,
    fontSize: 18,
    fontWeight: typography.weightBold,
  },
  popularBadge: {
    backgroundColor: t.raised,
    borderRadius: t.controlRadius,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  popularBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },
  price: {
    color: colors.text,
    fontSize: 30,
    fontWeight: typography.weightSemibold,
    fontVariant: ['tabular-nums'],
  },
  pricePeriod: {
    color: colors.muted,
    fontSize: 12,
    marginLeft: 2,
  },
  priceUnavailable: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  billingStatus: { marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle, alignItems: 'center', gap: spacing.sm },
  billingStatusText: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  billingActions: { paddingHorizontal: spacing.lg, marginTop: spacing.xl, gap: spacing.md, alignItems: 'center' },
  restoreButton: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: 46, width: '100%', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  restoreText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  billingLink: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md, marginTop: spacing.md },
  legalText: { color: colors.muted, fontSize: 11, textDecorationLine: 'underline' },
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
    fontSize: 14,
    lineHeight: 21,
    flex: 1,
  },
  subscribeBtn: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: t.controlRadius,
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
    fontSize: 18,
    fontWeight: typography.weightSemibold,
    marginBottom: spacing.md,
  },
  compareTable: {
    backgroundColor: t.surface,
    borderRadius: t.cardRadius,
    borderWidth: 1,
    borderColor: t.border,
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
    backgroundColor: t.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
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
    fontSize: 14,
    lineHeight: 21,
    fontWeight: typography.weightSemibold,
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
    fontSize: 13,
    lineHeight: 20,
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
