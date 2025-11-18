import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Conta from "./pages/Conta";
import Historico from "./pages/Historico";
import Favoritos from "./pages/Favoritos";
import Salvos from "./pages/Salvos";
import Studio from "./pages/Studio";
import StudioUpload from "./pages/StudioUpload";
import AdminCreators from "./pages/AdminCreators";
import AdminContents from "./pages/AdminContents";
import Study from "./pages/Study";
import Watch from "./pages/Watch";
import Listen from "./pages/Listen";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/conta" element={<Conta />} />
              <Route path="/historico" element={<Historico />} />
              <Route path="/favoritos" element={<Favoritos />} />
              <Route path="/salvos" element={<Salvos />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/studio/upload" element={<StudioUpload />} />
              <Route path="/admin/creators" element={<AdminCreators />} />
              <Route path="/admin/contents" element={<AdminContents />} />
              <Route path="/watch/:id" element={<Watch />} />
              <Route path="/listen/:id" element={<Listen />} />
              <Route path="/c/:id" element={<Study />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
