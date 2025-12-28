import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import { ContentCard } from "@/components/ContentCard";
import { ConversionModal } from "@/components/ConversionModal";
import { SearchBar } from "@/components/SearchBar";
import { ContinueStudyCard } from "@/components/ContinueStudyCard";
import { ContentSection } from "@/components/ContentSection";
import { FeaturedCreators } from "@/components/FeaturedCreators";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { Sparkles, AlertCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudies } from "@/hooks/useStudies";
import { GlobalLoader } from "@/components/GlobalLoader";
import { supabase } from "@/integrations/supabase/client";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";
import { CreatorApprovedBanner } from "@/components/CreatorApprovedBanner";

export default function Index() {
  const { user, loading: authLoading, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeCount, limit, canCreateMore } = useStudies();

  // Mode from URL param, defaulting to localStorage value or explore
  const modeFromUrl = searchParams.get("mode");
  const [isExploreMode, setIsExploreMode] = useState(true);

  const setMode = (isExplore: boolean) => {
    setIsExploreMode(isExplore);
    localStorage.setItem("exploreMode", JSON.stringify(isExplore));
    setSearchParams({ mode: isExplore ? "explore" : "focus" }, { replace: true });
  };

  // URL is the source of truth. Only set a default when the param is missing.
  useEffect(() => {
    if (modeFromUrl === "explore") {
      setIsExploreMode(true);
      localStorage.setItem("exploreMode", "true");
      return;
    }

    if (modeFromUrl === "focus") {
      setIsExploreMode(false);
      localStorage.setItem("exploreMode", "false");
      return;
    }

    const saved = localStorage.getItem("exploreMode");
    const defaultExplore = saved ? JSON.parse(saved) : true;
    setIsExploreMode(defaultExplore);
    setSearchParams({ mode: defaultExplore ? "explore" : "focus" }, { replace: true });
  }, [modeFromUrl, setSearchParams]);

  // Search state
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Explore mode data with React Query for caching
  const { data: exploreData, isLoading: exploreLoading } = useQuery({
    queryKey: ["explore-data"],
    queryFn: async () => {
      const [
        featuredCreatorsResult,
        trendingResult,
        proResult,
        podcastResult,
        shortsResult,
        premiumResult,
        coursesResult
      ] = await Promise.all([
        // Featured creators fetch (must load first visually)
        supabase
          .from("featured_creators")
          .select(`*, profiles:creator_id (display_name, creator_channel_name)`)
          .order("order_index", { ascending: true }),
        supabase
          .from("contents")
          .select(`*, profiles:creator_id (display_name, avatar_url)`)
          .eq("content_type", "aula")
          .eq("status", "approved")
          .order("views_count", { ascending: false })
          .limit(4),
        supabase
          .from("contents")
          .select(`*, profiles:creator_id (display_name, avatar_url)`)
          .eq("visibility", "pro")
          .eq("status", "approved")
          .in("content_type", ["aula"])
          .order("created_at", { ascending: false })
          .limit(4),
        supabase
          .from("contents")
          .select(`*, profiles:creator_id (display_name, avatar_url)`)
          .eq("content_type", "podcast")
          .eq("status", "approved")
          .order("views_count", { ascending: false })
          .limit(6),
        supabase
          .from("contents")
          .select(`*, profiles:creator_id (display_name, avatar_url)`)
          .eq("content_type", "short")
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("contents")
          .select(`*, profiles:creator_id (display_name, avatar_url)`)
          .eq("visibility", "premium")
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(4),
        supabase
          .from("courses")
          .select(`*, profiles:creator_id (display_name, avatar_url)`)
          .order("created_at", { ascending: false })
          .limit(4)
      ]);

      // Process featured creators with duration calculation
      const featuredCreatorsData = featuredCreatorsResult.data || [];
      const creatorsWithDuration = await Promise.all(
        featuredCreatorsData.map(async (creator: any) => {
          const { data: contents } = await supabase
            .from("contents")
            .select("duration_seconds")
            .eq("creator_id", creator.creator_id)
            .eq("status", "approved");

          const totalSeconds = contents?.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) || 0;
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);

          return {
            ...creator,
            creator_name: creator.profiles?.creator_channel_name || creator.profiles?.display_name || "Creator",
            total_duration: hours > 0 ? `${hours}h ${minutes}min` : `${minutes} minutos`,
          };
        })
      );

      return {
        featuredCreators: creatorsWithDuration,
        trendingClasses: trendingResult.data || [],
        proContents: proResult.data || [],
        trendingPodcasts: podcastResult.data || [],
        shorts: shortsResult.data || [],
        premiumContents: premiumResult.data || [],
        courses: coursesResult.data || []
      };
    },
    enabled: isExploreMode,
    staleTime: 5 * 60 * 1000, // 5 minutes - prevents refetch on remount
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  });

  const featuredCreators = exploreData?.featuredCreators || [];
  const trendingClasses = exploreData?.trendingClasses || [];
  const proContents = exploreData?.proContents || [];
  const trendingPodcasts = exploreData?.trendingPodcasts || [];
  const shorts = exploreData?.shorts || [];
  const premiumContents = exploreData?.premiumContents || [];
  const courses = exploreData?.courses || [];

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReason, setModalReason] = useState<"premium" | "rewards" | "save" | "progress">("premium");

  // Upgrade and Purchase modals
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredUpgradePlan, setRequiredUpgradePlan] = useState<"pro" | "premium">("pro");
  const [selectedContent, setSelectedContent] = useState<any>(null);

  const currentPlan = profile?.plan || "free";
  const limitText = limit === Infinity ? "ilimitados" : `${activeCount}/${limit}`;
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

  const handleContentClick = (content: any) => {
    // Check if user is logged in before allowing navigation
    if (!user) {
      // Redirect to auth page if not logged in
      navigate("/auth");
      return;
    }
    navigate(`/watch/${content.id}`, isMobile ? { state: { backgroundLocation: location } } : undefined);
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
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        {/* Sidebar */}
        <AppSidebar />

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          <Header 
            variant="home" 
            showSearch={true}
            isExploreMode={isExploreMode}
            onModeChange={setMode}
          />

          {/* Modals */}
          <ConversionModal open={modalOpen} onOpenChange={setModalOpen} reason={modalReason} />
          <UpgradeModal open={showUpgradeModal} onOpenChange={setShowUpgradeModal} requiredPlan={requiredUpgradePlan} />
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
                  selectedContent.profiles?.display_name || selectedContent.creator?.display_name || "Creator",
              }}
              onPurchaseComplete={() => {
                setShowPurchaseModal(false);
                setSelectedContent(null);
              }}
            />
          )}

          {/* Content Area */}
          <main className="flex-1 flex flex-col items-center justify-start p-3 sm:p-6 md:p-12 pb-24 md:pb-12">

            {/* Modo Foco (Original) */}
            {!isExploreMode && (
              <>
                {/* Search Component - Always visible and centered */}
                <div className={`w-full max-w-5xl ${!hasSearched ? "mt-8 sm:mt-16 md:mt-32" : "mt-4 sm:mt-8"} transition-all duration-500`}>
                  {/* Title (only when no search) */}
                  {!hasSearched && (
                    <div className="text-center mb-8 sm:mb-16 space-y-4 sm:space-y-6 animate-fade-in">
                      <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-cinematic-accent/10 border border-cinematic-accent/20 text-cinematic-accent text-xs sm:text-sm font-medium mb-2 sm:mb-4">
                        <Sparkles className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span>Powered by AI</span>
                      </div>
                      <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent px-2">
                        O que você quer aprender?
                      </h1>
                      <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto font-medium px-4">
                        Digite um tema e crie um estudo personalizado com a Classy
                      </p>
                    </div>
                  )}

                  {/* Search Bar */}
                  <SearchBar
                    onResults={handleSearchResults}
                    onLoading={handleSearchLoading}
                    onError={handleSearchError}
                    onLimitReached={() => {
                      setRequiredUpgradePlan(profile?.plan === "free" ? "pro" : "premium");
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
                  {isLoading && (
                    <div className="mt-6 text-center animate-fade-in">
                      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/30">
                        <div className="w-2 h-2 rounded-full bg-cinematic-accent animate-pulse" />
                        <p className="text-muted-foreground text-sm font-medium">
                          Classy está processando sua busca...
                        </p>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="mt-6 flex items-center justify-center gap-2 animate-fade-in">
                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
                        <AlertCircle className="w-4 h-4" />
                        <p className="text-sm font-medium">{error}</p>
                      </div>
                    </div>
                  )}

                  {/* Auth prompt for non-logged users */}
                  {hasSearched && !user && searchResults.length > 0 && (
                    <div className="mt-6 p-4 bg-cinematic-accent/10 border border-cinematic-accent/20 rounded-lg text-center">
                      <p className="text-foreground/80 text-sm mb-3">
                        Crie sua conta grátis para ganhar recompensas com suas ações.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => navigate("/auth")}
                        className="bg-cinematic-accent hover:bg-cinematic-accent/90 text-white"
                      >
                        Criar Conta Grátis
                      </Button>
                    </div>
                  )}
                </div>

                {/* Results Feed */}
                {hasSearched && searchResults.length > 0 && (
                  <div className="w-full max-w-5xl mt-6 sm:mt-12">
                    <div className="mb-4 sm:mb-6">
                      <h2 className="text-lg sm:text-2xl font-bold text-foreground">
                        {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""} encontrado
                        {searchResults.length !== 1 ? "s" : ""}
                      </h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      {searchResults.map((content) => (
                        <ContentCard
                          key={content.id}
                          content={content}
                          onClick={() => handleContentClick(content)}
                          userPlan={currentPlan}
                          onUpgradeClick={(plan) => handleUpgradeClick(plan, content)}
                          onPurchaseClick={() => handlePurchaseClick(content)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Modo Explorar (YouTube-style feed) */}
            {isExploreMode && (
              <div className="w-full max-w-7xl space-y-6 sm:space-y-12">
                {/* Creator Approved Banner - Always show first if applicable */}
                <CreatorApprovedBanner />

                {exploreLoading ? (
                  <div className="text-center py-20">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/30">
                      <div className="w-2 h-2 rounded-full bg-cinematic-accent animate-pulse" />
                      <p className="text-muted-foreground text-sm font-medium">Carregando conteúdos...</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Featured Creators Section */}
                    <FeaturedCreators creators={featuredCreators} />

                    {/* 1. Em Alta - 4 cards (Apenas Aulas) */}
                    {trendingClasses.length > 0 && (
                      <ContentSection
                        title="Em Alta"
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
                        title="Itens PRO"
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
                        title="Podcasts em Alta"
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
                        title="Shorts"
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
                        title="Itens Premium"
                        contents={premiumContents}
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {/* 6. Cursos - 4 cards */}
                    {courses.length > 0 && (
                      <ContentSection
                        title="Cursos"
                        contents={courses}
                        onContentClick={(course) => navigate(`/watch/${course.id}`)}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {/* Empty state se não houver nenhum conteúdo */}
                    {trendingClasses.length === 0 &&
                      proContents.length === 0 &&
                      trendingPodcasts.length === 0 &&
                      shorts.length === 0 &&
                      premiumContents.length === 0 &&
                      courses.length === 0 && (
                        <div className="text-center py-20">
                          <BookOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
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
    </SidebarProvider>
  );
}
