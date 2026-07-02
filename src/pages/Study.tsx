import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, MoreVertical, Edit2, Share2, Trash2, X, List, Minimize2, Maximize2, Play, ChevronLeft, ChevronRight, AlertCircle, Sparkles, Brain, Compass, ChevronRight as ChevronRightIcon, PlayCircle, BookOpen, StickyNote, Clock, Coins } from "lucide-react";
import { StudyMessage } from "@/hooks/useStudies";
import { useStudies } from "@/hooks/useStudies";
import { StudyUsageIndicator } from "@/components/StudyUsageIndicator";
import { ChatContentCard } from "@/components/ChatContentCard";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ClassyMessageExtras, ClassyMessageMetadata } from "@/components/chat/ClassyMessageExtras";
import { ClassyStudyState } from "@/components/chat/ClassyStudyStateBar";
import { UpgradePromptCard } from "@/components/chat/UpgradePromptCard";
import { UnifiedVideoPlayer } from "@/components/unified/UnifiedVideoPlayer";
import { SocialBar } from "@/components/unified/SocialBar";
import { StudyToolbar, ToolPanel } from "@/components/unified/StudyToolbar";
import { useAccessControl } from "@/hooks/useAccessControl";
import { useContentMetrics } from "@/hooks/useContentMetrics";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";
import { AddToStudyModal } from "@/components/AddToStudyModal";
import { ContentComments } from "@/components/ContentComments";
import { WatchRelated } from "@/components/WatchRelated";
import { ContentRewardProgress } from "@/components/watch/ContentRewardProgress";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MobileStudyPlayer } from "@/components/study/MobileStudyPlayer";
import { useStudyJourneySummary } from "@/hooks/useStudyJourneySummary";
import { toShortTitle } from "@/lib/study/getStudyJourneySummary";

import { StudyQuiz } from "@/components/StudyQuiz";
import { StudyNotes } from "@/components/StudyNotes";
import { Textarea } from "@/components/ui/textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type StudyAiStateRecord = {
  active_mode: ClassyStudyState["activeMode"];
  celebration_count: number | null;
  current_focus: string | null;
  last_celebration: string | null;
  learner_level: ClassyStudyState["learnerLevel"];
  live_plan_steps: string[] | null;
  next_best_action: string | null;
  user_goal: string | null;
  session_summary: string | null;
  mastered_topics: string[] | null;
  weak_topics: string[] | null;
  open_questions: string[] | null;
  last_checkpoint_at: string | null;
  last_quiz_score: number | null;
  last_quiz_total: number | null;
};

const mapStudyStateRecord = (record: StudyAiStateRecord | null): ClassyStudyState | null => {
  if (!record) return null;

  const weakTopics = record.weak_topics || [];
  const masteredTopics = record.mastered_topics || [];
  const openQuestions = record.open_questions || [];
  const checkpointStatus: ClassyStudyState["checkpointStatus"] =
    weakTopics.length > 0
      ? "recommended"
      : record.last_checkpoint_at
      ? "fresh"
      : "due";

  return {
    activeMode: record.active_mode,
    currentFocus: record.current_focus,
    learnerLevel: record.learner_level,
    nextBestAction: record.next_best_action,
    userGoal: record.user_goal,
    sessionSummary: record.session_summary,
    masteredTopics,
    weakTopics,
    openQuestions,
    lastCheckpointAt: record.last_checkpoint_at,
    lastQuizScore: record.last_quiz_score,
    lastQuizTotal: record.last_quiz_total,
    checkpointStatus,
    livePlanSteps: record.live_plan_steps || [],
    lastCelebration: record.last_celebration,
    celebrationCount: record.celebration_count || 0,
  };
};

const STUDY_BOOTSTRAP_RETRY_LIMIT = 8;
const STUDY_BOOTSTRAP_RETRY_DELAY_MS = 350;
const INITIAL_ONBOARDING_SUGGESTIONS = [
  "Quero começar do zero",
  "Já sei o básico",
  "Quero aplicar isso no trabalho",
];

const isTransientStudyBootstrapError = (error: any) => {
  const status = error?.context?.status ?? error?.status;
  const message = String(error?.message || error?.context?.error?.message || "").toLowerCase();

  return (
    status === 404 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("not found") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("service unavailable") ||
    message.includes("gateway") ||
    message.includes("timeout")
  );
};

const getInitialConversationErrorMessage = (error: any) => {
  const status = error?.context?.status ?? error?.status;

  if (status === 401 || status === 403) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }

  if (status === 404) {
    return "O estudo ainda está sendo preparado. Tente novamente em alguns segundos.";
  }

  return "Erro ao iniciar conversa. Tente novamente.";
};

const modeLabelMap: Record<ClassyStudyState["activeMode"], string> = {
  onboard: "Diagnóstico",
  explain: "Explicando",
  recommend: "Trilha",
  practice: "Praticando",
  review: "Revisando",
  plan: "Plano",
};

const sanitizeStudyTopic = (value?: string | null) => {
  if (!value) return "";

  return value
    .replace(/^ol[aá](?:,\s*[^!?.]+)?[!?.]?\s*/i, "")
    .replace(/^quero aprender(?:\s+sobre)?\s+/i, "")
    .replace(/^aprender(?:\s+sobre)?\s+/i, "")
    .replace(/^estudo(?:\s+sobre)?\s+/i, "")
    .replace(/^tema:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[!?.:,;\s]+$/g, "");
};

const buildInitialAssistantReply = (studyTitle: string, userName?: string | null) => {
  const firstName = userName?.trim()?.split(" ")[0];
  const greetingPrefix = firstName ? `Olá, ${firstName}!` : "Olá!";
  const cleanTopic = sanitizeStudyTopic(studyTitle) || studyTitle;

  return [
    `${greetingPrefix} Vamos estruturar seu estudo em ${cleanTopic}.`,
    "Antes de eu te guiar, quero calibrar rapidinho seu ponto de partida.",
    "Você já teve algum contato com esse tema, ou está começando do zero?",
  ].join("\n\n");
};

const buildInitialAssistantMetadata = (): ClassyMessageMetadata => ({
  active_mode: "onboard",
  follow_up_suggestions: INITIAL_ONBOARDING_SUGGESTIONS,
  citations: [],
  ui_blocks: [],
  checkpoint_generated: false,
});

const buildThinkingPhrases = (topic?: string | null) => {
  const focus = topic || "seu tema";

  return [
    `Explorando ${focus}...`,
    `Conectando ideias sobre ${focus}...`,
    "Montando uma resposta mais útil...",
  ];
};

const resizeTextareaToContent = (textarea: HTMLTextAreaElement | null) => {
  if (!textarea) return;

  textarea.style.height = "0px";
  const nextHeight = Math.min(textarea.scrollHeight, 160);
  textarea.style.height = `${Math.max(nextHeight, 24)}px`;
  textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
};

const sanitizeRelatedContents = (contents: any[] | null | undefined) => {
  if (!Array.isArray(contents)) return [];

  return contents.filter((content) => {
    if (!content || typeof content !== "object") return false;
    return "id" in content && content.id;
  });
};

function StudyContent() {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { updateLastActivity, getStudyUsage, limits } = useStudies();
  const { setOpen, open } = useSidebar();
  const isMobile = useIsMobile();
  const { startMiniPlayer, closeMiniPlayer, state: miniPlayerState } = useMiniPlayer();

  const currentPlan = (profile?.plan || 'free') as 'free' | 'pro' | 'premium';
  const PLAYLIST_LIMITS: Record<'free' | 'pro' | 'premium', number> = {
    free: 5,
    pro: 50,
    premium: Infinity,
  };
  const playlistLimit = PLAYLIST_LIMITS[currentPlan];
  const messageLimit = limits.messages;
  
  const [study, setStudy] = useState<any>(null);
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [messageContents, setMessageContents] = useState<Map<string, any[]>>(new Map());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [sending, setSending] = useState(false);
  const [initialMessageSent, setInitialMessageSent] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [activeContent, setActiveContent] = useState<any>(null);
  const [transcription, setTranscription] = useState<string>("");
  const [transcriptionLoading, setTranscriptionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteTimestamp, setNoteTimestamp] = useState<number>(0);
  const [noteText, setNoteText] = useState("");
  const [notesRefresh, setNotesRefresh] = useState(0);
  const [wasOpenBeforeFocus, setWasOpenBeforeFocus] = useState(true);
  const [savedPlaylists, setSavedPlaylists] = useState<Set<string>>(new Set());
  const [showPlaylistsDropdown, setShowPlaylistsDropdown] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState<{messageId: string, currentIndex: number} | null>(null);
  const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);
  const [playlistsCount, setPlaylistsCount] = useState(0);
  const [newestMessageId, setNewestMessageId] = useState<string | null>(null);
  const initialMessageTriggeredRef = useRef(false);
  const autoplayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const trackedMessageEventsRef = useRef<Set<string>>(new Set());
  const latestMessagesRef = useRef<StudyMessage[]>([]);
  
  // Tool panels state - using unified ToolPanel type
  const [activeToolPanel, setActiveToolPanel] = useState<ToolPanel>(null);
  const [miniPlayerActive, setMiniPlayerActive] = useState(false);
  const [miniPlayerPosition, setMiniPlayerPosition] = useState({ x: 20, y: 20 });
  const miniPlayerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Mobile-specific state
  const [showPlaylistSheet, setShowPlaylistSheet] = useState(false);

  // Limit state (inline alert + CTA card)
  const [limitReached, setLimitReached] = useState<{
    type: 'messages' | 'deviations';
    suggestedTopic?: string;
  } | null>(null);
  const [studyUsage, setStudyUsage] = useState<{ messageCount: number; maxMessages: number } | null>(null);
  const [studyAiState, setStudyAiState] = useState<ClassyStudyState | null>(null);
  const [studyMapDialogOpen, setStudyMapDialogOpen] = useState(false);
  const [thinkingPhraseIndex, setThinkingPhraseIndex] = useState(0);

  // Access control state
  const { checkAccess, hasAccess, blockReason, requiredPlan } = useAccessControl();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [activeContentInfo, setActiveContentInfo] = useState<{ price?: number } | null>(null);
  const [followersCount, setFollowersCount] = useState(0);
  
  // Track current playback time for mini player
  const currentPlaybackTimeRef = useRef(0);
  const activeContentRef = useRef<any>(null);
  
  // Keep activeContentRef updated
  useEffect(() => {
    activeContentRef.current = activeContent;
  }, [activeContent]);

  // Fetch followers count when content changes
  useEffect(() => {
    if (activeContent?.creator?.id) {
      fetchFollowersCount(activeContent.creator.id);
    }
  }, [activeContent?.creator?.id]);

  const fetchFollowersCount = async (creatorId: string) => {
    const { count } = await supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("following_id", creatorId);
    setFollowersCount(count || 0);
  };

  // Activate mini player when leaving Study page with active content
  useEffect(() => {
    return () => {
      const content = activeContentRef.current;
      const playbackTime = currentPlaybackTimeRef.current;
      
      // Only activate if we have content and some playback progress
      if (content && playbackTime > 0) {
        startMiniPlayer({
          id: content.id,
          title: content.title,
          subtitle: content.creator?.display_name,
          thumbnail_url: content.thumbnail_url,
          file_url: content.file_url,
          duration_seconds: content.duration_seconds,
          creator: content.creator ? { display_name: content.creator.display_name } : undefined,
        }, playbackTime);
      }
    };
  }, [startMiniPlayer]);

  // Focus Mode: Auto-collapse sidebar when content is playing
  useEffect(() => {
    if (activeContent && open) {
      setWasOpenBeforeFocus(true);
      setOpen(false);
    } else if (!activeContent && wasOpenBeforeFocus && !isMobile) {
      setOpen(true);
    }
  }, [activeContent]);

  // Always collapse sidebar on mobile
  useEffect(() => {
    if (isMobile) {
      setOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }

    if (id) {
      fetchStudy();
      fetchStudyAiState();
      fetchMessages();
      fetchPlaylists();
    }
  }, [id, user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    latestMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!user || !id) return;

    const assistantMessages = messages.filter((message) => message.role === "assistant");
    assistantMessages.forEach((message) => {
      if (trackedMessageEventsRef.current.has(message.id)) {
        return;
      }

      const metadata = getAssistantMetadata(message);
      if (!metadata) return;

      trackedMessageEventsRef.current.add(message.id);

      const blockTypes = new Set((metadata.ui_blocks || []).map((block) => block.type));
      if (blockTypes.has("checkpoint")) {
        trackClassyEvent("checkpoint_impression", {
          assistant_message_id: message.id,
          current_focus: studyAiState?.currentFocus || null,
        });
      }

      if (blockTypes.has("celebration")) {
        trackClassyEvent("celebration_impression", {
          assistant_message_id: message.id,
          current_focus: studyAiState?.currentFocus || null,
        });
      }

      if (blockTypes.has("trail")) {
        trackClassyEvent("learning_plan_impression", {
          assistant_message_id: message.id,
          current_focus: studyAiState?.currentFocus || null,
        });
      }
    });
  }, [messages, user, id, studyAiState]);

  useEffect(() => {
    setStudyUsage((current) => {
      if (!current) return current;
      if (current.maxMessages === messageLimit) return current;

      return {
        ...current,
        maxMessages: messageLimit,
      };
    });
  }, [messageLimit]);

  useEffect(() => {
    const isFreshStudy = Number(study?.message_count || 0) === 0;

    if (
      study && 
      (isFreshStudy || !loadingMessages) && 
      messages.length === 0 && 
      !initialMessageTriggeredRef.current &&
      !initialMessageSent && 
      !loading && 
      !sending
    ) {
      initialMessageTriggeredRef.current = true;
      setInitialMessageSent(true);
      sendInitialMessage();
    }
  }, [study, loadingMessages, messages.length, initialMessageSent, loading, sending]);

  useEffect(() => {
    if (!sending) {
      setThinkingPhraseIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setThinkingPhraseIndex((current) => current + 1);
    }, 1300);

    return () => window.clearInterval(intervalId);
  }, [sending]);

  useEffect(() => {
    const autoOpenPlaylistId = location.state?.autoOpenPlaylist;
    if (autoOpenPlaylistId && savedPlaylists.has(autoOpenPlaylistId) && !activePlaylist) {
      const playlistMessage = messages.find(msg => msg.id === autoOpenPlaylistId);
      if (playlistMessage) {
        const contents = messageContents.get(playlistMessage.id);
        if (contents && contents.length > 0) {
          const firstContent = contents[0];
          const firstContentId = typeof firstContent === 'string' ? firstContent : firstContent.id;

          if (firstContentId) {
            setActivePlaylist({ messageId: playlistMessage.id, currentIndex: 0 });
            setShowPlaylistsDropdown(false);
            handlePlayContent(firstContentId, {
              sourceMessageId: playlistMessage.id,
              title: typeof firstContent === "string" ? undefined : firstContent.title,
              relevanceScore: typeof firstContent === "string" ? null : firstContent.relevanceScore,
            });
            navigate(location.pathname, { replace: true, state: {} });
          }
        }
      }
    }
  }, [savedPlaylists, messages, messageContents, location.state, activePlaylist]);

  const handleCreatePlaylist = async (messageId: string, contentIds: string[]) => {
    if (!user || !id) return;

    if (playlistsCount >= playlistLimit) {
      toast.error("Você atingiu o limite de playlists para o seu plano.");
      return;
    }
    
    setSending(true);
    
    try {
      const { error: playlistError } = await supabase
        .from("study_playlists")
        .insert({
          user_id: user.id,
          study_id: id,
          message_id: messageId,
        });

      if (playlistError) throw playlistError;

      setSavedPlaylists(prev => new Set(prev).add(messageId));
      setPlaylistsCount(prev => prev + 1);
      
      const { data: transcriptions } = await supabase
        .from('transcriptions')
        .select('content_id, text')
        .in('content_id', contentIds);

      const { data: contents } = await supabase
        .from('contents')
        .select('id, title, description')
        .in('id', contentIds);

      const transcriptionsMap = new Map(transcriptions?.map(t => [t.content_id, t.text]) || []);
      const contentsInfo = contents?.map(c => ({
        title: c.title,
        description: c.description,
        transcription: transcriptionsMap.get(c.id)?.substring(0, 2000)
      })) || [];

      toast.success('Playlist salva! Gerando resumo...');

      const { data: aiData, error: aiError } = await supabase.functions.invoke(
        "classy-chat",
        {
          body: {
            studyId: id,
            message: `Analise esses ${contentIds.length} conteúdos e gere um resumo contextual do que a pessoa pode aprender com essa playlist: ${JSON.stringify(contentsInfo)}`,
            playlistSummary: true,
            activeContentId: null,
          },
        }
      );

      if (aiError) throw aiError;

      await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "assistant",
          content: aiData.message,
          related_contents: null,
        });

      await fetchMessages();
      await refetchStudyJourneySummary();
      scrollToBottom();
    } catch (error) {
      console.error('Error creating playlist:', error);
      toast.error('Erro ao salvar playlist');
    } finally {
      setSending(false);
    }
  };

  const getPlaylistMessages = () => {
    return messages.filter(msg => 
      msg.role === 'assistant' && 
      messageContents.get(msg.id) && 
      messageContents.get(msg.id)!.length > 1 &&
      savedPlaylists.has(msg.id)
    );
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  // Scroll callback for typewriter animation - uses scrollTop for smoother continuous scroll
  const handleContentGrow = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  const fetchPlaylists = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("study_playlists")
        .select("id, study_id, message_id")
        .eq("user_id", user.id);

      if (error) throw error;

      const allPlaylists = (data || []) as { id: string; study_id: string; message_id: string }[];
      const currentStudyPlaylists = allPlaylists.filter(p => p.study_id === id);

      setSavedPlaylists(new Set(currentStudyPlaylists.map(p => p.message_id)));
      setPlaylistsCount(allPlaylists.length);
    } catch (error) {
      console.error("Error fetching playlists:", error);
    }
  };

  const fetchStudy = async () => {
    if (!id) return;

    try {
      let data: any = null;
      let lastError: any = null;

      for (let attempt = 0; attempt < STUDY_BOOTSTRAP_RETRY_LIMIT; attempt += 1) {
        const response = await supabase
          .from("studies")
          .select("*")
          .eq("id", id)
          .maybeSingle();

        data = response.data;
        lastError = response.error;

        if (data) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, STUDY_BOOTSTRAP_RETRY_DELAY_MS));
      }

      if (!data) {
        throw lastError || new Error("STUDY_NOT_FOUND");
      }

      setStudy(data);
      // Initialize usage from study data
      if (data) {
        setStudyUsage({
          messageCount: data.message_count || 0,
          maxMessages: messageLimit
        });
      }
    } catch (error) {
      console.error("Error fetching study:", error);
      toast.error("Estudo não encontrado");
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async () => {
    if (!id) return;

    setLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from("study_messages")
        .select("*")
        .eq("study_id", id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const fetchedMessages = (data || []) as StudyMessage[];

      if (
        fetchedMessages.length === 0 &&
        initialMessageTriggeredRef.current &&
        latestMessagesRef.current.length > 0
      ) {
        return;
      }

      setMessages(fetchedMessages);
      if (fetchedMessages.length > 0) {
        setInitialMessageSent(true);
      }
      
      if (data) {
        const newContentsMap = new Map();
        data.forEach((msg: any) => {
          const sanitizedContents = sanitizeRelatedContents(msg.related_contents);
          if (sanitizedContents.length > 0) {
            newContentsMap.set(msg.id, sanitizedContents);
          }
        });
        setMessageContents(newContentsMap);
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
    } finally {
      setLoadingMessages(false);
    }
  };

  const fetchStudyAiState = async () => {
    if (!id) return;

    try {
      const { data, error } = await supabase
        .from("study_ai_state")
        .select("active_mode, celebration_count, current_focus, last_celebration, learner_level, live_plan_steps, next_best_action, user_goal, session_summary, mastered_topics, weak_topics, open_questions, last_checkpoint_at, last_quiz_score, last_quiz_total")
        .eq("study_id", id)
        .maybeSingle();

      if (error) throw error;

      setStudyAiState(mapStudyStateRecord(data as StudyAiStateRecord | null));
    } catch (error) {
      console.error("Error fetching study ai state:", error);
    }
  };

  const getAssistantMetadata = (message: StudyMessage): ClassyMessageMetadata | null => {
    if (message.role !== "assistant" || !message.metadata || typeof message.metadata !== "object") {
      return null;
    }

    return message.metadata as ClassyMessageMetadata;
  };

  const handleSuggestionClick = async (suggestion: string) => {
    trackClassyEvent("suggestion_clicked", {
      suggestion,
      current_focus: studyAiState?.currentFocus || null,
    });
    trackClassyEvent("followup_used", {
      suggestion,
      current_focus: studyAiState?.currentFocus || null,
    });

    await handleSend(suggestion);
  };

  const trackClassyEvent = async (eventKey: string, payload: Record<string, any>) => {
    if (!user || !id) return;

    try {
      await supabase.from("study_ai_events").insert({
        user_id: user.id,
        study_id: id,
        event_key: eventKey,
        payload,
      });
    } catch (error) {
      console.error("Error tracking classy event:", error);
    }
  };

  const buildAssistantMetadata = (aiData: any) => ({
    intent: aiData.intent || null,
    active_mode: aiData.studyState?.activeMode || null,
    next_best_action: aiData.studyState?.nextBestAction || null,
    follow_up_suggestions: aiData.followUpSuggestions || [],
    citations: aiData.citations || [],
    ui_blocks: aiData.uiBlocks || [],
    content_strategy: aiData.contentStrategy || null,
    source_transparency: aiData.sourceTransparency || null,
    checkpoint_generated: (aiData.uiBlocks || []).some((block: any) => block.type === "checkpoint"),
  });

  const studyTitleText = study?.title?.trim() || "Novo estudo";
  const sanitizedStudyTopic = sanitizeStudyTopic(studyTitleText) || studyTitleText;
  const studyDisplayTitle = toShortTitle(sanitizedStudyTopic) || sanitizedStudyTopic;
  const studyLearningTopic = studyDisplayTitle || "este tema";

  useEffect(() => {
    resizeTextareaToContent(messageInputRef.current);
  }, [input]);
  const studyJourneyOverrides = useMemo(
    () => ({
      activeMode: studyAiState?.activeMode,
      currentFocus: studyAiState?.currentFocus,
      nextBestAction: studyAiState?.nextBestAction,
    }),
    [
      studyAiState?.activeMode,
      studyAiState?.currentFocus,
      studyAiState?.nextBestAction,
    ]
  );
  const {
    summary: studyJourneySummary,
    refetch: refetchStudyJourneySummary,
  } = useStudyJourneySummary({
    studyId: id,
    userId: user?.id,
    title: studyTitleText,
    overrides: studyJourneyOverrides,
    enabled: Boolean(id && user?.id && study),
  });
  const studyJourneyRefetchPrimedRef = useRef(false);

  useEffect(() => {
    if (!study || !user || !id) return;
    if (!studyJourneyRefetchPrimedRef.current) {
      studyJourneyRefetchPrimedRef.current = true;
      return;
    }
    refetchStudyJourneySummary();
  }, [
    study?.id,
    user?.id,
    id,
    notesRefresh,
    savedPlaylists.size,
    messages.length,
    studyJourneyOverrides,
    refetchStudyJourneySummary,
  ]);
  const sendInitialMessage = async () => {
    if (!id || !user || !study) return;

    const now = new Date().toISOString();
    const initialMessage =
      studyLearningTopic === "este tema"
        ? "Quero começar um novo estudo"
        : `Quero aprender ${studyLearningTopic}`;
    const assistantReply = buildInitialAssistantReply(studyLearningTopic, profile?.display_name);
    const assistantMetadata = buildInitialAssistantMetadata();

    const localUserMessage: StudyMessage = {
      id: `local-user-${Date.now()}`,
      study_id: id,
      role: "user",
      content: initialMessage,
      created_at: now,
    };

    const localAssistantMessage: StudyMessage = {
      id: `local-assistant-${Date.now()}`,
      study_id: id,
      role: "assistant",
      content: assistantReply,
      created_at: now,
      metadata: assistantMetadata,
      related_contents: null,
    };

    setMessages([localUserMessage, localAssistantMessage]);
    setNewestMessageId(localAssistantMessage.id);
    setStudyUsage({
      messageCount: 1,
      maxMessages: messageLimit,
    });
    setStudyAiState({
      activeMode: "onboard",
      currentFocus: studyDisplayTitle,
      learnerLevel: "unknown",
      nextBestAction: "Entender seu nível atual antes de montar a melhor direção.",
      userGoal: studyDisplayTitle,
      sessionSummary: null,
      masteredTopics: [],
      weakTopics: [],
      openQuestions: [],
      lastCheckpointAt: null,
      lastQuizScore: null,
      lastQuizTotal: null,
      checkpointStatus: "due",
      livePlanSteps: [],
      lastCelebration: null,
      celebrationCount: 0,
    });

    try {
      const { error: userError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "user",
          content: initialMessage,
        });

      if (userError) throw userError;

      const { error: aiMessageError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "assistant",
          content: assistantReply,
          metadata: assistantMetadata,
          related_contents: null,
        });

      if (aiMessageError) throw aiMessageError;

      await supabase
        .from("study_ai_state")
        .upsert({
          study_id: id,
          user_goal: studyDisplayTitle,
          current_focus: studyDisplayTitle,
          learner_level: "unknown",
          active_mode: "onboard",
          next_best_action: "Entender seu nível atual antes de montar a melhor direção.",
          open_questions: INITIAL_ONBOARDING_SUGGESTIONS,
        });

      await updateLastActivity(id);

      const { data: updatedStudy } = await supabase
        .from("studies")
        .select("*")
        .eq("id", id)
        .single();

      if (updatedStudy) {
        setStudy(updatedStudy);
        setStudyUsage({
          messageCount: updatedStudy.message_count || 1,
          maxMessages: messageLimit,
        });
      }

      await fetchMessages();
      await refetchStudyJourneySummary();
    } catch (error: any) {
      console.error("Error syncing initial conversation:", error);
      initialMessageTriggeredRef.current = false;
      setInitialMessageSent(false);
      toast.error(getInitialConversationErrorMessage(error));
    }
  };

  const messageCount = studyUsage?.messageCount || study?.message_count || 0;
  const maxMessages = studyUsage?.maxMessages || messageLimit;
  const isMessageLimitReached = currentPlan !== 'premium' && maxMessages !== Infinity && messageCount >= maxMessages;
  const isChatLocked = Boolean(limitReached) || isMessageLimitReached;
  const userMessagesCount = messages.filter((message) => message.role === "user").length;
  const isEarlyOnboarding =
    studyAiState?.activeMode === "onboard" &&
    userMessagesCount <= 1 &&
    messages.length <= 2;
  const thinkingPhrases = buildThinkingPhrases(study?.title);
  const thinkingLabel = thinkingPhrases[thinkingPhraseIndex % thinkingPhrases.length];
  const hasDetailedStudyState = Boolean(
    studyAiState &&
    userMessagesCount >= 2 &&
    (
      (studyAiState.livePlanSteps?.length || 0) > 0 ||
      (studyAiState.masteredTopics?.length || 0) > 0 ||
      (studyAiState.weakTopics?.length || 0) > 0 ||
      (studyAiState.openQuestions?.length || 0) > 0 ||
      studyAiState.lastCelebration
    )
  );
  const shouldShowStudyMap = Boolean(study && studyJourneySummary);

  const handleSend = async (messageOverride?: string) => {
    if (isChatLocked) {
      toast.error("Limite atingido. Faça upgrade para continuar.");
      return;
    }
    const resolvedMessage = (messageOverride ?? input).trim();
    if (!resolvedMessage || !id || !user) return;

    const userMessage = resolvedMessage;
    const optimisticUserMessage: StudyMessage = {
      id: `local-user-${Date.now()}`,
      study_id: id,
      role: "user",
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    setInput("");
    setMessages((current) => [...current, optimisticUserMessage]);
    setSending(true);

    try {
      let currentVideoTime: number | undefined;
      if (activeContent) {
        const videoElement = document.querySelector('video');
        if (videoElement) {
          currentVideoTime = videoElement.currentTime;
        }
      }

      const { data: aiData, error: aiError } = await supabase.functions.invoke(
        "classy-chat",
        {
          body: {
            studyId: id,
            message: userMessage,
            activeContentId: activeContent?.id,
            currentVideoTime
          },
        }
      );

      if (aiError) throw aiError;

      // Handle limit errors
      if (aiData.limitReached) {
        const limitType = aiData.limitType === 'deviations' ? 'deviations' : 'messages';

        setLimitReached({
          type: limitType,
          suggestedTopic: aiData.suggestedTopic,
        });

        setStudyUsage({
          messageCount: aiData.usage?.userMessageCount || study?.message_count || 0,
          maxMessages: aiData.usage?.maxMessages || messageLimit,
        });

        return;
      }

      const { error: userError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "user",
          content: userMessage,
        });

      if (userError) throw userError;

      // Update usage info
      if (aiData.usage) {
        setStudyUsage({
          messageCount: aiData.usage.userMessageCount,
          maxMessages: aiData.usage.maxMessages
        });
      }

      if (aiData.studyState) {
        setStudyAiState(aiData.studyState);
      }

      const { data: aiMessageData, error: aiMessageError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "assistant",
          content: aiData.message,
          metadata: buildAssistantMetadata(aiData),
          related_contents: sanitizeRelatedContents(aiData.relatedContents) || null,
        })
        .select()
        .single();

      if (aiMessageError) throw aiMessageError;

      // Mark this message as the newest for typewriter animation
      setNewestMessageId(aiMessageData.id);
      await fetchMessages();
      await refetchStudyJourneySummary();
      await updateLastActivity(id);
      
      // Update study to get latest message_count
      const { data: updatedStudy } = await supabase
        .from("studies")
        .select("*")
        .eq("id", id)
        .single();
      
      if (updatedStudy) {
        setStudy(updatedStudy);
      }
    } catch (error: any) {
      console.error("Error sending message:", error);
      setMessages((current) => current.filter((message) => message.id !== optimisticUserMessage.id));
      toast.error("Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };


  const handleRename = async () => {
    if (!newTitle.trim() || !id) return;

    try {
      const { error } = await supabase
        .from("studies")
        .update({ title: newTitle.trim() })
        .eq("id", id);

      if (error) throw error;

      setStudy({ ...study, title: newTitle.trim() });
      setRenameDialogOpen(false);
      toast.success("Estudo renomeado com sucesso!");
    } catch (error) {
      console.error("Error renaming study:", error);
      toast.error("Erro ao renomear estudo");
    }
  };

  const handleDelete = async () => {
    if (!id) return;

    try {
      const { error: messagesError } = await supabase
        .from("study_messages")
        .delete()
        .eq("study_id", id);

      if (messagesError) throw messagesError;

      const { error: studyError } = await supabase
        .from("studies")
        .delete()
        .eq("id", id);

      if (studyError) throw studyError;

      toast.success("Estudo excluído com sucesso!");
      navigate("/");
    } catch (error) {
      console.error("Error deleting study:", error);
      toast.error("Erro ao excluir estudo");
    }
  };

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado para a área de transferência!");
  };

  const handlePlayContent = async (contentId: string, source?: { sourceMessageId?: string; title?: string; relevanceScore?: number | null }) => {
    try {
      if (source?.sourceMessageId) {
        trackClassyEvent("content_opened", {
          assistant_message_id: source.sourceMessageId,
          content_id: contentId,
          content_title: source.title || null,
          relevance_score: source.relevanceScore ?? null,
        });
      }

      // Reset playback time for mini player tracking
      currentPlaybackTimeRef.current = 0;
      
      const { data, error } = await supabase
        .from("contents")
        .select("id, title, file_url, content_type, duration_seconds, visibility, price, creator_id, views_count, created_at, tags, thumbnail_url, description, category_id, creator:profiles!creator_id(id, display_name, avatar_url, creator_channel_name, creator_channel_name)")
        .eq("id", contentId)
        .single();

      if (error) throw error;

      // Check access control
      const accessResult = await checkAccess({
        contentId: data.id,
        visibility: data.visibility as any,
        price: data.price,
      });

      if (!accessResult.hasAccess) {
        setActiveContentInfo({ price: data.price });
        if (accessResult.blockReason === "purchase") {
          setShowPurchaseModal(true);
        } else if (accessResult.blockReason === "plan") {
          setShowUpgradeModal(true);
        }
        return;
      }

      // Register view for metrics
      if (user) {
        await supabase.rpc("increment_content_view", {
          p_user_id: user.id,
          p_content_id: contentId,
        });
      }

      if (user) {
        const { data: progressData } = await supabase
          .from("user_progress")
          .select("last_position_seconds")
          .eq("user_id", user.id)
          .eq("content_id", contentId)
          .maybeSingle();

        setActiveContent({
          ...data,
          savedPosition: progressData?.last_position_seconds || 0
        });
      } else {
        setActiveContent(data);
      }
      
      await loadTranscription(contentId);
    } catch (error) {
      console.error("Error loading content:", error);
      toast.error("Erro ao carregar conteúdo");
    }
  };

  const handleVideoEnded = () => {
    if (!activePlaylist) return;

    const playlistContents = messageContents.get(activePlaylist.messageId) || [];
    const nextIndex = activePlaylist.currentIndex + 1;

    if (nextIndex < playlistContents.length) {
      startAutoplayCountdown(nextIndex);
    }
  };

  const startAutoplayCountdown = (nextIndex: number) => {
    setAutoplayCountdown(5);
    
    const interval = setInterval(() => {
      setAutoplayCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          playNextVideo(nextIndex);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    
    autoplayTimerRef.current = interval;
  };

  const cancelAutoplay = () => {
    if (autoplayTimerRef.current) {
      clearInterval(autoplayTimerRef.current);
      autoplayTimerRef.current = null;
    }
    setAutoplayCountdown(null);
  };

  const playNextVideo = (nextIndex: number) => {
    if (!activePlaylist) return;

    const playlistContents = messageContents.get(activePlaylist.messageId) || [];
    const nextContent = playlistContents[nextIndex];

    if (nextContent) {
      setActivePlaylist({ ...activePlaylist, currentIndex: nextIndex });
      handlePlayContent(nextContent.id, {
        sourceMessageId: activePlaylist.messageId,
        title: nextContent.title,
        relevanceScore: nextContent.relevanceScore,
      });
    }
    setAutoplayCountdown(null);
  };

  useEffect(() => {
    return () => {
      if (autoplayTimerRef.current) {
        clearInterval(autoplayTimerRef.current);
      }
    };
  }, []);

  const loadTranscription = async (contentId: string) => {
    try {
      const { data, error } = await supabase
        .from("transcriptions")
        .select("text")
        .eq("content_id", contentId)
        .maybeSingle();

      if (error) throw error;
      setTranscription(data?.text || "");
    } catch (error) {
      console.error("Error loading transcription:", error);
    }
  };

  const handleCreateNote = (timestamp: number) => {
    setNoteTimestamp(timestamp);
    setNoteText("");
    setNoteDialogOpen(true);
  };

  const handleSaveNote = async () => {
    if (!user || !id || !noteText.trim()) return;

    try {
      const { error } = await supabase.from("study_notes").insert({
        study_id: id,
        content_id: activeContent?.id || null,
        user_id: user.id,
        note_text: noteText.trim(),
        timestamp_seconds: noteTimestamp,
      });

      if (error) throw error;

      toast.success("Anotação salva com sucesso!");
      setNoteDialogOpen(false);
      setNoteText("");
      setNotesRefresh((prev) => prev + 1);
      await refetchStudyJourneySummary();
    } catch (error) {
      console.error("Error saving note:", error);
      toast.error("Erro ao salvar anotação");
    }
  };

  const handleSeekToTimestamp = (seconds: number) => {
    trackClassyEvent("citation_clicked", {
      seconds,
      current_focus: studyAiState?.currentFocus || null,
    });
    toast.info(`Saltar para ${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`);
  };

  const generateTranscription = async () => {
    if (!activeContent) return;
    
    setTranscriptionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("transcribe-content", {
        body: { contentId: activeContent.id },
      });

      if (error) throw error;

      if (data.error) {
        toast.error(data.error);
        return;
      }

      setTranscription(data.transcription.text);
      toast.success("Transcrição gerada com sucesso!");
      
      await loadTranscription(activeContent.id);
    } catch (error: any) {
      console.error("Error generating transcription:", error);
      toast.error("Erro ao gerar transcrição");
    } finally {
      setTranscriptionLoading(false);
    }
  };

  // Escape special regex characters to prevent ReDoS attacks
  const escapeRegex = (str: string) => 
    str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const highlightSearchResults = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const escapedQuery = escapeRegex(query);
    const regex = new RegExp(`(${escapedQuery})`, "gi");
    return text.split(regex).map((part, i) => 
      regex.test(part) 
        ? `<mark class="bg-primary/30 text-foreground">${part}</mark>` 
        : part
    ).join("");
  };

  if (loading) {
    return (
      <div className="flex-1">
        <Header />
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!study) {
    return null;
  }

  const studyProgressPercent = studyJourneySummary?.progressPercent ?? 0;
  const studyTotalMinutes = studyJourneySummary?.estimatedMinutes ?? 0;
  const compactStudyTitle = studyJourneySummary?.shortTitle || studyDisplayTitle;
  const compactStageLabel =
    studyJourneySummary?.stageLabel ||
    (studyAiState?.activeMode
      ? modeLabelMap[studyAiState.activeMode]
      : "Diagnóstico");
  const studyVideosCount = studyJourneySummary?.videosCount ?? 0;
  const studyPlaylistsCount = studyJourneySummary?.playlistsCount ?? savedPlaylists.size;
  const studyNotesCount = studyJourneySummary?.notesCount ?? 0;
  const studyRewardValue = studyJourneySummary?.rewardValue ?? 0;
  const studyPerformancePoints = studyJourneySummary?.performancePoints ?? 0;
  const studyEngagedContentsCount = studyJourneySummary?.engagedContentsCount ?? 0;
  const studyCompletedContentsCount = studyJourneySummary?.completedContentsCount ?? 0;
  const studyRecommendedContentsCount = studyJourneySummary?.totalRecommendedContents ?? 0;

  const studyMapActions = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onClick={() => {
            setNewTitle(studyTitleText);
            setRenameDialogOpen(true);
          }}
          className="cursor-pointer"
        >
          <Edit2 className="mr-2 h-4 w-4" />
          Renomear
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleShare} className="cursor-pointer">
          <Share2 className="mr-2 h-4 w-4" />
          Compartilhar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setDeleteDialogOpen(true)}
          className="cursor-pointer text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const studyMapCard = shouldShowStudyMap ? (
    <button
      type="button"
      onClick={() => setStudyMapDialogOpen(true)}
      className="group w-full overflow-hidden rounded-full border border-border/70 bg-[#FFF5F6] px-3 py-2.5 text-left transition-colors hover:border-primary/20 dark:border-white/10 dark:bg-[#2a141acc] sm:px-4"
    >
      <div className="flex w-full items-center gap-2 sm:gap-3">
        <img
          src="/star-red.png"
          alt=""
          aria-hidden="true"
          className="h-7 w-7 shrink-0 object-contain sm:h-8 sm:w-8"
        />

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground sm:text-base">
            {compactStudyTitle}
          </span>

          <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-background/92 px-2.5 py-1 text-sm font-semibold text-foreground dark:bg-white/10 dark:text-white">
            {studyProgressPercent}%
          </span>

          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-background/92 px-2.5 py-1 text-sm font-medium text-foreground/82 min-[430px]:inline-flex dark:bg-white/10 dark:text-white/82">
            <Brain className="h-4 w-4 text-muted-foreground dark:text-white/55" />
            <span className="truncate">{compactStageLabel}</span>
          </span>

          {studyRewardValue > 0 && (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-background/92 px-2.5 py-1 text-sm font-semibold text-foreground min-[760px]:inline-flex dark:bg-white/10 dark:text-white">
              <Coins className="h-4 w-4 text-muted-foreground dark:text-white/55" />
              R$ {studyRewardValue.toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden items-center gap-1 rounded-full bg-background/96 px-3 py-1.5 text-sm font-semibold text-foreground min-[520px]:inline-flex dark:bg-white dark:text-zinc-900">
            <span className="hidden min-[760px]:inline">Plano de estudo</span>
            <span className="min-[760px]:hidden">Plano</span>
            <ChevronRightIcon className="h-4 w-4" />
          </span>
          <span onClick={(event) => event.stopPropagation()}>
            {studyMapActions}
          </span>
        </div>
      </div>
    </button>
  ) : null;

  const studyMapDialog = shouldShowStudyMap ? (
    <Dialog open={studyMapDialogOpen} onOpenChange={setStudyMapDialogOpen}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-6 py-5 text-left">
          <DialogTitle>Mapa do estudo</DialogTitle>
          <DialogDescription>
            Foco, próximos passos e sinais da sua jornada com a Classy.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(85vh-88px)]">
          <div className="space-y-4 p-6">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Foco</p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {toShortTitle(studyAiState?.currentFocus || studyAiState?.userGoal || studyDisplayTitle)}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Modo atual</p>
                <p className="mt-2 text-sm font-medium text-foreground">{studyAiState?.activeMode ? modeLabelMap[studyAiState.activeMode] : "Em andamento"}</p>
              </div>
              <div className="rounded-2xl border border-primary/20 bg-primary/8 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">Próximo passo</p>
                <p className="mt-2 text-sm font-medium text-foreground">{studyAiState?.nextBestAction || "Continue a conversa para a Classy ajustar sua direção."}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Progresso</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{studyProgressPercent}%</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {studyEngagedContentsCount} engajados de {studyRecommendedContentsCount || 0} sugeridos
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Conteúdos</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{studyCompletedContentsCount}/{studyRecommendedContentsCount || 0}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {studyPlaylistsCount} playlists · {studyVideosCount} vídeos
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ganhos</p>
                <p className="mt-2 text-lg font-semibold text-foreground">R$ {studyRewardValue.toFixed(2)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{studyPerformancePoints} pontos de performance</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/35 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ritmo</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{studyTotalMinutes}min</p>
                <p className="mt-1 text-xs text-muted-foreground">{studyNotesCount} anotações no estudo</p>
              </div>
            </div>

            {(studyAiState?.livePlanSteps?.length || 0) > 0 && (
              <div className="rounded-3xl border border-border/60 bg-card p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/85">Rota sugerida</p>
                <div className="mt-4 space-y-2.5">
                  {studyAiState?.livePlanSteps?.slice(0, 4).map((step, index) => (
                    <div key={step} className="flex gap-3 rounded-2xl border border-border/50 bg-muted/25 px-4 py-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
                        {index + 1}
                      </div>
                      <p className="text-sm leading-6 text-foreground">{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {((studyAiState?.masteredTopics?.length || 0) > 0 || (studyAiState?.weakTopics?.length || 0) > 0) && (
              <div className="grid gap-3 md:grid-cols-2">
                {(studyAiState?.masteredTopics?.length || 0) > 0 && (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Já está firme</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {studyAiState?.masteredTopics?.slice(0, 4).map((topic) => (
                        <span key={topic} className="rounded-full border border-emerald-500/20 bg-background/70 px-3 py-1 text-xs text-foreground">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {(studyAiState?.weakTopics?.length || 0) > 0 && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Vale revisar</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {studyAiState?.weakTopics?.slice(0, 4).map((topic) => (
                        <span key={topic} className="rounded-full border border-amber-500/20 bg-background/70 px-3 py-1 text-xs text-foreground">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {(studyAiState?.openQuestions?.length || 0) > 0 && (
              <div className="rounded-2xl border border-border/60 bg-card p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Próximos atalhos úteis</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {studyAiState?.openQuestions?.slice(0, 3).map((question) => (
                    <Button
                      key={question}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full text-xs"
                      onClick={() => {
                        setStudyMapDialogOpen(false);
                        handleSuggestionClick(question);
                      }}
                    >
                      {question}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  ) : null;

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="flex flex-col h-[100dvh] overflow-hidden">
        <Header />
        
        {/* Mobile Header - Compact */}
        <header className="border-b border-border bg-card px-3 py-2.5 flex-shrink-0">
          <div className="flex items-center justify-end gap-2">
            {savedPlaylists.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 gap-1"
                onClick={() => setShowPlaylistSheet(true)}
              >
                <List className="w-4 h-4" />
                <span className="text-xs">{savedPlaylists.size}</span>
              </Button>
            )}

            <StudyUsageIndicator
              messageCount={studyUsage?.messageCount || study?.message_count || 0}
              maxMessages={studyUsage?.maxMessages || messageLimit}
              plan={currentPlan}
              compact
            />
          </div>
          {studyMapCard && !activeContent && (
            <div className="mt-3 w-full max-w-4xl mx-auto">
              {studyMapCard}
            </div>
          )}
        </header>
        {studyMapDialog}

        {/* Modals for access control */}
        <UpgradeModal open={showUpgradeModal} onOpenChange={setShowUpgradeModal} requiredPlan={requiredPlan} />
        {activeContentInfo && (
          <PurchaseModal
            open={showPurchaseModal}
            onOpenChange={setShowPurchaseModal}
            content={{
              id: activeContent?.id || "",
              title: activeContent?.title || "",
              thumbnail_url: activeContent?.thumbnail_url || "",
              price: activeContentInfo.price || 0,
              discount: 0,
              creator_name: activeContent?.creator?.display_name || "Criador",
            }}
            onPurchaseComplete={() => {
              setShowPurchaseModal(false);
              if (activeContent?.id) handlePlayContent(activeContent.id);
            }}
          />
        )}

        {/* Mobile Video Player - Inline when active */}
        {activeContent && !miniPlayerActive && (
          <MobileStudyPlayer
            activeContent={activeContent}
            activePlaylist={activePlaylist}
            messageContents={messageContents}
            autoplayCountdown={autoplayCountdown}
            activeToolPanel={activeToolPanel}
            onToolPanelChange={setActiveToolPanel}
            onMinimize={() => setMiniPlayerActive(true)}
            onVideoEnded={handleVideoEnded}
            onNoteCreated={() => setNotesRefresh((prev) => prev + 1)}
            onCancelAutoplay={cancelAutoplay}
            studyId={id}
            studyTitle={studyTitleText}
          />
        )}

        {/* Mobile Chat Area */}
        <div className="flex-1 min-h-0 overflow-hidden w-full max-w-full">
          <ScrollArea className="h-full w-full max-w-full" ref={scrollRef}>
            <div className="py-4 space-y-4 px-3 w-full max-w-full">
            {loading || (messages.length === 0 && !initialMessageSent) ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" />
                <p className="text-sm">Iniciando conversa...</p>
              </div>
            ) : (
              <>
                {messages.map((message) => {
                return (
                <div key={message.id} className="space-y-3 w-full overflow-hidden animate-fade-in">
                  <div
                    className={`flex w-full ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <ChatMessage
                      content={message.content}
                      role={message.role}
                      isNew={message.id === newestMessageId && message.role === 'assistant'}
                      className="text-sm"
                      onContentGrow={message.id === newestMessageId && message.role === 'assistant' ? handleContentGrow : undefined}
                    />
                  </div>
                  {message.role === "assistant" && (
                    <ClassyMessageExtras
                      metadata={getAssistantMetadata(message)}
                      onSuggestionClick={handleSuggestionClick}
                      onCitationClick={handleSeekToTimestamp}
                      compact
                    />
                  )}
                  
                  {/* Mobile Content Cards */}
                  {message.role === "assistant" && messageContents.has(message.id) && (
                    <div className="space-y-3 w-full">
                      {messageContents.get(message.id)!.length >= 3 ? (
                        <div className="relative">
                          <Carousel
                            opts={{
                              align: "start",
                              loop: false,
                            }}
                            className="w-full"
                          >
                            <CarouselContent className="-ml-2">
                              {messageContents.get(message.id)?.map((content: any) => (
                                <CarouselItem key={content.id} className="pl-2 basis-[75%]">
                                  <ChatContentCard
                                    id={content.id}
                                    title={content.title}
                                    description={content.description}
                                    thumbnail_url={content.thumbnail_url}
                                    content_type={content.content_type}
                                    duration_minutes={content.duration_minutes}
                                    required_plan={content.required_plan}
                                    visibility={content.visibility}
                                    price={content.price}
                                    is_free={content.is_free}
                                    relevanceScore={content.relevanceScore}
                                    onPlay={(contentId) => handlePlayContent(contentId, {
                                      sourceMessageId: message.id,
                                      title: content.title,
                                      relevanceScore: content.relevanceScore,
                                    })}
                                    compact
                                  />
                                </CarouselItem>
                              ))}
                            </CarouselContent>
                          </Carousel>
                        </div>
                      ) : (
                        <div 
                          className={`grid gap-2 w-full ${
                            messageContents.get(message.id)!.length === 1 
                              ? 'grid-cols-1' 
                              : 'grid-cols-2'
                          }`}
                        >
                          {messageContents.get(message.id)?.map((content: any) => (
                            <ChatContentCard
                              key={content.id}
                              id={content.id}
                              title={content.title}
                              description={content.description}
                              thumbnail_url={content.thumbnail_url}
                              content_type={content.content_type}
                              duration_minutes={content.duration_minutes}
                              required_plan={content.required_plan}
                              visibility={content.visibility}
                              price={content.price}
                              is_free={content.is_free}
                              relevanceScore={content.relevanceScore}
                              onPlay={(contentId) => handlePlayContent(contentId, {
                                sourceMessageId: message.id,
                                title: content.title,
                                relevanceScore: content.relevanceScore,
                              })}
                              compact
                            />
                          ))}
                        </div>
                      )}
                      {messageContents.get(message.id) && messageContents.get(message.id)!.length > 1 && (
                        <div className="flex gap-2 justify-start">
                          {savedPlaylists.has(message.id) ? (
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => {
                                setActivePlaylist({ messageId: message.id, currentIndex: 0 });
                                const firstContent = messageContents.get(message.id)?.[0];
                                if (firstContent) handlePlayContent(firstContent.id, {
                                  sourceMessageId: message.id,
                                  title: firstContent.title,
                                  relevanceScore: firstContent.relevanceScore,
                                });
                              }}
                              className="gap-1.5 text-xs h-8"
                            >
                              <Play className="w-3.5 h-3.5" />
                              Assistir Playlist
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const contentIds = messageContents.get(message.id)?.map(c => c.id) || [];
                                handleCreatePlaylist(message.id, contentIds);
                              }}
                              className="gap-1.5 text-xs h-8"
                            >
                              <List className="w-3.5 h-3.5" />
                              Salvar ({messageContents.get(message.id)!.length})
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
              </>
            )}
            <div ref={messagesEndRef} />
            {sending && (
              <div className="flex justify-start animate-fade-in pl-1">
                <div className="flex items-center gap-2 py-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs text-muted-foreground">{thinkingLabel}</span>
                </div>
              </div>
            )}

            {isChatLocked && (
              <div className="space-y-3 w-full overflow-hidden animate-fade-in">
                <div className="flex w-full justify-start">
                  <div className="w-full">
                    <div className="w-full rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
                        <p className="text-sm text-destructive">
                          {limitReached?.type === 'deviations'
                            ? `Novo tema detectado${limitReached?.suggestedTopic ? `: "${limitReached.suggestedTopic}"` : ''}. Faça upgrade para continuar explorando sem limites.`
                            : 'Você atingiu o limite de mensagens do seu plano. Faça upgrade para continuar.'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <UpgradePromptCard
                        userName={profile?.display_name}
                        currentPlan={currentPlan}
                        messageCount={messageCount}
                        maxMessages={maxMessages}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
            </div>
          </ScrollArea>
        </div>

        {/* Mobile Input - Fixed at bottom */}
        <div className="border-t border-border bg-card px-3 py-3 flex-shrink-0 pb-safe">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isChatLocked ? "Limite atingido — faça upgrade para continuar" : "Digite sua mensagem..."}
              disabled={sending || isChatLocked}
              className="flex-1 h-10"
            />
            <Button type="submit" disabled={sending || isChatLocked || !input.trim()} size="icon" className="h-10 w-10 shrink-0">
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </form>
        </div>

        {/* Mobile Mini Player - Above input */}
        {miniPlayerActive && activeContent && (
          <div className="flex-shrink-0 bg-card border-t-2 border-border">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {activeContent.title}
                </p>
                {activePlaylist && (
                  <p className="text-[10px] text-muted-foreground">
                    Playlist: {activePlaylist.currentIndex + 1}/{messageContents.get(activePlaylist.messageId)?.length}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setMiniPlayerActive(false)}
              >
                <Maximize2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  setMiniPlayerActive(false);
                  setActiveContent(null);
                  setActivePlaylist(null);
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="aspect-video bg-black max-h-36">
              <UnifiedVideoPlayer
                content={{
                  id: activeContent.id,
                  title: activeContent.title,
                  file_url: activeContent.file_url,
                  content_type: activeContent.content_type,
                  duration_seconds: activeContent.duration_seconds,
                  content_id: activeContent.id,
                }}
                mode="study"
                compact
                onVideoEnded={handleVideoEnded}
              />
            </div>
          </div>
        )}

        {/* Mobile FAB for Active Playlist */}
        {activePlaylist && !showPlaylistSheet && !miniPlayerActive && (
          <div className="fixed bottom-20 right-3 z-40">
            <Button
              onClick={() => setShowPlaylistSheet(true)}
              className="rounded-full shadow-2xl h-12 px-4 gap-2"
              size="lg"
            >
              <List className="w-4 h-4" />
              <span className="text-sm font-medium">
                {activePlaylist.currentIndex + 1}/{messageContents.get(activePlaylist.messageId)?.length}
              </span>
            </Button>
          </div>
        )}

        {/* Mobile Playlist Sheet */}
        <Sheet open={showPlaylistSheet} onOpenChange={setShowPlaylistSheet}>
          <SheetContent side="right" className="w-[85vw] max-w-sm p-0">
            <SheetHeader className="p-4 border-b">
              <SheetTitle>Playlists</SheetTitle>
              <SheetDescription>
                {savedPlaylists.size} playlist{savedPlaylists.size !== 1 ? 's' : ''} salva{savedPlaylists.size !== 1 ? 's' : ''}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-8rem)]">
              <div className="p-3 space-y-3">
                {getPlaylistMessages().map((msg, idx) => {
                  const contents = messageContents.get(msg.id) || [];
                  const isActive = activePlaylist?.messageId === msg.id;
                  return (
                    <button
                      key={msg.id}
                      onClick={() => {
                        setActivePlaylist({ messageId: msg.id, currentIndex: 0 });
                        const firstContent = contents[0];
                        if (firstContent) handlePlayContent(firstContent.id, {
                          sourceMessageId: msg.id,
                          title: firstContent.title,
                          relevanceScore: firstContent.relevanceScore,
                        });
                        setShowPlaylistSheet(false);
                      }}
                      className={`w-full text-left p-3 rounded-lg transition-all ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      }`}
                    >
                      <div className="font-medium text-sm">Playlist {idx + 1}</div>
                      <div className={`text-xs mt-1 ${isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                        {contents.length} conteúdos
                      </div>
                      {isActive && activePlaylist && (
                        <div className={`text-xs mt-2 ${isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          Reproduzindo: {activePlaylist.currentIndex + 1}/{contents.length}
                        </div>
                      )}
                    </button>
                  );
                })}
                {getPlaylistMessages().length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Nenhuma playlist salva ainda.
                  </p>
                )}
              </div>

              {/* Current Playlist Items */}
              {activePlaylist && (
                <div className="border-t p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Conteúdos da Playlist
                  </p>
                  {messageContents.get(activePlaylist.messageId)?.map((content, idx) => (
                    <button
                      key={content.id}
                      onClick={() => {
                        setActivePlaylist({ ...activePlaylist, currentIndex: idx });
                        handlePlayContent(content.id, {
                          sourceMessageId: activePlaylist.messageId,
                          title: content.title,
                          relevanceScore: content.relevanceScore,
                        });
                        setShowPlaylistSheet(false);
                      }}
                      className={`w-full text-left p-2.5 rounded-lg transition-all ${
                        idx === activePlaylist.currentIndex
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card hover:bg-muted'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`text-xs font-semibold mt-0.5 ${
                          idx === activePlaylist.currentIndex ? 'text-primary-foreground' : 'text-muted-foreground'
                        }`}>
                          {idx + 1}
                        </span>
                        <p className={`text-sm font-medium line-clamp-2 ${
                          idx === activePlaylist.currentIndex ? 'text-primary-foreground' : 'text-foreground'
                        }`}>
                          {content.title}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* Tool Panels - Sheets (shared with desktop) */}
        {renderToolSheets()}
        {renderDialogs()}
      </div>
    );
  }

  // Helper function to render tool sheets
  function renderToolSheets() {
    if (!activeContent) return null;
    
    return (
      <>
        {/* Transcription Sheet */}
        <Sheet open={activeToolPanel === 'transcription'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
          <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Transcrição</SheetTitle>
              <SheetDescription className="line-clamp-1">{activeContent.title}</SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              {!transcription && !transcriptionLoading ? (
                <div className="space-y-4">
                  <div className="text-muted-foreground text-sm">
                    <p>A transcrição deste conteúdo está sendo processada automaticamente.</p>
                    <p className="mt-2">
                      Isso acontece em segundo plano quando o conteúdo é aprovado. Recarregue a página em alguns minutos.
                    </p>
                    <p className="mt-2 text-xs">
                      Se a transcrição não aparecer após alguns minutos, você pode gerá-la manualmente:
                    </p>
                  </div>
                  <Button onClick={generateTranscription} disabled={transcriptionLoading} variant="outline" size="sm">
                    Tentar Gerar Novamente
                  </Button>
                </div>
              ) : transcriptionLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <p className="text-sm">Gerando transcrição...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Buscar na transcrição..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1"
                    />
                    {searchQuery && (
                      <Button variant="ghost" size="icon" onClick={() => setSearchQuery("")}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="prose prose-sm max-w-none text-foreground">
                    <div 
                      dangerouslySetInnerHTML={{ 
                        __html: highlightSearchResults(transcription, searchQuery) 
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Quiz Sheet */}
        <Sheet open={activeToolPanel === 'quiz'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
          <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Quiz</SheetTitle>
              <SheetDescription className="line-clamp-1">Teste seus conhecimentos</SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <StudyQuiz 
                studyId={id!}
                contentId={activeContent.id}
                contentTitle={activeContent.title}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Notes Sheet */}
        <Sheet open={activeToolPanel === 'notes'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
          <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Anotações</SheetTitle>
              <SheetDescription>Suas anotações de estudo</SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <StudyNotes
                studyId={id!}
                activeContentId={activeContent?.id || null}
                onSeekToTimestamp={handleSeekToTimestamp}
                key={notesRefresh}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Comments Sheet */}
        <Sheet open={activeToolPanel === 'comments'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
          <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Comentários</SheetTitle>
              <SheetDescription className="line-clamp-1">Discussões sobre {activeContent.title}</SheetDescription>
            </SheetHeader>
            <div className="mt-6 text-muted-foreground text-sm">
              <p>Comentários disponíveis em breve...</p>
            </div>
          </SheetContent>
        </Sheet>

        {/* Recommendations Sheet */}
        <Sheet open={activeToolPanel === 'recommendations'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
          <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Recomendações</SheetTitle>
              <SheetDescription>Conteúdos sugeridos para você</SheetDescription>
            </SheetHeader>
            <div className="mt-6 text-muted-foreground text-sm">
              <p>Recomendações personalizadas baseadas no seu progresso...</p>
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Helper function to render dialogs
  function renderDialogs() {
    return (
      <>
        {/* Rename Dialog */}
        <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Renomear Estudo</DialogTitle>
              <DialogDescription>
                Digite o novo nome para este estudo.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="new-title">Novo nome</Label>
              <Input
                id="new-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Digite o novo nome..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleRename();
                  }
                }}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleRename} disabled={!newTitle.trim()}>
                Renomear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir Estudo</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir este estudo? Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Create Note Dialog */}
        <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Anotação</DialogTitle>
              <DialogDescription>
                Adicione uma anotação {noteTimestamp > 0 ? `no momento ${Math.floor(noteTimestamp / 60)}:${(noteTimestamp % 60).toString().padStart(2, "0")}` : "geral"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="note-text">Anotação</Label>
                <Textarea
                  id="note-text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Digite sua anotação..."
                  className="min-h-[120px] mt-2"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveNote} disabled={!noteText.trim()}>
                Salvar Anotação
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Desktop Layout - sidebar-aware responsive container
  return (
    <div className="flex-1 flex flex-col h-screen w-full min-w-0 overflow-hidden">
      <Header />
          
      {/* Study Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex-shrink-0">
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 justify-center">
            <div className="w-full max-w-4xl">
              {!activeContent && studyMapCard}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* Usage Indicator - Desktop */}
            <StudyUsageIndicator
              messageCount={studyUsage?.messageCount || study?.message_count || 0}
              maxMessages={studyUsage?.maxMessages || messageLimit}
              plan={currentPlan}
            />

            {/* Playlists Button */}
            {savedPlaylists.size > 0 && (
              <DropdownMenu open={showPlaylistsDropdown} onOpenChange={setShowPlaylistsDropdown}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <List className="w-4 h-4" />
                    Playlists ({savedPlaylists.size})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {getPlaylistMessages().map((msg, idx) => {
                    const contents = messageContents.get(msg.id) || [];
                    return (
                      <DropdownMenuItem
                        key={msg.id}
                        onClick={() => {
                          setActivePlaylist({ messageId: msg.id, currentIndex: 0 });
                          const firstContent = contents[0];
                          if (firstContent) handlePlayContent(firstContent.id, {
                            sourceMessageId: msg.id,
                            title: firstContent.title,
                            relevanceScore: firstContent.relevanceScore,
                          });
                          setShowPlaylistsDropdown(false);
                        }}
                        className="cursor-pointer flex-col items-start gap-1 py-3"
                      >
                        <div className="font-medium text-sm">Playlist {idx + 1}</div>
                        <div className="text-xs text-muted-foreground">{contents.length} conteúdos</div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Actions Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => {
                    setNewTitle(studyTitleText);
                    setRenameDialogOpen(true);
                  }}
                  className="cursor-pointer"
                >
                  <Edit2 className="w-4 h-4 mr-2" />
                  Renomear
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleShare}
                  className="cursor-pointer"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Compartilhar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDeleteDialogOpen(true)}
                  className="cursor-pointer text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      {studyMapDialog}

      {/* Main Content Area - Responsive Layout based on sidebar state */}
      <div className="flex-1 flex min-w-0 overflow-hidden">
        {/* Left Panel - Video Player (when active and not minimized) */}
        {activeContent && !miniPlayerActive && (
          <>
            {/* Video Panel: flex-based width that adapts to available space */}
            <div 
              className="overflow-hidden"
              style={{ 
                flex: activePlaylist ? '6 1 0%' : '7 1 0%',
                minWidth: '350px',
              }}
            >
              <ScrollArea className="h-full">
                <div className="flex flex-col bg-background">
                  {/* Video Tools Bar - Using unified StudyToolbar - ABOVE player */}
                  <div className="flex items-center gap-2 p-2 bg-background/95 backdrop-blur-sm border-b border-border sticky top-0 z-20 shadow-sm">
                    <StudyToolbar
                      activePanel={activeToolPanel}
                      onPanelChange={setActiveToolPanel}
                    />
                    
                    <div className="flex-1" />
                    
                    {/* Mini Player Toggle */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setMiniPlayerActive(true)}
                      className="gap-2"
                    >
                      <Minimize2 className="w-4 h-4" />
                      Minimizar
                    </Button>
                  </div>

                  {/* Video Player */}
                  <div className="relative">
                    <div className="aspect-video">
                      <UnifiedVideoPlayer
                        content={{
                          id: activeContent.id,
                          title: activeContent.title,
                          file_url: activeContent.file_url,
                          content_type: activeContent.content_type,
                          duration_seconds: activeContent.duration_seconds,
                          content_id: activeContent.id,
                          creator: activeContent.creator,
                        }}
                        mode="study"
                        onVideoEnded={handleVideoEnded}
                        onNoteCreated={() => setNotesRefresh((prev) => prev + 1)}
                        onTimeUpdate={(time) => { currentPlaybackTimeRef.current = time; }}
                      />
                    </div>

                    {/* Autoplay Countdown Overlay */}
                    {autoplayCountdown !== null && activePlaylist && (
                      <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50">
                        <div className="bg-card border border-border rounded-lg p-8 text-center space-y-4 max-w-md mx-4">
                          <div className="space-y-2">
                            <h3 className="text-2xl font-bold text-foreground">Próximo Vídeo</h3>
                            <p className="text-muted-foreground">
                              {(() => {
                                const playlistContents = messageContents.get(activePlaylist.messageId) || [];
                                const nextContent = playlistContents[activePlaylist.currentIndex + 1];
                                return nextContent?.title || "Carregando...";
                              })()}
                            </p>
                          </div>
                          
                          <div className="flex items-center justify-center">
                            <div className="relative w-24 h-24">
                              <svg className="w-24 h-24 transform -rotate-90">
                                <circle
                                  cx="48"
                                  cy="48"
                                  r="40"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                  className="text-muted"
                                />
                                <circle
                                  cx="48"
                                  cy="48"
                                  r="40"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                  fill="none"
                                  strokeDasharray={`${2 * Math.PI * 40}`}
                                  strokeDashoffset={`${2 * Math.PI * 40 * (1 - autoplayCountdown / 5)}`}
                                  className="text-primary transition-all duration-1000 ease-linear"
                                />
                              </svg>
                              <span className="absolute inset-0 flex items-center justify-center text-3xl font-bold">
                                {autoplayCountdown}
                              </span>
                            </div>
                          </div>
                          
                          <Button variant="outline" onClick={cancelAutoplay}>
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="px-3 pt-3">
                    <ContentRewardProgress
                      contentId={activeContent.id}
                      studyId={id}
                      studyTitle={studyTitleText}
                      refreshTrigger={notesRefresh}
                    />
                  </div>

                  {/* Title */}
                  <div className="px-3 pt-3">
                    <h1 className="text-lg font-bold">{activeContent.title}</h1>
                  </div>

                  {/* Social Bar - BELOW player */}
                  <div className="px-3 py-2">
                    <SocialBar
                      contentId={activeContent.id}
                      contentTitle={activeContent.title}
                      creator={activeContent.creator ? {id: activeContent.creator.id, display_name: activeContent.creator.display_name, avatar_url: activeContent.creator.avatar_url, channel_name: (activeContent.creator as any)?.creator_channel_name} : null}
                      followersCount={followersCount}
                      showCreator={true}
                      onAddToStudy={() => {}}
                    />
                  </div>

                  {/* Description with views/date - YouTube style */}
                  <div className="px-3 pb-3">
                    <div className="bg-secondary/50 rounded-lg p-3">
                      <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">
                        {activeContent.views_count ? `${activeContent.views_count} visualizações` : "0 visualizações"} • {activeContent.created_at ? formatDistanceToNow(new Date(activeContent.created_at), { addSuffix: true, locale: ptBR }) : "recentemente"}
                        {activeContent.tags && activeContent.tags.length > 0 && (
                          <span className="ml-2">
                            {activeContent.tags.slice(0, 3).map((tag: string) => `#${tag}`).join(' ')}
                          </span>
                        )}
                      </p>
                      {activeContent.description && (
                        <p className="text-sm text-muted-foreground">{activeContent.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Comments */}
                  <div className="px-3 pb-3">
                    <ContentComments contentId={activeContent.id} />
                  </div>

                  {/* Related Content */}
                  <div className="px-3 pb-6">
                    <WatchRelated
                      contentId={activeContent.id}
                      categoryId={activeContent.category_id}
                      tags={activeContent.tags || []}
                      contentType={activeContent.content_type}
                    />
                  </div>
                </div>
              </ScrollArea>
            </div>

            {/* Active Playlist Panel - fixed width, shrinks when sidebar open */}
            {activePlaylist && (
              <div 
                className="flex-shrink-0 h-full flex flex-col bg-card border-l border-border"
                style={{ 
                  width: '200px',
                  minWidth: '160px',
                  transition: 'width 0.2s ease-out'
                }}
              >
                <div className="p-3 border-b border-border flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Playlist</h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setActivePlaylist(null)}
                      className="h-8 w-8"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {messageContents.get(activePlaylist.messageId)?.length || 0} conteúdos
                  </p>
                </div>
                
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-2">
                    {messageContents.get(activePlaylist.messageId)?.map((content, idx) => (
                      <button
                        key={content.id}
                        onClick={() => {
                          setActivePlaylist({ ...activePlaylist, currentIndex: idx });
                          handlePlayContent(content.id, {
                            sourceMessageId: activePlaylist.messageId,
                            title: content.title,
                            relevanceScore: content.relevanceScore,
                          });
                        }}
                        className={`w-full text-left p-3 rounded-lg transition-all ${
                          idx === activePlaylist.currentIndex
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted hover:bg-muted/80'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`text-xs font-semibold mt-1 ${
                            idx === activePlaylist.currentIndex ? 'text-primary-foreground' : 'text-muted-foreground'
                          }`}>
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium line-clamp-2 ${
                              idx === activePlaylist.currentIndex ? 'text-primary-foreground' : 'text-foreground'
                            }`}>
                              {content.title}
                            </p>
                            {content.description && (
                              <p className={`text-xs mt-1 line-clamp-1 ${
                                idx === activePlaylist.currentIndex ? 'text-primary-foreground/80' : 'text-muted-foreground'
                              }`}>
                                {content.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </>
        )}

        {/* Right Panel - Chat - flex-based width that adapts to remaining space */}
        <div 
          className={`flex flex-col overflow-hidden ${activeContent && !miniPlayerActive ? 'border-l border-border' : ''}`}
          style={{ 
            flex: activeContent && !miniPlayerActive ? '3 1 0%' : '1 1 0%',
            minWidth: activeContent && !miniPlayerActive ? '260px' : undefined,
          }}
        >
          <div className="flex flex-col h-full overflow-hidden">
            {/* Chat Messages */}
            <ScrollArea className="flex-1 px-6" ref={scrollRef}>
              <div className="max-w-4xl mx-auto py-6 space-y-6">
                {loading || (messages.length === 0 && !initialMessageSent) ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                    <p>Iniciando conversa sobre {studyDisplayTitle}...</p>
                  </div>
                ) : (
                  <>
                    {messages.map((message) => {
                    return (
                    <div key={message.id} className="space-y-4 animate-fade-in">
                      <div
                        className={`flex ${
                          message.role === "user" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <ChatMessage
                          content={message.content}
                          role={message.role}
                          isNew={message.id === newestMessageId && message.role === 'assistant'}
                          onContentGrow={message.id === newestMessageId && message.role === 'assistant' ? handleContentGrow : undefined}
                        />
                      </div>
                      {message.role === "assistant" && (
                        <ClassyMessageExtras
                          metadata={getAssistantMetadata(message)}
                          onSuggestionClick={handleSuggestionClick}
                          onCitationClick={handleSeekToTimestamp}
                        />
                      )}
                      
                      {/* Render content cards if available - Always carousel for responsive behavior */}
                      {message.role === "assistant" && messageContents.has(message.id) && (
                        <div className="space-y-4 w-full">
                          <div className="relative">
                            <Carousel
                              opts={{
                                align: "start",
                                loop: false,
                              }}
                              className="w-full"
                            >
                              <CarouselContent className="-ml-2">
                                {messageContents.get(message.id)?.map((content: any) => (
                                  <CarouselItem 
                                    key={content.id} 
                                    className="pl-2 basis-[280px] max-w-[280px]"
                                  >
                                    <ChatContentCard
                                      id={content.id}
                                      title={content.title}
                                      description={content.description}
                                      thumbnail_url={content.thumbnail_url}
                                      content_type={content.content_type}
                                      duration_minutes={content.duration_minutes}
                                      required_plan={content.required_plan}
                                      visibility={content.visibility}
                                    price={content.price}
                                    is_free={content.is_free}
                                    relevanceScore={content.relevanceScore}
                                      onPlay={(contentId) => handlePlayContent(contentId, {
                                        sourceMessageId: message.id,
                                        title: content.title,
                                        relevanceScore: content.relevanceScore,
                                      })}
                                      compact
                                    />
                                  </CarouselItem>
                                ))}
                              </CarouselContent>
                              {(messageContents.get(message.id)?.length ?? 0) > 1 && (
                                <>
                                  <CarouselPrevious className="absolute -left-3 top-1/2 -translate-y-1/2 h-8 w-8 bg-background/80 backdrop-blur-sm border-border" />
                                  <CarouselNext className="absolute -right-3 top-1/2 -translate-y-1/2 h-8 w-8 bg-background/80 backdrop-blur-sm border-border" />
                                </>
                              )}
                            </Carousel>
                          </div>
                          {messageContents.get(message.id) && messageContents.get(message.id)!.length > 1 && (
                            <div className="flex gap-2 justify-start pt-3 mt-1 border-t border-border/30">
                              {savedPlaylists.has(message.id) ? (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => {
                                    setActivePlaylist({ messageId: message.id, currentIndex: 0 });
                                    const firstContent = messageContents.get(message.id)?.[0];
                                    if (firstContent) handlePlayContent(firstContent.id, {
                                      sourceMessageId: message.id,
                                      title: firstContent.title,
                                      relevanceScore: firstContent.relevanceScore,
                                    });
                                  }}
                                  className="gap-2 shadow-sm hover:shadow-md transition-all h-9"
                                >
                                  <Play className="w-4 h-4" />
                                  Assistir Playlist
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const contentIds = messageContents.get(message.id)?.map(c => c.id) || [];
                                    handleCreatePlaylist(message.id, contentIds);
                                  }}
                                  className="gap-2 shadow-sm hover:shadow-md transition-all hover:border-primary/50 h-9"
                                >
                                  <List className="w-4 h-4" />
                                  Salvar Playlist ({messageContents.get(message.id)!.length} conteúdos)
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                  </>
                )}
                <div ref={messagesEndRef} />
                {sending && (
                  <div className="flex justify-start animate-fade-in pl-1">
                    <div className="flex items-center gap-2 py-2">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" />
                        <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-muted-foreground">{thinkingLabel}</span>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Input - Modern ChatGPT Style */}
            <div className="border-t border-border/50 bg-gradient-to-b from-card/50 to-background/50 backdrop-blur-xl px-4 sm:px-6 py-6 flex-shrink-0">
              <div className="max-w-4xl mx-auto">
                {isChatLocked && (
                  <div className="pb-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="w-full rounded-2xl border border-destructive/20 bg-gradient-to-r from-destructive/5 to-destructive/10 px-5 py-4 shadow-lg">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-xl bg-destructive/10">
                          <AlertCircle className="w-5 h-5 text-destructive" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-destructive/85">
                            {limitReached?.type === 'deviations'
                              ? `${limitReached?.suggestedTopic ? `"${limitReached.suggestedTopic}" • ` : ''}Faça upgrade para explorar temas ilimitados.`
                              : 'Limite atingido • atualize seu plano para continuar conversando.'}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <UpgradePromptCard
                        userName={profile?.display_name}
                        currentPlan={currentPlan}
                        messageCount={messageCount}
                        maxMessages={maxMessages}
                      />
                    </div>
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                  }}
                  className="relative"
                >
                  {/* Modern Input Container */}
                  <div className={cn(
                    "relative flex items-end gap-2 rounded-3xl transition-all duration-300",
                    "bg-card border-2 shadow-lg hover:shadow-xl",
                    isChatLocked 
                      ? "border-border/30 opacity-60" 
                      : "border-border/50 hover:border-border focus-within:border-primary/30 focus-within:shadow-2xl focus-within:shadow-primary/5"
                  )}>
                    {/* Text Input */}
                    <div className="flex-1 min-h-[56px] px-5 py-3">
                      <textarea
                        ref={messageInputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onInput={(e) => resizeTextareaToContent(e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                          }
                        }}
                        placeholder={isChatLocked ? "🔒 Limite atingido — faça upgrade para continuar" : "Pergunte algo à Classy..."}
                        disabled={sending || isChatLocked}
                        rows={1}
                        className={cn(
                          "block w-full bg-transparent resize-none overflow-y-hidden outline-none",
                          "text-sm sm:text-base leading-relaxed",
                          "placeholder:text-muted-foreground/60",
                          "disabled:cursor-not-allowed"
                        )}
                        style={{ minHeight: "24px", maxHeight: "160px" }}
                      />
                    </div>

                    {/* Send Button */}
                    <div className="pr-2 pb-2">
                      <Button 
                        type="submit" 
                        disabled={sending || isChatLocked || !input.trim()}
                        size="icon"
                        className={cn(
                          "h-10 w-10 rounded-2xl transition-all duration-300 shadow-md",
                          "disabled:opacity-40 disabled:cursor-not-allowed",
                          !input.trim() && !sending && !isChatLocked && "opacity-50 hover:opacity-70",
                          input.trim() && !sending && !isChatLocked && "bg-primary hover:bg-primary/90 hover:scale-105 active:scale-95 shadow-lg shadow-primary/20"
                        )}
                      >
                        {sending ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Send className="w-5 h-5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Character hint for long messages */}
                  {input.length > 200 && (
                    <p className="text-xs text-muted-foreground/60 mt-2 ml-5 animate-in fade-in duration-300">
                      {input.length} caracteres • Shift+Enter para nova linha
                    </p>
                  )}
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tool Panels - Sheets */}
      {renderToolSheets()}
      {renderDialogs()}

      {/* Mini Player Flutuante - Desktop */}
      {miniPlayerActive && activeContent && (
        <div
          ref={miniPlayerRef}
          className="fixed bottom-20 right-20 z-50 w-80 bg-card border-2 border-border rounded-lg shadow-2xl overflow-hidden"
          style={{
            transform: `translate(${miniPlayerPosition.x}px, ${miniPlayerPosition.y}px)`
          }}
        >
          {/* Mini Player Header */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-card/95 backdrop-blur-sm border-b border-border cursor-move"
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingRef.current = true;
              const startX = e.clientX - miniPlayerPosition.x;
              const startY = e.clientY - miniPlayerPosition.y;

              const handleMouseMove = (e: MouseEvent) => {
                if (isDraggingRef.current) {
                  setMiniPlayerPosition({
                    x: e.clientX - startX,
                    y: e.clientY - startY
                  });
                }
              };

              const handleMouseUp = () => {
                isDraggingRef.current = false;
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
              };

              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {activeContent.title}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setMiniPlayerActive(false)}
              >
                <Maximize2 className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setMiniPlayerActive(false);
                  setActiveContent(null);
                  setActivePlaylist(null);
                }}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Mini Video Player */}
          <div className="aspect-video bg-black">
            <UnifiedVideoPlayer
              content={{
                id: activeContent.id,
                title: activeContent.title,
                file_url: activeContent.file_url,
                content_type: activeContent.content_type,
                duration_seconds: activeContent.duration_seconds,
                content_id: activeContent.id,
              }}
              mode="study"
              compact
              onVideoEnded={handleVideoEnded}
            />
          </div>

          {/* Mini Playlist (if active) */}
          {activePlaylist && (
            <div className="p-2 border-t border-border bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">
                Playlist: {activePlaylist.currentIndex + 1}/{(messageContents.get(activePlaylist.messageId) || []).length}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Study() {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <StudyContent />
      </div>
    </SidebarProvider>
  );
}
