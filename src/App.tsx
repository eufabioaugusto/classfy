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
import AdminCreators from "./pages/AdminCreators";
import Study from "./pages/Study";
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
              <Route path="/studio/contents" element={<Studio />} />
              <Route path="/studio/new" element={<Studio />} />
              <Route path="/admin/creators" element={<AdminCreators />} />
              <Route path="/admin/users" element={<AdminCreators />} />
              <Route path="/admin/settings" element={<AdminCreators />} />
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
