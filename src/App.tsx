import { OnboardingGate } from "@/components/onboarding/OnboardingGate";
import { captureReferral } from "@/lib/referrals/attribution";
import { AppNotifications } from "@/components/AppNotifications";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { MiniPlayerProvider, useMiniPlayer } from "./contexts/MiniPlayerContext";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState, Suspense, lazy, Fragment } from "react";
import { GlobalLoader } from "./components/GlobalLoader";
import { LiveLoadingScreen } from "./components/live/LiveLoadingScreen";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { RouteLoadBoundary } from "./components/RouteLoadBoundary";
import { MiniPlayer } from "./components/MiniPlayer";
import { useIsMobile } from "@/hooks/use-mobile";

// Lazy load all pages for maximum code splitting
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Index = lazy(() => import("./pages/Index"));
const Legal = lazy(() => import("./pages/Legal"));
const Auth = lazy(() => import("./pages/Auth"));
const Conta = lazy(() => import("./pages/Conta"));
const Historico = lazy(() => import("./pages/Historico"));
const Favoritos = lazy(() => import("./pages/Favoritos"));
const Salvos = lazy(() => import("./pages/Salvos"));
const Studio = lazy(() => import("./pages/Studio"));
const StudioUpload = lazy(() => import("./pages/StudioUpload"));
const StudioUploadCurso = lazy(() => import("./pages/StudioUploadCurso"));
const StudioContents = lazy(() => import("./pages/StudioContents"));
const AdminCreators = lazy(() => import("./pages/AdminCreators"));
const AdminContents = lazy(() => import("./pages/AdminContents"));
const AdminRewards = lazy(() => import("./pages/AdminRewards"));
const AdminMarketingMaterials = lazy(() => import("./pages/AdminMarketingMaterials"));
const AdminTranscriptions = lazy(() => import("./pages/AdminTranscriptions"));
const AdminFeaturedCreators = lazy(() => import("./pages/AdminFeaturedCreators"));
const AdminHomeHero = lazy(() => import("./pages/AdminHomeHero"));
const AdminWithdrawals = lazy(() => import("./pages/AdminWithdrawals"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminProspects = lazy(() => import("./pages/AdminProspects"));
const AdminWaitlist = lazy(() => import("./pages/AdminWaitlist"));
const AdminCuration = lazy(() => import("./pages/AdminCuration"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const RewardsHistory = lazy(() => import("./pages/RewardsHistory"));
const Recompensas = lazy(() => import("./pages/Recompensas"));
const Carteira = lazy(() => import("./pages/Carteira"));
const BoostSuccess = lazy(() => import("./pages/BoostSuccess"));
const StudioBoosts = lazy(() => import("./pages/StudioBoosts"));
const StudioAnalytics = lazy(() => import("./pages/StudioAnalytics"));
const StudioGoals = lazy(() => import("./pages/StudioGoals"));
const Study = lazy(() => import("./pages/Study"));
const NewStudy = lazy(() => import("./pages/NewStudy"));
const Messages = lazy(() => import("./pages/Messages"));
const Watch = lazy(() => import("./pages/Watch"));
const Listen = lazy(() => import("./pages/Listen"));
const Shorts = lazy(() => import("./pages/Shorts"));
const Planos = lazy(() => import("./pages/Planos"));
const FeaturedCreatorPage = lazy(() => import("./pages/FeaturedCreatorPage"));
const StudioLive = lazy(() => import("./pages/StudioLive"));
const LiveBroadcast = lazy(() => import("./pages/LiveBroadcast"));
const LiveWatch = lazy(() => import("./pages/LiveWatch"));

const CreatorProfile = lazy(() => import("./pages/CreatorProfile"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const MediaAudit = lazy(() => import("./pages/MediaAudit"));
const FrontV2Lab = lazy(() => import("./pages/FrontV2Lab"));


const queryClient = new QueryClient();

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { closeMiniPlayer } = useMiniPlayer();
  const backgroundLocation = isMobile ? (location.state as any)?.backgroundLocation : null;
  const isBroadcastRoute = /^\/live\/[^/]+\/broadcast\/?$/.test(location.pathname);
  const liveRouteId = /^\/live\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? null;
  const [liveSessionId, setLiveSessionId] = useState<string | null>(liveRouteId);
  const [liveReturnPath, setLiveReturnPath] = useState("/");
  const previousLocation = useRef(location);

  useEffect(() => {
    if (isBroadcastRoute || location.pathname === "/auth") {
      setLiveSessionId(null);
    }
    if (liveRouteId) {
      if (!/^\/live\/[^/]+\/?$/.test(previousLocation.current.pathname)) {
        const previous = previousLocation.current;
        setLiveReturnPath(previous.pathname === "/auth" ? "/" : `${previous.pathname}${previous.search}${previous.hash}`);
      }
      setLiveSessionId(liveRouteId);
    }
    previousLocation.current = location;
  }, [isBroadcastRoute, liveRouteId, location]);

  const activeLiveId = isBroadcastRoute || location.pathname === "/auth" ? null : liveRouteId ?? liveSessionId;
  useEffect(() => {
    if (activeLiveId) closeMiniPlayer();
  }, [activeLiveId, closeMiniPlayer]);
  const closeLive = () => {
    if (liveRouteId) navigate(liveReturnPath);
    setLiveSessionId(null);
  };
  const loadingLabels: Record<string, string> = {
    "/studio": "Carregando Studio",
    "/studio/goals": "Carregando metas",
    "/studio/analytics": "Carregando Analytics",
    "/studio/contents": "Carregando conteúdos",
    "/studio/boosts": "Carregando boosts",
  };
  const liveOpening = isBroadcastRoute
    ? <LiveLoadingScreen title="Abrindo sua live" dark />
    : location.pathname === "/studio/live"
      ? <LiveLoadingScreen title="Carregando suas lives" />
      : <GlobalLoader label={loadingLabels[location.pathname]} />;

  useEffect(() => {
    const referral = captureReferral(window.location.href);
    if (!referral) return;
    window.history.replaceState(window.history.state, '', referral.cleanPath);
    if (referral.code) {
      void supabase.functions.invoke('track-referral-click', {
        body: { referral_code: referral.code },
      }).then(({ error }) => { if (error) console.warn('Não foi possível registrar o clique de indicação.'); });
    }
  }, [location.search]);

  const mainRoutes = (
    <>
      <Route path="/" element={<Index />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/privacidade" element={<Legal kind="privacy" />} />
      <Route path="/termos" element={<Legal kind="terms" />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/conta" element={<Conta />} />
      <Route path="/historico" element={<Historico />} />
      <Route path="/favoritos" element={<Favoritos />} />
      <Route path="/salvos" element={<Salvos />} />
      <Route path="/studio" element={<Studio />} />
      <Route path="/studio/upload" element={<StudioUpload />} />
      <Route path="/studio/upload/curso" element={<StudioUploadCurso />} />
      <Route path="/studio/contents" element={<StudioContents />} />
      <Route path="/studio/boosts" element={<StudioBoosts />} />
      <Route path="/studio/analytics" element={<StudioAnalytics />} />
      <Route path="/studio/goals" element={<StudioGoals />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/creators" element={<AdminCreators />} />
      <Route path="/admin/contents" element={<AdminContents />} />
      <Route path="/admin/rewards" element={<AdminRewards />} />
      <Route path="/admin/marketing" element={<AdminMarketingMaterials />} />
      <Route path="/admin/transcriptions" element={<AdminTranscriptions />} />
      <Route path="/admin/featured-creators" element={<AdminFeaturedCreators />} />
      <Route path="/admin/home-hero" element={<AdminHomeHero />} />
      <Route path="/admin/withdrawals" element={<AdminWithdrawals />} />
      <Route path="/admin/users" element={<AdminUsers />} />
      <Route path="/admin/settings" element={<AdminSettings />} />
      <Route path="/admin/prospects" element={<AdminProspects />} />
      <Route path="/admin/waitlist" element={<AdminWaitlist />} />
      <Route path="/admin/curadoria" element={<AdminCuration />} />
      <Route path="/rewards-history" element={<RewardsHistory />} />
      <Route path="/recompensas" element={<Recompensas />} />
      <Route path="/carteira" element={<Carteira />} />
      <Route path="/boost-success" element={<BoostSuccess />} />
      <Route path="/listen/:id" element={<Listen />} />
      <Route path="/shorts" element={<Shorts />} />
      <Route path="/shorts/:id" element={<Shorts />} />
      <Route path="/c/new" element={<NewStudy />} />
      <Route path="/c/:id" element={<Study />} />
      <Route path="/study" element={<Study />} />
      <Route path="/planos" element={<Planos />} />
      <Route path="/messages" element={<Messages />} />
      <Route path="/studio/live" element={<StudioLive />} />
      <Route path="/live/:id/broadcast" element={<LiveBroadcast />} />
      <Route path="/live/:id" element={null} />
      <Route path="/creators/destaque/:slug" element={<FeaturedCreatorPage />} />
      <Route path="/lab/front-v2" element={<FrontV2Lab />} />
      <Route path="/:username" element={<CreatorProfile />} />
      {import.meta.env.DEV && <Route path="/dev/media-audit" element={<MediaAudit />} />}
      <Route path="*" element={<NotFound />} />
    </>
  );

  return (
    <>
      <OnboardingGate />
      <RouteLoadBoundary>
        <Suspense fallback={liveOpening}>
          {backgroundLocation ? (
            <>
              {/* Background page (previous route) */}
              <Routes location={backgroundLocation}>{mainRoutes}</Routes>

              {/* Overlay route (Watch) */}
              <Routes location={location}>
                <Route path="/watch/:id" element={<Watch />} />
              </Routes>
            </>
          ) : (
            <Routes>
              {mainRoutes}
              <Route path="/watch/:id" element={<Watch />} />
            </Routes>
          )}
        </Suspense>
      </RouteLoadBoundary>
      {activeLiveId && (
        <Suspense fallback={liveOpening}>
          <LiveWatch
            key={activeLiveId}
            liveId={activeLiveId}
            minimized={!liveRouteId}
            onMinimize={() => navigate(liveReturnPath)}
            onExpand={() => navigate(`/live/${activeLiveId}`)}
            onClose={closeLive}
          />
        </Suspense>
      )}
      {!isBroadcastRoute && !activeLiveId && location.pathname !== "/onboarding" && <MiniPlayer />}
      {!isBroadcastRoute && !liveRouteId && location.pathname !== "/onboarding" && <MobileBottomNav />}
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <MiniPlayerProvider>
            <TooltipProvider>
              <AppNotifications />
              <AppContent />
            </TooltipProvider>
          </MiniPlayerProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
