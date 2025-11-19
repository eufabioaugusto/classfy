import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Send, ArrowLeft, MoreVertical, Edit2, Share2, Trash2, X } from "lucide-react";
import { StudyMessage } from "@/hooks/useStudies";
import { useStudies } from "@/hooks/useStudies";
import { ChatContentCard } from "@/components/ChatContentCard";
import { StudyVideoPlayer } from "@/components/StudyVideoPlayer";
import { StudyQuiz } from "@/components/StudyQuiz";
import { StudyNotes } from "@/components/StudyNotes";
import { Textarea } from "@/components/ui/textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
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

export default function Study() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { updateLastActivity } = useStudies();
  
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }

    if (id) {
      fetchStudy();
      fetchMessages();
    }
  }, [id, user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Send initial message ONLY when:
  // 1. Study is loaded
  // 2. Messages have been loaded (not still loading)
  // 3. There are truly no messages
  // 4. We haven't sent initial message yet
  // 5. We're not currently loading or sending
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

  const handleCreatePlaylist = async (contentIds: string[]) => {
    if (!user || !id) return;
    
    try {
      // Instead of creating a new study, add a playlist message to current study
      const playlistMessage = `📚 Ótimo! Preparei uma sequência de estudos com ${contentIds.length} conteúdos selecionados. Você pode assistir na ordem que preferir! Clique nos cards abaixo para começar.`;
      
      // Insert assistant message with playlist
      const { error: messageError } = await supabase
        .from('study_messages')
        .insert({
          study_id: id,
          role: 'assistant',
          content: playlistMessage,
          related_contents: contentIds
        });

      if (messageError) throw messageError;

      // Fetch the contents to add to messageContents
      const { data: contents } = await supabase
        .from('contents')
        .select('*')
        .in('id', contentIds);

      if (contents) {
        // Reload messages to show the new playlist
        await fetchMessages();
      }

      toast.success('Playlist criada no estudo atual!');
    } catch (error) {
      console.error('Error creating playlist:', error);
      toast.error('Erro ao criar playlist');
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
      
      // Load related contents from database
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
      // Send initial greeting to trigger AI response with content recommendations
      const initialMessage = `Olá! Quero aprender sobre ${study.title}`;
      
      // Save user message
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

      // Call AI
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

      // Save AI response with related contents
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

      await fetchMessages();
    } catch (error: any) {
      console.error("Error sending initial message:", error);
      toast.error("Erro ao iniciar conversa. Estudo não encontrado.");
      navigate("/");
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !id || !user) return;

    const userMessage = input.trim();
    setInput("");
    setSending(true);

    try {
      // Save user message
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

      // Call AI
      // Get current video time if there's active content
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

      // Save AI response with related contents
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

      await fetchMessages();
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
      // Delete messages first
      const { error: messagesError } = await supabase
        .from("study_messages")
        .delete()
        .eq("study_id", id);

      if (messagesError) throw messagesError;

      // Delete study
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
      setActiveContent(data);
      
      // Load transcription if available
      await loadTranscription(contentId);
    } catch (error) {
      console.error("Error loading content:", error);
      toast.error("Erro ao carregar conteúdo");
    }
  };

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
    // Future: Implement seek functionality if needed
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
      
      // Reload transcription to show the newly generated one
      await loadTranscription(activeContent.id);
    } catch (error: any) {
      console.error("Error generating transcription:", error);
      toast.error("Erro ao gerar transcrição");
    } finally {
      setTranscriptionLoading(false);
    }
  };

  const highlightSearchResults = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const regex = new RegExp(`(${query})`, "gi");
    return text.split(regex).map((part, i) => 
      regex.test(part) 
        ? `<mark class="bg-primary/30 text-foreground">${part}</mark>` 
        : part
    ).join("");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!study) {
    return null;
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
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
          </div>

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
      </header>

      {/* Main Content Area - Resizable Panels */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Panel - Video Player (when active) */}
        {activeContent && (
          <>
            <ResizablePanel defaultSize={60} minSize={40}>
              <StudyVideoPlayer
                studyId={id!}
                content={activeContent}
                onClose={() => {
                  setActiveContent(null);
                  setTranscription("");
                  setSearchQuery("");
                }}
                onTranscriptionUpdate={() => loadTranscription(activeContent.id)}
                onCreateNote={handleCreateNote}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}

        {/* Right Panel - Chat */}
        <ResizablePanel defaultSize={activeContent ? 40 : 100} minSize={30}>
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
                  messages.map((message) => (
                    <div key={message.id} className="space-y-4">
                      <div
                        className={`flex ${
                          message.role === "user" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-3 ${
                            message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                      </div>
                      
                      {/* Render content cards if available */}
                      {message.role === "assistant" && messageContents.has(message.id) && (
                        <div className="space-y-4 w-full">
                          {messageContents.get(message.id)!.length >= 4 ? (
                            /* Carousel for 4+ cards */
                            <div className="relative px-12">
                              <Carousel
                                opts={{
                                  align: "start",
                                  loop: false,
                                }}
                                className="w-full"
                              >
                                <CarouselContent className="-ml-3">
                                  {messageContents.get(message.id)?.map((content: any) => (
                                    <CarouselItem key={content.id} className="pl-3 basis-1/3">
                                      <ChatContentCard
                                        id={content.id}
                                        title={content.title}
                                        description={content.description}
                                        thumbnail_url={content.thumbnail_url}
                                        content_type={content.content_type}
                                        duration_minutes={content.duration_minutes}
                                        required_plan={content.required_plan}
                                        is_free={content.is_free}
                                        matchScore={content.matchScore}
                                        onPlay={handlePlayContent}
                                      />
                                    </CarouselItem>
                                  ))}
                                </CarouselContent>
                                <CarouselPrevious className="absolute left-0 top-1/2 -translate-y-1/2" />
                                <CarouselNext className="absolute right-0 top-1/2 -translate-y-1/2" />
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
                                  is_free={content.is_free}
                                  matchScore={content.matchScore}
                                  onPlay={handlePlayContent}
                                />
                              ))}
                            </div>
                          )}
                          {messageContents.get(message.id) && messageContents.get(message.id)!.length > 1 && (
                            <div className="flex gap-2 justify-start pt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const contentIds = messageContents.get(message.id)?.map(c => c.id) || [];
                                  handleCreatePlaylist(contentIds);
                                }}
                                className="gap-2 shadow-sm hover:shadow-md transition-all hover:border-primary/50"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                                Salvar Playlist ({messageContents.get(message.id)!.length} conteúdos)
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
                {sending && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-4 py-3">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="border-t border-border bg-card px-6 py-4 flex-shrink-0">
              <div className="max-w-4xl mx-auto">
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
                    placeholder="Digite sua mensagem..."
                    disabled={sending}
                    className="flex-1"
                  />
                  <Button type="submit" disabled={sending || !input.trim()}>
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

      {/* Tabs Section - Only visible when content is active */}
      {activeContent && (
        <div className="border-t border-border bg-card flex-shrink-0">
          <Tabs defaultValue="transcription" className="w-full">
            <div className="border-b border-border px-6">
              <TabsList className="bg-transparent">
                <TabsTrigger value="transcription">Transcrição</TabsTrigger>
                <TabsTrigger value="quiz">Quiz</TabsTrigger>
                <TabsTrigger value="notes">Anotações</TabsTrigger>
                <TabsTrigger value="comments">Comentários</TabsTrigger>
                <TabsTrigger value="recommendations">Recomendações</TabsTrigger>
              </TabsList>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <TabsContent value="transcription" className="px-6 py-4">
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
                    <p className="text-sm">Gerando transcrição... Isso pode levar alguns minutos.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Search box */}
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
                    
                    {/* Transcription text */}
                    <div className="prose prose-sm max-w-none text-foreground">
                      <div 
                        dangerouslySetInnerHTML={{ 
                          __html: highlightSearchResults(transcription, searchQuery) 
                        }}
                      />
                    </div>
                  </div>
                )}
              </TabsContent>
              <TabsContent value="quiz" className="px-6 py-4">
                <StudyQuiz 
                  studyId={id!}
                  contentId={activeContent.id}
                  contentTitle={activeContent.title}
                />
              </TabsContent>
              <TabsContent value="notes" className="px-6 py-4">
                <StudyNotes
                  studyId={id!}
                  activeContentId={activeContent?.id || null}
                  onSeekToTimestamp={handleSeekToTimestamp}
                  key={notesRefresh}
                />
              </TabsContent>
              <TabsContent value="comments" className="px-6 py-4">
                {/* Usar o componente ContentComments existente */}
                <div className="text-muted-foreground text-sm">
                  <p>Comentários disponíveis em breve...</p>
                </div>
              </TabsContent>
              <TabsContent value="recommendations" className="px-6 py-4">
                <div className="text-muted-foreground text-sm">
                  <p>Recomendações personalizadas baseadas no seu progresso...</p>
                  <p className="mt-2">
                    A IA Classy analisará seu aprendizado e sugerirá próximos conteúdos.
                  </p>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}

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
              Todas as mensagens e conversas serão permanentemente removidas.
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
    </div>
  );
}
