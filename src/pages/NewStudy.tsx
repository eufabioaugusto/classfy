import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, BookOpen, Loader2, Sparkles } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { GlobalLoader } from "@/components/GlobalLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useStudies } from "@/hooks/useStudies";
import { getTopInterests, trackUserInteraction } from "@/lib/personalization/interests";

const starterTopics = ["Inteligência artificial", "Marketing digital", "Finanças pessoais", "Design de produto"];

export default function NewStudy() {
  const { user, loading: authLoading, profile } = useAuth();
  const { createStudy, canCreateMore, limitsReady, loading: studiesLoading } = useStudies();
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState(() => {
    const contentTitle = (location.state as { contentTitle?: string } | null)?.contentTitle;
    return contentTitle ? `Quero aprender sobre ${contentTitle}` : "";
  });
  const [interests, setInterests] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getTopInterests(user?.id).then((items) => {
      if (!active) return;
      setInterests([...new Set(items.map((item) => item.trim()).filter((item) => item.length >= 4))].slice(0, 4));
    });
    return () => { active = false; };
  }, [user?.id]);

  if (authLoading) return <GlobalLoader label="Abrindo novo estudo" />;
  if (!user) return <Navigate to="/auth" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const topic = prompt.trim();
    if (!topic || sending || !limitsReady || studiesLoading) return;
    if (!canCreateMore) { setUpgradeOpen(true); return; }

    setSending(true);
    try {
      const result = await createStudy(topic);
      if (result?.error === "LIMIT_REACHED") { setUpgradeOpen(true); return; }
      if (!result || result.error || !result.data) throw result?.error || new Error("STUDY_CREATION_FAILED");
      void trackUserInteraction({ userId: user.id, action: "search", title: topic });
      sessionStorage.setItem(`classfy:pending-study-prompt:${result.data.id}`, topic);
      navigate(`/c/${result.data.id}`, { replace: true, state: { initialPrompt: topic } });
    } catch (error) {
      console.error("Could not create study:", error);
      toast.error("Não foi possível iniciar o estudo. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-h-svh min-w-0 flex-1 flex-col">
          <Header title="Novo estudo" />
          <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-12 sm:px-8">
            <div className="w-full max-w-3xl">
              <div className="mb-10 text-center">
                <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400"><BookOpen className="h-6 w-6" /></span>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">O que você gostaria de aprender?</h1>
                <p className="mt-3 text-sm text-muted-foreground sm:text-base">Conte para a Classy. Seu estudo começa com a primeira mensagem.</p>
              </div>
              <form onSubmit={handleSubmit} className="rounded-3xl border border-border bg-card p-3 shadow-[0_16px_55px_rgba(0,0,0,.07)] focus-within:border-rose-500/50 focus-within:ring-4 focus-within:ring-rose-500/10">
                <label htmlFor="new-study-prompt" className="sr-only">Mensagem para começar o estudo</label>
                <textarea
                  ref={inputRef}
                  id="new-study-prompt"
                  autoFocus
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Sobre o que você quer aprender?"
                  rows={3}
                  maxLength={500}
                  disabled={sending}
                  className="w-full resize-none bg-transparent px-3 py-3 text-base outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-between gap-3 px-2 pb-1">
                  <span className="text-xs text-muted-foreground">Enter para começar · Shift + Enter para nova linha</span>
                  <button type="submit" aria-label="Começar estudo" disabled={!prompt.trim() || sending || !limitsReady || studiesLoading} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
                  </button>
                </div>
              </form>
              <div className="mt-6 text-center">
                <p className="mb-3 text-xs font-medium text-muted-foreground">{interests.length ? "Com base nos seus interesses" : "Ideias para começar"}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {(interests.length ? interests : starterTopics).map((topic) => (
                    <button key={topic} type="button" onClick={() => { setPrompt(topic); inputRef.current?.focus(); }} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground/80 transition-colors hover:border-rose-500/40 hover:bg-rose-500/5">
                      <Sparkles className="h-3 w-3 text-rose-500" /> {topic}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} requiredPlan={profile?.plan === "free" ? "pro" : "premium"} />
    </SidebarProvider>
  );
}
