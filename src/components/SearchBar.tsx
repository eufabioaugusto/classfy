import { useState, useEffect } from "react";
import { Search, Loader2, Mic, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useStudies } from "@/hooks/useStudies";
import { CategoryChip } from "@/components/CategoryChip";

interface SearchBarProps {
  onResults: (results: any[]) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
}

export function SearchBar({ onResults, onLoading, onError }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { createStudy, canCreateMore, activeCount, limit } = useStudies();

  const placeholders = [
    "O que você quer aprender hoje?",
    "Pergunte qualquer coisa à Classy...",
    "Explore novos conhecimentos...",
    "Descubra conteúdos incríveis...",
  ];

  const suggestions = [
    { label: "Inteligência Artificial", icon: <Sparkles /> },
    { label: "Desenvolvimento Web", icon: <TrendingUp /> },
    { label: "Marketing Digital", icon: <TrendingUp /> },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) {
      onError("Digite algo para buscar");
      return;
    }

    if (!user) {
      onError("Faça login para criar um estudo");
      return;
    }

    // Clear previous error
    onError(null);
    
    setIsSearching(true);
    onLoading(true);

    try {
      // Create study
      const result = await createStudy(query.trim());

      if (result?.error === 'LIMIT_REACHED') {
        const planName = profile?.plan === 'free' ? 'Free' : 'Pro';
        const limitText = limit === Infinity ? 'ilimitados' : limit.toString();
        onError(
          `Você atingiu o limite de ${limitText} estudos ativos no plano ${planName}. Arquive um estudo ou ${
            profile?.plan === 'free' ? 'migre para o plano Pro' : 'migre para o Premium'
          } para criar mais.`
        );
        setIsSearching(false);
        onLoading(false);
        return;
      }

      if (result?.error) {
        throw result.error;
      }

      if (result?.data) {
        // Small delay to ensure database consistency
        await new Promise(resolve => setTimeout(resolve, 500));
        // Navigate to study page
        navigate(`/c/${result.data.id}`);
      }
    } catch (error: any) {
      onError("Ocorreu um erro ao criar o estudo. Tente novamente.");
      console.error("Study creation error:", error);
    } finally {
      setIsSearching(false);
      onLoading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <form onSubmit={handleSearch} className="relative">
        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-cinematic-accent/20 to-primary/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
          
          <div className="relative bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl shadow-lg hover:shadow-xl transition-all">
            {/* Main Input Area */}
            <div className="flex items-center gap-3 p-4">
              <Search className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                placeholder={placeholders[placeholderIndex]}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isSearching}
                className="flex-1 bg-transparent border-none outline-none text-lg text-foreground placeholder:text-muted-foreground disabled:opacity-50"
              />
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex items-center justify-between px-4 pb-3 pt-2 border-t border-border/30">
              {/* Suggestions Chips - Left Side */}
              <div className="flex items-center gap-2 flex-wrap">
                {suggestions.map((suggestion, index) => (
                  <CategoryChip
                    key={index}
                    label={suggestion.label}
                    icon={suggestion.icon}
                    onClick={() => {
                      setQuery(suggestion.label);
                    }}
                  />
                ))}
              </div>

              {/* Action Buttons - Right Side */}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  disabled={isSearching}
                  title="Busca por voz"
                >
                  <Mic className="w-4 h-4" />
                </Button>
                
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSearching}
                  className="bg-cinematic-accent hover:bg-cinematic-accent/90 text-white px-4"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Buscando
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Buscar
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
