import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { ContentCard } from "@/components/ContentCard";
import { ConversionModal } from "@/components/ConversionModal";
import { SearchBar } from "@/components/SearchBar";
import { ContinueStudyCard } from "@/components/ContinueStudyCard";
import { ContentSection } from "@/components/ContentSection";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { Sparkles, AlertCircle, BookOpen, Compass, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useStudies } from "@/hooks/useStudies";
import { GlobalLoader } from "@/components/GlobalLoader";
import { supabase } from "@/integrations/supabase/client";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";

export default function Index() {
  const {
    user,
    loading: authLoading,
    profile
  } = useAuth();
  const navigate = useNavigate();
  const {
    activeCount,
    limit,
    canCreateMore
  } = useStudies();

  // Mode toggle state - persisted in localStorage
  const [isExploreMode, setIsExploreMode] = useState(() => {
    const saved = localStorage.getItem('exploreMode');
    return saved ? JSON.parse(saved) : false;
  });

  // Persist explore mode state
  useEffect(() => {
    localStorage.setItem('exploreMode', JSON.stringify(isExploreMode));
  }, [isExploreMode]);

  // Search state
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Explore mode state
  const [trendingClasses, setTrendingClasses] = useState<any[]>([]);
  const [proContents, setProContents] = useState<any[]>([]);
  const [trendingPodcasts, setTrendingPodcasts] = useState<any[]>([]);
  const [shorts, setShorts] = useState<any[]>([]);
  const [premiumContents, setPremiumContents] = useState<any[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReason, setModalReason] = useState<"premium" | "rewards" | "save" | "progress">("premium");
  
  // Upgrade and Purchase modals
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredUpgradePlan, setRequiredUpgradePlan] = useState<"pro" | "premium">("pro");
  const [selectedContent, setSelectedContent] = useState<any>(null);
  
  const currentPlan = profile?.plan || 'free';
  const limitText = limit === Infinity ? 'ilimitados' : `${activeCount}/${limit}`;
  const handleSearchResults = (results: any[]) => {
    setSearchResults(results);
    setHasSearched(true);
  };
  const handleSearchLoading = (loading: boolean) => {
    setIsLoading(loading);
    if (loading) {
      setError(null);
    }
  };
  const handleSearchError = (error: string | null) => {
    setError(error);
  };
  // Load explore mode data - works even when not logged in
  useEffect(() => {
    if (isExploreMode) {
      loadExploreData();
    }
  }, [isExploreMode]);

  const loadExploreData = async () => {
    setExploreLoading(true);
    try {
      // 1. Em Alta - 4 cards (Apenas Aulas) - Prioriza boosted primeiro
      const { data: trendingData } = await supabase
        .from('contents')
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .eq('content_type', 'aula')
        .order('views_count', { ascending: false })
        .limit(20); // Fetch more to ensure we get some

      // Sort by boost status, then views
      const sortedTrending = (trendingData || []).sort((a, b) => {
        const aHasBoost = a.id ? false : false; // Will check boost later
        const bHasBoost = b.id ? false : false;
        if (aHasBoost && !bHasBoost) return -1;
        if (!aHasBoost && bHasBoost) return 1;
        return (b.views_count || 0) - (a.views_count || 0);
      }).slice(0, 4);

      setTrendingClasses(sortedTrending);

      // 2. Itens PRO - 4 cards (Aulas, Cursos)
      const { data: proData } = await supabase
        .from('contents')
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .eq('visibility', 'pro')
        .in('content_type', ['aula'])
        .order('created_at', { ascending: false })
        .limit(20);

      const sortedPro = (proData || []).slice(0, 4);
      setProContents(sortedPro);

      // 3. Podcasts em Alta - 6 itens (cards square)
      const { data: podcastData } = await supabase
        .from('contents')
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .eq('content_type', 'podcast')
        .order('views_count', { ascending: false })
        .limit(6);

      setTrendingPodcasts(podcastData || []);

      // 4. Shorts - 6 itens (cards verticais 9:16)
      const { data: shortsData } = await supabase
        .from('contents')
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .eq('content_type', 'short')
        .order('created_at', { ascending: false })
        .limit(6);

      setShorts(shortsData || []);

      // 5. Itens Premium - 4 cards
      const { data: premiumData } = await supabase
        .from('contents')
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .eq('visibility', 'premium')
        .order('created_at', { ascending: false })
        .limit(4);

      setPremiumContents(premiumData || []);

    } catch (error) {
      console.error('Error loading explore data:', error);
    } finally {
      setExploreLoading(false);
    }
  };

  const handleContentClick = (content: any) => {
    // Check if user is logged in before allowing navigation
    if (!user) {
      // Redirect to auth page if not logged in
      navigate('/auth');
      return;
    }
    navigate(`/watch/${content.id}`);
  };
  
  const handleUpgradeClick = (plan: "pro" | "premium", content: any) => {
    setRequiredUpgradePlan(plan);
    setSelectedContent(content);
    setShowUpgradeModal(true);
  };
  
  const handlePurchaseClick = (content: any) => {
    setSelectedContent(content);
    setShowPurchaseModal(true);
  };
  if (authLoading) {
    return <GlobalLoader />;
  }
  return <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        {/* Sidebar */}
        <AppSidebar />

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          <Header variant="home" />

          {/* Modals */}
          <ConversionModal open={modalOpen} onOpenChange={setModalOpen} reason={modalReason} />
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
                creator_name: selectedContent.profiles?.display_name || selectedContent.creator?.display_name || "Creator"
              }}
              onPurchaseComplete={() => {
                setShowPurchaseModal(false);
                setSelectedContent(null);
              }}
            />
          )}

          {/* Content Area */}
          <main className="flex-1 flex flex-col items-center justify-start p-6 md:p-12">

            {/* Mode Toggle */}
            <div className="w-full max-w-5xl mb-8">
              <div className="flex items-center justify-center gap-4 p-4 bg-card rounded-xl border border-border">
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-muted-foreground" />
                  <Label htmlFor="mode-toggle" className="text-sm font-medium cursor-pointer">
                    Modo Foco
                  </Label>
                </div>
                <Switch
                  id="mode-toggle"
                  checked={isExploreMode}
                  onCheckedChange={setIsExploreMode}
                />
                <div className="flex items-center gap-2">
                  <Compass className="w-5 h-5 text-muted-foreground" />
                  <Label htmlFor="mode-toggle" className="text-sm font-medium cursor-pointer">
                    Modo Explorar
                  </Label>
                </div>
              </div>
            </div>

            {/* Modo Foco (Original) */}
            {!isExploreMode && (
              <>
                {/* Search Component - Always visible and centered */}
                <div className={`w-full max-w-5xl ${!hasSearched ? 'mt-32' : 'mt-8'} transition-all duration-500`}>
              {/* Title (only when no search) */}
              {!hasSearched && <div className="text-center mb-16 space-y-6 animate-fade-in">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cinematic-accent/10 border border-cinematic-accent/20 text-cinematic-accent text-sm font-medium mb-4">
                    <Sparkles className="w-4 h-4" />
                    <span>Powered by AI</span>
                  </div>
                  <h1 className="text-6xl font-bold text-foreground md:text-5xl bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
                    O que você quer aprender?
                  </h1>
                  <p className="text-xl text-muted-foreground max-w-2xl mx-auto font-medium">
                    Digite um tema e crie um estudo personalizado com a Classy
                  </p>
                </div>}

              {/* Search Bar */}
              <SearchBar 
                onResults={handleSearchResults} 
                onLoading={handleSearchLoading} 
                onError={handleSearchError}
                onLimitReached={() => {
                  setRequiredUpgradePlan(profile?.plan === 'free' ? 'pro' : 'premium');
                  setShowUpgradeModal(true);
                }}
              />

                  {/* Continue Study Card - Shows when user has active studies and no search */}
                  {user && !hasSearched && (
                    <div className="mt-8">
                      <ContinueStudyCard userId={user.id} />
                    </div>
                  )}

                  {/* Status Messages - Inline below search */}
                  {isLoading && <div className="mt-6 text-center animate-fade-in">
                      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/30">
                        <div className="w-2 h-2 rounded-full bg-cinematic-accent animate-pulse" />
                        <p className="text-muted-foreground text-sm font-medium">Classy está processando sua busca...</p>
                      </div>
                    </div>}

                  {error && <div className="mt-6 flex items-center justify-center gap-2 animate-fade-in">
                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
                        <AlertCircle className="w-4 h-4" />
                        <p className="text-sm font-medium">{error}</p>
                      </div>
                    </div>}

                  {/* Auth prompt for non-logged users */}
                  {hasSearched && !user && searchResults.length > 0 && <div className="mt-6 p-4 bg-cinematic-accent/10 border border-cinematic-accent/20 rounded-lg text-center">
                      <p className="text-foreground/80 text-sm mb-3">
                        Crie sua conta grátis para ganhar recompensas com suas ações.
                      </p>
                      <Button size="sm" onClick={() => navigate("/auth")} className="bg-cinematic-accent hover:bg-cinematic-accent/90 text-white">
                        Criar Conta Grátis
                      </Button>
                    </div>}
                </div>

                {/* Results Feed */}
                {hasSearched && searchResults.length > 0 && <div className="w-full max-w-5xl mt-12">
                    <div className="mb-6">
                      <h2 className="text-2xl font-bold text-foreground">
                        {searchResults.length} resultado{searchResults.length !== 1 ? 's' : ''} encontrado{searchResults.length !== 1 ? 's' : ''}
                      </h2>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      {searchResults.map(content => <ContentCard 
                        key={content.id} 
                        content={content} 
                        onClick={() => handleContentClick(content)}
                        userPlan={currentPlan}
                        onUpgradeClick={(plan) => handleUpgradeClick(plan, content)}
                        onPurchaseClick={() => handlePurchaseClick(content)}
                      />)}
                    </div>
                  </div>}
              </>
            )}

            {/* Modo Explorar (YouTube-style feed) */}
            {isExploreMode && (
              <div className="w-full max-w-7xl space-y-12">
                {exploreLoading ? (
                  <div className="text-center py-20">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/30">
                      <div className="w-2 h-2 rounded-full bg-cinematic-accent animate-pulse" />
                      <p className="text-muted-foreground text-sm font-medium">Carregando conteúdos...</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 1. Em Alta - 4 cards (Apenas Aulas) */}
                    {trendingClasses.length > 0 && (
                      <ContentSection
                        title="🔥 Em Alta"
                        contents={trendingClasses}
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {/* 2. Itens PRO - 4 cards */}
                    {proContents.length > 0 && (
                      <ContentSection
                        title="👑 Itens PRO"
                        contents={proContents}
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {/* 3. Podcasts em Alta - 6 itens (cards square) */}
                    {trendingPodcasts.length > 0 && (
                      <ContentSection
                        title="🎙️ Podcasts em Alta"
                        contents={trendingPodcasts}
                        aspectRatio="square"
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {/* 4. Shorts - 6 itens (cards verticais 9:16) */}
                    {shorts.length > 0 && (
                      <ContentSection
                        title="⚡ Shorts"
                        contents={shorts}
                        aspectRatio="vertical"
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {/* 5. Itens Premium - 4 cards */}
                    {premiumContents.length > 0 && (
                      <ContentSection
                        title="💎 Itens Premium"
                        contents={premiumContents}
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {/* Empty state se não houver nenhum conteúdo */}
                    {trendingClasses.length === 0 && proContents.length === 0 && trendingPodcasts.length === 0 && shorts.length === 0 && premiumContents.length === 0 && (
                      <div className="text-center py-20">
                        <Compass className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                        <h3 className="text-2xl font-bold text-foreground mb-2">Nenhum conteúdo disponível</h3>
                        <p className="text-muted-foreground">Conteúdos serão exibidos aqui quando disponíveis.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>;
}