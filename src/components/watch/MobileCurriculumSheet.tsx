import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, Lock, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Lesson {
  id: string;
  title: string;
  description?: string | null;
  duration_seconds?: number | null;
  is_preview?: boolean | null;
  video_url?: string | null;
}

interface Module {
  id: string;
  title: string;
  description?: string | null;
  lessons?: Lesson[];
}

interface MobileCurriculumSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modules: Module[];
  currentLesson: Lesson | null;
  onLessonSelect: (lesson: Lesson) => void;
  hasAccess: boolean;
}

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  return `${mins} min`;
};

export function MobileCurriculumSheet({
  open,
  onOpenChange,
  modules,
  currentLesson,
  onLessonSelect,
  hasAccess,
}: MobileCurriculumSheetProps) {
  const totalLessons = modules.reduce((acc, mod) => acc + (mod.lessons?.length || 0), 0);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="border-b pb-3">
          <DrawerTitle className="flex items-center gap-2">
            Conteúdo do Curso
            <Badge variant="secondary" className="text-xs">
              {totalLessons} aulas
            </Badge>
          </DrawerTitle>
        </DrawerHeader>

        <ScrollArea className="flex-1 px-4 py-2" style={{ maxHeight: "calc(85vh - 80px)" }}>
          <div className="space-y-4 pb-6">
            {modules.map((module, moduleIdx) => (
              <div key={module.id} className="space-y-2">
                {/* Module Header */}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs font-medium">
                    {moduleIdx + 1}
                  </Badge>
                  <h3 className="font-semibold text-sm">{module.title}</h3>
                </div>
                
                {module.description && (
                  <p className="text-xs text-muted-foreground ml-7 mb-2">
                    {module.description}
                  </p>
                )}

                {/* Lessons */}
                <div className="space-y-1 ml-2">
                  {module.lessons?.map((lesson, lessonIdx) => {
                    const isCurrentLesson = currentLesson?.id === lesson.id;
                    const isPreview = lesson.is_preview;
                    const canPlay = hasAccess || isPreview;

                    return (
                      <button
                        key={lesson.id}
                        onClick={() => {
                          if (canPlay) {
                            onLessonSelect(lesson);
                            onOpenChange(false);
                          }
                        }}
                        disabled={!canPlay}
                        className={cn(
                          "w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors",
                          isCurrentLesson
                            ? "bg-primary/10 border border-primary/20"
                            : canPlay
                            ? "bg-secondary/50 active:bg-secondary/70"
                            : "bg-muted/30 opacity-60"
                        )}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {isCurrentLesson ? (
                            <PlayCircle className="h-5 w-5 text-primary" />
                          ) : canPlay ? (
                            <PlayCircle className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <Lock className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={cn(
                              "text-sm font-medium",
                              isCurrentLesson && "text-primary"
                            )}>
                              {lessonIdx + 1}. {lesson.title}
                            </span>
                            {isPreview && (
                              <Badge variant="outline" className="text-[10px] py-0 h-4">
                                Preview
                              </Badge>
                            )}
                          </div>
                          
                          {lesson.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              {lesson.description}
                            </p>
                          )}
                          
                          {lesson.duration_seconds && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDuration(lesson.duration_seconds)}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {modules.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Nenhum módulo disponível</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
