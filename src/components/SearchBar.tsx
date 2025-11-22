import { useState, useEffect, useRef } from "react";
import { Search, Loader2, Mic, Sparkles, TrendingUp, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useStudies } from "@/hooks/useStudies";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  onResults: (results: any[]) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
  onLimitReached?: () => void;
}

export function SearchBar({ onResults, onLoading, onError, onLimitReached }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { createStudy, canCreateMore, activeCount, limit } = useStudies();
  const recognitionRef = useRef<any>(null);

  const placeholders = [
    "O que você quer aprender hoje?",
    "Pergunte qualquer coisa à Classy...",
    "Explore novos conhecimentos...",
    "Descubra conteúdos incríveis...",
  ];

  const suggestions = [
    "Inteligência Artificial",
    "Desenvolvimento Web",
    "Marketing Digital",
    "Design UX/UI",
  ];

  const currentPlan = profile?.plan || 'free';
  const limitText = limit === Infinity ? 'ilimitados' : `${activeCount}/${limit}`;

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Initialize Web Speech API
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'pt-BR';

      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        setQuery((finalTranscript + interimTranscript).trim());
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        onError('Erro ao capturar áudio. Tente novamente.');
      };

      recognitionRef.current.onend = () => {
        if (isRecording) {
          recognitionRef.current?.start();
        }
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isRecording]);

  const toggleVoiceRecording = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      onError('Seu navegador não suporta reconhecimento de voz.');
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      setQuery('');
      onError(null);
      setIsRecording(true);
      recognitionRef.current?.start();
    }
  };

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
        setIsSearching(false);
        onLoading(false);
        // Call the onLimitReached callback to show upgrade modal
        if (onLimitReached) {
          onLimitReached();
        }
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
    <div className="w-full max-w-4xl mx-auto">
      <form onSubmit={handleSearch} className="relative">
        {/* Glow effect on hover */}
        <div className="absolute -inset-1 bg-gradient-to-r from-cinematic-accent/30 via-primary/30 to-cinematic-accent/30 rounded-[28px] blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
        
        <div className="relative group">
          {/* Main container with glass morphism */}
          <div className="relative bg-background/95 backdrop-blur-xl border border-border/50 rounded-3xl shadow-2xl hover:shadow-cinematic-accent/10 transition-all duration-300 overflow-hidden">
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-cinematic-accent/5 via-transparent to-primary/5 pointer-events-none" />
            
            {/* Main Input Area */}
            <div className="relative flex items-center gap-4 p-6 min-h-[72px]">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-cinematic-accent/10 text-cinematic-accent flex-shrink-0">
                <Search className="w-5 h-5" />
              </div>
              
              <input
                type="text"
                placeholder={placeholders[placeholderIndex]}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isSearching}
                className={cn(
                  "flex-1 bg-transparent border-none outline-none text-lg font-medium text-foreground placeholder:text-muted-foreground/60 disabled:opacity-50",
                  "transition-all duration-300"
                )}
              />
            </div>

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />

            {/* Bottom Actions Bar */}
            <div className="flex items-center justify-between gap-4 px-6 py-4">
              {/* Left side - Study counter + Suggestions */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {/* Study counter */}
                {user && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border/30 flex-shrink-0 animate-fade-in">
                    <BookOpen className="w-3.5 h-3.5 text-cinematic-accent" />
                    <span className="text-xs font-medium text-foreground">
                      {limitText}
                    </span>
                    {!canCreateMore && currentPlan !== 'premium' && (
                      <span className="text-xs text-cinematic-accent">• limite</span>
                    )}
                  </div>
                )}

                {/* Suggestion chips */}
                <div className="hidden md:flex items-center gap-2 overflow-x-auto scrollbar-none">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setQuery(suggestion)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground border border-border/20 hover:border-border/40 transition-all duration-200 whitespace-nowrap flex-shrink-0"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              {/* Right side - Action buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant={isRecording ? "default" : "ghost"}
                  onClick={toggleVoiceRecording}
                  className={cn(
                    "h-9 w-9 p-0 rounded-xl transition-all",
                    isRecording 
                      ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground animate-pulse" 
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                  disabled={isSearching}
                  title={isRecording ? "Parar gravação" : "Busca por voz"}
                >
                  <Mic className="w-4 h-4" />
                </Button>
                
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSearching || !query.trim() || isRecording}
                  className={cn(
                    "h-9 px-5 rounded-xl font-medium shadow-lg shadow-cinematic-accent/20",
                    "bg-gradient-to-r from-cinematic-accent to-cinematic-accent/90",
                    "hover:shadow-xl hover:shadow-cinematic-accent/30",
                    "transition-all duration-300",
                    "disabled:opacity-50 disabled:shadow-none"
                  )}
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      <span>Buscando</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      <span>Buscar</span>
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
