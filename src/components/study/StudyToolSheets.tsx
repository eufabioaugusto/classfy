import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, X } from "lucide-react";
import { StudyQuiz } from "@/components/StudyQuiz";
import { StudyNotes } from "@/components/StudyNotes";
import { WatchRelated } from "@/components/WatchRelated";
import { ToolPanel } from "@/components/unified/StudyToolbar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface StudyToolSheetsProps {
  activeToolPanel: ToolPanel;
  setActiveToolPanel: (panel: ToolPanel) => void;
  activeContent: any;
  studyId: string;
  transcription: string;
  transcriptionLoading: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onGenerateTranscription: () => void;
  onSeekToTimestamp: (seconds: number) => void;
  notesRefresh: number;
  highlightSearchResults: (text: string, query: string) => string;
}

export function StudyToolSheets({
  activeToolPanel,
  setActiveToolPanel,
  activeContent,
  studyId,
  transcription,
  transcriptionLoading,
  searchQuery,
  setSearchQuery,
  onGenerateTranscription,
  onSeekToTimestamp,
  notesRefresh,
  highlightSearchResults,
}: StudyToolSheetsProps) {
  if (!activeContent) return null;

  return (
    <>
      {/* Transcription Sheet */}
      <Sheet open={activeToolPanel === 'transcription'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
        <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Transcrição</SheetTitle>
            <SheetDescription className="line-clamp-1">{activeContent.title}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {!transcription && !transcriptionLoading ? (
              <div className="space-y-4">
                <div className="text-muted-foreground text-sm">
                  <p>A transcrição deste conteúdo está sendo processada automaticamente.</p>
                  <p className="mt-2">Isso acontece em segundo plano quando o conteúdo é aprovado. Recarregue a página em alguns minutos.</p>
                  <p className="mt-2 text-xs">Se a transcrição não aparecer após alguns minutos, você pode gerá-la manualmente:</p>
                </div>
                <Button onClick={onGenerateTranscription} disabled={transcriptionLoading} variant="outline" size="sm">
                  Tentar Gerar Novamente
                </Button>
              </div>
            ) : transcriptionLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <p className="text-sm">Gerando transcrição...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input placeholder="Buscar na transcrição..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1" />
                  {searchQuery && (
                    <Button variant="ghost" size="icon" onClick={() => setSearchQuery("")}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="prose prose-sm max-w-none text-foreground">
                  <div dangerouslySetInnerHTML={{ __html: highlightSearchResults(transcription, searchQuery) }} />
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Quiz Sheet */}
      <Sheet open={activeToolPanel === 'quiz'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
        <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Quiz</SheetTitle>
            <SheetDescription className="line-clamp-1">Teste seus conhecimentos</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <StudyQuiz studyId={studyId} contentId={activeContent.id} contentTitle={activeContent.title} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Notes Sheet */}
      <Sheet open={activeToolPanel === 'notes'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
        <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Anotações</SheetTitle>
            <SheetDescription>Suas anotações de estudo</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <StudyNotes studyId={studyId} activeContentId={activeContent?.id || null} onSeekToTimestamp={onSeekToTimestamp} key={notesRefresh} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Comments Sheet */}
      <Sheet open={activeToolPanel === 'comments'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
        <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Comentários</SheetTitle>
            <SheetDescription className="line-clamp-1">Discussões sobre {activeContent.title}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 text-muted-foreground text-sm">
            <p>Comentários disponíveis em breve...</p>
          </div>
        </SheetContent>
      </Sheet>

      {/* Recommendations Sheet */}
      <Sheet open={activeToolPanel === 'recommendations'} onOpenChange={(open) => !open && setActiveToolPanel(null)}>
        <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Recomendações</SheetTitle>
            <SheetDescription>Conteúdos sugeridos para você</SheetDescription>
          </SheetHeader>
          <div className="mt-6 text-muted-foreground text-sm">
            <p>Recomendações personalizadas baseadas no seu progresso...</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
