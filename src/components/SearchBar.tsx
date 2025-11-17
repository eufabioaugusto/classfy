import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface SearchBarProps {
  onResults: (results: any[]) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
}

export function SearchBar({ onResults, onLoading, onError }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const { user } = useAuth();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) {
      onError("Digite algo para buscar");
      return;
    }

    // Clear previous error
    onError(null);
    
    setIsSearching(true);
    onLoading(true);

    try {
      // Search in contents table
      const { data, error } = await supabase
        .from("contents")
        .select(`
          *,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .not("published_at", "is", null)
        .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
        .order("views_count", { ascending: false })
        .limit(20);

      if (error) throw error;

      onResults(data || []);
      
      if (!data || data.length === 0) {
        onError(`Nenhum conteúdo encontrado para "${query}"`);
      }
    } catch (error: any) {
      onError("Ocorreu um erro ao buscar. Tente novamente.");
      console.error("Search error:", error);
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
