import { Card } from "@/components/ui/card";
import { Video, HelpCircle, FileText, Clock, BookOpen } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Module {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
  quizzes: Quiz[];
  materials: Material[];
}

interface Lesson {
  id: string;
  title: string;
  duration: number;
  isPreview: boolean;
}

interface Quiz {
  id: string;
  title: string;
}

interface Material {
  id: string;
  title: string;
}

interface CourseStructurePreviewProps {
  modules: Module[];
}

export function CourseStructurePreview({ modules }: CourseStructurePreviewProps) {
  const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);
  const totalDuration = modules.reduce(
    (acc, m) => acc + m.lessons.reduce((sum, l) => sum + l.duration, 0),
    0
  );
  const totalQuizzes = modules.reduce((acc, m) => acc + m.quizzes.length, 0);
  const totalMaterials = modules.reduce((acc, m) => acc + m.materials.length, 0);

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    }
    return `${minutes}min`;
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <span className="text-sm text-muted-foreground">Módulos</span>
          </div>
          <p className="text-3xl font-bold text-foreground">
            {modules.filter(m => m.title).length}
          </p>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Video className="w-5 h-5 text-blue-500" />
            <span className="text-sm text-muted-foreground">Aulas</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{totalLessons}</p>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20">
          <div className="flex items-center gap-2 mb-2">
            <HelpCircle className="w-5 h-5 text-purple-500" />
            <span className="text-sm text-muted-foreground">Quizzes</span>
          </div>
          <p className="text-3xl font-bold text-foreground">{totalQuizzes}</p>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-green-500" />
            <span className="text-sm text-muted-foreground">Duração</span>
          </div>
          <p className="text-3xl font-bold text-foreground">
            {formatDuration(totalDuration)}
          </p>
        </Card>
      </div>

      {/* Structure Tree */}
      <Card className="p-6">
        <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Estrutura do Curso
        </h4>
        
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {modules.map((module, moduleIndex) => (
              <div
                key={module.id}
                className="border-l-2 border-primary/30 pl-4 space-y-2 animate-fade-in"
              >
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary mt-1">
                    {moduleIndex + 1}
                  </div>
                  <div className="flex-1">
                    <h5 className="font-semibold text-foreground">
                      {module.title || `Módulo ${moduleIndex + 1}`}
                    </h5>
                    {module.description && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {module.description}
                      </p>
                    )}

                    {/* Lessons */}
                    {module.lessons.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {module.lessons.map((lesson, lessonIndex) => (
                          <div
                            key={lesson.id}
                            className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
                          >
                            <Video className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            <span className="flex-1 truncate">
                              {lesson.title || `Aula ${lessonIndex + 1}`}
                            </span>
                            {lesson.duration > 0 && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {Math.floor(lesson.duration / 60)}min
                              </span>
                            )}
                            {lesson.isPreview && (
                              <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-700 dark:text-green-400 rounded-full">
                                Preview
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Quizzes */}
                    {module.quizzes.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {module.quizzes.map((quiz) => (
                          <div
                            key={quiz.id}
                            className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
                          >
                            <HelpCircle className="w-4 h-4 text-purple-500 flex-shrink-0" />
                            <span className="flex-1 truncate">
                              {quiz.title || "Quiz sem título"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Materials */}
                    {module.materials.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {module.materials.map((material) => (
                          <div
                            key={material.id}
                            className="flex items-center gap-2 text-sm py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
                          >
                            <FileText className="w-4 h-4 text-orange-500 flex-shrink-0" />
                            <span className="flex-1 truncate">
                              {material.title || "Material sem título"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {modules.filter(m => m.title).length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Nenhum módulo criado ainda</p>
                <p className="text-xs mt-1">
                  Adicione módulos e aulas para visualizar a estrutura
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}