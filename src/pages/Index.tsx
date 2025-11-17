import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ContentSection } from "@/components/ContentSection";
import { CategoryChip } from "@/components/CategoryChip";
import { ConversionModal } from "@/components/ConversionModal";
import { supabase } from "@/integrations/supabase/client";
import { 
  Sparkles, 
  Search, 
  TrendingUp, 
  Clock, 
  Star, 
  Menu, 
  User, 
  LogOut,
  Code,
  Megaphone,
  Languages,
  DollarSign,
  Palette,
  Cpu,
  Flame,
  Play
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

const categories = [
  { id: "programacao", label: "Programação", icon: <Code className="w-4 h-4" /> },
  { id: "marketing", label: "Marketing", icon: <Megaphone className="w-4 h-4" /> },
  { id: "idiomas", label: "Idiomas", icon: <Languages className="w-4 h-4" /> },
  { id: "negocios", label: "Dinheiro & Negócios", icon: <DollarSign className="w-4 h-4" /> },
  { id: "criatividade", label: "Criatividade", icon: <Palette className="w-4 h-4" /> },
  { id: "tecnologia", label: "Tecnologia", icon: <Cpu className="w-4 h-4" /> },
];

export default function Index() {
  const { user, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [freeContents, setFreeContents] = useState<any[]>([]);
  const [trendingContents, setTrendingContents] = useState<any[]>([]);
  const [shortsContents, setShortsContents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReason, setModalReason] = useState<"premium" | "rewards" | "save" | "progress">("premium");
  const { toast } = useToast();

  useEffect(() => {
    fetchContents();
  }, []);

  const fetchContents = async () => {
    try {
      // Fetch free contents
      const { data: freeData, error: freeError } = await supabase
        .from("contents")
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .not("published_at", "is", null)
        .eq("is_free", true)
        .order("created_at", { ascending: false })
        .limit(8);

      if (freeError) throw freeError;
      setFreeContents(freeData || []);

      // Fetch trending (most viewed)
      const { data: trendingData, error: trendingError } = await supabase
        .from("contents")
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .not("published_at", "is", null)
        .order("views_count", { ascending: false })
        .limit(8);

      if (trendingError) throw trendingError;
      setTrendingContents(trendingData || []);

      // Fetch shorts (duration < 5 minutes)
      const { data: shortsData, error: shortsError } = await supabase
        .from("contents")
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .not("published_at", "is", null)
        .lte("duration_minutes", 5)
        .eq("is_free", true)
        .order("views_count", { ascending: false })
        .limit(12);

      if (shortsError) throw shortsError;
      setShortsContents(shortsData || []);
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

  const handleContentClick = (content: any) => {
    // Check if user is logged in
    if (!user) {
      // Check if content requires premium access
      if (!content.is_free || content.required_plan) {
        setModalReason("premium");
        setModalOpen(true);
        return;
      }
      // Allow free content for non-logged users
      navigate(`/player/${content.id}`);
    } else {
      // Logged in users can navigate normally
      navigate(`/player/${content.id}`);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      if (!user) {
        setModalReason("rewards");
        setModalOpen(true);
      } else {
        toast({
          title: "Classy está pensando...",
          description: "A IA está processando sua pergunta.",
        });
        // Future: Integrate with Lovable AI
      }
    }
  };

  const handleCategoryClick = (categoryId: string) => {
    setSelectedCategory(categoryId === selectedCategory ? null : categoryId);
    if (!user) {
      toast({
        title: "Categorias disponíveis",
        description: "Crie sua conta para ver conteúdos personalizados por categoria.",
      });
    }
  };

  if (authLoading) {
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
      {/* Conversion Modal */}
      <ConversionModal open={modalOpen} onOpenChange={setModalOpen} reason={modalReason} />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
            <Sparkles className="w-8 h-8 text-accent" />
            <h1 className="text-2xl font-bold">CLASSFY</h1>
          </div>

          {user ? (
            <>
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
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => navigate("/auth")}>
                Entrar
              </Button>
              <Button onClick={() => navigate("/auth")}>
                Criar Conta
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section - Classy AI */}
      <section className="relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
        
        <div className="container mx-auto px-4 py-20 relative">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 text-accent border border-accent/20 backdrop-blur-sm">
                <Sparkles className="w-4 h-4 animate-pulse" />
                <span className="text-sm font-medium">Powered by Classy AI</span>
              </div>
              
              <h2 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight animate-fade-in">
                {user ? "O que você quer" : "Você já aprende."}
                <br />
                <span className="text-accent">
                  {user ? "aprender hoje?" : "Agora também ganha por isso."}
                </span>
              </h2>
              
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                {user 
                  ? "Converse com Classy, a IA que entende seu momento e recomenda o melhor caminho para sua evolução."
                  : "Aprenda, evolua e ganhe com conhecimento. Crie sua conta grátis e comece a ser recompensado por aprender."
                }
              </p>

              {!user && (
                <div 
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-badge-premium/10 text-cinematic-gold border border-cinematic-gold/20 cursor-pointer hover:bg-badge-premium/20 transition-colors"
                  onClick={() => {
                    setModalReason("rewards");
                    setModalOpen(true);
                  }}
                >
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm font-medium">Ganhe recompensas por aprender</span>
                </div>
              )}
            </div>

            {/* Search/Chat Box */}
            <form onSubmit={handleSearch} className="relative">
              <Card className="p-6 bg-card/50 backdrop-blur-sm border-border/50 hover:border-accent/50 transition-colors">
                <div className="flex gap-4">
                  <Input
                    type="text"
                    placeholder={user ? 'Ex: "Quero aprender sobre propósito de vida"' : 'O que você quer aprender hoje?'}
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

            {!user && (
              <Button
                size="lg"
                onClick={() => navigate("/auth")}
                className="animate-scale-in"
              >
                Criar Conta Grátis
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="container mx-auto px-4 py-8">
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {categories.map((category) => (
            <CategoryChip
              key={category.id}
              label={category.label}
              icon={category.icon}
              active={selectedCategory === category.id}
              onClick={() => handleCategoryClick(category.id)}
            />
          ))}
        </div>
      </section>

      {/* Content Feed */}
      <section className="container mx-auto px-4 py-12 space-y-16">
        {/* Comece por aqui - Free Content */}
        <ContentSection
          title="Comece por aqui"
          icon={<Play className="w-6 h-6 text-accent" />}
          contents={freeContents}
          loading={loading}
          onContentClick={handleContentClick}
        />

        {/* Tendências - Most Viewed */}
        <ContentSection
          title="Tendências do momento"
          icon={<Flame className="w-6 h-6 text-accent" />}
          contents={trendingContents}
          loading={loading}
          onContentClick={handleContentClick}
        />

        {/* Shorts - Horizontal scroll */}
        <ContentSection
          title="Shorts mais vistos"
          icon={<TrendingUp className="w-6 h-6 text-accent" />}
          contents={shortsContents}
          loading={loading}
          horizontal
          onContentClick={handleContentClick}
        />

        {/* CTA for logged out users */}
        {!user && (
          <Card className="p-12 text-center space-y-6 bg-gradient-to-br from-accent/10 to-accent/5 border-accent/20">
            <div className="space-y-2">
              <h3 className="text-3xl font-bold">Pronto para começar?</h3>
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                Crie sua conta gratuita e comece a ganhar recompensas por cada vídeo assistido, curso concluído e interação na plataforma.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={() => navigate("/auth")}>
                Criar Conta Grátis
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/auth")}>
                Já tenho conta
              </Button>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}