import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { FeaturedBadge } from "@/components/FeaturedBadge";
import { History, AlertCircle, Search, Trash2, MoreVertical, Bookmark, Share2, Clock, X, Play, Music, Video, Zap, Filter } from "lucide-react";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "sonner";
import { format, isToday, isYesterday, isThisWeek, isThisMonth, parseISO } from "date-fns";

// ... keep existing code
import { ptBR } from "date-fns/locale";

interface HistoryItem {
  id: string;
  content_id: string | null;
  course_id: string | null;
  last_viewed_at: string;
  isCourse: boolean;
  content: {
    id: string;
    title: string;
    description: string | null;
    thumbnail_url: string | null;
    content_type: string;
    views_count: number | null;
    duration_seconds: number | null;
    price: number | null;
    discount: number | null;
    is_free: boolean;
    required_plan: string | null;
    profiles: {
      id: string;
      display_name: string;
      avatar_url: string | null;
      creator_channel_name: string | null;
    } | null;
  };
}

type ContentTypeFilter = "all" | "aula" | "curso" | "podcast" | "short" | "live";

const contentTypeConfig: Record<ContentTypeFilter, { label: string; icon: typeof Video }> = {
  all: { label: "Tudo", icon: Filter },
  aula: { label: "Aulas", icon: Video },
  curso: { label: "Cursos", icon: Play },
  podcast: { label: "Podcasts", icon: Music },
  short: { label: "Shorts", icon: Zap },
  live: { label: "Lives", icon: Video },
};

export default function Historico() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredUpgradePlan, setRequiredUpgradePlan] = useState<"pro" | "premium">("pro");
  const [selectedContent, setSelectedContent] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<ContentTypeFilter>("all");
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [itemToRemove, setItemToRemove] = useState<string | null>(null);

  const currentPlan = profile?.plan || "free";

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    loadHistory();
  }, [user, navigate]);

  const loadHistory = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      // Fetch content views
      const { data: contentViewData, error: contentViewError } = await supabase
        .from("content_views")
        .select(`
          id,
          content_id,
          course_id,
          last_viewed_at,
          contents (
            id,
            title,
            description,
            thumbnail_url,
            content_type,
            views_count,
            duration_seconds,
            price,
            discount,
            is_free,
            required_plan,
            profiles:creator_id (
              id,
              display_name,
              avatar_url,
              creator_channel_name
            )
          ),
          courses (
            id,
            title,
            description,
            thumbnail_url,
            views_count,
            total_duration_seconds,
            price,
            discount,
            visibility,
            profiles:creator_id (
              id,
              display_name,
              avatar_url,
              creator_channel_name
            )
          )
        `)
        .eq("user_id", user.id)
        .order("last_viewed_at", { ascending: false })
        .limit(100);

      if (contentViewError) throw contentViewError;

      // Process and combine items
      const uniqueItems = new Map<string, HistoryItem>();
      
      (contentViewData || []).forEach((view: any) => {
        // Handle content views
        if (view.contents && view.content_id && !uniqueItems.has(`content-${view.content_id}`)) {
          uniqueItems.set(`content-${view.content_id}`, {
            id: view.id,
            content_id: view.content_id,
            course_id: null,
            last_viewed_at: view.last_viewed_at,
            isCourse: false,
            content: view.contents,
          });
        }
        
        // Handle course views
        if (view.courses && view.course_id && !uniqueItems.has(`course-${view.course_id}`)) {
          uniqueItems.set(`course-${view.course_id}`, {
            id: view.id,
            content_id: null,
            course_id: view.course_id,
            last_viewed_at: view.last_viewed_at,
            isCourse: true,
            content: {
              id: view.courses.id,
              title: view.courses.title,
              description: view.courses.description,
              thumbnail_url: view.courses.thumbnail_url,
              content_type: "curso",
              views_count: view.courses.views_count,
              duration_seconds: view.courses.total_duration_seconds,
              price: view.courses.price,
              discount: view.courses.discount,
              is_free: view.courses.visibility === "free",
              required_plan: view.courses.visibility,
              profiles: view.courses.profiles,
            },
          });
        }
      });

      // Sort by last_viewed_at
      const sortedItems = Array.from(uniqueItems.values()).sort(
        (a, b) => new Date(b.last_viewed_at).getTime() - new Date(a.last_viewed_at).getTime()
      );

      setHistoryItems(sortedItems);
    } catch (error) {
      console.error("Error loading history:", error);
      toast.error("Erro ao carregar histórico");
    } finally {
      setIsLoading(false);
    }
  };

  const removeFromHistory = async (viewId: string) => {
    try {
      const { error } = await supabase
        .from("content_views")
        .delete()
        .eq("id", viewId);

      if (error) throw error;

      setHistoryItems(prev => prev.filter(item => item.id !== viewId));
      toast.success("Removido do histórico");
    } catch (error) {
      console.error("Error removing from history:", error);
      toast.error("Erro ao remover do histórico");
    }
    setItemToRemove(null);
  };

  const clearAllHistory = async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from("content_views")
        .delete()
        .eq("user_id", user.id);

      if (error) throw error;

      setHistoryItems([]);
      toast.success("Histórico limpo com sucesso");
    } catch (error) {
      console.error("Error clearing history:", error);
      toast.error("Erro ao limpar histórico");
    }
    setShowClearDialog(false);
  };

  const saveContent = async (item: HistoryItem) => {
    if (!user) return;

    try {
      const insertData: any = { user_id: user.id };
      if (item.isCourse) {
        insertData.course_id = item.course_id;
      } else {
        insertData.content_id = item.content_id;
      }

      const { error } = await supabase
        .from("saved_contents")
        .upsert(insertData);

      if (error) throw error;
      toast.success("Salvo para assistir mais tarde");
    } catch (error) {
      console.error("Error saving content:", error);
      toast.error("Erro ao salvar conteúdo");
    }
  };

  const handleContentClick = (item: HistoryItem) => {
    navigate(`/watch/${item.content.id}`, isMobile ? { state: { backgroundLocation: location } } : undefined);
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatViews = (views: number | null) => {
    if (!views) return "0 visualizações";
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)} mi de visualizações`;
    if (views >= 1000) return `${(views / 1000).toFixed(1)} mil visualizações`;
    return `${views} visualizações`;
  };

  const getDateGroup = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return "Hoje";
    if (isYesterday(date)) return "Ontem";
    if (isThisWeek(date)) return "Esta semana";
    if (isThisMonth(date)) return "Este mês";
    return format(date, "MMMM yyyy", { locale: ptBR });
  };

  // Filter and group items
  const filteredItems = historyItems.filter(item => {
    const matchesSearch = searchQuery === "" || 
      item.content.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.content.profiles?.display_name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesType = typeFilter === "all" || item.content.content_type === typeFilter;
    
    return matchesSearch && matchesType;
  });

  const groupedItems = filteredItems.reduce((acc, item) => {
    const group = getDateGroup(item.last_viewed_at);
    if (!acc[group]) acc[group] = [];
    acc[group].push(item);
    return acc;
  }, {} as Record<string, HistoryItem[]>);

  const groupOrder = ["Hoje", "Ontem", "Esta semana", "Este mês"];

  const sortedGroups = Object.keys(groupedItems).sort((a, b) => {
    const aIndex = groupOrder.indexOf(a);
    const bIndex = groupOrder.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return 0;
  });

  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case "short": return <Zap className="w-3 h-3" />;
      case "podcast": return <Music className="w-3 h-3" />;
      case "curso": return <Play className="w-3 h-3" />;
      case "live": return <Video className="w-3 h-3" />;
      default: return null;
    }
  };

  return (
    <AdminLayout title="Histórico">
      <div className="flex gap-6 max-w-7xl mx-auto px-4 py-8">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <History className="w-8 h-8 text-primary" />
              <h1 className="text-3xl font-bold text-foreground">Histórico de exibição</h1>
            </div>
          </div>

          {/* Type Filters */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {(Object.keys(contentTypeConfig) as ContentTypeFilter[]).map((type) => {
              const config = contentTypeConfig[type];
              const Icon = config.icon;
              return (
                <Button
                  key={type}
                  variant={typeFilter === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTypeFilter(type)}
                  className="rounded-full"
                >
                  <Icon className="w-4 h-4 mr-1" />
                  {config.label}
                </Button>
              );
            })}
          </div>

          {isLoading && (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4 animate-pulse">
                  <div className="w-40 h-24 bg-muted rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                    <div className="h-3 bg-muted rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && filteredItems.length === 0 && (
            <div className="text-center py-20">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">
                    {searchQuery ? "Nenhum resultado encontrado" : "Nenhum conteúdo no histórico"}
                  </h3>
                  <p className="text-muted-foreground">
                    {searchQuery 
                      ? "Tente buscar por outro termo" 
                      : "Os vídeos que você assistir aparecerão aqui"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {!isLoading && sortedGroups.map((group) => (
            <div key={group} className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-4">{group}</h2>
              <div className="space-y-4">
                {groupedItems[group].map((item) => (
                  <div
                    key={item.id}
                    className="flex gap-3 group hover:bg-muted/50 p-2 -mx-2 rounded-lg transition-colors overflow-hidden"
                  >
                    {/* Thumbnail */}
                    <div 
                      className="relative w-32 sm:w-40 aspect-video flex-shrink-0 cursor-pointer"
                      onClick={() => handleContentClick(item)}
                    >
                      <img
                        src={item.content.thumbnail_url || "/placeholder.svg"}
                        alt={item.content.title}
                        className="w-full h-full object-cover rounded-lg"
                      />
                      {item.content.duration_seconds && (
                        <span className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                          {formatDuration(item.content.duration_seconds)}
                        </span>
                      )}
                      {item.content.content_type === "short" && (
                        <Badge className="absolute bottom-1 left-1 bg-red-500 text-white text-xs">
                          <Zap className="w-3 h-3 mr-1" />
                          SHORT
                        </Badge>
                      )}
                      {item.content.content_type === "curso" && (
                        <Badge className="absolute bottom-1 left-1 bg-primary text-primary-foreground text-xs">
                          CURSO
                        </Badge>
                      )}
                      {item.content.content_type === "live" && (
                        <Badge className="absolute bottom-1 left-1 bg-red-600 text-white text-xs">
                          LIVE
                        </Badge>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                        <Play className="w-10 h-10 text-white" fill="white" />
                      </div>
                    </div>

                    {/* Content Info */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex items-start justify-between gap-2">
                        <div 
                          className="cursor-pointer flex-1 min-w-0"
                          onClick={() => handleContentClick(item)}
                        >
                          <h3 className="text-sm font-medium text-foreground line-clamp-2 hover:text-primary transition-colors break-words">
                            {item.content.title}
                          </h3>
                          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground flex-wrap">
                            <span className="hover:text-foreground cursor-pointer truncate max-w-[120px] sm:max-w-none flex items-center gap-1">
                              {item.content.profiles?.creator_channel_name || item.content.profiles?.display_name}
                              <FeaturedBadge creatorId={item.content.profiles?.id} size="xs" />
                            </span>
                            <span>•</span>
                            <span className="whitespace-nowrap">{formatViews(item.content.views_count)}</span>
                            {getContentTypeIcon(item.content.content_type)}
                          </div>
                          {item.content.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                              {item.content.description}
                            </p>
                          )}
                        </div>

                        {/* Actions Menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <MoreVertical className="w-5 h-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => saveContent(item)}>
                              <Clock className="w-4 h-4 mr-2" />
                              Salvar em "Assistir mais tarde"
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => saveContent(item)}>
                              <Bookmark className="w-4 h-4 mr-2" />
                              Salvar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/watch/${item.content.id}`);
                              toast.success("Link copiado!");
                            }}>
                              <Share2 className="w-4 h-4 mr-2" />
                              Compartilhar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => setItemToRemove(item.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Remover do histórico
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar */}
        <div className="w-72 flex-shrink-0 hidden lg:block">
          <div className="sticky top-24 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Pesquisar no histórico..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-1">
              <Button
                variant="ghost"
                className="w-full justify-start text-muted-foreground hover:text-foreground"
                onClick={() => setShowClearDialog(true)}
                disabled={historyItems.length === 0}
              >
                <Trash2 className="w-4 h-4 mr-3" />
                Limpar todo o histórico
              </Button>
            </div>

            {/* Stats */}
            {historyItems.length > 0 && (
              <div className="pt-4 border-t border-border">
                <p className="text-sm text-muted-foreground">
                  {historyItems.length} {historyItems.length === 1 ? "item" : "itens"} no histórico
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Clear All Dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar histórico de exibição?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso removerá todo o seu histórico de exibição. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={clearAllHistory} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Limpar histórico
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove Item Dialog */}
      <AlertDialog open={!!itemToRemove} onOpenChange={() => setItemToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover do histórico?</AlertDialogTitle>
            <AlertDialogDescription>
              Este vídeo será removido do seu histórico de exibição.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => itemToRemove && removeFromHistory(itemToRemove)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        requiredPlan={requiredUpgradePlan}
      />
      {selectedContent && (
        <PurchaseModal
          open={showPurchaseModal}
          onOpenChange={setShowPurchaseModal}
          content={{
            id: selectedContent.id,
            title: selectedContent.title,
            thumbnail_url: selectedContent.thumbnail_url,
            price: selectedContent.price,
            discount: selectedContent.discount || 0,
            creator_name:
              selectedContent.profiles?.display_name ||
              selectedContent.creator?.display_name ||
              "Creator",
          }}
          onPurchaseComplete={() => {
            setShowPurchaseModal(false);
            setSelectedContent(null);
          }}
        />
      )}
    </AdminLayout>
  );
}
