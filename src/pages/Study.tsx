import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, ArrowLeft, MoreVertical, Edit2, Share2, Trash2, X, List, FileText, Brain, StickyNote, MessageSquare, Lightbulb, Minimize2, Maximize2, Play, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { StudyMessage } from "@/hooks/useStudies";
import { useStudies } from "@/hooks/useStudies";
import { StudyUsageIndicator } from "@/components/StudyUsageIndicator";
import { ChatContentCard } from "@/components/ChatContentCard";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { UpgradePromptCard } from "@/components/chat/UpgradePromptCard";
import { StudyVideoPlayer } from "@/components/StudyVideoPlayer";
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

function StudyContent() {
  const { id } = useParams<{ id: string }>();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { updateLastActivity, getStudyUsage } = useStudies();
  const { setOpen, open } = useSidebar();
  const isMobile = useIsMobile();

  const currentPlan = (profile?.plan || 'free') as 'free' | 'pro' | 'premium';
  const PLAYLIST_LIMITS: Record<'free' | 'pro' | 'premium', number> = {
    free: 5,
    pro: 50,
    premium: Infinity,
  };
  const MESSAGE_LIMITS: Record<'free' | 'pro' | 'premium', number> = {
    free: 5,
    pro: 30,
    premium: Infinity,
  };
  const playlistLimit = PLAYLIST_LIMITS[currentPlan];
  const messageLimit = MESSAGE_LIMITS[currentPlan];
  
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
  const autoplayTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Tool panels state
  const [activeToolPanel, setActiveToolPanel] = useState<'transcription' | 'quiz' | 'notes' | 'comments' | 'recommendations' | null>(null);
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
      fetchMessages();
      fetchPlaylists();
    }
  }, [id, user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (
      study && 
      !loadingMessages && 
      messages.length === 0 && 
      !initialMessageSent && 
      !loading && 
      !sending
    ) {
      setInitialMessageSent(true);
      sendInitialMessage();
    }
  }, [study, loadingMessages, messages.length, initialMessageSent, loading, sending]);

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
            handlePlayContent(firstContentId);
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
      const { data, error } = await supabase
        .from("studies")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

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

      setMessages((data || []) as StudyMessage[]);
      
      if (data) {
        const newContentsMap = new Map();
        data.forEach((msg: any) => {
          if (msg.related_contents && msg.related_contents.length > 0) {
            newContentsMap.set(msg.id, msg.related_contents);
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

  const sendInitialMessage = async () => {
    if (!id || !user || !study) return;
    
    setSending(true);

    try {
      const initialMessage = `Olá! Quero aprender sobre ${study.title}`;
      
      const { error: userError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "user",
          content: initialMessage,
        });

      if (userError) throw userError;

      await fetchMessages();
      await updateLastActivity(id);

      const { data: aiData, error: aiError } = await supabase.functions.invoke(
        "classy-chat",
        {
          body: {
            studyId: id,
            message: initialMessage,
            activeContentId: activeContent?.id,
          },
        }
      );

      if (aiError) throw aiError;

      // Update usage info from response
      if (aiData.usage) {
        setStudyUsage({
          messageCount: aiData.usage.messageCount,
          maxMessages: aiData.usage.maxMessages
        });
      }

      const { data: aiMessageData, error: aiMessageError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "assistant",
          content: aiData.message,
          related_contents: aiData.relatedContents || null,
        })
        .select()
        .single();

      if (aiMessageError) throw aiMessageError;

      // Mark this message as the newest for typewriter animation
      setNewestMessageId(aiMessageData.id);
      await fetchMessages();
      
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
      console.error("Error sending initial message:", error);
      toast.error("Erro ao iniciar conversa. Estudo não encontrado.");
      navigate("/");
    } finally {
      setSending(false);
    }
  };

  const messageCount = studyUsage?.messageCount || study?.message_count || 0;
  const maxMessages = studyUsage?.maxMessages || messageLimit;
  const isMessageLimitReached = currentPlan !== 'premium' && maxMessages !== Infinity && messageCount >= maxMessages;
  const isChatLocked = Boolean(limitReached) || isMessageLimitReached;

  const handleSend = async () => {
    if (isChatLocked) {
      toast.error("Limite atingido. Faça upgrade para continuar.");
      return;
    }
    if (!input.trim() || !id || !user) return;

    const userMessage = input.trim();
    setInput("");
    setSending(true);

    try {
      const { error: userError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "user",
          content: userMessage,
        });

      if (userError) throw userError;

      await fetchMessages();
      await updateLastActivity(id);

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
        const limitType = aiData.limitType === 'DEVIATION_LIMIT_REACHED' ? 'deviations' : 'messages';

        setLimitReached({
          type: limitType,
          suggestedTopic: aiData.suggestedTopic,
        });

        setStudyUsage({
          messageCount: aiData.usage?.messageCount || study?.message_count || 0,
          maxMessages: aiData.usage?.maxMessages || messageLimit,
        });

        return;
      }

      // Update usage info
      if (aiData.usage) {
        setStudyUsage({
          messageCount: aiData.usage.messageCount,
          maxMessages: aiData.usage.maxMessages
        });
      }

      const { data: aiMessageData, error: aiMessageError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "assistant",
          content: aiData.message,
          related_contents: aiData.relatedContents || null,
        })
        .select()
        .single();

      if (aiMessageError) throw aiMessageError;

      // Mark this message as the newest for typewriter animation
      setNewestMessageId(aiMessageData.id);
      await fetchMessages();
      
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

  const handlePlayContent = async (contentId: string) => {
    try {
      const { data, error } = await supabase
        .from("contents")
        .select("id, title, file_url, content_type, duration_seconds")
        .eq("id", contentId)
        .single();

      if (error) throw error;

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
      handlePlayContent(nextContent.id);
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
    } catch (error) {
      console.error("Error saving note:", error);
      toast.error("Erro ao salvar anotação");
    }
  };

  const handleSeekToTimestamp = (seconds: number) => {
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

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="flex flex-col h-[100dvh] overflow-hidden">
        <Header />
        
        {/* Mobile Header - Compact */}
        <header className="border-b border-border bg-card px-3 py-2.5 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-semibold text-foreground truncate">
                {study.title}
              </h1>
            </div>

            {/* Usage Indicator - Mobile Compact */}
            <StudyUsageIndicator
              messageCount={studyUsage?.messageCount || study?.message_count || 0}
              maxMessages={studyUsage?.maxMessages || messageLimit}
              plan={currentPlan}
              compact
            />

            <div className="flex items-center gap-1">
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

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={() => {
                      setNewTitle(study.title);
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

        {/* Mobile Video Player - Inline when active */}
        {activeContent && !miniPlayerActive && (
          <div className="flex-shrink-0">
            {/* Video Container with aspect ratio */}
            <div className="relative bg-black" style={{ maxHeight: '30vh' }}>
              <div className="aspect-video max-h-[30vh]">
                <StudyVideoPlayer
                  studyId={id!}
                  content={activeContent}
                  compact
                  onClose={() => {
                    setActiveContent(null);
                    setActivePlaylist(null);
                    setTranscription("");
                    setSearchQuery("");
                    cancelAutoplay();
                    setActiveToolPanel(null);
                  }}
                  onTranscriptionUpdate={() => loadTranscription(activeContent.id)}
                  onCreateNote={handleCreateNote}
                  onVideoEnded={handleVideoEnded}
                />
              </div>

              {/* Autoplay Countdown Overlay - Mobile */}
              {autoplayCountdown !== null && activePlaylist && (
                <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-card border border-border rounded-lg p-4 text-center space-y-2 mx-4">
                    <h3 className="text-base font-bold text-foreground">Próximo Vídeo</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {(() => {
                        const playlistContents = messageContents.get(activePlaylist.messageId) || [];
                        const nextContent = playlistContents[activePlaylist.currentIndex + 1];
                        return nextContent?.title || "Carregando...";
                      })()}
                    </p>
                    <div className="text-2xl font-bold text-primary">{autoplayCountdown}</div>
                    <Button variant="outline" size="sm" onClick={cancelAutoplay}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile Tool Buttons - Horizontal Scroll */}
            <div className="flex items-center gap-1 px-2 py-1.5 bg-card border-b border-border overflow-x-auto scrollbar-hide">
              <Button
                variant={activeToolPanel === 'transcription' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveToolPanel(activeToolPanel === 'transcription' ? null : 'transcription')}
                className="h-8 px-2.5 shrink-0"
              >
                <FileText className="w-4 h-4" />
              </Button>
              <Button
                variant={activeToolPanel === 'quiz' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveToolPanel(activeToolPanel === 'quiz' ? null : 'quiz')}
                className="h-8 px-2.5 shrink-0"
              >
                <Brain className="w-4 h-4" />
              </Button>
              <Button
                variant={activeToolPanel === 'notes' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveToolPanel(activeToolPanel === 'notes' ? null : 'notes')}
                className="h-8 px-2.5 shrink-0"
              >
                <StickyNote className="w-4 h-4" />
              </Button>
              <Button
                variant={activeToolPanel === 'comments' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveToolPanel(activeToolPanel === 'comments' ? null : 'comments')}
                className="h-8 px-2.5 shrink-0"
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
              <Button
                variant={activeToolPanel === 'recommendations' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveToolPanel(activeToolPanel === 'recommendations' ? null : 'recommendations')}
                className="h-8 px-2.5 shrink-0"
              >
                <Lightbulb className="w-4 h-4" />
              </Button>
              
              <div className="flex-1" />
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMiniPlayerActive(true)}
                className="h-8 px-2.5 shrink-0"
              >
                <Minimize2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
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
              messages.map((message) => {
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
                                    onPlay={handlePlayContent}
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
                              onPlay={handlePlayContent}
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
                                if (firstContent) handlePlayContent(firstContent.id);
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
              })
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
                  <span className="text-xs text-muted-foreground">Pensando...</span>
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
              <StudyVideoPlayer
                studyId={id!}
                content={activeContent}
                compact
                onClose={() => {}}
                onTranscriptionUpdate={() => {}}
                onCreateNote={() => {}}
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
                        if (firstContent) handlePlayContent(firstContent.id);
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
                        handlePlayContent(content.id);
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

  // Desktop Layout
  return (
    <div className="flex-1 flex flex-col h-screen">
      <Header />
          
      {/* Study Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-foreground">
              {study.title}
            </h1>
            {study.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {study.description}
              </p>
            )}
          </div>

          {/* Usage Indicator - Desktop */}
          <StudyUsageIndicator
            messageCount={studyUsage?.messageCount || study?.message_count || 0}
            maxMessages={studyUsage?.maxMessages || messageLimit}
            plan={currentPlan}
          />

          <div className="flex items-center gap-2">
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
                          if (firstContent) handlePlayContent(firstContent.id);
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
                    setNewTitle(study.title);
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

      {/* Main Content Area - Resizable Panels */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Panel - Video Player (when active and not minimized) */}
        {activeContent && !miniPlayerActive && (
          <>
            <ResizablePanel defaultSize={activePlaylist ? 50 : 60} minSize={40}>
              <div className="relative h-full flex flex-col bg-background">
                {/* Video Tools Bar */}
                <div className="flex items-center gap-1 p-2 bg-card/50 backdrop-blur-sm border-b border-border">
                  <Button
                    variant={activeToolPanel === 'transcription' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setActiveToolPanel(activeToolPanel === 'transcription' ? null : 'transcription')}
                    className="gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    Transcrição
                  </Button>
                  <Button
                    variant={activeToolPanel === 'quiz' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setActiveToolPanel(activeToolPanel === 'quiz' ? null : 'quiz')}
                    className="gap-2"
                  >
                    <Brain className="w-4 h-4" />
                    Quiz
                  </Button>
                  <Button
                    variant={activeToolPanel === 'notes' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setActiveToolPanel(activeToolPanel === 'notes' ? null : 'notes')}
                    className="gap-2"
                  >
                    <StickyNote className="w-4 h-4" />
                    Anotações
                  </Button>
                  <Button
                    variant={activeToolPanel === 'comments' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setActiveToolPanel(activeToolPanel === 'comments' ? null : 'comments')}
                    className="gap-2"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Comentários
                  </Button>
                  <Button
                    variant={activeToolPanel === 'recommendations' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setActiveToolPanel(activeToolPanel === 'recommendations' ? null : 'recommendations')}
                    className="gap-2"
                  >
                    <Lightbulb className="w-4 h-4" />
                    Recomendações
                  </Button>
                  
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
                <div className="flex-1 relative">
                  <StudyVideoPlayer
                    studyId={id!}
                    content={activeContent}
                    onClose={() => {
                      setActiveContent(null);
                      setActivePlaylist(null);
                      setTranscription("");
                      setSearchQuery("");
                      cancelAutoplay();
                      setActiveToolPanel(null);
                    }}
                    onTranscriptionUpdate={() => loadTranscription(activeContent.id)}
                    onCreateNote={handleCreateNote}
                    onVideoEnded={handleVideoEnded}
                  />

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
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-4xl font-bold text-foreground">{autoplayCountdown}</span>
                            </div>
                          </div>
                        </div>
                        
                        <Button 
                          variant="outline" 
                          onClick={cancelAutoplay}
                          className="w-full"
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />

            {/* Active Playlist Panel */}
            {activePlaylist && (
              <>
                <ResizablePanel defaultSize={25} minSize={15} maxSize={35}>
                  <div className="h-full flex flex-col bg-card border-l border-border">
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
                              handlePlayContent(content.id);
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
                </ResizablePanel>
                <ResizableHandle withHandle />
              </>
            )}
          </>
        )}

        {/* Right Panel - Chat */}
        <ResizablePanel 
          defaultSize={miniPlayerActive ? 100 : (activeContent ? (activePlaylist ? 25 : 40) : 100)} 
          minSize={20}
        >
          <div className="flex flex-col h-full">
            {/* Chat Messages */}
            <ScrollArea className="flex-1 px-6" ref={scrollRef}>
              <div className="max-w-4xl mx-auto py-6 space-y-6">
                {loading || (messages.length === 0 && !initialMessageSent) ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                    <p>Iniciando conversa sobre {study.title}...</p>
                  </div>
                ) : (
                  messages.map((message) => {
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
                      
                      {/* Render content cards if available */}
                      {message.role === "assistant" && messageContents.has(message.id) && (
                        <div className="space-y-4 w-full">
                          {messageContents.get(message.id)!.length >= 4 ? (
                            /* Carousel for 4+ cards */
                            <div className="relative">
                              <Carousel
                                opts={{
                                  align: "start",
                                  loop: false,
                                }}
                                className="w-full"
                              >
                                <CarouselContent className="-ml-4">
                                  {messageContents.get(message.id)?.map((content: any) => (
                                    <CarouselItem key={content.id} className="pl-4 basis-1/3">
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
                                        onPlay={handlePlayContent}
                                      />
                                    </CarouselItem>
                                  ))}
                                </CarouselContent>
                                <CarouselPrevious className="absolute -left-4 top-1/2 -translate-y-1/2" />
                                <CarouselNext className="absolute -right-4 top-1/2 -translate-y-1/2" />
                              </Carousel>
                            </div>
                          ) : (
                            /* Grid for 1-3 cards */
                            <div 
                              className={`grid gap-3 w-full ${
                                messageContents.get(message.id)!.length === 1 
                                  ? 'grid-cols-1' 
                                  : messageContents.get(message.id)!.length === 2 
                                  ? 'grid-cols-2' 
                                  : 'grid-cols-3'
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
                                  onPlay={handlePlayContent}
                                />
                              ))}
                            </div>
                          )}
                          {messageContents.get(message.id) && messageContents.get(message.id)!.length > 1 && (
                            <div className="flex gap-2 justify-start pt-3 mt-1 border-t border-border/30">
                              {savedPlaylists.has(message.id) ? (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => {
                                    setActivePlaylist({ messageId: message.id, currentIndex: 0 });
                                    const firstContent = messageContents.get(message.id)?.[0];
                                    if (firstContent) handlePlayContent(firstContent.id);
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
                  })
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
                      <span className="text-sm text-muted-foreground">Pensando...</span>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="border-t border-border bg-card px-6 py-4 flex-shrink-0">
              <div className="max-w-4xl mx-auto">
                {isChatLocked && (
                  <div className="pb-4">
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
                )}

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
                    className="flex-1"
                  />
                  <Button type="submit" disabled={sending || isChatLocked || !input.trim()}>
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

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
            <StudyVideoPlayer
              studyId={id!}
              content={activeContent}
              onClose={() => {}}
              onTranscriptionUpdate={() => {}}
              onCreateNote={() => {}}
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
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <StudyContent />
      </div>
    </SidebarProvider>
  );
}
