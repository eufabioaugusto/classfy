import { useState, useEffect, useRef } from "react";
import { Search, Loader2, Mic, Sparkles, BookOpen } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useStudies } from "@/hooks/useStudies";
import { cn } from "@/lib/utils";
import { trackUserInteraction } from "@/lib/personalization/interests";

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
  const { createStudy, canCreateMore, activeCount, limits } = useStudies();
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
  const limitText = limits.studies === Infinity ? 'ilimitados' : `${activeCount}/${limits.studies}`;

  const waitForStudyAvailability = async (studyId: string, maxAttempts = 8, delayMs = 350) => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { data, error } = await supabase
        .from("studies")
        .select("id")
        .eq("id", studyId)
        .maybeSingle();

      if (data?.id) {
        return;
      }

      if (error) {
        console.error("Error checking study availability:", error);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error("STUDY_NOT_READY");
  };

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
      await trackUserInteraction({
        userId: user.id,
        action: "search",
        title: query.trim(),
      });

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
        await waitForStudyAvailability(result.data.id);
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
    <div className="cf-v2 cf2-study-search">
      <form onSubmit={handleSearch}>
        <div className="cf2-study-search__surface">
          <label className="cf2-study-search__input-row">
            <Search aria-hidden="true" />
              <input
                type="text"
                aria-label="Tema do novo estudo"
                placeholder={placeholders[placeholderIndex]}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isSearching}
              />
          </label>

          <div className="cf2-study-search__actions">
            <div className="cf2-study-search__suggestions">
                {user && (
                  <div className="cf2-study-search__counter">
                    <BookOpen aria-hidden="true" />
                    <span>{limitText}</span>
                    {!canCreateMore && currentPlan !== 'premium' && (
                      <em>limite</em>
                    )}
                  </div>
                )}

                <div className="cf2-study-search__chips">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setQuery(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
            </div>

            <div className="cf2-study-search__buttons">
                <button
                  type="button"
                  onClick={toggleVoiceRecording}
                  className={cn("cf2-study-search__voice", isRecording && "is-recording")}
                  disabled={isSearching}
                  title={isRecording ? "Parar gravação" : "Busca por voz"}
                >
                  <Mic aria-hidden="true" />
                </button>
                
                <button
                  type="submit"
                  disabled={isSearching || !query.trim() || isRecording}
                  className="cf2-study-search__submit"
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="animate-spin" />
                      <span>Buscando</span>
                    </>
                  ) : (
                    <>
                      <Sparkles />
                      <span>Buscar</span>
                    </>
                  )}
                </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
