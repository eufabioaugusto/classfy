import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery } from "@tanstack/react-query";
import { ContentCard } from "@/components/ContentCard";
import { ConversionModal } from "@/components/ConversionModal";
import { SearchBar } from "@/components/SearchBar";
import { ContinueStudyCard } from "@/components/ContinueStudyCard";
import { ContinueWatching } from "@/components/ContinueWatching";
import { ContentSection } from "@/components/ContentSection";
import { FeaturedCreators } from "@/components/FeaturedCreators";
import { ModeBridgeCard } from "@/components/ModeBridgeCard";
import { AlertCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudies } from "@/hooks/useStudies";
import { GlobalLoader } from "@/components/GlobalLoader";
import { supabase } from "@/integrations/supabase/client";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";
import { CreatorApprovedBanner } from "@/components/CreatorApprovedBanner";
import { ContentCardSkeleton } from "@/components/ContentCardSkeleton";
import { boostContentList, getTopInterests, trackUserInteraction } from "@/lib/personalization/interests";
import { AppShell } from "@/components/layout";
import { HomeHero, PremiumCollection, type HomeHeroContent } from "@/components/home";
import { HomeLiveSection } from "@/components/home/HomeLiveSection";
import { isConfiguredHomeHero } from "@/config/home";
import type { Database } from "@/integrations/supabase/types";
import "@/styles/home-v2.css";

type ContentRow = Database["public"]["Tables"]["contents"]["Row"];
type CourseRow = Database["public"]["Tables"]["courses"]["Row"];
type CatalogProfile = { display_name: string | null; avatar_url: string | null };
type CatalogContent = ContentRow & { profiles?: CatalogProfile | null };
type CatalogCourse = CourseRow & {
  content_type?: "curso";
  duration_seconds?: number | null;
  lesson_count?: number | null;
  profiles?: CatalogProfile | null;
};
type HomeCatalog = { contents: CatalogContent[]; courses: CatalogCourse[] };

async function loadHomeCatalog(authenticated: boolean): Promise<HomeCatalog> {
  if (!authenticated) {
    const { data, error } = await supabase.rpc("get_public_home_catalog");
    if (error) throw error;

    const catalog = data as unknown as Partial<HomeCatalog> | null;
    return {
      contents: Array.isArray(catalog?.contents) ? catalog.contents : [],
      courses: Array.isArray(catalog?.courses) ? catalog.courses : [],
    };
  }

  const [contentsResult, coursesResult] = await Promise.all([
    supabase
      .from("contents")
      .select(`*, profiles:creator_id (display_name, avatar_url)`)
      .eq("status", "approved")
      .order("created_at", { ascending: false }),
    supabase
      .from("courses")
      .select(`*, profiles:creator_id (display_name, avatar_url)`)
      .eq("status", "approved")
      .order("created_at", { ascending: false }),
  ]);

  if (contentsResult.error) throw contentsResult.error;
  if (coursesResult.error) throw coursesResult.error;

  return {
    contents: (contentsResult.data || []) as CatalogContent[],
    courses: (coursesResult.data || []) as CatalogCourse[],
  };
}

export default function Index() {
  const { user, loading: authLoading, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeCount, limits, canCreateMore } = useStudies();

  // Mode from URL param, defaulting to explore for the homepage entry
  const modeFromUrl = searchParams.get("mode");
  const [isExploreMode, setIsExploreMode] = useState(true);

  const setMode = (isExplore: boolean) => {
    setIsExploreMode(isExplore);
    localStorage.setItem("exploreMode", JSON.stringify(isExplore));
    setSearchParams({ mode: isExplore ? "explore" : "focus" }, { replace: true });
  };

  // URL is the source of truth. Only set a default when the param is missing.
  // Handle navigation state from other pages
  useEffect(() => {
    const state = location.state as { exploreMode?: boolean } | null;
    if (state?.exploreMode !== undefined) {
      const targetMode = state.exploreMode;
      setIsExploreMode(targetMode);
      localStorage.setItem("exploreMode", JSON.stringify(targetMode));
      setSearchParams({ mode: targetMode ? "explore" : "focus" }, { replace: true });
      // Clear the state after processing
      window.history.replaceState({}, document.title);
    }
  }, [location.state, setSearchParams]);

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

    setIsExploreMode(true);
    localStorage.setItem("exploreMode", "true");
    setSearchParams({ mode: "explore" }, { replace: true });
  }, [modeFromUrl, setSearchParams]);

  // Search state
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Explore mode data with React Query for caching
  const { data: exploreData, isLoading: exploreLoading } = useQuery({
    queryKey: ["explore-data", user?.id],
    queryFn: async () => {
      const [
        featuredCreatorsResult,
        catalog,
      ] = await Promise.all([
        // Featured creators fetch (must load first visually)
        supabase
          .from("featured_creators")
          .select(`*, profiles:creator_id (display_name, creator_channel_name)`)
          .eq("show_on_home", true)
          .order("order_index", { ascending: true }),
        loadHomeCatalog(Boolean(user)),
      ]);

      if (featuredCreatorsResult.error) throw featuredCreatorsResult.error;

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

      const topInterests = await getTopInterests(user?.id);
      const allContents = catalog.contents;
      const byViews = (items: typeof allContents) => [...items].sort(
        (a, b) => (b.views_count || 0) - (a.views_count || 0),
      );
      const trendingClassesData = byViews(allContents.filter((content) => content.content_type === "aula"));
      const proContentsData = allContents.filter((content) => content.visibility === "pro");
      const podcastsData = byViews(allContents.filter((content) => content.content_type === "podcast"));
      const shortsData = allContents.filter((content) => content.content_type === "short");
      const premiumContentsData = allContents.filter((content) => content.visibility === "premium");
      const paidContentsData = allContents.filter((content) => content.visibility === "paid");

      return {
        featuredCreators: creatorsWithDuration,
        trendingClasses: boostContentList(trendingClassesData, topInterests),
        proContents: boostContentList(proContentsData, topInterests),
        trendingPodcasts: boostContentList(podcastsData, topInterests),
        shorts: boostContentList(shortsData, topInterests),
        premiumContents: boostContentList(premiumContentsData, topInterests),
        paidContents: boostContentList(paidContentsData, topInterests),
        courses: boostContentList(catalog.courses, topInterests),
        personalizedContents: boostContentList(allContents, topInterests).slice(0, 8),
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
  const paidContents = exploreData?.paidContents || [];
  const courses = exploreData?.courses || [];
  const personalizedContents = exploreData?.personalizedContents || [];

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReason, setModalReason] = useState<"premium" | "rewards" | "save" | "progress">("premium");

  // Upgrade and Purchase modals
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredUpgradePlan, setRequiredUpgradePlan] = useState<"pro" | "premium">("pro");
  const [selectedContent, setSelectedContent] = useState<any>(null);

  const currentPlan = profile?.plan || "free";
  const limitText = limits.studies === Infinity ? "ilimitados" : `${activeCount}/${limits.studies}`;
  const heroCandidates = [
    ...personalizedContents,
    ...trendingClasses,
    ...premiumContents,
    ...proContents,
    ...courses,
  ].filter((content, index, candidates) => candidates.findIndex((candidate) => candidate.id === content.id) === index);
  const canAccessHero = (content: any) => {
    const visibility = content.visibility || "free";
    if (visibility === "free") return true;
    if (visibility === "pro") return currentPlan === "pro" || currentPlan === "premium";
    if (visibility === "premium") return currentPlan === "premium";
    return false;
  };
  const featuredHeroCreator = featuredCreators[0];
  const configuredContentHero = heroCandidates.find(isConfiguredHomeHero) || null;
  const fallbackContentHero = heroCandidates.find(
    (content) => content.thumbnail_url && canAccessHero(content),
  ) || null;
  const featuredContentHero = configuredContentHero || fallbackContentHero;
  const heroContent: HomeHeroContent | null = featuredContentHero
    ? (featuredContentHero as HomeHeroContent)
    : featuredHeroCreator
    ? {
        id: `creator-${featuredHeroCreator.id}`,
        title: featuredHeroCreator.description || featuredHeroCreator.creator_name,
        thumbnail_url: featuredHeroCreator.background_image_url,
        content_type: "Creator em destaque",
        visibility: "free",
        duration_minutes: null,
        profiles: { display_name: featuredHeroCreator.creator_name },
        identity_image_url: featuredHeroCreator.featured_image_url,
        context_label: "Seleção Classfy",
      }
    : null;
  const personalizedHomeContents = personalizedContents;
  const trendingHomeContents = trendingClasses;
  const premiumHomeContents = premiumContents;
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
    if (!user) {
      navigate("/auth", { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    if (user) {
      trackUserInteraction({
        userId: user.id,
        action: "click",
        title: content.title,
        tags: content.tags,
        categoryId: content.category_id,
      });
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
    <AppShell
      variant="home"
      showSearch={true}
      isExploreMode={isExploreMode}
      onModeChange={setMode}
      contentClassName={`cf2-home-main flex flex-1 flex-col items-center justify-start ${isExploreMode ? "cf2-home-main--explore" : "cf2-home-main--focus"}`}
    >

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
            {/* Modo Foco (Original) */}
            {!isExploreMode && (
              <>
                {/* Search Component - Always visible and centered */}
                <div className={`w-full max-w-5xl ${!hasSearched ? "mt-8 sm:mt-16 md:mt-32" : "mt-4 sm:mt-8"} transition-all duration-500`}>
                  {/* Title (only when no search) */}
                  {!hasSearched && (
                    <div className="mb-8 animate-fade-in space-y-6 sm:mb-16 sm:space-y-8">
                      <ModeBridgeCard
                        variant="focus-to-explore"
                        isLoggedIn={Boolean(user)}
                        plan={currentPlan as "free" | "pro" | "premium"}
                        onAction={() => setMode(true)}
                      />

                      <div className="text-center space-y-4 sm:space-y-6">
                      <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-foreground bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent px-2">
                        O que você quer aprender?
                      </h1>
                      <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto font-medium px-4">
                        Digite um tema e crie um estudo personalizado com a Classy
                      </p>
                      </div>
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
                          visualVariant="v2"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Modo Explorar (YouTube-style feed) */}
            {isExploreMode && (
              <div className="cf2-home-feed">
                {exploreLoading ? (
                  <div className="cf2-home-loading">
                    <div className="cf2-home-loading__hero animate-pulse" />
                    {/* Skeleton for Featured Creators */}
                    <div className="space-y-4">
                      <div className="h-6 w-48 bg-muted rounded animate-pulse" />
                      <div className="flex gap-4 overflow-hidden">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div key={i} className="aspect-[3/5] w-64 bg-muted rounded-xl animate-pulse flex-shrink-0" />
                        ))}
                      </div>
                    </div>
                    {/* Skeleton for Content Sections */}
                    {[1, 2, 3].map((section) => (
                      <div key={section} className="space-y-4">
                        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {[1, 2, 3, 4].map((i) => (
                            <ContentCardSkeleton key={i} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <HomeHero
                      content={heroContent}
                      onPlay={() => {
                        if (featuredContentHero) {
                          handleContentClick(featuredContentHero);
                          return;
                        }

                        if (featuredHeroCreator) {
                          navigate(
                            featuredHeroCreator.slug
                              ? `/creators/destaque/${featuredHeroCreator.slug}`
                              : featuredHeroCreator.link_url,
                          );
                          return;
                        }

                      }}
                      onOpenFocus={() => setMode(false)}
                      primaryLabel={featuredContentHero ? "Assistir agora" : "Conhecer creator"}
                    />

                    <HomeLiveSection authenticated={Boolean(user)} />

                    {/* Featured Creators Section */}
                    <FeaturedCreators creators={featuredCreators} />

                    {/* Creator Approved Banner - contextual status after the editorial opening */}
                    <CreatorApprovedBanner />

                    {/* Continue Watching Section */}
                    {user && <ContinueWatching userId={user.id} />}

                    {user && personalizedHomeContents.length > 0 && (
                      <ContentSection
                        title="Para você"
                        contents={personalizedHomeContents}
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    <div className="cf2-home-focus-entry">
                      <ModeBridgeCard
                        variant="explore-to-focus"
                        isLoggedIn={Boolean(user)}
                        plan={currentPlan as "free" | "pro" | "premium"}
                        onAction={() => setMode(false)}
                        className="cf2-home-mode-bridge"
                      />
                    </div>

                    {/* 1. Em Alta - 4 cards (Apenas Aulas) */}
                    {trendingHomeContents.length > 0 && (
                      <ContentSection
                        title="Em Alta"
                        contents={trendingHomeContents}
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    <PremiumCollection
                      contents={premiumHomeContents}
                      userPlan={currentPlan as "free" | "pro" | "premium"}
                      onContentClick={handleContentClick}
                      onUpgradeClick={handleUpgradeClick}
                      onPurchaseClick={handlePurchaseClick}
                    />

                    {/* Podcasts em Alta - 6 itens (cards square) */}
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

                    {/* Shorts - 6 itens (cards verticais 9:16) */}
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

                    {/* Cursos - 4 cards */}
                    {courses.length > 0 && (
                      <ContentSection
                        title="Cursos para aprofundar"
                        contents={courses}
                        onContentClick={(course) => navigate(`/watch/${course.id}`)}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {paidContents.length > 0 && (
                      <ContentSection
                        title="Conteúdos exclusivos"
                        contents={paidContents}
                        onContentClick={handleContentClick}
                        userPlan={currentPlan}
                        onUpgradeClick={handleUpgradeClick}
                        onPurchaseClick={handlePurchaseClick}
                      />
                    )}

                    {/* PRO closes the feed as a subtle membership discovery moment. */}
                    {proContents.length > 0 && (
                      <ContentSection
                        title="Mais para membros PRO"
                        contents={proContents}
                        onContentClick={handleContentClick}
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
                      paidContents.length === 0 &&
                      courses.length === 0 && (
                        <div className="cf2-home-empty">
                          <BookOpen aria-hidden="true" />
                          <div>
                            <h3>Nenhum conteúdo disponível</h3>
                            <p>Conteúdos serão exibidos aqui quando disponíveis.</p>
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>
            )}
    </AppShell>
  );
}
