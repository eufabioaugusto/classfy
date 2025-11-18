import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { ContentCard } from "@/components/ContentCard";
import { ConversionModal } from "@/components/ConversionModal";
import { SearchBar } from "@/components/SearchBar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { Sparkles, AlertCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudies } from "@/hooks/useStudies";
import { GlobalLoader } from "@/components/GlobalLoader";

export default function Index() {
  const { user, loading: authLoading, profile } = useAuth();
  const navigate = useNavigate();
  const { activeCount, limit, canCreateMore } = useStudies();
  
  // Search state
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReason, setModalReason] = useState<"premium" | "rewards" | "save" | "progress">("premium");

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
          <Header variant="home" />

          {/* Content Area */}
          <main className="flex-1 flex flex-col items-center justify-start p-6 md:p-12">
            <ConversionModal open={modalOpen} onOpenChange={setModalOpen} reason={modalReason} />

            {/* Search Component - Always visible and centered */}
            <div className={`w-full max-w-5xl ${!hasSearched ? 'mt-32' : 'mt-8'} transition-all duration-300`}>
              {/* Title (only when no search) */}
              {!hasSearched && (
                <div className="text-center mb-12 space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border backdrop-blur-sm mb-4">
                    <Sparkles className="w-3.5 h-3.5 text-cinematic-accent" />
                    <span className="text-xs font-medium uppercase tracking-wider text-foreground">Powered by Classy AI</span>
                  </div>
                  <h1 className="text-5xl md:text-6xl font-bold text-foreground">
                    O que você quer aprender?
                  </h1>
                  <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                    Digite um tema e crie um estudo personalizado com a Classy
                  </p>
                  
                  {/* Study counter */}
                  {user && (
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/50 border border-border/50 mt-4">
                      <BookOpen className="w-4 h-4 text-cinematic-accent" />
                      <span className="text-sm text-muted-foreground">
                        Você está usando <span className="font-semibold text-foreground">{limitText}</span> estudos
                        {!canCreateMore && currentPlan !== 'premium' && (
                          <span className="text-cinematic-accent ml-1">(limite atingido)</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Search Bar */}
              <SearchBar
                onResults={handleSearchResults}
                onLoading={handleSearchLoading}
                onError={handleSearchError}
              />

              {/* Status Messages - Inline below search */}
              {isLoading && (
                <div className="mt-4 text-center">
                  <p className="text-muted-foreground text-sm">Classy está processando sua busca...</p>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-center justify-center gap-2 text-cinematic-accent">
                  <AlertCircle className="w-4 h-4" />
                  <p className="text-sm">{error}</p>
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
              <div className="w-full max-w-5xl mt-12">
                <div className="mb-6">
                  <h2 className="text-2xl font-bold text-foreground">
                    {searchResults.length} resultado{searchResults.length !== 1 ? 's' : ''} encontrado{searchResults.length !== 1 ? 's' : ''}
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {searchResults.map((content) => (
                    <ContentCard
                      key={content.id}
                      content={content}
                      onClick={() => handleContentClick(content)}
                    />
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}