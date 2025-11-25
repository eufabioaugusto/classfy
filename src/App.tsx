import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotificationBell } from "./components/NotificationBell";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Conta from "./pages/Conta";
import Historico from "./pages/Historico";
import Favoritos from "./pages/Favoritos";
import Salvos from "./pages/Salvos";
import Studio from "./pages/Studio";
import StudioUpload from "./pages/StudioUpload";
import StudioUploadCurso from "./pages/StudioUploadCurso";
import StudioContents from "./pages/StudioContents";
import AdminCreators from "./pages/AdminCreators";
import AdminContents from "./pages/AdminContents";
import AdminRewards from "./pages/AdminRewards";
import AdminTranscriptions from "./pages/AdminTranscriptions";
import AdminFeaturedCreators from "./pages/AdminFeaturedCreators";
import AdminWithdrawals from "./pages/AdminWithdrawals";
import AdminSettings from "./pages/AdminSettings";
import AdminUsers from "./pages/AdminUsers";
import AdminDashboard from "./pages/AdminDashboard";
import RewardsHistory from "./pages/RewardsHistory";
import Recompensas from "./pages/Recompensas";
import BoostSuccess from "./pages/BoostSuccess";
import StudioBoosts from "./pages/StudioBoosts";
import StudioAnalytics from "./pages/StudioAnalytics";
import Study from "./pages/Study";
import Watch from "./pages/Watch";
import Listen from "./pages/Listen";
import Shorts from "./pages/Shorts";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppContent() {
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

  return (
    <Routes>
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
      <Route path="/boost-success" element={<BoostSuccess />} />
      <Route path="/watch/:id" element={<Watch />} />
      <Route path="/listen/:id" element={<Listen />} />
      <Route path="/shorts" element={<Shorts />} />
      <Route path="/shorts/:id" element={<Shorts />} />
      <Route path="/c/:id" element={<Study />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <AppContent />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
