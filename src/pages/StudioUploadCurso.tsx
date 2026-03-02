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
  HelpCircle, ImagePlus, X, GripVertical
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
import { DraggableModuleWrapper } from "@/components/course-builder/DraggableModule";
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

  // Course Settings
  const [issueCertificate, setIssueCertificate] = useState(true);
  const [accessType, setAccessType] = useState<"lifetime" | "limited">("lifetime");
  const [accessDays, setAccessDays] = useState("365");
  const [lessonOrder, setLessonOrder] = useState<"sequential" | "free">("free");
  const [allowComments, setAllowComments] = useState(true);
  const [allowReviews, setAllowReviews] = useState(true);
  const [allowDownloads, setAllowDownloads] = useState(true);

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
    setModules(prevModules => prevModules.filter(m => m.id !== moduleId));
  };

  const updateModule = (moduleId: string, field: keyof Module, value: any) => {
    setModules(prevModules => prevModules.map(m => 
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
    
    setModules(prevModules => prevModules.map(m => 
      m.id === moduleId ? { ...m, lessons: [...m.lessons, newLesson] } : m
    ));
  };

  const removeLesson = (moduleId: string, lessonId: string) => {
    setModules(prevModules => prevModules.map(m => 
      m.id === moduleId 
        ? { ...m, lessons: m.lessons.filter(l => l.id !== lessonId) }
        : m
    ));
  };

  const updateLesson = (moduleId: string, lessonId: string, field: keyof Lesson, value: any) => {
    setModules(prevModules => prevModules.map(m => 
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
    try {
      // Validate video size (max 500MB)
      const maxSize = 500 * 1024 * 1024;
      if (file.size > maxSize) {
        throw new Error("O vídeo é muito grande. Tamanho máximo: 500MB");
      }

      // Validate video format
      const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
      if (!allowedTypes.includes(file.type)) {
        throw new Error("Formato inválido. Use MP4, WebM ou MOV");
      }

      updateLesson(moduleId, lessonId, 'uploading', true);
      updateLesson(moduleId, lessonId, 'progress', 0);

      // Get video duration
      const videoDurationPromise = new Promise<number>((resolve) => {
        const video = document.createElement("video");
        const videoUrl = URL.createObjectURL(file);
        video.src = videoUrl;
        video.onloadedmetadata = () => {
          resolve(Math.floor(video.duration));
          URL.revokeObjectURL(videoUrl);
        };
        video.onerror = () => {
          URL.revokeObjectURL(videoUrl);
          resolve(0);
        };
      });

      // Compress video if needed (client-side FFmpeg.wasm)
      let fileToUpload = file;
      try {
        const { shouldCompress: checkCompress } = await import('@/hooks/useVideoCompression').then(() => {
          // We can't use the hook here directly, so do inline check
          return { shouldCompress: file.size > 50 * 1024 * 1024 };
        });

        if (checkCompress) {
          updateLesson(moduleId, lessonId, 'progress', 5);
          // Use FFmpeg for large files - import dynamically
          const { FFmpeg } = await import('@ffmpeg/ffmpeg');
          const { fetchFile, toBlobURL } = await import('@ffmpeg/util');

          const ffmpeg = new FFmpeg();
          ffmpeg.on('progress', ({ progress }) => {
            const percent = Math.min(Math.round(progress * 60), 60); // 0-60% for compression
            updateLesson(moduleId, lessonId, 'progress', percent);
          });

          const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
          await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          });

          const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
          await ffmpeg.writeFile(inputName, await fetchFile(file));

          await ffmpeg.exec([
            '-i', inputName,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '28',
            '-vf', 'scale=min(1920\\,iw):min(1080\\,ih):force_original_aspect_ratio=decrease',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart', '-y', 'output.mp4'
          ]);

          const rawData = await ffmpeg.readFile('output.mp4');
          const uint8 = rawData instanceof Uint8Array ? rawData : new TextEncoder().encode(rawData as string);
          const copy = new Uint8Array(uint8.length);
          copy.set(uint8);
          const blob = new Blob([copy], { type: 'video/mp4' });
          fileToUpload = new File([blob], file.name.replace(/\.[^/.]+$/, '.mp4'), { type: 'video/mp4' });

          await ffmpeg.deleteFile(inputName);
          await ffmpeg.deleteFile('output.mp4');

          const ratio = ((file.size - fileToUpload.size) / file.size) * 100;
          if (ratio > 5) {
            toast.success(`Vídeo comprimido ${ratio.toFixed(0)}%`);
          }
        }
      } catch (compressionError) {
        console.warn('Compression failed, using original file:', compressionError);
        fileToUpload = file;
      }

      // Upload with real XHR progress
      const fileExt = fileToUpload.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { data: session } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const uploadUrl = `${supabaseUrl}/storage/v1/object/courses/${fileName}`;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            // Upload progress mapped to 60-95%
            const uploadPercent = Math.round((event.loaded / event.total) * 35) + 60;
            updateLesson(moduleId, lessonId, 'progress', Math.min(uploadPercent, 95));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

        xhr.open('POST', uploadUrl);
        xhr.setRequestHeader('Authorization', `Bearer ${session?.session?.access_token}`);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.send(fileToUpload);
      });

      const { data: { publicUrl } } = supabase.storage
        .from('courses')
        .getPublicUrl(fileName);

      const videoDuration = await videoDurationPromise;
      updateLesson(moduleId, lessonId, 'duration', videoDuration);
      updateLesson(moduleId, lessonId, 'progress', 100);
      updateLesson(moduleId, lessonId, 'videoUrl', publicUrl);
      updateLesson(moduleId, lessonId, 'videoFile', fileToUpload);
      
      toast.success("Vídeo da aula enviado com sucesso!");
    } catch (error: any) {
      console.error("Erro ao enviar vídeo:", error);
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
    
    setModules(prevModules => {
      const updatedModules = prevModules.map(m => 
        m.id === moduleId ? { ...m, quizzes: [...m.quizzes, newQuiz] } : m
      );
      
      // Encontra o módulo atualizado e abre o editor
      const module = updatedModules.find(m => m.id === moduleId);
      if (module) {
        setEditingQuiz({ moduleId, quizIndex: module.quizzes.length - 1 });
      }
      
      return updatedModules;
    });
  };

  const updateQuiz = (moduleId: string, quizIndex: number, updatedQuiz: Quiz) => {
    setModules(prevModules => prevModules.map(m => {
      if (m.id === moduleId) {
        const newQuizzes = [...m.quizzes];
        newQuizzes[quizIndex] = updatedQuiz;
        return { ...m, quizzes: newQuizzes };
      }
      return m;
    }));
  };

  const removeQuiz = (moduleId: string, quizId: string) => {
    setModules(prevModules => prevModules.map(m => 
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
    
    setModules(prevModules => prevModules.map(m => 
      m.id === moduleId ? { ...m, materials: [...m.materials, newMaterial] } : m
    ));
  };

  const removeMaterial = (moduleId: string, materialId: string) => {
    setModules(prevModules => prevModules.map(m => 
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

      // Cleanup orphaned course if it was created but modules/lessons failed
      if (error && modules.length > 0) {
        try {
          const { data: orphanCourse } = await supabase
            .from('courses')
            .select('id')
            .eq('creator_id', user.id)
            .eq('title', title)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (orphanCourse) {
            // Delete cascade: lessons, modules, quizzes, materials reference course_id
            await supabase.from('course_lessons').delete().eq('course_id', orphanCourse.id);
            await supabase.from('course_quizzes').delete().eq('course_id', orphanCourse.id);
            await supabase.from('course_materials').delete().eq('course_id', orphanCourse.id);
            await supabase.from('course_modules').delete().eq('course_id', orphanCourse.id);
            await supabase.from('courses').delete().eq('id', orphanCourse.id);
            console.log('Cleaned up orphaned course:', orphanCourse.id);
          }
        } catch (cleanupError) {
          console.error('Cleanup failed:', cleanupError);
        }
      }
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
                          <AccordionItem
                            key={module.id}
                            value={module.id}
                            className="border rounded-lg border-none"
                          >
                            <DraggableModuleWrapper id={module.id}>
                              {({ ref, style, isDragging, handleProps }) => (
                                <Card
                                  ref={ref}
                                  style={{
                                    ...style,
                                    opacity: isDragging ? 0.5 : 1,
                                  }}
                                  className="p-0"
                                >
                                  <AccordionTrigger className="px-6 py-4 hover:no-underline">
                                    <div className="flex items-center gap-3 w-full">
                                      <div
                                        {...handleProps}
                                        className="cursor-grab active:cursor-grabbing p-1 hover:bg-accent rounded transition-colors"
                                      >
                                        <GripVertical className="w-5 h-5 text-muted-foreground" />
                                      </div>
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
                                      {/* Informações do Módulo */}
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

                                      {/* Aulas */}
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
                                                          <div className="flex items-start justify-between gap-4">
                                                            {/* Coluna da esquerda: Campos de texto - 50% */}
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
                                                                rows={3}
                                                              />
                                                            </div>

                                                            {/* Coluna da direita: Upload de vídeo - 50% */}
                                                            <div className="flex-1 flex flex-col gap-2">
                                                              {!lesson.videoUrl ? (
                                                                <label className="flex flex-col items-center justify-center h-full min-h-[120px] border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary transition-colors">
                                                                  <Video className="w-8 h-8 text-muted-foreground mb-2" />
                                                                  <span className="text-xs text-muted-foreground text-center px-2">
                                                                    Enviar vídeo da aula
                                                                  </span>
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
                                                                <div className="space-y-2">
                                                                  <div className="border rounded-lg overflow-hidden bg-muted">
                                                                    <video
                                                                      src={lesson.videoUrl}
                                                                      className="w-full aspect-video object-cover"
                                                                      controls
                                                                    />
                                                                  </div>
                                                                  <div className="flex items-center justify-between px-2">
                                                                    <div className="flex items-center gap-2">
                                                                      <Video className="w-4 h-4 text-primary" />
                                                                      <span className="text-xs text-muted-foreground">
                                                                        {lesson.duration ? `${lesson.duration}s` : 'Vídeo enviado'}
                                                                      </span>
                                                                    </div>
                                                                    <Button
                                                                      type="button"
                                                                      variant="ghost"
                                                                      size="sm"
                                                                      onClick={() => {
                                                                        updateLesson(module.id, lesson.id, 'videoUrl', '');
                                                                        updateLesson(module.id, lesson.id, 'videoFile', null);
                                                                      }}
                                                                    >
                                                                      <X className="w-4 h-4 mr-1" />
                                                                      Trocar
                                                                    </Button>
                                                                  </div>
                                                                </div>
                                                              )}

                                                              {lesson.uploading && (
                                                                <div className="mt-2">
                                                                  <Progress value={lesson.progress} />
                                                                  <p className="text-xs text-muted-foreground mt-1 text-center">
                                                                    {lesson.progress}%
                                                                  </p>
                                                                </div>
                                                              )}
                                                            </div>

                                                            {/* Botão de remover aula */}
                                                            <Button
                                                              type="button"
                                                              variant="ghost"
                                                              size="icon"
                                                              onClick={() => removeLesson(module.id, lesson.id)}
                                                            >
                                                              <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                          </div>

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

                                      {/* Quizzes */}
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

                                      {/* Materiais */}
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

                                      {/* Botão Remover Módulo */}
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
                              )}
                            </DraggableModuleWrapper>
                          </AccordionItem>
                        ))}
                        </Accordion>
                    </SortableContext>
                  </DndContext>
                </TabsContent>

                {/* TAB: Configurações */}
                <TabsContent value="settings" className="space-y-6">
                  <Card className="p-6">
                    <h3 className="text-lg font-semibold mb-6">Configurações do Curso</h3>
                    
                    <div className="space-y-6">
                      {/* Certificado */}
                      <div className="space-y-3">
                        <Label className="text-base font-semibold">Certificado</Label>
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Emitir certificado de conclusão</p>
                            <p className="text-sm text-muted-foreground">
                              Os alunos receberão um certificado ao completar o curso
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={issueCertificate}
                            onChange={(e) => setIssueCertificate(e.target.checked)}
                            className="w-5 h-5 rounded"
                          />
                        </div>
                      </div>

                      {/* Tipo de Acesso */}
                      <div className="space-y-3">
                        <Label className="text-base font-semibold">Tipo de Acesso</Label>
                        <Select value={accessType} onValueChange={(v: "lifetime" | "limited") => setAccessType(v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lifetime">Acesso Vitalício</SelectItem>
                            <SelectItem value="limited">Acesso Limitado</SelectItem>
                          </SelectContent>
                        </Select>
                        {accessType === "limited" && (
                          <div className="mt-3">
                            <Label htmlFor="accessDays">Dias de acesso após matrícula</Label>
                            <Input
                              id="accessDays"
                              type="number"
                              min="1"
                              value={accessDays}
                              onChange={(e) => setAccessDays(e.target.value)}
                              placeholder="365"
                            />
                          </div>
                        )}
                      </div>

                      {/* Ordem das Aulas */}
                      <div className="space-y-3">
                        <Label className="text-base font-semibold">Ordem das Aulas</Label>
                        <Select value={lessonOrder} onValueChange={(v: "sequential" | "free") => setLessonOrder(v)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="free">Livre - Alunos podem assistir em qualquer ordem</SelectItem>
                            <SelectItem value="sequential">Sequencial - Deve seguir a ordem do curso</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Interações */}
                      <div className="space-y-3">
                        <Label className="text-base font-semibold">Interações</Label>
                        
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Permitir comentários</p>
                            <p className="text-sm text-muted-foreground">
                              Alunos podem comentar nas aulas
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={allowComments}
                            onChange={(e) => setAllowComments(e.target.checked)}
                            className="w-5 h-5 rounded"
                          />
                        </div>

                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Permitir avaliações</p>
                            <p className="text-sm text-muted-foreground">
                              Alunos podem avaliar o curso
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={allowReviews}
                            onChange={(e) => setAllowReviews(e.target.checked)}
                            className="w-5 h-5 rounded"
                          />
                        </div>
                      </div>

                      {/* Downloads */}
                      <div className="space-y-3">
                        <Label className="text-base font-semibold">Downloads</Label>
                        <div className="flex items-center justify-between p-4 border rounded-lg">
                          <div>
                            <p className="font-medium">Permitir download de materiais</p>
                            <p className="text-sm text-muted-foreground">
                              Alunos podem baixar os materiais de apoio
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={allowDownloads}
                            onChange={(e) => setAllowDownloads(e.target.checked)}
                            className="w-5 h-5 rounded"
                          />
                        </div>
                      </div>
                    </div>
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