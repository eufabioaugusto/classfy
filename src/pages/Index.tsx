import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ContentCard } from "@/components/ContentCard";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Search, TrendingUp, Clock, Star, Menu, User, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Index() {
  const { user, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [contents, setContents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchContents();
    }
  }, [user]);

  const fetchContents = async () => {
    try {
      const { data, error } = await supabase
        .from("contents")
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .not("published_at", "is", null)
        .order("created_at", { ascending: false })
        .limit(12);

      if (error) throw error;
      setContents(data || []);
    } catch (error: any) {
      toast({
        title: "Erro ao carregar conteúdos",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      toast({
        title: "Classy está pensando...",
        description: "A IA está processando sua pergunta.",
      });
      // Future: Integrate with Lovable AI
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin">
          <Sparkles className="w-12 h-12 text-accent" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-8 h-8 text-accent" />
            <h1 className="text-2xl font-bold">CLASSFY</h1>
          </div>

          <nav className="hidden md:flex items-center gap-6">
            <Button variant="ghost" onClick={() => navigate("/")}>
              Início
            </Button>
            <Button variant="ghost" onClick={() => navigate("/historico")}>
              Histórico
            </Button>
            <Button variant="ghost" onClick={() => navigate("/favoritos")}>
              Favoritos
            </Button>
            <Button variant="ghost" onClick={() => navigate("/salvos")}>
              Salvos
            </Button>
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate("/conta")}>
                <User className="w-4 h-4 mr-2" />
                Minha Conta
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/studio")}>
                <Star className="w-4 h-4 mr-2" />
                Studio Creator
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Hero Section - Classy AI */}
      <section className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent border border-accent/20">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">Powered by Classy AI</span>
            </div>
            
            <h2 className="text-5xl md:text-6xl font-bold tracking-tight">
              O que você quer
              <br />
              <span className="text-accent">aprender hoje?</span>
            </h2>
            
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Converse com Classy, a IA que entende seu momento e recomenda o melhor caminho para sua evolução.
            </p>
          </div>

          {/* Search/Chat Box */}
          <form onSubmit={handleSearch} className="relative">
            <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50">
              <div className="flex gap-4">
                <Input
                  type="text"
                  placeholder='Ex: "Quero aprender sobre propósito de vida"'
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="flex-1 text-lg h-14 bg-background"
                />
                <Button type="submit" size="lg" className="h-14 px-8">
                  <Search className="w-5 h-5 mr-2" />
                  Buscar
                </Button>
              </div>
            </Card>
          </form>
        </div>
      </section>

      {/* Content Feed */}
      <section className="container mx-auto px-4 py-12 space-y-12">
        {/* Trending */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-6 h-6 text-accent" />
            <h3 className="text-2xl font-bold">Em Alta</h3>
          </div>
          
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <Card key={i} className="h-96 animate-pulse bg-muted" />
              ))}
            </div>
          ) : contents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {contents.map((content) => (
                <ContentCard
                  key={content.id}
                  id={content.id}
                  title={content.title}
                  description={content.description}
                  thumbnail={content.thumbnail_url || "https://images.unsplash.com/photo-1501504905252-473c47e087f8?w=800"}
                  creatorName={content.profiles?.display_name || "Creator"}
                  creatorAvatar={content.profiles?.avatar_url}
                  duration={content.duration_minutes}
                  lessonCount={content.lesson_count}
                  isFree={content.is_free}
                  price={content.price}
                  requiredPlan={content.required_plan}
                  views={content.views_count}
                  contentType={content.content_type}
                />
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">
                Nenhum conteúdo disponível ainda. Seja o primeiro a criar!
              </p>
            </Card>
          )}
        </div>

        {/* Recent */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-accent" />
            <h3 className="text-2xl font-bold">Recentes</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {contents.slice(0, 4).map((content) => (
              <ContentCard
                key={content.id}
                id={content.id}
                title={content.title}
                description={content.description}
                thumbnail={content.thumbnail_url || "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800"}
                creatorName={content.profiles?.display_name || "Creator"}
                creatorAvatar={content.profiles?.avatar_url}
                duration={content.duration_minutes}
                lessonCount={content.lesson_count}
                isFree={content.is_free}
                price={content.price}
                requiredPlan={content.required_plan}
                views={content.views_count}
                contentType={content.content_type}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}