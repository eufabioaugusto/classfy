import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useStudies } from "@/hooks/useStudies";

interface SearchBarProps {
  onResults: (results: any[]) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
}

export function SearchBar({ onResults, onLoading, onError }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { createStudy, canCreateMore, activeCount, limit } = useStudies();

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
    <form onSubmit={handleSearch} className="w-full max-w-3xl mx-auto">
      <div className="relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="text"
          placeholder="O que você quer aprender hoje?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-14 pl-14 pr-32 bg-muted border-border text-foreground placeholder:text-muted-foreground focus:bg-muted focus:border-cinematic-accent transition-all text-lg"
          disabled={isSearching}
        />
        <Button
          type="submit"
          disabled={isSearching}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-cinematic-accent hover:bg-cinematic-accent/90 text-white"
        >
          {isSearching ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Buscando
            </>
          ) : (
            "Buscar"
          )}
        </Button>
      </div>
    </form>
  );
}
