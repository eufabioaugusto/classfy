import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PlayCircle, CheckCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CourseCurriculumProps {
  modules: any[];
  currentLesson: any;
  onLessonSelect: (lesson: any) => void;
  hasAccess: boolean;
}

export const CourseCurriculum = ({ modules, currentLesson, onLessonSelect, hasAccess }: CourseCurriculumProps) => {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  };

  return (
    <Card className="p-4">
      <h3 className="text-lg font-bold mb-4">Conteúdo do Curso</h3>

      <Accordion type="single" collapsible className="w-full">
        {modules.map((module, idx) => (
          <AccordionItem key={module.id} value={`module-${idx}`}>
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3 text-left">
                <Badge variant="outline">{idx + 1}</Badge>
                <div>
                  <p className="font-semibold text-sm">{module.title}</p>
                  {module.description && <p className="text-xs text-muted-foreground mt-1">{module.description}</p>}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 mt-2">
                {module.lessons?.map((lesson: any, lessonIdx: number) => {
                  const isCurrentLesson = currentLesson?.id === lesson.id;
                  const isPreview = lesson.is_preview;
                  const canPlay = hasAccess || isPreview;

                  return (
                    <Button
                      key={lesson.id}
                      variant={isCurrentLesson ? "secondary" : "ghost"}
                      className="w-full justify-start text-left h-auto py-3"
                      onClick={() => canPlay && onLessonSelect(lesson)}
                      disabled={!canPlay}
                    >
                      <div className="flex items-start gap-3 w-full">
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
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">
                              {lessonIdx + 1}. {lesson.title}
                            </span>
                            {isPreview && (
                              <Badge variant="outline" className="text-xs">
                                Preview
                              </Badge>
                            )}
                          </div>
                          {lesson.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{lesson.description}</p>
                          )}
                          {lesson.duration_seconds && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDuration(lesson.duration_seconds)}
                            </p>
                          )}
                        </div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Card>
  );
};
