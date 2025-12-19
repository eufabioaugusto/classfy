import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Play, Podcast, Zap, GraduationCap, Target, Compass, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  content_type?: string;
  type: "content" | "course";
  creator?: {
    display_name: string;
    avatar_url: string | null;
  };
  views_count?: number;
}

interface GlobalSearchProps {
  isExploreMode: boolean;
  onModeChange: (isExplore: boolean) => void;
}

export function GlobalSearch({ isExploreMode, onModeChange }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setIsLoading(true);
    try {
      const searchPattern = `%${escapeRegex(searchQuery)}%`;
      const { data: contentsData } = await supabase
        .from("contents")
        .select(`id, title, description, thumbnail_url, content_type, views_count, profiles:creator_id (display_name, avatar_url)`)
        .eq("status", "approved")
        .or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`)
        .order("views_count", { ascending: false })
        .limit(5);

      const { data: coursesData } = await supabase
        .from("courses")
        .select(`id, title, description, thumbnail_url, views_count, profiles:creator_id (display_name, avatar_url)`)
        .eq("status", "approved")
        .or(`title.ilike.${searchPattern},description.ilike.${searchPattern}`)
        .order("views_count", { ascending: false })
        .limit(3);

      const contentResults: SearchResult[] = (contentsData || []).map((item: any) => ({
        id: item.id, title: item.title, description: item.description, thumbnail_url: item.thumbnail_url,
        content_type: item.content_type, type: "content" as const, creator: item.profiles, views_count: item.views_count,
      }));
      const courseResults: SearchResult[] = (coursesData || []).map((item: any) => ({
        id: item.id, title: item.title, description: item.description, thumbnail_url: item.thumbnail_url,
        type: "course" as const, creator: item.profiles, views_count: item.views_count,
      }));
      setResults([...contentResults, ...courseResults]);
      setIsOpen(true);
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => performSearch(value), 300);
  };

  const clearSearch = () => { setQuery(""); setResults([]); setIsOpen(false); };

  const handleResultClick = (result: SearchResult) => {
    setIsOpen(false); setQuery(""); setMobileSheetOpen(false);
    navigate(result.type === "course" ? `/watch/${result.id}?type=course` : `/watch/${result.id}`);
  };

  const getContentIcon = (type?: string) => {
    if (type === "podcast") return <Podcast className="w-3.5 h-3.5" />;
    if (type === "short") return <Zap className="w-3.5 h-3.5" />;
    return <Play className="w-3.5 h-3.5" />;
  };

  const formatViews = (count?: number) => {
    if (!count) return "0 views";
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return `${count}`;
  };

  const ResultItem = ({ result }: { result: SearchResult }) => (
    <button onClick={() => handleResultClick(result)} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left">
      <div className="relative flex-shrink-0 w-16 h-10 rounded-md overflow-hidden bg-muted">
        {result.thumbnail_url ? (
          <img src={result.thumbnail_url} alt={result.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-secondary">
            {result.type === "course" ? <GraduationCap className="w-5 h-5 text-muted-foreground" /> : getContentIcon(result.content_type)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-foreground truncate">{result.title}</h4>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {result.creator && <span className="truncate">{result.creator.display_name}</span>}
          <span>•</span>
          <span>{formatViews(result.views_count)} views</span>
        </div>
      </div>
    </button>
  );

  return (
    <>
      {/* Mobile */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="sm:hidden text-foreground"><Search className="w-5 h-5" /></Button>
        </SheetTrigger>
        <SheetContent side="top" className="h-auto max-h-[85vh] p-0 bg-background">
          <div className="flex items-center justify-center gap-4 py-3 border-b border-border/30">
            <Button variant="ghost" size="sm" className={cn("gap-2 rounded-full px-4", !isExploreMode ? "bg-accent/20 text-accent" : "text-muted-foreground")} onClick={() => { onModeChange(false); setMobileSheetOpen(false); }}>
              <Target className="w-4 h-4" />Foco
            </Button>
            <Button variant="ghost" size="sm" className={cn("gap-2 rounded-full px-4", isExploreMode ? "bg-accent/20 text-accent" : "text-muted-foreground")} onClick={() => { onModeChange(true); setMobileSheetOpen(false); }}>
              <Compass className="w-4 h-4" />Explorar
            </Button>
          </div>
          <div className="p-4 border-b border-border/30">
            <div className="flex items-center gap-3 bg-secondary/50 rounded-full px-4 py-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input type="text" placeholder="Buscar..." value={query} onChange={handleInputChange} className="border-0 bg-transparent focus-visible:ring-0 h-8 px-0" autoFocus />
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : query && <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={clearSearch}><X className="w-4 h-4" /></Button>}
            </div>
          </div>
          {results.length > 0 && <div className="max-h-[60vh] overflow-y-auto">{results.map(r => <ResultItem key={`${r.type}-${r.id}`} result={r} />)}</div>}
          {query.length >= 2 && results.length === 0 && !isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Nenhum resultado</div>}
        </SheetContent>
      </Sheet>

      {/* Desktop */}
      <div ref={containerRef} className="relative flex-1 max-w-xl mx-4 hidden sm:block">
        <div className={cn("flex items-center gap-2 rounded-full border bg-secondary/50 backdrop-blur-sm transition-all", isFocused ? "border-accent/50 ring-2 ring-accent/20" : "border-border/30 hover:border-border/50")}>
          <div className="flex items-center gap-1 pl-3 pr-1 border-r border-border/30">
            <Button variant="ghost" size="sm" className={cn("h-7 w-7 p-0 rounded-full", !isExploreMode ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => onModeChange(false)} title="Foco"><Target className="w-3.5 h-3.5" /></Button>
            <Button variant="ghost" size="sm" className={cn("h-7 w-7 p-0 rounded-full", isExploreMode ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground")} onClick={() => onModeChange(true)} title="Explorar"><Compass className="w-3.5 h-3.5" /></Button>
          </div>
          <Search className="w-4 h-4 text-muted-foreground ml-1" />
          <Input ref={inputRef} type="text" placeholder="Buscar conteúdos, cursos, criadores..." value={query} onChange={handleInputChange} onFocus={() => { setIsFocused(true); if (query.length >= 2) setIsOpen(true); }} className="border-0 bg-transparent focus-visible:ring-0 placeholder:text-muted-foreground/60 text-sm h-9 px-0" />
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-3" /> : query && <Button variant="ghost" size="sm" className="h-6 w-6 p-0 mr-2 rounded-full" onClick={clearSearch}><X className="w-3.5 h-3.5" /></Button>}
        </div>
        {isOpen && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 py-2 bg-popover border border-border rounded-xl shadow-xl z-50 animate-in fade-in-0 slide-in-from-top-2">
            <div className="max-h-[400px] overflow-y-auto">{results.map(r => <ResultItem key={`${r.type}-${r.id}`} result={r} />)}</div>
          </div>
        )}
        {isOpen && query.length >= 2 && results.length === 0 && !isLoading && (
          <div className="absolute top-full left-0 right-0 mt-2 py-6 bg-popover border border-border rounded-xl shadow-xl z-50 text-center text-sm text-muted-foreground">Nenhum resultado para "{query}"</div>
        )}
      </div>
    </>
  );
}
