import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { MiniPlayerProvider } from "./contexts/MiniPlayerContext";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, Suspense, lazy, Fragment } from "react";
import { GlobalLoader } from "./components/GlobalLoader";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { MiniPlayer } from "./components/MiniPlayer";
import { useIsMobile } from "@/hooks/use-mobile";

// Lazy load all pages for maximum code splitting
const Index = lazy(() => import("./pages/Index"));
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
const AdminTranscriptions = lazy(() => import("./pages/AdminTranscriptions"));
const AdminFeaturedCreators = lazy(() => import("./pages/AdminFeaturedCreators"));
const AdminWithdrawals = lazy(() => import("./pages/AdminWithdrawals"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
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
const Messages = lazy(() => import("./pages/Messages"));
const Watch = lazy(() => import("./pages/Watch"));
const Listen = lazy(() => import("./pages/Listen"));
const Shorts = lazy(() => import("./pages/Shorts"));
const Planos = lazy(() => import("./pages/Planos"));
const FeaturedCreatorPage = lazy(() => import("./pages/FeaturedCreatorPage"));

const CreatorProfile = lazy(() => import("./pages/CreatorProfile"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function AppContent() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const backgroundLocation = isMobile ? (location.state as any)?.backgroundLocation : null;

  // Track referral clicks
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');

    if (refCode) {
      // Save to localStorage (expires in 30 days)
      localStorage.setItem('referral_code', refCode);
      localStorage.setItem('referral_expires', String(Date.now() + (30 * 24 * 60 * 60 * 1000)));

      // Remove from URL
      window.history.replaceState({}, '', window.location.pathname);

      // Track click
      supabase.functions.invoke('track-referral-click', {
        body: { referral_code: refCode }
      }).catch(console.error);
    }
  }, []);

  const mainRoutes = (
    <>
      <Route path="/" element={<Index />} />
      <Route path="/auth" element={<Auth />} />
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
      <Route path="/admin/transcriptions" element={<AdminTranscriptions />} />
      <Route path="/admin/featured-creators" element={<AdminFeaturedCreators />} />
      <Route path="/admin/withdrawals" element={<AdminWithdrawals />} />
      <Route path="/admin/users" element={<AdminUsers />} />
      <Route path="/admin/settings" element={<AdminSettings />} />
      <Route path="/rewards-history" element={<RewardsHistory />} />
      <Route path="/recompensas" element={<Recompensas />} />
      <Route path="/carteira" element={<Carteira />} />
      <Route path="/boost-success" element={<BoostSuccess />} />
      <Route path="/listen/:id" element={<Listen />} />
      <Route path="/shorts" element={<Shorts />} />
      <Route path="/shorts/:id" element={<Shorts />} />
      <Route path="/c/:id" element={<Study />} />
      <Route path="/study" element={<Study />} />
      <Route path="/planos" element={<Planos />} />
      <Route path="/messages" element={<Messages />} />
      <Route path="/creators/destaque/:slug" element={<FeaturedCreatorPage />} />
      <Route path="/:username" element={<CreatorProfile />} />
      <Route path="*" element={<NotFound />} />
    </>
  );

  return (
    <>
      <Suspense fallback={<GlobalLoader />}>
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
      <MiniPlayer />
      <MobileBottomNav />
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
              <Toaster />
              <Sonner />
              <AppContent />
            </TooltipProvider>
          </MiniPlayerProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;