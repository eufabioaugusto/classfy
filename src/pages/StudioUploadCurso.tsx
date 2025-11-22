import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { 
  GraduationCap, Plus, Trash2, Video, FileText, 
  HelpCircle, ImagePlus, X
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { TagsInput } from "@/components/TagsInput";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { DraggableModule } from "@/components/course-builder/DraggableModule";
import { DraggableLesson } from "@/components/course-builder/DraggableLesson";
import { CourseStructurePreview } from "@/components/course-builder/CourseStructurePreview";
import { QuizEditor } from "@/components/course-builder/QuizEditor";

type Visibility = "free" | "pro" | "premium" | "paid";
type CourseLevel = "beginner" | "intermediate" | "advanced";
type QuestionType = "multiple" | "true-false" | "essay" | "fill-blank";

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
  description: string;
  videoFile: File | null;
  videoUrl: string;
  duration: number;
  isPreview: boolean;
  uploading: boolean;
  progress: number;
}

interface Quiz {
  id: string;
  title: string;
  description: string;
  questions: QuizQuestion[];
  passingScore: number;
  maxAttempts: number;
}

interface QuizQuestion {
  id: string;
  question: string;
  type: QuestionType;
  options: string[];
  correctAnswer: number | string;
  explanation: string;
  points: number;
}

interface Material {
  id: string;
  title: string;
  description: string;
  file: File | null;
  fileUrl: string;
  fileType: string;
  uploading: boolean;
  progress: number;
}

export default function StudioUploadCurso() {
  const { user, role, profile, loading } = useAuth();
  const navigate = useNavigate();

  // Course Info
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [thumbnailProgress, setThumbnailProgress] = useState(0);
  const [visibility, setVisibility] = useState<Visibility>("free");
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [level, setLevel] = useState<CourseLevel>("beginner");
  const [requirements, setRequirements] = useState("");
  const [whatYouLearn, setWhatYouLearn] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);

  // Modules
  const [modules, setModules] = useState<Module[]>([
    {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      lessons: [],
      quizzes: [],
      materials: []
    }
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [editingQuiz, setEditingQuiz] = useState<{ moduleId: string; quizIndex: number } | null>(null);

  // Drag and Drop Sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEndModules = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setModules((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
      toast.success("Módulo reordenado!");
    }
  };

  const handleDragEndLessons = (moduleId: string) => (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setModules((modules) =>
        modules.map((module) => {
          if (module.id === moduleId) {
            const oldIndex = module.lessons.findIndex((l) => l.id === active.id);
            const newIndex = module.lessons.findIndex((l) => l.id === over.id);
            return {
              ...module,
              lessons: arrayMove(module.lessons, oldIndex, newIndex),
            };
          }
          return module;
        })
      );
      toast.success("Aula reordenada!");
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (!user || (role !== 'creator' && role !== 'admin')) {
    return <Navigate to="/" replace />;
  }

  if (profile?.creator_status !== 'approved' && role !== 'admin') {
    return (
      <SidebarProvider defaultOpen={true}>
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col">
            <Header variant="studio" title="Criar Curso" />
            <main className="flex-1 p-6 md:p-12 flex items-center justify-center">
              <Card className="p-8 text-center max-w-md">
                <GraduationCap className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-xl font-bold mb-2">Apenas Creators podem criar cursos</h2>
                <p className="text-muted-foreground">
                  Você precisa ser um Creator aprovado para criar cursos na Classfy.
                </p>
              </Card>
            </main>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setThumbnailPreview(previewUrl);
    setThumbnailUploading(true);
    setThumbnailProgress(0);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `thumbnails/${user.id}/${Date.now()}.${fileExt}`;
      
      const progressInterval = setInterval(() => {
        setThumbnailProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      const { error } = await supabase.storage
        .from('contents')
        .upload(fileName, file);

      clearInterval(progressInterval);
      setThumbnailProgress(100);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('contents')
        .getPublicUrl(fileName);

      setThumbnailUrl(publicUrl);
      toast.success("Thumbnail enviada com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar thumbnail");
      setThumbnailPreview("");
      setThumbnailProgress(0);
    } finally {
      setThumbnailUploading(false);
    }
  };

  const handleRemoveThumbnail = () => {
    setThumbnailUrl("");
    setThumbnailPreview("");
    setThumbnailProgress(0);
  };

  const addModule = () => {
    const newModule: Module = {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      lessons: [],
      quizzes: [],
      materials: []
    };
    setModules([...modules, newModule]);
  };

  const removeModule = (moduleId: string) => {
    setModules(modules.filter(m => m.id !== moduleId));
  };

  const updateModule = (moduleId: string, field: keyof Module, value: any) => {
    setModules(modules.map(m => 
      m.id === moduleId ? { ...m, [field]: value } : m
    ));
  };

  const addLesson = (moduleId: string) => {
    const newLesson: Lesson = {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      videoFile: null,
      videoUrl: "",
      duration: 0,
      isPreview: false,
      uploading: false,
      progress: 0
    };
    
    setModules(modules.map(m => 
      m.id === moduleId ? { ...m, lessons: [...m.lessons, newLesson] } : m
    ));
  };

  const removeLesson = (moduleId: string, lessonId: string) => {
    setModules(modules.map(m => 
      m.id === moduleId 
        ? { ...m, lessons: m.lessons.filter(l => l.id !== lessonId) }
        : m
    ));
  };

  const updateLesson = (moduleId: string, lessonId: string, field: keyof Lesson, value: any) => {
    setModules(modules.map(m => 
      m.id === moduleId 
        ? { 
            ...m, 
            lessons: m.lessons.map(l => 
              l.id === lessonId ? { ...l, [field]: value } : l
            )
          }
        : m
    ));
  };

  const handleLessonVideoUpload = async (moduleId: string, lessonId: string, file: File) => {
    updateLesson(moduleId, lessonId, 'uploading', true);
    updateLesson(moduleId, lessonId, 'progress', 0);

    // Get video duration
    const video = document.createElement("video");
    const videoUrl = URL.createObjectURL(file);
    video.src = videoUrl;
    video.onloadedmetadata = () => {
      updateLesson(moduleId, lessonId, 'duration', Math.floor(video.duration));
    };

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `courses/${user.id}/${Date.now()}.${fileExt}`;
      
      const progressInterval = setInterval(() => {
        updateLesson(moduleId, lessonId, 'progress', (prev: number) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 500);

      const { error } = await supabase.storage
        .from('contents')
        .upload(fileName, file);

      clearInterval(progressInterval);
      updateLesson(moduleId, lessonId, 'progress', 100);

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('contents')
        .getPublicUrl(fileName);

      updateLesson(moduleId, lessonId, 'videoUrl', publicUrl);
      updateLesson(moduleId, lessonId, 'videoFile', file);
      toast.success("Vídeo da aula enviado!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao enviar vídeo");
      updateLesson(moduleId, lessonId, 'progress', 0);
    } finally {
      updateLesson(moduleId, lessonId, 'uploading', false);
    }
  };

  const addQuiz = (moduleId: string) => {
    const newQuiz: Quiz = {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      questions: [],
      passingScore: 70,
      maxAttempts: 3
    };
    
    setModules(modules.map(m => 
      m.id === moduleId ? { ...m, quizzes: [...m.quizzes, newQuiz] } : m
    ));

    // Open editor for the new quiz
    const module = modules.find(m => m.id === moduleId);
    if (module) {
      setEditingQuiz({ moduleId, quizIndex: module.quizzes.length });
    }
  };

  const updateQuiz = (moduleId: string, quizIndex: number, updatedQuiz: Quiz) => {
    setModules(modules.map(m => {
      if (m.id === moduleId) {
        const newQuizzes = [...m.quizzes];
        newQuizzes[quizIndex] = updatedQuiz;
        return { ...m, quizzes: newQuizzes };
      }
      return m;
    }));
  };

  const removeQuiz = (moduleId: string, quizId: string) => {
    setModules(modules.map(m => 
      m.id === moduleId 
        ? { ...m, quizzes: m.quizzes.filter(q => q.id !== quizId) }
        : m
    ));
  };

  const addMaterial = (moduleId: string) => {
    const newMaterial: Material = {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      file: null,
      fileUrl: "",
      fileType: "",
      uploading: false,
      progress: 0
    };
    
    setModules(modules.map(m => 
      m.id === moduleId ? { ...m, materials: [...m.materials, newMaterial] } : m
    ));
  };

  const removeMaterial = (moduleId: string, materialId: string) => {
    setModules(modules.map(m => 
      m.id === moduleId 
        ? { ...m, materials: m.materials.filter(mat => mat.id !== materialId) }
        : m
    ));
  };

  const handleGenerateTags = async () => {
    if (!title.trim()) {
      toast.error("Preencha o título primeiro para gerar tags");
      return;
    }

    setIsGeneratingTags(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-tags", {
        body: {
          title: title.trim(),
          description: description.trim(),
          contentType: "curso",
        },
      });

      if (error) throw error;

      if (data?.tags) {
        setTags(data.tags);
        toast.success(`${data.tags.length} tags geradas com sucesso!`);
      }
    } catch (error: any) {
      console.error("Erro ao gerar tags:", error);
      toast.error(error.message || "Erro ao gerar tags");
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title || !description || !thumbnailUrl) {
      toast.error("Preencha os campos obrigatórios do curso");
      return;
    }

    if (modules.length === 0 || !modules.some(m => m.title)) {
      toast.error("Adicione pelo menos um módulo ao curso");
      return;
    }

    setSubmitting(true);
    try {
      // Calculate totals
      const totalLessons = modules.reduce((acc, m) => acc + m.lessons.length, 0);
      const totalDuration = modules.reduce((acc, m) => 
        acc + m.lessons.reduce((sum, l) => sum + l.duration, 0), 0
      );

      // Create course
      const { data: courseData, error: courseError } = await supabase
        .from('courses')
        .insert({
          creator_id: user.id,
          title,
          description,
          thumbnail_url: thumbnailUrl,
          status: 'pending',
          visibility,
          price: visibility === 'paid' ? parseFloat(price) : 0,
          discount: visibility === 'paid' ? parseFloat(discount) : 0,
          tags: tags.length > 0 ? tags : null,
          level,
          requirements,
          what_you_learn: whatYouLearn,
          total_lessons: totalLessons,
          total_duration_seconds: totalDuration,
          views_count: 0,
          students_count: 0,
        })
        .select()
        .single();

      if (courseError) throw courseError;

      // Create modules
      for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
        const module = modules[moduleIndex];
        if (!module.title) continue;

        const { data: moduleData, error: moduleError } = await supabase
          .from('course_modules')
          .insert({
            course_id: courseData.id,
            title: module.title,
            description: module.description,
            order_index: moduleIndex,
          })
          .select()
          .single();

        if (moduleError) throw moduleError;

        // Create lessons
        for (let lessonIndex = 0; lessonIndex < module.lessons.length; lessonIndex++) {
          const lesson = module.lessons[lessonIndex];
          if (!lesson.title || !lesson.videoUrl) continue;

          const { error: lessonError } = await supabase
            .from('course_lessons')
            .insert({
              module_id: moduleData.id,
              course_id: courseData.id,
              title: lesson.title,
              description: lesson.description,
              video_url: lesson.videoUrl,
              duration_seconds: lesson.duration,
              order_index: lessonIndex,
              is_preview: lesson.isPreview,
            } as any);

          if (lessonError) throw lessonError;
        }

        // Create quizzes
        for (let quizIndex = 0; quizIndex < module.quizzes.length; quizIndex++) {
          const quiz = module.quizzes[quizIndex];
          if (!quiz.title || quiz.questions.length === 0) continue;

          const { error: quizError } = await supabase
            .from('course_quizzes')
            .insert({
              course_id: courseData.id,
              module_id: moduleData.id,
              title: quiz.title,
              description: quiz.description,
              questions: quiz.questions as any,
              passing_score: quiz.passingScore,
              max_attempts: quiz.maxAttempts,
              order_index: quizIndex,
            } as any);

          if (quizError) throw quizError;
        }

        // Create materials
        for (const material of module.materials) {
          if (!material.title || !material.fileUrl) continue;

          const { error: materialError } = await supabase
            .from('course_materials')
            .insert({
              course_id: courseData.id,
              module_id: moduleData.id,
              title: material.title,
              description: material.description,
              file_url: material.fileUrl,
              file_type: material.fileType,
            } as any);

          if (materialError) throw materialError;
        }
      }

      toast.success("Curso criado com sucesso e aguarda aprovação!");
      navigate('/studio/contents');
    } catch (error: any) {
      console.error("Erro ao criar curso:", error);
      toast.error(error.message || "Erro ao criar curso");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <Header variant="studio" title="Criar Curso" />

          <main className="flex-1 p-6 md:p-12">
            <form onSubmit={handleSubmit} className="max-w-5xl mx-auto space-y-6">
              <Tabs defaultValue="info" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="info">Informações</TabsTrigger>
                  <TabsTrigger value="modules">Módulos</TabsTrigger>
                  <TabsTrigger value="settings">Configurações</TabsTrigger>
                  <TabsTrigger value="preview">Pré-visualizar</TabsTrigger>
                </TabsList>

                {/* TAB: Informações do Curso */}
                <TabsContent value="info" className="space-y-6">
                  <Card className="p-6">
                    <h3 className="text-lg font-semibold mb-4">Informações Básicas</h3>
                    
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="title">Título do Curso *</Label>
                        <Input
                          id="title"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="Ex: Desenvolvimento Web Completo"
                          required
                        />
                      </div>

                      <div>
                        <Label htmlFor="description">Descrição *</Label>
                        <Textarea
                          id="description"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Descreva o que os alunos aprenderão neste curso..."
                          rows={4}
                          required
                        />
                      </div>

                      <div>
                        <Label>Thumbnail do Curso *</Label>
                        <div className="mt-2">
                          {!thumbnailPreview ? (
                            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors bg-muted/20">
                              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                <ImagePlus className="w-12 h-12 mb-4 text-muted-foreground" />
                                <p className="mb-2 text-sm text-muted-foreground font-medium">
                                  Enviar imagem de capa
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Recomendado: 1280x720px (16:9)
                                </p>
                              </div>
                              <input
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={handleThumbnailUpload}
                                disabled={thumbnailUploading}
                              />
                            </label>
                          ) : (
                            <div className="relative w-full h-48 rounded-lg overflow-hidden">
                              <img
                                src={thumbnailPreview}
                                alt="Thumbnail"
                                className="w-full h-full object-cover"
                              />
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                className="absolute top-2 right-2"
                                onClick={handleRemoveThumbnail}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                          {thumbnailUploading && (
                            <div className="mt-2">
                              <Progress value={thumbnailProgress} />
                              <p className="text-xs text-muted-foreground mt-1">
                                Enviando: {thumbnailProgress}%
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="level">Nível do Curso</Label>
                          <Select value={level} onValueChange={(v) => setLevel(v as CourseLevel)}>
                            <SelectTrigger id="level">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="beginner">Iniciante</SelectItem>
                              <SelectItem value="intermediate">Intermediário</SelectItem>
                              <SelectItem value="advanced">Avançado</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label htmlFor="visibility">Visibilidade</Label>
                          <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
                            <SelectTrigger id="visibility">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="free">Grátis</SelectItem>
                              <SelectItem value="pro">Pro</SelectItem>
                              <SelectItem value="premium">Premium</SelectItem>
                              <SelectItem value="paid">Pago</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {visibility === 'paid' && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="price">Preço (R$)</Label>
                            <Input
                              id="price"
                              type="number"
                              step="0.01"
                              value={price}
                              onChange={(e) => setPrice(e.target.value)}
                            />
                          </div>
                          <div>
                            <Label htmlFor="discount">Desconto (%)</Label>
                            <Input
                              id="discount"
                              type="number"
                              step="1"
                              value={discount}
                              onChange={(e) => setDiscount(e.target.value)}
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <Label htmlFor="requirements">Pré-requisitos</Label>
                        <Textarea
                          id="requirements"
                          value={requirements}
                          onChange={(e) => setRequirements(e.target.value)}
                          placeholder="O que o aluno precisa saber antes de começar?"
                          rows={3}
                        />
                      </div>

                      <div>
                        <Label htmlFor="whatYouLearn">O que você aprenderá</Label>
                        <Textarea
                          id="whatYouLearn"
                          value={whatYouLearn}
                          onChange={(e) => setWhatYouLearn(e.target.value)}
                          placeholder="Liste os principais aprendizados do curso..."
                          rows={3}
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label>Tags</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleGenerateTags}
                            disabled={isGeneratingTags || !title}
                          >
                            {isGeneratingTags ? "Gerando..." : "Gerar com IA"}
                          </Button>
                        </div>
                        <TagsInput
                          tags={tags}
                          onChange={setTags}
                          placeholder="Digite uma tag e pressione Enter"
                        />
                      </div>
                    </div>
                  </Card>
                </TabsContent>

                {/* TAB: Módulos e Conteúdo */}
                <TabsContent value="modules" className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Estrutura do Curso</h3>
                    <Button type="button" onClick={addModule}>
                      <Plus className="w-4 h-4 mr-2" />
                      Adicionar Módulo
                    </Button>
                  </div>

                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEndModules}
                  >
                    <SortableContext
                      items={modules.map(m => m.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <Accordion type="single" collapsible className="space-y-4">
                        {modules.map((module, moduleIndex) => (
                          <DraggableModule key={module.id} id={module.id}>
                            <AccordionItem value={module.id} className="border rounded-lg border-none">
                              <Card className="p-0">
                                <AccordionTrigger className="px-6 py-4 hover:no-underline">
                                  <div className="flex items-center gap-3 w-full">
                                    <div className="flex-1 text-left">
                                      <h4 className="font-semibold">
                                        {module.title || `Módulo ${moduleIndex + 1}`}
                                      </h4>
                                      <p className="text-sm text-muted-foreground">
                                        {module.lessons.length} aulas • {module.quizzes.length} quizzes • {module.materials.length} materiais
                                      </p>
                                    </div>
                                  </div>
                                </AccordionTrigger>

                          <AccordionContent className="px-6 pb-4">
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 gap-4">
                                <div>
                                  <Label>Título do Módulo *</Label>
                                  <Input
                                    value={module.title}
                                    onChange={(e) => updateModule(module.id, 'title', e.target.value)}
                                    placeholder="Ex: Introdução ao Desenvolvimento Web"
                                  />
                                </div>
                                <div>
                                  <Label>Descrição do Módulo</Label>
                                  <Textarea
                                    value={module.description}
                                    onChange={(e) => updateModule(module.id, 'description', e.target.value)}
                                    placeholder="Descreva o conteúdo deste módulo..."
                                    rows={2}
                                  />
                                </div>
                              </div>

                              <div className="border-t pt-4">
                                <div className="flex items-center justify-between mb-3">
                                  <Label className="text-base">Aulas</Label>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addLesson(module.id)}
                                  >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Adicionar Aula
                                  </Button>
                                </div>

                                {module.lessons.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">
                                    Nenhuma aula adicionada ainda
                                  </p>
                                ) : (
                                  <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEndLessons(module.id)}
                                  >
                                    <SortableContext
                                      items={module.lessons.map(l => l.id)}
                                      strategy={verticalListSortingStrategy}
                                    >
                                      <div className="space-y-3">
                                        {module.lessons.map((lesson, lessonIndex) => (
                                          <DraggableLesson key={lesson.id} id={lesson.id}>
                                            <Card className="p-4">
                                        <div className="space-y-3">
                                          <div className="flex items-start justify-between">
                                            <div className="flex-1 space-y-3">
                                              <Input
                                                value={lesson.title}
                                                onChange={(e) => updateLesson(module.id, lesson.id, 'title', e.target.value)}
                                                placeholder={`Aula ${lessonIndex + 1} - Título`}
                                              />
                                              <Textarea
                                                value={lesson.description}
                                                onChange={(e) => updateLesson(module.id, lesson.id, 'description', e.target.value)}
                                                placeholder="Descrição da aula"
                                                rows={2}
                                              />
                                            </div>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              onClick={() => removeLesson(module.id, lesson.id)}
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </Button>
                                          </div>

                                          {!lesson.videoUrl ? (
                                            <label className="flex items-center justify-center w-full h-24 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors">
                                              <div className="flex items-center gap-2">
                                                <Video className="w-5 h-5 text-muted-foreground" />
                                                <span className="text-sm text-muted-foreground">
                                                  Enviar vídeo da aula
                                                </span>
                                              </div>
                                              <input
                                                type="file"
                                                className="hidden"
                                                accept="video/*"
                                                onChange={(e) => {
                                                  const file = e.target.files?.[0];
                                                  if (file) handleLessonVideoUpload(module.id, lesson.id, file);
                                                }}
                                                disabled={lesson.uploading}
                                              />
                                            </label>
                                          ) : (
                                            <div className="flex items-center gap-2 p-2 bg-muted rounded-lg">
                                              <Video className="w-4 h-4 text-primary" />
                                              <span className="text-sm flex-1">Vídeo enviado ({lesson.duration}s)</span>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                  updateLesson(module.id, lesson.id, 'videoUrl', '');
                                                  updateLesson(module.id, lesson.id, 'videoFile', null);
                                                }}
                                              >
                                                <X className="w-4 h-4" />
                                              </Button>
                                            </div>
                                          )}

                                          {lesson.uploading && (
                                            <div>
                                              <Progress value={lesson.progress} />
                                              <p className="text-xs text-muted-foreground mt-1">
                                                Enviando: {lesson.progress}%
                                              </p>
                                            </div>
                                          )}

                                          <div className="flex items-center gap-2">
                                            <input
                                              type="checkbox"
                                              id={`preview-${lesson.id}`}
                                              checked={lesson.isPreview}
                                              onChange={(e) => updateLesson(module.id, lesson.id, 'isPreview', e.target.checked)}
                                              className="rounded"
                                            />
                                            <Label htmlFor={`preview-${lesson.id}`} className="text-sm cursor-pointer">
                                              Aula de pré-visualização (gratuita para todos)
                                            </Label>
                                          </div>
                                            </div>
                                          </Card>
                                        </DraggableLesson>
                                      ))}
                                    </div>
                                  </SortableContext>
                                </DndContext>
                              )}
                            </div>

                              <div className="border-t pt-4">
                                <div className="flex items-center justify-between mb-3">
                                  <Label className="text-base">Quizzes</Label>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addQuiz(module.id)}
                                  >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Adicionar Quiz
                                  </Button>
                                </div>

                                {module.quizzes.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">
                                    Nenhum quiz adicionado ainda
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    {module.quizzes.map((quiz, quizIndex) => (
                                      <Card key={quiz.id} className="p-4 hover:border-primary transition-colors">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-3 flex-1">
                                            <HelpCircle className="w-4 h-4 text-purple-500" />
                                            <div className="flex-1">
                                              <p className="text-sm font-medium">
                                                {quiz.title || "Quiz sem título"}
                                              </p>
                                              <p className="text-xs text-muted-foreground">
                                                {quiz.questions.length} questões • {quiz.passingScore}% para aprovação
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              onClick={() => setEditingQuiz({ moduleId: module.id, quizIndex })}
                                            >
                                              Editar
                                            </Button>
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="icon"
                                              onClick={() => removeQuiz(module.id, quiz.id)}
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        </div>
                                      </Card>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="border-t pt-4">
                                <div className="flex items-center justify-between mb-3">
                                  <Label className="text-base">Materiais de Apoio</Label>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addMaterial(module.id)}
                                  >
                                    <Plus className="w-4 h-4 mr-2" />
                                    Adicionar Material
                                  </Button>
                                </div>

                                {module.materials.length === 0 ? (
                                  <p className="text-sm text-muted-foreground text-center py-4">
                                    Nenhum material adicionado ainda
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    {module.materials.map((material) => (
                                      <Card key={material.id} className="p-4">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 text-primary" />
                                            <span className="text-sm">
                                              {material.title || "Material sem título"}
                                            </span>
                                          </div>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => removeMaterial(module.id, material.id)}
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </Button>
                                        </div>
                                      </Card>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-end pt-2">
                                <Button
                                  type="button"
                                  variant="destructive"
                                  onClick={() => removeModule(module.id)}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Remover Módulo
                                </Button>
                              </div>
                            </div>
                          </AccordionContent>
                              </Card>
                            </AccordionItem>
                          </DraggableModule>
                        ))}
                      </Accordion>
                    </SortableContext>
                  </DndContext>
                </TabsContent>

                {/* TAB: Configurações */}
                <TabsContent value="settings">
                  <Card className="p-6">
                    <h3 className="text-lg font-semibold mb-4">Configurações do Curso</h3>
                    <p className="text-sm text-muted-foreground">
                      Opções adicionais serão adicionadas em breve.
                    </p>
                  </Card>
                </TabsContent>

                {/* TAB: Pré-visualizar */}
                <TabsContent value="preview" className="space-y-6">
                  <Card className="p-6">
                    <h3 className="text-lg font-semibold mb-4">Prévia do Curso</h3>
                    <div className="space-y-4">
                      {thumbnailPreview && (
                        <img
                          src={thumbnailPreview}
                          alt={title}
                          className="w-full h-64 object-cover rounded-lg"
                        />
                      )}
                      <h2 className="text-2xl font-bold">{title || "Título do Curso"}</h2>
                      <p className="text-muted-foreground">{description || "Descrição do curso..."}</p>
                      
                      {requirements && (
                        <div>
                          <h4 className="font-semibold mb-2">Pré-requisitos</h4>
                          <p className="text-sm text-muted-foreground">{requirements}</p>
                        </div>
                      )}

                      {whatYouLearn && (
                        <div>
                          <h4 className="font-semibold mb-2">O que você aprenderá</h4>
                          <p className="text-sm text-muted-foreground">{whatYouLearn}</p>
                        </div>
                      )}

                      {tags.length > 0 && (
                        <div>
                          <h4 className="font-semibold mb-2">Tags</h4>
                          <div className="flex flex-wrap gap-2">
                            {tags.map((tag, index) => (
                              <span
                                key={index}
                                className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>

                  <CourseStructurePreview modules={modules} />
                </TabsContent>
              </Tabs>

              <div className="flex items-center justify-between pt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/studio/contents')}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Publicando..." : "Publicar Curso"}
                </Button>
              </div>
            </form>
          </main>
        </div>
      </div>

      {/* Quiz Editor Modal */}
      {editingQuiz && (() => {
        const module = modules.find(m => m.id === editingQuiz.moduleId);
        const quiz = module?.quizzes[editingQuiz.quizIndex];
        return quiz ? (
          <QuizEditor
            quiz={quiz}
            onUpdate={(updatedQuiz) => {
              updateQuiz(editingQuiz.moduleId, editingQuiz.quizIndex, updatedQuiz);
              setEditingQuiz(null);
            }}
            onClose={() => setEditingQuiz(null)}
          />
        ) : null;
      })()}
    </SidebarProvider>
  );
}