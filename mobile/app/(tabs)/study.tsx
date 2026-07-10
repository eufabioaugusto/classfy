import {
  ExpoSpeechRecognitionModule,
  isSpeechRecognitionAvailable,
  startAudioRecording,
  stopAudioRecordingAndTranscribe,
  USE_NATIVE_SPEECH_RECOGNITION,
  useSpeechRecognitionEvent
} from '@/lib/speech';
import { ResizeMode, Video } from 'expo-av';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Crown,
  FileText,
  ListVideo,
  Mic,
  Play,
  Plus,
  Square,
  Timer,
  Trash2,
  X,
  Zap
} from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { getActiveDifficulties, getTopInterests, trackUserInteraction } from '@/lib/interests';
import { fetchStudyJourneySummary, StudyJourneySummary, toShortTitle } from '@/lib/study/getStudyJourneySummary';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface Study {
  id: string;
  title: string;
  created_at: string;
  status: string;
  message_count: number;
}

interface StudyMessage {
  id: string;
  study_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  related_contents?: any[] | null;
  metadata?: {
    active_mode?: string;
    follow_up_suggestions?: string[];
    citations?: any[];
  } | null;
}

interface WaveformProps {
  size?: 'small' | 'normal';
}

function WaveformVisualizer({ size = 'normal' }: WaveformProps) {
  const isSmall = size === 'small';
  const barsCount = isSmall ? 8 : 20;
  const animatedValues = useRef(
    Array.from({ length: barsCount }).map(() => new Animated.Value(1))
  ).current;

  useEffect(() => {
    const activeAnimations = animatedValues.map((anim, index) => {
      let isCancelled = false;
      const runAnimation = () => {
        if (isCancelled) return;
        Animated.sequence([
          Animated.timing(anim, {
            toValue: Math.random() * (isSmall ? 1.8 : 2.8) + 0.4,
            duration: 130 + Math.random() * 150,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 1,
            duration: 130 + Math.random() * 150,
            useNativeDriver: true,
          }),
        ]).start(() => {
          runAnimation();
        });
      };

      const timeoutId = setTimeout(runAnimation, index * 25);
      return {
        cancel: () => {
          isCancelled = true;
          clearTimeout(timeoutId);
          anim.stopAnimation();
        }
      };
    });

    return () => {
      activeAnimations.forEach(item => item.cancel());
    };
  }, [animatedValues, isSmall]);

  return (
    <View style={[styles.waveformContainer, isSmall && { height: 20, gap: 2.5 }]}>
      {animatedValues.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveformBar,
            isSmall && { width: 2, height: 8, borderRadius: 1 },
            {
              transform: [{ scaleY: anim }],
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function StudyScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const { height: windowHeight } = useWindowDimensions();
  const centerSectionHeight = windowHeight - insets.top - insets.bottom - 600;

  // Custom swipe-back pan responder (Left-to-right gesture)
  const handleBackRef = useRef<() => void>(undefined);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 3;
        const isLeftToRight = gestureState.dx > 15;
        const isNearLeftEdge = gestureState.x0 < 80;
        return isHorizontalSwipe && isLeftToRight && isNearLeftEdge;
      },
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 70 && handleBackRef.current) {
          handleBackRef.current();
        }
      },
      onPanResponderTerminate: () => { },
      onShouldBlockNativeResponder: () => false,
    })
  ).current;

  // URL params if coming from Home Page Lobby
  const params = useLocalSearchParams<{ studyId?: string; newTopic?: string }>();
  const displayName = profile?.display_name?.split(' ')[0] || 'Estudante';

  // Screen selection state
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);

  // Studies list for switcher
  const [studies, setStudies] = useState<Study[]>([]);
  const [studiesSummaries, setStudiesSummaries] = useState<StudyJourneySummary[]>([]);
  const [currentStudy, setCurrentStudy] = useState<Study | null>(null);

  // Chat States
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [input, setInput] = useState('');
  const [lobbyInput, setLobbyInput] = useState('');
  const [dynamicSuggestions, setDynamicSuggestions] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Switcher bottom sheet state
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [creatingStudy, setCreatingStudy] = useState(false);
  const [processedTopic, setProcessedTopic] = useState<string | null>(null);

  // Voice transcription state and listeners
  const [recordingTarget, setRecordingTarget] = useState<'lobby' | 'chat' | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const getUserDailyLimit = () => {
    const plan = profile?.plan || 'free';
    if (plan === 'premium') return 200;
    if (plan === 'pro') return 50;
    return 15;
  };

  const userMessages = messages.filter(m => {
    if (m.role !== 'user') return false;
    const dateStr = m.created_at ? m.created_at.replace(' ', 'T').replace(/\.(\d{3})\d+/, '.$1') : '';
    const createdAt = dateStr ? new Date(dateStr).getTime() : 0;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return createdAt > oneDayAgo;
  });

  const userMessagesCount = userMessages.length;

  const getHoursUntilReset = () => {
    if (userMessages.length === 0) return 24;
    const timestamps = userMessages.map(m => {
      const dateStr = m.created_at ? m.created_at.replace(' ', 'T').replace(/\.(\d{3})\d+/, '.$1') : '';
      return dateStr ? new Date(dateStr).getTime() : 0;
    });
    const latestTimestamp = Math.max(...timestamps);
    const resetTime = latestTimestamp + 24 * 60 * 60 * 1000;
    const msLeft = resetTime - Date.now();
    const hoursLeft = Math.ceil(msLeft / (1000 * 60 * 60));
    return Math.max(1, hoursLeft);
  };

  useSpeechRecognitionEvent('start', () => setIsRecording(true));
  useSpeechRecognitionEvent('end', () => {
    setIsRecording(false);
    setRecordingTarget(null);
  });
  useSpeechRecognitionEvent('result', (event: any) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) {
      if (recordingTarget === 'lobby') {
        setLobbyInput(transcript);
      } else if (recordingTarget === 'chat') {
        setInput(transcript);
      }
    }
  });
  useSpeechRecognitionEvent('error', (event: any) => {
    console.error('Speech recognition error:', event.error, event.message);
    setIsRecording(false);
    setRecordingTarget(null);
  });

  const handleToggleVoice = async (target: 'lobby' | 'chat') => {
    if (USE_NATIVE_SPEECH_RECOGNITION) {
      if (!isSpeechRecognitionAvailable) {
        Alert.alert('Ditado não disponível', 'O ditado por voz via Apple Speech nativo requer uma build de desenvolvimento e não está disponível no Expo Go.');
        return;
      }
      if (isRecording && recordingTarget === target) {
        ExpoSpeechRecognitionModule.stop();
      } else {
        const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (granted) {
          setRecordingTarget(target);
          ExpoSpeechRecognitionModule.start({
            lang: 'pt-BR',
            interimResults: true,
          });
        } else {
          Alert.alert('Microfone', 'A permissão de acesso ao microfone é necessária para ditar.');
        }
      }
    } else {
      // Option 2: Record + Edge Function (Whisper/Gemini)
      if (isRecording) {
        if (recordingTarget !== target) return;
        setIsRecording(false);
        setTranscribing(true);
        try {
          const transcriptionText = await stopAudioRecordingAndTranscribe();
          if (transcriptionText) {
            if (target === 'lobby') {
              setLobbyInput(prev => prev ? `${prev} ${transcriptionText}` : transcriptionText);
            } else {
              setInput(prev => prev ? `${prev} ${transcriptionText}` : transcriptionText);
            }
          }
        } catch (err) {
          console.error('Transcription error:', err);
          Alert.alert('Erro', 'Falha ao transcrever o áudio.');
        } finally {
          setTranscribing(false);
          setRecordingTarget(null);
        }
      } else {
        const started = await startAudioRecording();
        if (started) {
          setRecordingTarget(target);
          setIsRecording(true);
        } else {
          Alert.alert('Microfone', 'A permissão de acesso ao microfone é necessária para ditar.');
        }
      }
    }
  };

  // Monitor params to switch study when redirected
  useEffect(() => {
    if (params.studyId) {
      setSelectedStudyId(params.studyId);
    }
  }, [params.studyId]);

  // Monitor params to start a new study from home lobby
  useEffect(() => {
    if (params.newTopic && params.newTopic !== processedTopic) {
      setProcessedTopic(params.newTopic);
      handleCreateStudy(params.newTopic);
    }
  }, [params.newTopic, processedTopic]);

  // Load studies list for switcher on mount and periodically
  useEffect(() => {
    if (user) {
      loadStudiesList();
    }
  }, [user, selectedStudyId]);

  // Load messages when study ID changes
  useEffect(() => {
    if (selectedStudyId) {
      loadStudyChat(selectedStudyId, true);
    } else {
      setMessages([]);
      setCurrentStudy(null);
    }
  }, [selectedStudyId]);

  // Load dynamic recommendations based on user interests using the algorithm
  useEffect(() => {
    async function loadDynamicSuggestions() {
      if (user) {
        try {
          const interests = await getTopInterests(user.id);
          if (interests && interests.length > 0) {
            const mapped = interests.slice(0, 4).map((interest) => {
              const cap = interest.charAt(0).toUpperCase() + interest.slice(1);
              return `Aprender ${cap}`;
            });
            // Use up to 4 interest-based suggestions
            setDynamicSuggestions(mapped.slice(0, 4));
          } else {
            setDynamicSuggestions([
              'Marketing Digital',
              'Programação Python',
              'Oratória e Liderança',
              'Finanças Pessoais',
            ]);
          }
        } catch (err) {
          console.error('Error fetching dynamic suggestions in study:', err);
        }
      }
    }
    loadDynamicSuggestions();
  }, [user]);

  const loadStudiesList = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('studies')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('last_activity_at', { ascending: false });

      if (!error && data) {
        setStudies(data as Study[]);

        // Fetch summaries in parallel
        const summaries = await Promise.all(
          data.map(async (study) => {
            try {
              return await fetchStudyJourneySummary({
                studyId: study.id,
                userId: user.id,
                title: study.title,
              });
            } catch (err) {
              console.error('Error fetching summary for study:', study.id, err);
              return null;
            }
          })
        );
        setStudiesSummaries(summaries.filter(Boolean) as StudyJourneySummary[]);
      }
    } catch (e) {
      console.error('Error fetching studies switcher list:', e);
    }
  };

  const loadStudyChat = async (studyId: string, isFirstLoad = false) => {
    try {
      if (isFirstLoad) {
        setLoadingMessages(true);
      }

      const { data: studyData } = await supabase
        .from('studies')
        .select('*')
        .eq('id', studyId)
        .single();

      if (studyData) {
        setCurrentStudy(studyData as Study);
      }

      const { data: msgs, error } = await supabase
        .from('study_messages')
        .select('*')
        .eq('study_id', studyId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((msgs || []) as StudyMessage[]);

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 300);

    } catch (e) {
      console.error('Error loading study chat:', e);
      if (isFirstLoad) {
        setSelectedStudyId(null);
      }
    } finally {
      if (isFirstLoad) {
        setLoadingMessages(false);
      }
    }
  };

  const handleCreateStudy = async (topic: string) => {
    const cleanTopic = topic.trim();
    if (!cleanTopic || !user || creatingStudy) return;

    // Check active plan limits
    const activeCount = studies.length;
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single();

    const plan = profile?.plan || 'free';
    const limit = plan === 'pro' ? 50 : plan === 'premium' ? 9999 : 5;

    if (activeCount >= limit) {
      Alert.alert(
        'Limite atingido',
        'Você atingiu o limite de estudos ativos para o seu plano grátis. Arquive estudos ou faça upgrade para continuar.'
      );
      return;
    }

    try {
      setCreatingStudy(true);
      setSending(true);

      // 1. Track topic interest query
      await trackUserInteraction(user.id, 'search', [cleanTopic]);

      // 2. Create study
      const { data: studyData, error: studyError } = await supabase
        .from('studies')
        .insert({
          user_id: user.id,
          title: `Aprender ${cleanTopic}`,
          status: 'active',
          plan_at_creation: plan,
        })
        .select()
        .single();

      if (studyError) throw studyError;

      // 3. Setup initial onboarding assistant messages
      const now = new Date().toISOString();
      const initialUserMsg = `Olá! Quero aprender sobre ${cleanTopic}`;
      const initialAssistantMsg = `Olá! Vamos estruturar seu estudo em ${cleanTopic}.\n\nAntes de eu te guiar, quero calibrar o seu ponto de partida.\n\nVocê já teve algum contato com esse tema, ou está começando do zero?`;

      const initialSuggestions = [
        'Estou começando do zero',
        'Já conheço um pouco',
        'Quero aprofundar tópicos avançados'
      ];

      const { error: msgError } = await supabase.from('study_messages').insert([
        {
          study_id: studyData.id,
          role: 'user',
          content: initialUserMsg,
          created_at: now,
        },
        {
          study_id: studyData.id,
          role: 'assistant',
          content: initialAssistantMsg,
          metadata: {
            active_mode: 'onboard',
            follow_up_suggestions: initialSuggestions,
            citations: [],
            ui_blocks: [],
            checkpoint_generated: false,
          },
          created_at: now,
        }
      ]);

      if (msgError) throw msgError;

      // 4. Setup AI State
      await supabase.from('study_ai_state').insert({
        study_id: studyData.id,
        user_goal: cleanTopic,
        current_focus: cleanTopic,
        learner_level: 'unknown',
        active_mode: 'onboard',
        next_best_action: 'Entender seu nível atual antes de montar a melhor direção.',
        open_questions: initialSuggestions,
      });

      setInput('');
      setSelectedStudyId(studyData.id);

    } catch (e) {
      console.error('Error creating study:', e);
      Alert.alert('Erro', 'Não foi possível inicializar seu estudo.');
    } finally {
      setCreatingStudy(false);
      setSending(false);
    }
  };

  const handleSendMessage = async (textOverride?: string) => {
    const resolvedMessage = (textOverride ?? input).trim();
    if (!resolvedMessage || !user || sending) return;

    // If no active study is loaded, typing in empty chat creates a new study
    if (!selectedStudyId) {
      await handleCreateStudy(resolvedMessage);
      return;
    }

    setInput('');
    const optimisticMessage: StudyMessage = {
      id: `local-user-${Date.now()}`,
      study_id: selectedStudyId,
      role: 'user',
      content: resolvedMessage,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, optimisticMessage]);
    setSending(true);

    try {
      // 1. Fetch user interests and difficulties dynamically
      const [topInterests, activeDifficulties] = await Promise.all([
        getTopInterests(user.id),
        getActiveDifficulties(user.id),
      ]);

      // 2. Invoke Chat Edge Function passing the hidden profiling context
      const { data: aiData, error: aiError } = await supabase.functions.invoke('classy-chat', {
        body: {
          studyId: selectedStudyId,
          message: resolvedMessage,
          user_interests: topInterests,
          user_difficulties: activeDifficulties,
        },
      });

      if (aiError) throw aiError;

      if (aiData.limitReached) {
        Alert.alert('Limite atingido', 'Você atingiu o limite de envios do seu plano.');
        setSending(false);
        return;
      }

      // 3. Persist user message
      await supabase.from('study_messages').insert({
        study_id: selectedStudyId,
        role: 'user',
        content: resolvedMessage,
      });

      // 4. Persist assistant message
      await supabase.from('study_messages').insert({
        study_id: selectedStudyId,
        role: 'assistant',
        content: aiData.message,
        metadata: {
          active_mode: aiData.studyState?.active_mode || 'explain',
          follow_up_suggestions: aiData.suggestions || [],
          citations: aiData.citations || [],
        },
        related_contents: aiData.relatedContents || null,
      });

      // Reload fresh chat list
      loadStudyChat(selectedStudyId);

    } catch (e) {
      console.error('Error sending study message:', e);
      Alert.alert('Erro', 'Houve um problema de conexão com a Classy IA.');
    } finally {
      setSending(false);
    }
  };

  const handleDeleteStudy = async (studyId: string) => {
    Alert.alert(
      'Excluir Estudo',
      'Deseja realmente excluir esta jornada? Todo o histórico de chat será apagado.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('study_messages').delete().eq('study_id', studyId);
              await supabase.from('study_ai_state').delete().eq('study_id', studyId);
              await supabase.from('studies').delete().eq('id', studyId);

              if (selectedStudyId === studyId) {
                setSelectedStudyId(null);
              }
              loadStudiesList();
              setSwitcherOpen(false);
            } catch (e) {
              console.error('Error deleting study:', e);
              Alert.alert('Erro', 'Não foi possível excluir o estudo.');
            }
          }
        }
      ]
    );
  };

  const renderMessageItem = ({ item }: { item: StudyMessage }) => {
    const isUser = item.role === 'user';
    const suggestions = item.metadata?.follow_up_suggestions || [];
    const relatedContents = item.related_contents || [];

    return (
      <View style={[styles.msgWrapper, isUser ? styles.msgWrapperRight : styles.msgWrapperLeft]}>
        {!isUser && (
          <View style={styles.classyAvatar}>
            <Zap size={13} color="#fff" />
          </View>
        )}
        <View style={styles.msgContentBlock}>
          <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleClassy]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
          </View>

          {/* Video Recommendations Rail */}
          {!isUser && relatedContents.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.relatedCarousel}
            >
              {relatedContents.map((content: any) => (
                <Pressable
                  key={content.id}
                  style={styles.contentCard}
                  onPress={async () => {
                    // Track click interaction to feed algorithmic profiling
                    if (user) {
                      await trackUserInteraction(user.id, 'click', content.tags, content.category_id);
                    }
                    router.push({ pathname: `/watch/${content.id}`, params: { studyId: selectedStudyId } } as any);
                  }}
                >
                  <Image
                    source={{ uri: content.thumbnail_url || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=300&h=180&fit=crop' }}
                    style={styles.cardThumbnail}
                  />
                  <View style={styles.cardMeta}>
                    <Text numberOfLines={2} style={styles.cardTitle}>
                      {content.title}
                    </Text>
                    <View style={styles.cardPlayRow}>
                      <Play size={10} color={colors.accent} style={{ marginRight: 4 }} />
                      <Text style={styles.cardDuration}>
                        {content.duration_minutes ? `${content.duration_minutes} min` : 'Assistir'}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Quick-reply Suggestion Chips */}
          {!isUser && suggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {suggestions.map((text, idx) => (
                <Pressable
                  key={idx}
                  style={({ pressed }) => [
                    styles.suggestionChip,
                    pressed && styles.suggestionChipPressed,
                  ]}
                  onPress={() => handleSendMessage(text)}
                >
                  <Text style={styles.suggestionText}>{text}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  };

  const handleBack = () => {
    if (selectedStudyId) {
      setSelectedStudyId(null);
      setCurrentStudy(null);
      router.setParams({ studyId: undefined });
    } else {
      router.push('/');
    }
  };

  useEffect(() => {
    handleBackRef.current = handleBack;
  }, [selectedStudyId]);

  return (
    <AppScreen scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 50 : 0}
        {...panResponder.panHandlers}
      >
        {/* Header Switcher */}
        <View style={styles.chatHeader}>
          <Pressable onPress={handleBack} style={styles.backBtn}>
            <ArrowLeft size={20} color={colors.text} />
          </Pressable>

          {user ? (
            <Pressable onPress={() => setSwitcherOpen(true)} style={styles.headerSwitcher}>
              <Text numberOfLines={1} style={styles.chatHeaderTitle}>
                {selectedStudyId && currentStudy ? toShortTitle(currentStudy.title) : 'Nova Conversa'}
              </Text>
              <ChevronDown size={14} color={colors.muted} />
            </Pressable>
          ) : (
            <Text style={styles.chatHeaderTitle}>Classy IA</Text>
          )}

          {selectedStudyId ? (
            <Pressable onPress={() => setLimitModalOpen(true)} style={styles.limitPill}>
              <Text style={styles.limitPillText}>
                {userMessagesCount}/{getUserDailyLimit()}
              </Text>
            </Pressable>
          ) : (
            <View style={{ width: 28 }} />
          )}
        </View>

        {user ? (
          !selectedStudyId ? (
            // LOBBY — Chat-style AI welcome with solid black background
            <View style={styles.lobbyOuter}>
              <ScrollView
                contentContainerStyle={styles.lobbyScrollContainer}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={[styles.lobbyCenterSection, { height: centerSectionHeight }]}>
                  <View style={styles.lobbyHero}>
                    <Text style={styles.lobbyHeroTitle}>Classy IA</Text>
                    <Text style={styles.lobbyHeroSubtitle}>Estudos personalizados alimentados por inteligência artificial.</Text>
                  </View>

                  {/* Central chat creation box */}
                  <View style={styles.lobbyInputWrapper}>
                    <TextInput
                      style={styles.lobbyTextInput}
                      placeholder="O que você quer aprender hoje?"
                      placeholderTextColor="rgba(255, 255, 255, 0.35)"
                      value={lobbyInput}
                      onChangeText={setLobbyInput}
                      multiline
                      returnKeyType="send"
                      onSubmitEditing={() => {
                        if (lobbyInput.trim()) {
                          handleCreateStudy(lobbyInput);
                          setLobbyInput('');
                        }
                      }}
                    />
                    <View style={styles.lobbyInputFooter}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Pressable
                          style={[
                            styles.lobbyMicBtn,
                            isRecording && recordingTarget === 'lobby' && styles.lobbyMicBtnRecording
                          ]}
                          onPress={() => handleToggleVoice('lobby')}
                          disabled={transcribing}
                        >
                          {transcribing && recordingTarget === 'lobby' ? (
                            <ActivityIndicator size="small" color={colors.accent} />
                          ) : isRecording && recordingTarget === 'lobby' ? (
                            <Square size={12} color="#EF4444" fill="#EF4444" />
                          ) : (
                            <Mic
                              size={17}
                              color="rgba(255, 255, 255, 0.5)"
                            />
                          )}
                        </Pressable>

                        {isRecording && recordingTarget === 'lobby' && (
                          <WaveformVisualizer size="small" />
                        )}
                      </View>

                      <Pressable
                        onPress={() => {
                          if (lobbyInput.trim()) {
                            handleCreateStudy(lobbyInput);
                            setLobbyInput('');
                          }
                        }}
                        style={[
                          styles.lobbySendBtn,
                          !lobbyInput.trim() && { opacity: 0.4 },
                        ]}
                        disabled={!lobbyInput.trim() || creatingStudy}
                      >
                        {creatingStudy ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <ArrowUp size={17} color="#FFF" />
                        )}
                      </Pressable>
                    </View>
                  </View>

                  {/* Suggestion chips — max 4 */}
                  <View style={styles.lobbySuggestionsRow}>
                    {dynamicSuggestions.slice(0, 4).map((text, idx) => (
                      <Pressable
                        key={idx}
                        style={styles.lobbySuggestionChip}
                        onPress={() => handleCreateStudy(text)}
                      >
                        <Text style={styles.lobbySuggestionChipText}>{text}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                {/* Active Studies */}
                {studiesSummaries.length > 0 && (
                  <View style={styles.activeStudiesSection}>
                    <Text style={styles.activeStudiesHeading}>Continue de onde parou</Text>
                    {studiesSummaries.map((summary) => (
                      <View key={summary.studyId} style={styles.studySummaryCard}>
                        {/* Background video/image preview */}
                        {summary.backgroundVideoUrl ? (
                          <Video
                            source={{ uri: summary.backgroundVideoUrl }}
                            style={styles.cardVideoBg}
                            resizeMode={ResizeMode.COVER}
                            shouldPlay
                            isLooping
                            isMuted
                            useNativeControls={false}
                          />
                        ) : summary.thumbnailUrl ? (
                          <Image
                            source={{ uri: summary.thumbnailUrl }}
                            style={styles.cardVideoBg}
                            resizeMode="cover"
                          />
                        ) : null}
                        <View style={styles.cardVideoOverlay} />

                        <View style={styles.cardContent}>
                          <Text
                            style={
                              summary.progressPercent >= 100
                                ? styles.studySummaryTitleCompleted
                                : styles.studySummaryTitle
                            }
                            numberOfLines={2}
                          >
                            {summary.title}
                          </Text>

                          {/* Progress */}
                          <View style={styles.progressRow}>
                            <Text style={styles.progressText}>{summary.progressPercent}% concluído</Text>
                          </View>
                          <View style={styles.progressBarBg}>
                            <View
                              style={[
                                styles.progressBarFill,
                                { width: `${summary.progressPercent}%` as any },
                              ]}
                            />
                          </View>

                          {/* Metrics with Lucide icons */}
                          <View style={styles.metricsRow}>
                            <View style={styles.metricItemRow}>
                              <ListVideo size={11} color="rgba(255,255,255,0.45)" />
                              <Text style={styles.metricItem}>{summary.videosCount} vídeos</Text>
                            </View>
                            <View style={styles.metricItemRow}>
                              <FileText size={11} color="rgba(255,255,255,0.45)" />
                              <Text style={styles.metricItem}>{summary.notesCount} notas</Text>
                            </View>
                            <View style={styles.metricItemRow}>
                              <Timer size={11} color="rgba(255,255,255,0.45)" />
                              <Text style={styles.metricItem}>{summary.estimatedMinutes}min</Text>
                            </View>
                          </View>

                          {/* Classy status */}
                          <Text style={styles.classyStatusText}>{summary.summaryLine}</Text>

                          {/* Actions */}
                          <View style={styles.cardActionsRow}>
                            <Pressable
                              style={styles.continueStudyBtn}
                              onPress={() => setSelectedStudyId(summary.studyId)}
                            >
                              <Play size={12} color="#FFF" />
                              <Text style={styles.continueStudyBtnText}>Continuar</Text>
                            </Pressable>
                            <Pressable
                              style={styles.detailsStudyBtn}
                              onPress={() => setSelectedStudyId(summary.studyId)}
                            >
                              <Text style={styles.detailsStudyBtnText}>Ver detalhes</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          ) : loadingMessages ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            // ACTIVE STUDY CHAT VIEW
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessageItem}
              contentContainerStyle={styles.chatList}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={
                sending ? (
                  <View style={styles.thinkingContainer}>
                    <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 8 }} />
                    <Text style={styles.thinkingText}>Classy está pensando...</Text>
                  </View>
                ) : null
              }
            />
          )
        ) : (
          // AUTH REQUIRED NOTICE
          <View style={styles.authNotice}>
            <AlertTriangle size={32} color={colors.accent} style={{ marginBottom: spacing.sm }} />
            <Text style={styles.authNoticeTitle}>Área Restrita</Text>
            <Text style={styles.authNoticeBody}>
              Faça login no Classfy para abrir conversas de estudo personalizadas com a Classy IA e sincronizar o seu progresso.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.authBtnBanner, pressed && styles.authBtnPressed]}
              onPress={() => router.push('/auth/sign-in')}
            >
              <Text style={styles.authBtnText}>Fazer Login</Text>
            </Pressable>
          </View>
        )}

        {/* Floating Bottom Prompt Input — only visible inside an active study */}
        {user && selectedStudyId && (
          <View style={styles.inputContainer}>
            <View style={styles.inputPillWrapper}>
              <TextInput
                style={styles.pillTextInput}
                value={input}
                onChangeText={setInput}
                placeholder="Pergunte à Classy..."
                placeholderTextColor="rgba(255, 255, 255, 0.4)"
                editable={!sending}
                multiline
              />
              {(input.trim().length === 0 || transcribing || isRecording) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {isRecording && recordingTarget === 'chat' && (
                    <WaveformVisualizer size="small" />
                  )}
                  <Pressable
                    style={[
                      styles.micBtn,
                      isRecording && recordingTarget === 'chat' && styles.micBtnRecording
                    ]}
                    onPress={() => handleToggleVoice('chat')}
                    disabled={transcribing}
                  >
                    {transcribing && recordingTarget === 'chat' ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : isRecording && recordingTarget === 'chat' ? (
                      <Square size={14} color="#EF4444" fill="#EF4444" />
                    ) : (
                      <Mic size={18} color={isRecording && recordingTarget === 'chat' ? '#EF4444' : colors.muted} />
                    )}
                  </Pressable>
                </View>
              )}
            </View>

            <Pressable
              onPress={() => handleSendMessage()}
              style={({ pressed }) => [
                styles.sendBtn,
                (!input.trim() || sending) && styles.sendBtnDisabled,
                pressed && styles.sendBtnPressed,
              ]}
              disabled={!input.trim() || sending}
            >
              <ArrowUp size={16} color={!input.trim() ? 'rgba(255, 255, 255, 0.4)' : '#000'} />
            </Pressable>
          </View>
        )}

        {/* Switcher Bottom Sheet Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={switcherOpen}
          onRequestClose={() => setSwitcherOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSwitcherOpen(false)} />
            <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + spacing.md }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Seus Estudos</Text>
                <Pressable onPress={() => setSwitcherOpen(false)} style={styles.sheetCloseBtn}>
                  <X size={18} color={colors.text} />
                </Pressable>
              </View>

              <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
                {studies.length === 0 ? (
                  <View style={styles.emptySheetBlock}>
                    <Text style={styles.emptySheetText}>Nenhum estudo ativo.</Text>
                  </View>
                ) : (
                  studies.map((study) => (
                    <View key={study.id} style={styles.sheetRow}>
                      <Pressable
                        style={styles.sheetRowClick}
                        onPress={() => {
                          setSelectedStudyId(study.id);
                          setSwitcherOpen(false);
                        }}
                      >
                        <BookOpen size={16} color={selectedStudyId === study.id ? colors.accent : colors.muted} style={{ marginRight: 10 }} />
                        <Text
                          style={[
                            styles.sheetRowText,
                            selectedStudyId === study.id && styles.sheetRowTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {toShortTitle(study.title)}
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => handleDeleteStudy(study.id)} style={styles.sheetDeleteBtn}>
                        <Trash2 size={16} color="#ef4444" />
                      </Pressable>
                    </View>
                  ))
                )}

                <Pressable
                  style={({ pressed }) => [
                    styles.sheetAddBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => {
                    setSelectedStudyId(null);
                    setSwitcherOpen(false);
                  }}
                >
                  <Plus size={16} color={colors.accent} style={{ marginRight: 8 }} />
                  <Text style={styles.sheetAddText}>Iniciar Novo Estudo</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Limit Info Bottom Sheet Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={limitModalOpen}
          onRequestClose={() => setLimitModalOpen(false)}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setLimitModalOpen(false)} />
            <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Limite de Mensagens</Text>
                <Pressable onPress={() => setLimitModalOpen(false)} style={styles.sheetCloseBtn}>
                  <X size={18} color={colors.text} />
                </Pressable>
              </View>

              <View style={styles.limitModalBody}>
                <View style={styles.limitModalIconContainer}>
                  <Crown size={28} color={colors.accent} />
                </View>

                <Text style={styles.limitModalTitle}>
                  Você está no Plano {(profile?.plan || 'free').toUpperCase()}
                </Text>

                <Text style={styles.limitModalDescription}>
                  {userMessagesCount > 0 ? (
                    `Você utilizou parte do seu uso diário; ele será totalmente renovado em ${getHoursUntilReset()} ${getHoursUntilReset() === 1 ? 'hora' : 'horas'}.`
                  ) : (
                    "Você possui todas as interações diárias disponíveis neste estudo."
                  )}
                </Text>

                <View style={styles.limitProgressBarContainer}>
                  <View
                    style={[
                      styles.limitProgressBarFill,
                      { width: `${Math.min(100, (userMessagesCount / getUserDailyLimit()) * 100)}%` }
                    ]}
                  />
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.limitUpgradeBtn,
                    pressed && styles.limitUpgradeBtnPressed
                  ]}
                  onPress={() => {
                    setLimitModalOpen(false);
                    router.push('/premium');
                  }}
                >
                  <Text style={styles.limitUpgradeBtnText}>Fazer Upgrade e Mensagens Ilimitadas</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  chatHeader: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  backBtn: {
    padding: spacing.xs,
  },
  headerSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    maxWidth: 200,
  },
  chatHeaderTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weightBold,
    marginRight: 4,
  },
  lobbyOuter: {
    flex: 1,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  lobbyBlurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(30, 10, 40, 0.55)',
  },
  lobbyScrollContainer: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  lobbyCenterSection: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    minHeight: 460,
  },
  glowSpot1: {
    position: 'absolute',
    top: '12%',
    left: '-15%',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(225, 29, 72, 0.22)',
  },
  glowSpot2: {
    position: 'absolute',
    top: '38%',
    right: '-20%',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
  },
  glowSpot3: {
    position: 'absolute',
    bottom: '15%',
    left: '-10%',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(225, 29, 72, 0.15)',
  },
  neonArcGlow: {
    position: 'absolute',
    top: -100,
    left: '-30%',
    right: '-30%',
    height: 220,
    borderRadius: 160,
    backgroundColor: 'rgba(225, 29, 72, 0.12)',
    shadowColor: '#E11D48',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 80,
    zIndex: 0,
  },
  lobbyHero: {
    alignItems: 'center',
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
  },
  lobbyHeroTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  lobbyHeroSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  lobbyInputWrapper: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  lobbyTextInput: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
    minHeight: 52,
    textAlignVertical: 'top',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  lobbyInputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 1,
    paddingTop: spacing.xs,
  },
  lobbyMicBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  lobbyMicBtnRecording: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
  },
  lobbySendBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  lobbySuggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'center',
    marginBottom: spacing.xxl,
  },
  lobbySuggestionChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  lobbySuggestionChipText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '400',
  },
  activeStudiesSection: {
    marginTop: spacing.sm,
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 1,
    paddingTop: spacing.xl,
  },
  activeStudiesHeading: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: spacing.md,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  studySummaryCard: {
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    minHeight: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  cardVideoBg: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.25,
  },
  cardVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,8,18,0.65)',
  },
  cardContent: {
    padding: spacing.lg,
  },
  studySummaryTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: spacing.xs,
    lineHeight: 21,
  },
  studySummaryTitleCompleted: {
    color: '#4ADE80',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  progressText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '400',
  },
  progressBarBg: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.full,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  metricItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricItem: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '400',
  },
  classyStatusText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '400',
    marginBottom: spacing.md,
    lineHeight: 16,
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  continueStudyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1.2,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    height: 34,
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  continueStudyBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '500',
  },
  detailsStudyBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: radius.md,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsStudyBtnText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '400',
  },
  chatList: {
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
  },
  msgWrapper: {
    flexDirection: 'row',
    width: '100%',
    marginVertical: 4,
  },
  msgWrapperLeft: {
    justifyContent: 'flex-start',
  },
  msgWrapperRight: {
    justifyContent: 'flex-end',
  },
  classyAvatar: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 28,
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: 2,
    width: 28,
  },
  msgContentBlock: {
    flex: 1,
    maxWidth: '85%',
  },
  bubble: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleUser: {
    backgroundColor: colors.accent,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2,
  },
  bubbleClassy: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2,
  },
  bubbleText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
  },
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 36,
    paddingVertical: spacing.sm,
  },
  thinkingText: {
    color: colors.muted,
    fontSize: 12,
  },
  inputContainer: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? 8 : spacing.md,
  },
  inputPillWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#27272a',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: spacing.md,
    minHeight: 40,
    maxHeight: 100,
  },
  pillTextInput: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    paddingTop: 8,
    paddingBottom: 8,
  },
  micBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 30,
    width: 30,
    marginLeft: 4,
    borderRadius: radius.full,
  },
  micBtnRecording: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  sendBtn: {
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: radius.full,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  sendBtnDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  sendBtnPressed: {
    opacity: 0.8,
  },
  suggestionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  suggestionChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  suggestionChipPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  suggestionText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
  },
  relatedCarousel: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  contentCard: {
    backgroundColor: '#111',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    width: 180,
  },
  cardThumbnail: {
    aspectRatio: 16 / 9,
    width: '100%',
  },
  cardMeta: {
    padding: spacing.sm,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weightBold,
    marginBottom: 4,
  },
  cardPlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardDuration: {
    color: colors.muted,
    fontSize: 9,
  },
  authNotice: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    marginTop: spacing.xl,
    flex: 1,
    justifyContent: 'center',
  },
  authNoticeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    marginBottom: spacing.xs,
  },
  authNoticeBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  authBtnBanner: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  authBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  authBtnPressed: {
    opacity: 0.8,
  },

  // Switcher Bottom Sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '65%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: 1,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: typography.weightBold,
  },
  sheetCloseBtn: {
    padding: 4,
  },
  sheetScroll: {
    marginBottom: spacing.md,
  },
  emptySheetBlock: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptySheetText: {
    color: colors.muted,
    fontSize: 13,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  sheetRowClick: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sheetRowText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: typography.weightMedium,
    flex: 1,
  },
  sheetRowTextActive: {
    color: colors.accent,
    fontWeight: typography.weightBold,
  },
  sheetDeleteBtn: {
    padding: spacing.sm,
  },
  sheetAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  sheetAddText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    gap: 3.5,
  },
  waveformBar: {
    width: 2.5,
    height: 14,
    backgroundColor: '#EF4444',
    borderRadius: 1.25,
  },
  voiceRecordingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 24,
    paddingHorizontal: 8,
    height: 46,
    flex: 1,
  },
  voiceStopBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  voiceStopSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  voiceSendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waveformWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginRight: spacing.xs,
  },
  limitPillText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 10,
    fontWeight: '600',
  },
  limitModalBody: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  limitModalIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  limitModalTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  limitModalDescription: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.lg,
  },
  limitProgressBarContainer: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  limitProgressBarFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  limitUpgradeBtn: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitUpgradeBtnPressed: {
    opacity: 0.85,
  },
  limitUpgradeBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
});
