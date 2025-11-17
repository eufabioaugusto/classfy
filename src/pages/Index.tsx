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

      {/* Header - MasterClass Style */}
      <header className="sticky top-0 z-50 border-b border-border/20 bg-cinematic-black/95 backdrop-blur-xl">
        <div className="container mx-auto px-6 py-5 flex items-center justify-between">
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

      {/* Hero Section - MasterClass Cinematic Style */}
      <section className="relative overflow-hidden bg-cinematic-black">
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-cinematic-black via-cinematic-darker to-cinematic-black" />
        
        <div className="container mx-auto px-6 py-24 md:py-32 lg:py-40 relative">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left side - Text content */}
              <div className="space-y-8 text-left">
                <div className="space-y-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 text-white border border-white/10 backdrop-blur-sm">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium uppercase tracking-wider">Powered by Classy AI</span>
                  </div>
                  
                  <h1 className="text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight text-white animate-fade-in leading-none">
                    {user ? (
                      <>
                        APRENDA COM
                        <br />
                        <span className="text-cinematic-accent">OS MELHORES</span>
                      </>
                    ) : (
                      <>
                        VOCÊ JÁ
                        <br />
                        APRENDE.
                        <br />
                        <span className="text-cinematic-accent">AGORA GANHE.</span>
                      </>
                    )}
                  </h1>
                  
                  <p className="text-lg md:text-xl text-white/70 max-w-xl leading-relaxed">
                    {user 
                      ? "Acesse aulas exclusivas com experts e evolua suas habilidades enquanto ganha recompensas."
                      : "Aprenda, evolua e ganhe com conhecimento. Uma plataforma que recompensa seu aprendizado."
                    }
                  </p>
                </div>

                {/* Search Box - Cinematic */}
                <form onSubmit={handleSearch} className="relative">
                  <div className="relative">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                    <Input
                      type="text"
                      placeholder={user ? 'O que você quer aprender hoje?' : 'Buscar aulas...'}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="h-14 pl-14 pr-6 bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:bg-white/15 focus:border-white/30 transition-all"
                    />
                  </div>
                </form>

                {!user && (
                  <div className="flex flex-col sm:flex-row gap-4">
                    <Button
                      size="lg"
                      onClick={() => navigate("/auth")}
                      className="bg-cinematic-accent hover:bg-cinematic-accent/90 text-white px-8 h-14 text-base font-semibold"
                    >
                      Começar Grátis
                    </Button>
                    <button
                      onClick={() => {
                        setModalReason("rewards");
                        setModalOpen(true);
                      }}
                      className="inline-flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm"
                    >
                      <TrendingUp className="w-4 h-4" />
                      <span>Como funciona a remuneração?</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Right side - Hero visual placeholder */}
              <div className="hidden lg:block relative">
                <div className="aspect-square rounded-2xl bg-gradient-to-br from-white/5 to-white/0 border border-white/10 backdrop-blur-sm" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories - MasterClass Style */}
      <section className="bg-cinematic-darker border-y border-white/5">
        <div className="container mx-auto px-6 py-6">
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
        </div>
      </section>

      {/* Content Feed - Cinematic Layout */}
      <section className="bg-cinematic-black py-16 md:py-24">
        <div className="container mx-auto px-6 space-y-20">
          {/* Popular Now - Featured */}
          <div className="space-y-8">
            <div className="flex items-baseline justify-between">
              <div>
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-2">Popular Agora</h2>
                <p className="text-white/60">Os conteúdos mais assistidos da semana</p>
              </div>
              <button className="text-white/70 hover:text-white transition-colors text-sm uppercase tracking-wider hidden md:block">
                Ver Todos
              </button>
            </div>
            <ContentSection
              title=""
              contents={trendingContents}
              loading={loading}
              onContentClick={handleContentClick}
            />
          </div>

          {/* Free to Start */}
          <div className="space-y-8">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-2">Comece Grátis</h2>
              <p className="text-white/60">Conteúdo gratuito para você iniciar sua jornada</p>
            </div>
            <ContentSection
              title=""
              contents={freeContents}
              loading={loading}
              onContentClick={handleContentClick}
            />
          </div>

          {/* Quick Learn - Shorts */}
          <div className="space-y-8">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-2">Aprenda Rápido</h2>
              <p className="text-white/60">Conteúdos curtos e diretos ao ponto</p>
            </div>
            <ContentSection
              title=""
              contents={shortsContents}
              loading={loading}
              horizontal
              onContentClick={handleContentClick}
            />
          </div>

          {/* CTA Section - MasterClass Style */}
          {!user && (
            <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-cinematic-accent/20 to-cinematic-accent/5 border border-cinematic-accent/20 p-12 md:p-16 text-center">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cinematic-accent/10 to-transparent" />
              <div className="relative space-y-6 max-w-3xl mx-auto">
                <h3 className="text-4xl md:text-5xl font-bold text-white">
                  Pronto para começar?
                </h3>
                <p className="text-xl text-white/70 max-w-2xl mx-auto leading-relaxed">
                  Crie sua conta gratuita e comece a ganhar recompensas por cada vídeo assistido, curso concluído e interação na plataforma.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
                  <Button 
                    size="lg" 
                    onClick={() => navigate("/auth")}
                    className="bg-cinematic-accent hover:bg-cinematic-accent/90 text-white px-10 h-14 text-base font-semibold"
                  >
                    Criar Conta Grátis
                  </Button>
                  <Button 
                    size="lg" 
                    variant="outline" 
                    onClick={() => navigate("/auth")}
                    className="border-white/20 text-white hover:bg-white/10 h-14 px-10"
                  >
                    Já tenho conta
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}