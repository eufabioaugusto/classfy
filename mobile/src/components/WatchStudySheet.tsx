import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Animated,
  PanResponder,
  useWindowDimensions,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';
import { useBottomSheetScroll } from '@/hooks/useBottomSheetScroll';
import { registerDifficulty, getTopInterests, getActiveDifficulties } from '@/lib/interests';

type TabType = 'notes' | 'transcript' | 'quiz' | 'suggestions' | 'classy' | 'modules';

type WatchStudySheetProps = {
  visible: boolean;
  contentId: string;
  contentTitle: string;
  isCourse?: boolean;
  lessonId?: string | null;
  getCurrentPosition: () => number;
  onSeekTo: (seconds: number) => void;
  onClose: () => void;
  initialTab?: TabType;
  studyId?: string | null;
  courseModules?: any[];
  completedLessons?: string[];
  onSelectLesson?: (lesson: any) => void;
  progressPercent?: number;
  onStudyIdCreated?: (newStudyId: string) => void;
};

type Note = {
  id: string;
  note_text: string;
  timestamp_seconds: number | null;
  created_at: string;
};

type Question = {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
};

type QuizData = {
  id: string;
  questions: Question[];
};

type StudyMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
};

export function WatchStudySheet({
  visible,
  contentId,
  contentTitle,
  isCourse = false,
  lessonId = null,
  getCurrentPosition,
  onSeekTo,
  onClose,
  initialTab = 'notes',
  studyId = null,
  courseModules = [],
  completedLessons = [],
  onSelectLesson,
  progressPercent = 0,
  onStudyIdCreated,
}: WatchStudySheetProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  const [activeStudyId, setActiveStudyId] = useState<string | null>(studyId);
  const [userStudies, setUserStudies] = useState<any[]>([]);
  const [loadingStudies, setLoadingStudies] = useState(false);
  const [creatingStudy, setCreatingStudy] = useState(false);
  const [newStudyTitle, setNewStudyTitle] = useState('');

  // Sync activeStudyId when prop changes
  useEffect(() => {
    setActiveStudyId(studyId);
  }, [studyId]);

  const changeActiveStudyId = (newId: string) => {
    setActiveStudyId(newId);
    onStudyIdCreated?.(newId);
  };

  const tabList = useMemo<TabType[]>(() => {
    const list: TabType[] = [];
    if (isCourse) list.push('modules');
    if (user) list.push('classy');
    list.push('notes', 'transcript', 'quiz', 'suggestions');
    return list;
  }, [isCourse, user]);
  const {
    scrollEnabled,
    handleScroll,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    isScrollAtTop,
    setIsScrollAtTop,
  } = useBottomSheetScroll();

  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const playerHeight = isLandscape ? 0 : windowWidth * (9 / 16);
  const playerBottom = isLandscape ? 20 : insets.top + 12 + playerHeight;
  const maxSheetHeight = windowHeight - playerBottom;

  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  // Auto-expand the module containing the active lesson
  useEffect(() => {
    if (lessonId && courseModules.length > 0) {
      const activeModule = courseModules.find(mod =>
        mod.lessons?.some((l: any) => l.id === lessonId)
      );
      if (activeModule) {
        setExpandedModules(prev => ({ ...prev, [activeModule.id]: true }));
      }
    }
  }, [lessonId, courseModules, visible]);

  useEffect(() => {
    if (visible) {
      sheetTranslateY.setValue(0);
      setIsScrollAtTop(true);
    }
  }, [visible, setIsScrollAtTop]);

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          isScrollAtTop && gestureState.dy > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          isScrollAtTop && gestureState.dy > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            sheetTranslateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 120 || gestureState.vy > 0.5) {
            Animated.timing(sheetTranslateY, {
              toValue: Dimensions.get('window').height,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              onClose();
            });
          } else {
            Animated.spring(sheetTranslateY, {
              toValue: 0,
              friction: 8,
              tension: 80,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [onClose, sheetTranslateY, isScrollAtTop]
  );

  useEffect(() => {
    if (visible && initialTab) {
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

  // Classy Chat state
  const [chatMessages, setChatMessages] = useState<StudyMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatFlatListRef = useRef<FlatList>(null);

  // Notes state
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [notesSubmitting, setNotesSubmitting] = useState(false);

  // Transcript state
  const [transcript, setTranscript] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [generatingTranscript, setGeneratingTranscript] = useState(false);

  // Quiz state
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizScore, setQuizScore] = useState(0);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [quizStartTime, setQuizStartTime] = useState<number | null>(null);

  // Suggestions state
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Formatting helpers
  const formatTime = (seconds: number | null) => {
    if (seconds === null || seconds === undefined) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatViewsCount = (count?: number | null) => {
    if (!count) return '0';
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return String(count);
  };

  // FETCH FUNCTIONS
  const fetchNotes = useCallback(async () => {
    if (!user || !contentId) return;
    setNotesLoading(true);
    try {
      const query = supabase
        .from('study_notes')
        .select('id, note_text, timestamp_seconds, created_at')
        .eq('user_id', user.id);

      if (isCourse && lessonId) {
        query.eq('lesson_id', lessonId);
      } else {
        query.eq('content_id', contentId);
      }

      const { data, error } = await query.order('timestamp_seconds', {
        ascending: true,
        nullsFirst: false,
      });

      if (!error && data) {
        setNotes(data);
      }
    } catch (err) {
      console.error('Error fetching notes:', err);
    } finally {
      setNotesLoading(false);
    }
  }, [contentId, user, isCourse, lessonId]);

  const fetchTranscript = useCallback(async () => {
    if (!contentId) return;
    setTranscriptLoading(true);
    try {
      const { data, error } = await supabase
        .from('transcriptions')
        .select('text')
        .eq('content_id', contentId)
        .maybeSingle();

      if (!error && data) {
        setTranscript(data.text || '');
      } else {
        setTranscript('');
      }
    } catch (err) {
      console.error('Error fetching transcript:', err);
    } finally {
      setTranscriptLoading(false);
    }
  }, [contentId]);

  const fetchSuggestions = useCallback(async () => {
    if (!contentId) return;
    setSuggestionsLoading(true);
    try {
      const { data, error } = await supabase
        .from('contents')
        .select('id, title, thumbnail_url, duration_seconds, views_count, creator:creator_id(display_name)')
        .neq('id', contentId)
        .limit(4);

      if (!error && data) {
        setSuggestions(data);
      }
    } catch (err) {
      console.error('Error fetching suggestions:', err);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [contentId]);

  const fetchUserStudies = useCallback(async () => {
    if (!user) return;
    setLoadingStudies(true);
    try {
      const { data, error } = await supabase
        .from('studies')
        .select('id, title, created_at')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setUserStudies(data);
      }
    } catch (err) {
      console.error('Error fetching user studies:', err);
    } finally {
      setLoadingStudies(false);
    }
  }, [user]);

  const handleCreateStudyPlan = async (titleToUse?: string) => {
    if (!user) return;
    const finalTitle = (titleToUse || newStudyTitle || `Aprender sobre ${contentTitle}`).trim();
    if (!finalTitle) {
      Alert.alert('Erro', 'Por favor, insira um tema ou título.');
      return;
    }
    setCreatingStudy(true);
    try {
      // 1. Get user profile plan
      const { data: profile } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', user.id)
        .single();
      const plan = profile?.plan || 'free';

      // 2. Check active plan limits
      const limit = plan === 'pro' ? 50 : plan === 'premium' ? 9999 : 5;

      const { count: activeCount, error: countError } = await supabase
        .from('studies')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (countError) throw countError;

      if (activeCount !== null && activeCount >= limit) {
        Alert.alert(
          'Limite atingido',
          'Você atingiu o limite de estudos ativos para o seu plano grátis. Arquive estudos ou faça upgrade para continuar.'
        );
        return;
      }

      // 3. Create study
      const { data: studyData, error: studyError } = await supabase
        .from('studies')
        .insert({
          user_id: user.id,
          title: finalTitle,
          status: 'active',
          plan_at_creation: plan,
        })
        .select()
        .single();

      if (studyError) throw studyError;

      // 4. Setup initial onboarding assistant messages
      const now = new Date().toISOString();
      const initialUserMsg = `Olá! Quero aprender sobre ${finalTitle}`;
      const initialAssistantMsg = `Olá! Vamos estruturar seu estudo em ${finalTitle}.\n\nAntes de eu te guiar, quero calibrar o seu ponto de partida.\n\nVocê já teve algum contato com esse tema, ou está começando do zero?`;
      
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
          metadata: {},
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

      // 5. Setup AI State
      await supabase.from('study_ai_state').insert({
        study_id: studyData.id,
        user_goal: finalTitle,
        current_focus: finalTitle,
        learner_level: 'unknown',
        active_mode: 'onboard',
        next_best_action: 'Entender seu nível atual antes de montar a melhor direção.',
        open_questions: initialSuggestions,
      });

      // 6. Activate study session in state
      changeActiveStudyId(studyData.id);
      setNewStudyTitle('');
      
    } catch (err) {
      console.error('Error creating study plan:', err);
      Alert.alert('Erro', 'Não foi possível criar o plano de estudo.');
    } finally {
      setCreatingStudy(false);
    }
  };

  const fetchStudyMessages = useCallback(async () => {
    if (!activeStudyId) return;
    setChatLoading(true);
    try {
      const { data, error } = await supabase
        .from('study_messages')
        .select('id, role, content, metadata, created_at')
        .eq('study_id', activeStudyId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        setChatMessages(data as StudyMessage[]);
        setTimeout(() => {
          chatFlatListRef.current?.scrollToEnd({ animated: true });
        }, 300);
      }
    } catch (err) {
      console.error('Error fetching study messages in watch sheet:', err);
    } finally {
      setChatLoading(false);
    }
  }, [activeStudyId]);

  const handleSendClassyMessage = async (textOverride?: string) => {
    const userMsgText = (textOverride || chatInput).trim();
    if (!user || !activeStudyId || !userMsgText || chatSending) return;
    
    if (!textOverride) {
      setChatInput('');
    }
    setChatSending(true);

    const optimisticUserMsg: StudyMessage = {
      id: Math.random().toString(),
      role: 'user',
      content: userMsgText,
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, optimisticUserMsg]);
    setTimeout(() => {
      chatFlatListRef.current?.scrollToEnd({ animated: true });
    }, 200);

    try {
      const [topInterests, activeDifficulties] = await Promise.all([
        getTopInterests(user.id),
        getActiveDifficulties(user.id),
      ]);

      const { data: aiData, error: aiError } = await supabase.functions.invoke('classy-chat', {
        body: {
          studyId: activeStudyId,
          message: userMsgText,
          activeContentId: contentId,
          currentVideoTime: Math.floor(getCurrentPosition()),
          user_interests: topInterests,
          user_difficulties: activeDifficulties,
        },
      });

      if (aiError) throw aiError;

      if (aiData.limitReached) {
        Alert.alert('Limite atingido', 'Você atingiu o limite de envios do seu plano.');
        setChatSending(false);
        return;
      }

      await supabase.from('study_messages').insert({
        study_id: activeStudyId,
        role: 'user',
        content: userMsgText,
        metadata: {},
      });

      const assistantMessage = {
        study_id: activeStudyId,
        role: 'assistant',
        content: aiData.message,
        metadata: {
          active_mode: aiData.studyState?.active_mode || 'explain',
          follow_up_suggestions: aiData.suggestions || [],
          citations: aiData.citations || [],
        },
        related_contents: aiData.relatedContents || null,
      };
      await supabase.from('study_messages').insert(assistantMessage);

      fetchStudyMessages();

    } catch (e) {
      console.error('Error sending study message in watch sheet:', e);
      Alert.alert('Erro', 'Não foi possível enviar a mensagem.');
    } finally {
      setChatSending(false);
    }
  };

  // Tab change triggers loading
  useEffect(() => {
    if (!visible) return;
    if (activeTab === 'notes') fetchNotes();
    if (activeTab === 'transcript') fetchTranscript();
    if (activeTab === 'suggestions') fetchSuggestions();
    if (activeTab === 'classy') {
      if (activeStudyId) {
        fetchStudyMessages();
      } else {
        fetchUserStudies();
      }
    }
  }, [activeTab, visible, activeStudyId, fetchNotes, fetchTranscript, fetchSuggestions, fetchStudyMessages, fetchUserStudies]);

  // NOTE ACTIONS
  const handleSaveNote = async () => {
    if (!user || !noteInput.trim()) return;
    setNotesSubmitting(true);
    try {
      const currentSeconds = Math.floor(getCurrentPosition());
      const { error } = await supabase.from('study_notes').insert({
        user_id: user.id,
        content_id: isCourse ? null : contentId,
        lesson_id: isCourse ? lessonId : null,
        study_id: null,
        note_text: noteInput.trim(),
        timestamp_seconds: currentSeconds,
      });

      if (!error) {
        setNoteInput('');
        fetchNotes();
      } else {
        Alert.alert('Erro', 'Não foi possível salvar a nota.');
      }
    } catch (err) {
      console.error('Error saving note:', err);
    } finally {
      setNotesSubmitting(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      const { error } = await supabase.from('study_notes').delete().eq('id', noteId);
      if (!error) {
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
      } else {
        Alert.alert('Erro', 'Não foi possível excluir a nota.');
      }
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  };

  // TRANSCRIPT ACTIONS
  const handleGenerateTranscript = async () => {
    setGeneratingTranscript(true);
    try {
      const { error } = await supabase.functions.invoke('transcribe-content', {
        body: { contentId },
      });

      if (!error) {
        Alert.alert('Processando', 'A transcrição está sendo gerada. Recarregue em instantes.');
      } else {
        Alert.alert('Erro', 'Não foi possível disparar a transcrição.');
      }
    } catch (err) {
      console.error('Error generating transcript:', err);
    } finally {
      setGeneratingTranscript(false);
    }
  };

  // QUIZ ACTIONS
  const handleGenerateQuiz = async () => {
    setQuizLoading(true);
    try {
      // studyId can equal contentId for standalone watch quiz
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { studyId: contentId, contentId },
      });

      if (!error && data && data.questions) {
        setQuiz(data);
        setQuizStartTime(Date.now());
        setCurrentQuestion(0);
        setSelectedAnswer(null);
        setShowExplanation(false);
        setQuizScore(0);
        setQuizCompleted(false);
        setAnswers([]);
      } else {
        Alert.alert('Erro', error?.message || 'Transcrição pendente para gerar quiz.');
      }
    } catch (err) {
      console.error('Error generating quiz:', err);
    } finally {
      setQuizLoading(false);
    }
  };

  const handleSubmitAnswer = () => {
    if (selectedAnswer === null || !quiz) return;
    const currentQ = quiz.questions[currentQuestion];
    setAnswers((prev) => [...prev, selectedAnswer]);
    setShowExplanation(true);

    if (selectedAnswer === currentQ.correctAnswer) {
      setQuizScore((prev) => prev + 1);
    }
  };

  const handleNextQuestion = () => {
    if (!quiz) return;
    if (currentQuestion === quiz.questions.length - 1) {
      handleCompleteQuiz();
    } else {
      setCurrentQuestion((prev) => prev + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    }
  };

  const handleCompleteQuiz = async () => {
    setQuizCompleted(true);
    if (!quiz) return;

    const timeSpent = quizStartTime ? Math.floor((Date.now() - quizStartTime) / 1000) : 0;
    try {
      await supabase.from('quiz_attempts').insert({
        quiz_id: quiz.id,
        user_id: user?.id,
        answers,
        score: quizScore,
        max_score: quiz.questions.length,
        time_spent_seconds: timeSpent,
      });

      // Register learning difficulty if score percentage is low
      const scorePercentage = (quizScore / quiz.questions.length) * 100;
      if (scorePercentage < 70) {
        const detail = `Pontuação baixa (${quizScore}/${quiz.questions.length}). Necessita esclarecer este assunto.`;
        registerDifficulty(user?.id, contentTitle, detail);
      }
    } catch (err) {
      console.error('Error saving quiz attempt:', err);
    }
  };

  // RENDER SECTIONS
  const renderNotesTab = () => {
    if (!user) {
      return (
        <View style={styles.tabPlaceholder}>
          <Ionicons name="lock-closed" color={colors.muted} size={36} style={{ marginBottom: spacing.md }} />
          <Text style={styles.placeholderTitle}>Anotações Restritas</Text>
          <Text style={styles.placeholderText}>Entre na sua conta Classfy para salvar suas notas.</Text>
        </View>
      );
    }

    return (
      <View style={styles.tabContentContainer}>
        {notesLoading ? (
          <ActivityIndicator color={colors.accent} style={{ flex: 1 }} />
        ) : (
          <FlatList
            style={{ flex: 1, flexShrink: 1 }}
            data={notes}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listPadding}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            bounces={false}
            disableScrollViewPanResponder={true}
            scrollEnabled={scrollEnabled}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            renderItem={({ item }) => (
              <View style={styles.noteItem}>
                <View style={styles.noteHeader}>
                  <Pressable
                    style={styles.timestampBadge}
                    onPress={() => {
                      if (item.timestamp_seconds !== null) {
                        onSeekTo(item.timestamp_seconds);
                        onClose();
                      }
                    }}
                  >
                    <Ionicons name="play" color={colors.background} size={10} style={{ marginRight: 4 }} />
                    <Text style={styles.timestampText}>{formatTime(item.timestamp_seconds)}</Text>
                  </Pressable>
                  <Pressable style={styles.deleteNoteBtn} onPress={() => handleDeleteNote(item.id)}>
                    <Ionicons name="trash-outline" color="#ef4444" size={16} />
                  </Pressable>
                </View>
                <Text style={styles.noteText}>{item.note_text}</Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="create-outline" color={colors.mutedDim} size={42} style={{ marginBottom: spacing.sm }} />
                <Text style={styles.emptyTitle}>Nenhuma anotação criada</Text>
                <Text style={styles.emptyBody}>Suas anotações dinâmicas com tempo do vídeo aparecerão aqui.</Text>
              </View>
            }
          />
        )}

        <View style={styles.inputContainer}>
          <TextInput
            placeholder={`Anotar no tempo ${formatTime(getCurrentPosition())}...`}
            placeholderTextColor={colors.muted}
            value={noteInput}
            onChangeText={setNoteInput}
            style={styles.textInput}
            multiline
          />
          <Pressable
            disabled={notesSubmitting || !noteInput.trim()}
            style={[styles.saveNoteBtn, (!noteInput.trim() || notesSubmitting) && styles.saveNoteBtnDisabled]}
            onPress={handleSaveNote}
          >
            {notesSubmitting ? <ActivityIndicator size="small" color={colors.background} /> : <Ionicons name="checkmark" color={colors.background} size={20} />}
          </Pressable>
        </View>
      </View>
    );
  };

  const renderTranscriptTab = () => {
    return (
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={styles.scrollPadding}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        bounces={false}
        disableScrollViewPanResponder={true}
        scrollEnabled={scrollEnabled}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {transcriptLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : transcript ? (
          <Text style={styles.transcriptText}>{transcript}</Text>
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" color={colors.mutedDim} size={42} style={{ marginBottom: spacing.md }} />
            <Text style={styles.emptyTitle}>Transcrição Indisponível</Text>
            <Text style={styles.emptyBody}>Esta aula ainda não possui transcrição de áudio processada.</Text>
            <Pressable
              disabled={generatingTranscript}
              style={[styles.actionBtn, generatingTranscript && styles.actionBtnDisabled]}
              onPress={handleGenerateTranscript}
            >
              <Text style={styles.actionBtnText}>{generatingTranscript ? 'Processando...' : 'Gerar Transcrição'}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    );
  };

  const renderQuizTab = () => {
    if (!user) {
      return (
        <View style={styles.tabPlaceholder}>
          <Ionicons name="lock-closed" color={colors.muted} size={36} style={{ marginBottom: spacing.md }} />
          <Text style={styles.placeholderTitle}>Quiz Restrito</Text>
          <Text style={styles.placeholderText}>Entre na sua conta para testar seus conhecimentos.</Text>
        </View>
      );
    }

    if (quizLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accent} size="large" style={{ marginBottom: spacing.md }} />
          <Text style={styles.loadingText}>Gerando perguntas com IA baseadas na transcrição...</Text>
        </View>
      );
    }

    if (!quiz) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="bulb-outline" color={colors.accent} size={48} style={{ marginBottom: spacing.md }} />
          <Text style={styles.emptyTitle}>Quiz de Aprendizado</Text>
          <Text style={styles.emptyBody}>Geramos perguntas interativas e inteligentes baseadas no conteúdo da aula para testar seu foco.</Text>
          <Pressable style={styles.actionBtn} onPress={handleGenerateQuiz}>
            <Text style={styles.actionBtnText}>Gerar Quiz</Text>
          </Pressable>
        </View>
      );
    }

    if (quizCompleted) {
      const scorePercentage = (quizScore / quiz.questions.length) * 100;
      return (
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={styles.scrollPadding}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          bounces={false}
          disableScrollViewPanResponder={true}
          scrollEnabled={scrollEnabled}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          <View style={styles.quizResultContainer}>
            <Ionicons name="trophy" color="#eab308" size={64} style={{ marginBottom: spacing.md }} />
            <Text style={styles.resultTitle}>Quiz Concluído!</Text>
            <Text style={styles.resultScore}>
              {quizScore} de {quiz.questions.length} corretas
            </Text>
            <Text style={styles.resultPercentage}>{scorePercentage.toFixed(0)}% de acertos</Text>

            <Pressable style={styles.actionBtn} onPress={handleGenerateQuiz}>
              <Text style={styles.actionBtnText}>Refazer / Novo Quiz</Text>
            </Pressable>
          </View>
        </ScrollView>
      );
    }

    const currentQ = quiz.questions[currentQuestion];
    return (
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={styles.scrollPadding}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        bounces={false}
        disableScrollViewPanResponder={true}
        scrollEnabled={scrollEnabled}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <View style={styles.quizHeader}>
          <Text style={styles.quizProgressText}>
            Pergunta {currentQuestion + 1} de {quiz.questions.length}
          </Text>
          <View style={styles.difficultyBadge}>
            <Text style={styles.difficultyText}>{currentQ.difficulty.toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.quizQuestion}>{currentQ.question}</Text>

        <View style={styles.optionsList}>
          {currentQ.options.map((option, idx) => {
            const isSelected = selectedAnswer === idx;
            const isCorrect = idx === currentQ.correctAnswer;
            const showCorrect = showExplanation && isCorrect;
            const showWrong = showExplanation && isSelected && !isCorrect;

            let optionStyle = styles.optionItem;
            if (isSelected) optionStyle = { ...optionStyle, ...styles.optionSelected };
            if (showCorrect) optionStyle = { ...optionStyle, ...styles.optionCorrect };
            if (showWrong) optionStyle = { ...optionStyle, ...styles.optionWrong };

            return (
              <Pressable
                key={idx}
                disabled={showExplanation}
                style={optionStyle}
                onPress={() => setSelectedAnswer(idx)}
              >
                <Text style={styles.optionText}>{option}</Text>
                {showCorrect && <Ionicons name="checkmark-circle" color="#22c55e" size={20} />}
                {showWrong && <Ionicons name="close-circle" color="#ef4444" size={20} />}
              </Pressable>
            );
          })}
        </View>

        {showExplanation && (
          <View
            style={[
              styles.explanationCard,
              selectedAnswer === currentQ.correctAnswer ? styles.explanationCorrect : styles.explanationWrong,
            ]}
          >
            <Text style={styles.explanationTitle}>
              {selectedAnswer === currentQ.correctAnswer ? 'Correto!' : 'Incorreto!'}
            </Text>
            <Text style={styles.explanationText}>{currentQ.explanation}</Text>
          </View>
        )}

        <View style={styles.quizFooter}>
          {!showExplanation ? (
            <Pressable
              disabled={selectedAnswer === null}
              style={[styles.quizActionBtn, selectedAnswer === null && styles.quizActionBtnDisabled]}
              onPress={handleSubmitAnswer}
            >
              <Text style={styles.quizActionBtnText}>Confirmar Resposta</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.quizActionBtn} onPress={handleNextQuestion}>
              <Text style={styles.quizActionBtnText}>
                {currentQuestion === quiz.questions.length - 1 ? 'Ver Resultado' : 'Próxima Pergunta'}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    );
  };

  const renderSuggestionsTab = () => {
    return (
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={styles.scrollPadding}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        bounces={false}
        disableScrollViewPanResponder={true}
        scrollEnabled={scrollEnabled}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        <Text style={styles.suggestionsTitle}>Sugestões de estudo relacionadas</Text>
        {suggestionsLoading ? (
          <ActivityIndicator color={colors.accent} />
        ) : suggestions.length > 0 ? (
          suggestions.map((item) => (
            <Pressable
              key={item.id}
              style={styles.suggestionItem}
              onPress={() => {
                onClose();
                router.replace(`/watch/${item.id}`);
              }}
            >
              <View style={styles.suggestionThumb}>
                {item.thumbnail_url ? (
                  <Image source={{ uri: item.thumbnail_url }} style={styles.suggestionImage} />
                ) : null}
                <View style={styles.suggestionOverlay} />
                <Text style={styles.durationBadge}>{formatTime(item.duration_seconds)}</Text>
              </View>
              <View style={styles.suggestionCopy}>
                <Text numberOfLines={2} style={styles.suggestionItemTitle}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={styles.suggestionCreator}>
                  {item.creator?.creator_channel_name || item.creator?.display_name || 'Creator Classfy'}
                </Text>
                <Text style={styles.suggestionMeta}>
                  {formatViewsCount(item.views_count)} views
                </Text>
              </View>
            </Pressable>
          ))
        ) : (
          <Text style={styles.noSuggestionsText}>Sem recomendações no momento.</Text>
        )}
      </ScrollView>
    );
  };

  const renderModulesTab = () => {
    const totalLessons = courseModules.reduce((acc, curr) => acc + (curr.lessons?.length || 0), 0);

    return (
      <View style={styles.tabContentContainer}>
        {/* Progress Bar Header */}
        <View style={styles.progressHeader}>
          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>Progresso do Curso</Text>
            <Text style={styles.progressValue}>
              {completedLessons.length} de {totalLessons} aulas ({progressPercent}%)
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressIndicator, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        {/* Modules Accordion List */}
        <FlatList
          style={{ flex: 1, flexShrink: 1 }}
          data={courseModules}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          bounces={false}
          disableScrollViewPanResponder={true}
          scrollEnabled={scrollEnabled}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          renderItem={({ item, index }) => {
            const isExpanded = !!expandedModules[item.id];
            const modLessons = item.lessons || [];
            
            return (
              <View style={styles.moduleItem}>
                <Pressable
                  style={styles.moduleHeader}
                  onPress={() => {
                    setExpandedModules(prev => ({ ...prev, [item.id]: !prev[item.id] }));
                  }}
                >
                  <View style={styles.moduleHeaderInfo}>
                    <Text style={styles.moduleIndex}>Módulo {index + 1}</Text>
                    <Text style={styles.moduleTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.moduleLessonsCount}>{modLessons.length} aulas</Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    color={colors.muted}
                    size={18}
                  />
                </Pressable>

                {isExpanded && (
                  <View style={styles.lessonsList}>
                    {modLessons.length > 0 ? (
                      modLessons.map((lesson: any) => {
                        const isPlaying = lessonId === lesson.id;
                        const isCompleted = completedLessons.includes(lesson.id);

                        return (
                          <Pressable
                            key={lesson.id}
                            style={[styles.lessonRow, isPlaying && styles.lessonRowPlaying]}
                            onPress={() => onSelectLesson?.(lesson)}
                          >
                            <View style={styles.lessonLeft}>
                              <View style={styles.lessonStatusIcon}>
                                {isPlaying ? (
                                  <Ionicons name="volume-medium" color={colors.accent} size={18} />
                                ) : isCompleted ? (
                                  <Ionicons name="checkmark-circle" color={colors.free} size={18} />
                                ) : (
                                  <Ionicons name="play-circle-outline" color={colors.muted} size={18} />
                                )}
                              </View>
                              <Text
                                numberOfLines={2}
                                style={[
                                  styles.lessonTitle,
                                  isPlaying && styles.lessonTitlePlaying,
                                  isCompleted && !isPlaying && styles.lessonTitleCompleted
                                ]}
                              >
                                {lesson.title}
                              </Text>
                            </View>
                            <Text style={styles.lessonDuration}>
                              {formatTime(lesson.duration_seconds)}
                            </Text>
                          </Pressable>
                        );
                      })
                    ) : (
                      <Text style={styles.noLessonsText}>Nenhuma aula neste módulo.</Text>
                    )}
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="list" color={colors.mutedDim} size={42} style={{ marginBottom: spacing.md }} />
              <Text style={styles.emptyTitle}>Sem Aulas</Text>
              <Text style={styles.emptyBody}>Este curso ainda não possui módulos cadastrados.</Text>
            </View>
          }
        />
      </View>
    );
  };

  const renderClassyTab = () => {
    if (!activeStudyId) {
      return (
        <ScrollView
          style={{ flex: 1, flexShrink: 1 }}
          contentContainerStyle={styles.listPadding}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          bounces={false}
          scrollEnabled={scrollEnabled}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          <View style={styles.noStudyContainer}>
            <Ionicons name="sparkles-outline" color={colors.accent} size={44} style={{ marginBottom: spacing.md }} />
            <Text style={styles.noStudyTitle}>Ativar Inteligência Artificial</Text>
            <Text style={styles.noStudyDesc}>
              A Classy IA precisa de um plano de estudo para guiar suas dúvidas e registrar seu progresso.
            </Text>

            {/* Quick Create Button */}
            <Pressable
              disabled={creatingStudy}
              onPress={() => handleCreateStudyPlan(`Aprender: ${contentTitle}`)}
              style={({ pressed }) => [
                styles.quickCreateBtn,
                pressed && { opacity: 0.85 }
              ]}
            >
              {creatingStudy ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="flash-outline" size={16} color={colors.background} style={{ marginRight: 6 }} />
                  <Text style={styles.quickCreateBtnText}>Criar Plano para esta Aula</Text>
                </View>
              )}
            </Pressable>

            <Text style={styles.dividerText}>OU CRIE UM PLANO PERSONALIZADO</Text>
            
            <View style={styles.customCreateRow}>
              <TextInput
                placeholder="Ex: Programação Funcional, Meditação..."
                placeholderTextColor={colors.muted}
                value={newStudyTitle}
                onChangeText={setNewStudyTitle}
                style={styles.customInput}
              />
              <Pressable
                disabled={creatingStudy || !newStudyTitle.trim()}
                onPress={() => handleCreateStudyPlan()}
                style={({ pressed }) => [
                  styles.customCreateBtn,
                  (!newStudyTitle.trim() || creatingStudy) && styles.customCreateBtnDisabled,
                  pressed && { opacity: 0.85 }
                ]}
              >
                <Ionicons name="add" size={20} color={colors.background} />
              </Pressable>
            </View>

            {/* List Existing Active Studies */}
            {userStudies.length > 0 && (
              <View style={styles.existingPlansContainer}>
                <Text style={styles.existingPlansTitle}>VINCULAR A UM PLANO ATIVO</Text>
                {loadingStudies ? (
                  <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
                ) : (
                  userStudies.map((st) => (
                    <Pressable
                      key={st.id}
                      onPress={() => changeActiveStudyId(st.id)}
                      style={({ pressed }) => [
                        styles.existingPlanRow,
                        pressed && { backgroundColor: 'rgba(255,255,255,0.05)' }
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.existingPlanName} numberOfLines={1}>{st.title}</Text>
                        <Text style={styles.existingPlanDate}>
                          Criado em {new Date(st.created_at).toLocaleDateString('pt-BR')}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </View>
        </ScrollView>
      );
    }

    return (
      <View style={styles.tabContentContainer}>
        {chatLoading && chatMessages.length === 0 ? (
          <ActivityIndicator color={colors.accent} style={{ flex: 1 }} />
        ) : (
          <FlatList
            ref={chatFlatListRef}
            style={{ flex: 1, flexShrink: 1 }}
            data={chatMessages}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listPadding}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            bounces={false}
            disableScrollViewPanResponder={true}
            scrollEnabled={scrollEnabled}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            renderItem={({ item, index }) => {
              const isUser = item.role === 'user';
              const suggestions = item.metadata?.follow_up_suggestions || [];
              
              return (
                <View style={[styles.msgContainer, isUser ? styles.msgContainerUser : styles.msgContainerAssistant]}>
                  <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleClassy]}>
                    <Text style={styles.bubbleText}>{item.content}</Text>
                  </View>
                  
                  {!isUser && suggestions.length > 0 && index === chatMessages.length - 1 && (
                    <View style={styles.suggestionsChipsWrapper}>
                      {suggestions.map((suggestion: string, sIdx: number) => (
                        <Pressable
                          key={sIdx}
                          onPress={() => handleSendClassyMessage(suggestion)}
                          style={({ pressed }) => [
                            styles.suggestionChip,
                            pressed && { opacity: 0.8 }
                          ]}
                        >
                          <Text style={styles.suggestionChipText}>{suggestion}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="sparkles-outline" color={colors.accent} size={42} style={{ marginBottom: spacing.sm }} />
                <Text style={styles.emptyTitle}>Converse com a Classy IA</Text>
                <Text style={styles.emptyBody}>Tire dúvidas sobre a aula ou peça resumos. A Classy tem acesso à transcrição da aula!</Text>
              </View>
            }
          />
        )}

        {chatSending && (
          <View style={styles.thinkingContainer}>
            <ActivityIndicator size="small" color={colors.muted} style={{ marginRight: 8 }} />
            <Text style={styles.thinkingText}>Classy está formulando uma resposta...</Text>
          </View>
        )}

        <View style={styles.inputContainer}>
          <TextInput
            placeholder="Pergunte algo sobre a aula..."
            placeholderTextColor={colors.muted}
            value={chatInput}
            onChangeText={setChatInput}
            style={styles.textInput}
            multiline
          />
          <Pressable
            disabled={chatSending || !chatInput.trim()}
            style={[styles.saveNoteBtn, (!chatInput.trim() || chatSending) && styles.saveNoteBtnDisabled]}
            onPress={() => handleSendClassyMessage()}
          >
            {chatSending ? <ActivityIndicator size="small" color={colors.background} /> : <Ionicons name="send" color={colors.background} size={16} />}
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalContainer}
      >
        <View
          style={styles.backdrop}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: insets.bottom + spacing.md,
                maxHeight: maxSheetHeight,
                transform: [{ translateY: sheetTranslateY }]
              }
            ]}
            {...sheetPanResponder.panHandlers}
          >
            <View
              style={[
                { flex: 1, width: '100%' },
                isLandscape && {
                  width: Math.min(windowWidth, windowHeight * (16 / 9)),
                  alignSelf: 'center',
                }
              ]}
            >
              <View onStartShouldSetResponder={() => true} style={{ backgroundColor: 'transparent' }}>
                <View style={styles.handle} />

                <View style={styles.header}>
                  <Text style={styles.title} numberOfLines={1}>
                    Estudo: {contentTitle}
                  </Text>
                  <Pressable style={styles.closeBtn} onPress={onClose}>
                    <Ionicons name="close" color={colors.text} size={20} />
                  </Pressable>
                </View>
              </View>

              {/* Tab Navigation */}
              <View style={{ borderBottomColor: colors.borderSubtle, borderBottomWidth: 1 }}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabsRow}
                >
                  {tabList.map((tab) => (
                     <Pressable
                       key={tab}
                       style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
                       onPress={() => {
                         setActiveTab(tab);
                         setIsScrollAtTop(true);
                       }}
                     >
                       <Text style={[styles.tabButtonText, activeTab === tab && styles.tabButtonTextActive]}>
                         {tab === 'modules'
                           ? 'Aulas'
                           : tab === 'classy'
                           ? 'Classy IA'
                           : tab === 'notes'
                           ? 'Notas'
                           : tab === 'transcript'
                           ? 'Transcrição'
                           : tab === 'quiz'
                           ? 'Quiz'
                           : 'Sugestões'}
                       </Text>
                     </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* Tab Contents */}
              <View style={styles.contentContainer}>
                {activeTab === 'modules' && renderModulesTab()}
                {activeTab === 'classy' && renderClassyTab()}
                {activeTab === 'notes' && renderNotesTab()}
                {activeTab === 'transcript' && renderTranscriptTab()}
                {activeTab === 'quiz' && renderQuizTab()}
                {activeTab === 'suggestions' && renderSuggestionsTab()}
              </View>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: 'transparent',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    flex: 1,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    height: 4,
    marginTop: spacing.sm,
    width: 42,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
    marginRight: spacing.md,
  },
  closeBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  tabButton: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    paddingBottom: spacing.sm,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  tabButtonActive: {
    borderBottomColor: colors.accent,
  },
  tabButtonText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  tabButtonTextActive: {
    color: colors.accent,
  },
  contentContainer: {
    flex: 1,
  },
  tabContentContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  listPadding: {
    padding: spacing.lg,
  },
  scrollPadding: {
    padding: spacing.lg,
  },
  tabPlaceholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  placeholderTitle: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
    marginBottom: spacing.xs,
  },
  placeholderText: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    textAlign: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    lineHeight: 18,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  actionBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionBtnText: {
    color: colors.background,
    fontSize: typography.bodySmall,
    fontWeight: typography.weightBlack,
  },
  noteItem: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  noteHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  timestampBadge: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  timestampText: {
    color: colors.background,
    fontSize: 10,
    fontWeight: '800',
  },
  deleteNoteBtn: {
    padding: 2,
  },
  noteText: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 18,
  },
  inputContainer: {
    alignItems: 'flex-end',
    borderTopColor: colors.borderSubtle,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    color: colors.text,
    flex: 1,
    fontSize: typography.bodySmall,
    maxHeight: 80,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  saveNoteBtn: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  saveNoteBtnDisabled: {
    opacity: 0.45,
  },
  transcriptText: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 22,
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    textAlign: 'center',
  },
  quizResultContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  resultTitle: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: typography.weightBlack,
  },
  resultScore: {
    color: colors.accent,
    fontSize: 32,
    fontWeight: '900',
    marginVertical: spacing.sm,
  },
  resultPercentage: {
    color: colors.muted,
    fontSize: typography.body,
    fontWeight: typography.weightBold,
    marginBottom: spacing.xl,
  },
  quizHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  quizProgressText: {
    color: colors.muted,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  difficultyBadge: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  difficultyText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '800',
  },
  quizQuestion: {
    color: colors.text,
    fontSize: typography.bodyLarge,
    fontWeight: typography.weightBlack,
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  optionsList: {
    gap: spacing.md,
  },
  optionItem: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionSelected: {
    borderColor: colors.accent,
  },
  optionCorrect: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: '#22c55e',
  },
  optionWrong: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: '#ef4444',
  },
  optionText: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    fontWeight: typography.weightBold,
  },
  explanationCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  explanationCorrect: {
    backgroundColor: 'rgba(34, 197, 94, 0.05)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  explanationWrong: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  explanationTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
    marginBottom: spacing.xs,
  },
  explanationText: {
    color: colors.textSecondary,
    fontSize: typography.bodySmall,
    lineHeight: 18,
  },
  quizFooter: {
    marginTop: spacing.xl,
  },
  quizActionBtn: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
  },
  quizActionBtnDisabled: {
    opacity: 0.5,
  },
  quizActionBtnText: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  suggestionsTitle: {
    color: colors.text,
    fontSize: typography.titleSmall,
    fontWeight: typography.weightBlack,
    marginBottom: spacing.lg,
  },
  keyboardAvoidingContainer: {
    flex: 1,
  },
  suggestionItem: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  suggestionThumb: {
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    width: 140,
  },
  suggestionImage: {
    height: '100%',
    width: '100%',
  },
  suggestionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  durationBadge: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.xs,
    bottom: spacing.xs,
    color: colors.text,
    fontSize: typography.label,
    fontWeight: typography.weightBlack,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    position: 'absolute',
    right: spacing.xs,
  },
  suggestionCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: spacing.xs,
  },
  suggestionItemTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
    lineHeight: 20,
  },
  suggestionCreator: {
    color: colors.muted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  suggestionMeta: {
    color: colors.mutedDim,
    fontSize: typography.caption,
    marginTop: spacing.xxs,
  },
  noSuggestionsText: {
    color: colors.muted,
    fontSize: typography.bodySmall,
    textAlign: 'center',
  },
  msgContainer: {
    width: '100%',
    marginVertical: spacing.xs,
    flexDirection: 'row',
  },
  msgContainerUser: {
    justifyContent: 'flex-end',
  },
  msgContainerAssistant: {
    justifyContent: 'flex-start',
  },
  bubble: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: '85%',
  },
  bubbleUser: {
    backgroundColor: colors.accent,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2,
  },
  bubbleClassy: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2,
  },
  bubbleText: {
    color: '#FFF',
    fontSize: 13,
    lineHeight: 18,
  },
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  thinkingText: {
    color: colors.muted,
    fontSize: 12,
  },
  // Course Progress & Modules Tab
  progressHeader: {
    padding: spacing.lg,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    backgroundColor: colors.backgroundElevated,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  progressLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  progressValue: {
    color: colors.muted,
    fontSize: 11,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressIndicator: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  moduleItem: {
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  },
  moduleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  moduleHeaderInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  moduleIndex: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  moduleTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginVertical: 2,
  },
  moduleLessonsCount: {
    color: colors.muted,
    fontSize: 11,
  },
  lessonsList: {
    backgroundColor: colors.background,
  },
  lessonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomColor: 'rgba(255, 255, 255, 0.03)',
    borderBottomWidth: 1,
  },
  lessonRowPlaying: {
    backgroundColor: 'rgba(225, 29, 72, 0.05)',
  },
  lessonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.md,
  },
  lessonStatusIcon: {
    marginRight: spacing.sm,
    width: 20,
    alignItems: 'center',
  },
  lessonTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  lessonTitlePlaying: {
    color: colors.accent,
    fontWeight: '700',
  },
  lessonTitleCompleted: {
    color: colors.muted,
  },
  lessonDuration: {
    color: colors.mutedDim,
    fontSize: 11,
  },
  noLessonsText: {
    padding: spacing.md,
    textAlign: 'center',
    color: colors.mutedDim,
    fontSize: 12,
  },
  // Active study plan linking & Classy IA onboarding styles
  noStudyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  noStudyTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '900',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  noStudyDesc: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  quickCreateBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    height: 48,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  quickCreateBtnText: {
    color: colors.background,
    fontSize: 13.5,
    fontWeight: '800',
  },
  dividerText: {
    color: colors.mutedDim,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginVertical: spacing.md,
    textAlign: 'center',
  },
  customCreateRow: {
    flexDirection: 'row',
    width: '100%',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  customInput: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    color: '#FFF',
    paddingHorizontal: spacing.md,
    fontSize: 13,
  },
  customCreateBtn: {
    backgroundColor: colors.accent,
    width: 44,
    height: 44,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  customCreateBtnDisabled: {
    opacity: 0.4,
  },
  existingPlansContainer: {
    width: '100%',
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: 1,
    paddingTop: spacing.lg,
  },
  existingPlansTitle: {
    color: colors.muted,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  existingPlanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    borderBottomWidth: 1,
  },
  existingPlanName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  existingPlanDate: {
    color: colors.mutedDim,
    fontSize: 11,
  },
  // Chat Suggestion Chips styles
  suggestionsChipsWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
    width: '100%',
  },
  suggestionChip: {
    backgroundColor: 'rgba(225, 29, 72, 0.08)',
    borderColor: 'rgba(225, 29, 72, 0.2)',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  suggestionChipText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
});
