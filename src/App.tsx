import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { NotificationBell } from "./components/NotificationBell";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Conta from "./pages/Conta";
import Historico from "./pages/Historico";
import Favoritos from "./pages/Favoritos";
import Salvos from "./pages/Salvos";
import Studio from "./pages/Studio";
import StudioUpload from "./pages/StudioUpload";
import StudioContents from "./pages/StudioContents";
import AdminCreators from "./pages/AdminCreators";
import AdminContents from "./pages/AdminContents";
import AdminRewards from "./pages/AdminRewards";
import AdminTranscriptions from "./pages/AdminTranscriptions";
import RewardsHistory from "./pages/RewardsHistory";
import Recompensas from "./pages/Recompensas";
import BoostSuccess from "./pages/BoostSuccess";
import StudioBoosts from "./pages/StudioBoosts";
import Study from "./pages/Study";
import Watch from "./pages/Watch";
import Listen from "./pages/Listen";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/conta" element={<Conta />} />
              <Route path="/historico" element={<Historico />} />
              <Route path="/favoritos" element={<Favoritos />} />
              <Route path="/salvos" element={<Salvos />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/studio/upload" element={<StudioUpload />} />
              <Route path="/studio/contents" element={<StudioContents />} />
              <Route path="/studio/boosts" element={<StudioBoosts />} />
              <Route path="/admin/creators" element={<AdminCreators />} />
              <Route path="/admin/contents" element={<AdminContents />} />
              <Route path="/admin/rewards" element={<AdminRewards />} />
              <Route path="/admin/transcriptions" element={<AdminTranscriptions />} />
              <Route path="/rewards-history" element={<RewardsHistory />} />
              <Route path="/recompensas" element={<Recompensas />} />
              <Route path="/boost-success" element={<BoostSuccess />} />
              <Route path="/watch/:id" element={<Watch />} />
              <Route path="/listen/:id" element={<Listen />} />
              <Route path="/c/:id" element={<Study />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
