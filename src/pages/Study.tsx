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
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
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
  const [sending, setSending] = useState(false);
  const [initialMessageSent, setInitialMessageSent] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [activeContent, setActiveContent] = useState<any>(null);
  const [transcription, setTranscription] = useState<string>("");
  const [transcriptionLoading, setTranscriptionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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

  // Send initial message when chat is empty
  useEffect(() => {
    if (study && messages.length === 0 && !initialMessageSent && !loading && !sending) {
      setInitialMessageSent(true);
      sendInitialMessage();
    }
  }, [study, messages, initialMessageSent, loading, sending]);

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

    try {
      const { data, error } = await supabase
        .from("study_messages")
        .select("*")
        .eq("study_id", id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      setMessages((data || []) as StudyMessage[]);
    } catch (error) {
      console.error("Error fetching messages:", error);
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
          },
        }
      );

      if (aiError) throw aiError;

      // Save AI response
      const { data: aiMessageData, error: aiMessageError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "assistant",
          content: aiData.message,
        })
        .select()
        .single();

      if (aiMessageError) throw aiMessageError;

      // Store related contents if available
      if (aiData.relatedContents && aiData.relatedContents.length > 0 && aiMessageData) {
        setMessageContents(prev => {
          const newMap = new Map(prev);
          newMap.set(aiMessageData.id, aiData.relatedContents);
          return newMap;
        });
      }

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
      const { data: aiData, error: aiError } = await supabase.functions.invoke(
        "classy-chat",
        {
          body: {
            studyId: id,
            message: userMessage,
          },
        }
      );

      if (aiError) throw aiError;

      // Save AI response
      const { data: aiMessageData, error: aiMessageError } = await supabase
        .from("study_messages")
        .insert({
          study_id: id,
          role: "assistant",
          content: aiData.message,
        })
        .select()
        .single();

      if (aiMessageError) throw aiMessageError;

      // Store related contents if available
      if (aiData.relatedContents && aiData.relatedContents.length > 0 && aiMessageData) {
        setMessageContents(prev => {
          const newMap = new Map(prev);
          newMap.set(aiMessageData.id, aiData.relatedContents);
          return newMap;
        });
      }

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
      setTranscription("");
    }
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
                content={activeContent}
                onClose={() => {
                  setActiveContent(null);
                  setTranscription("");
                  setSearchQuery("");
                }}
                onTranscriptionUpdate={() => loadTranscription(activeContent.id)}
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
                        <div className="grid grid-cols-1 gap-4 max-w-[80%]">
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
                      <p>Nenhuma transcrição disponível para este conteúdo.</p>
                      <p className="mt-2">
                        Gere uma transcrição automática usando IA para poder buscar e navegar pelo conteúdo.
                      </p>
                    </div>
                    <Button onClick={generateTranscription} disabled={transcriptionLoading}>
                      Gerar Transcrição com IA
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
              <TabsContent value="notes" className="px-6 py-4">
                <div className="text-muted-foreground text-sm">
                  <p>Área de anotações em desenvolvimento...</p>
                  <p className="mt-2">
                    Em breve você poderá fazer anotações enquanto assiste.
                  </p>
                </div>
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
    </div>
  );
}
