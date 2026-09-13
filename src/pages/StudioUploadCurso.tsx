import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  BookOpen,
  Check,
  CircleAlert,
  Cloud,
  CloudOff,
  Eye,
  File,
  FileAudio,
  FileText,
  FileVideo,
  GripVertical,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Plus,
  Save,
  Send,
  Settings2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import {
  V2Badge,
  V2Button,
  V2Card,
  V2CardContent,
  V2CardHeader,
  V2Input,
  V2Textarea,
} from "@/components/v2";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { QuizEditor } from "@/components/course-builder/QuizEditor";
import { TagsInput } from "@/components/TagsInput";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { usePublicationDraft } from "@/hooks/usePublicationDraft";
import { useVideoCompression } from "@/hooks/useVideoCompression";
import { compressImage } from "@/utils/imageCompression";
import {
  createNewPublicationDraftKey,
  isPersistedPublicationDraft,
  isNewPublicationDraftKey,
  visibilityOptions,
  type PublicationVisibility,
} from "@/lib/studio/publication";
import {
  emptyCourseLesson,
  emptyCourseMaterial,
  emptyCourseModule,
  emptyCourseQuiz,
  getCourseDraftIssues,
  type CourseLessonDraft,
  type CourseModuleDraft,
  type CoursePublicationDraft,
  type CourseQuizDraft,
} from "@/lib/studio/course";
import { toast } from "sonner";
import "@/styles/studio-v2.css";
import "@/styles/studio-publish-v2.css";

type Selection =
  | { type: "course" }
  | { type: "module"; moduleId: string }
  | { type: "lesson" | "quiz" | "material"; moduleId: string; itemId: string };

function SortableItem({
  id,
  active,
  children,
  onClick,
}: {
  id: string;
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      type="button"
      className="course-outline-item"
      data-active={active || undefined}
      data-dragging={isDragging || undefined}
      onClick={onClick}
    >
      <span className="course-outline-grip" {...attributes} {...listeners}>
        <GripVertical />
      </span>
      {children}
    </button>
  );
}

const formatDuration = (seconds: number) =>
  seconds
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
    : "Sem duração";

function StudioUploadCurso() {
  const { user, role, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const [sourceLoaded, setSourceLoaded] = useState(!editId);
  const [originalStatus, setOriginalStatus] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ type: "course" });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [materialUploading, setMaterialUploading] = useState<string | null>(
    null,
  );
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [thumbnailPreview, setThumbnailPreview] = useState("");
  const [visibility, setVisibility] = useState<PublicationVisibility>("free");
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [level, setLevel] =
    useState<CoursePublicationDraft["level"]>("beginner");
  const [requirements, setRequirements] = useState("");
  const [whatYouLearn, setWhatYouLearn] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [issueCertificate, setIssueCertificate] = useState(true);
  const [accessType, setAccessType] =
    useState<CoursePublicationDraft["accessType"]>("lifetime");
  const [accessDays, setAccessDays] = useState("365");
  const [lessonOrder, setLessonOrder] =
    useState<CoursePublicationDraft["lessonOrder"]>("free");
  const [allowComments, setAllowComments] = useState(true);
  const [allowReviews, setAllowReviews] = useState(true);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [modules, setModules] = useState<CourseModuleDraft[]>([
    emptyCourseModule(),
  ]);
  const activeLessonUploadRef = useRef<{
    moduleId: string;
    lessonId: string;
  } | null>(null);
  const temporaryFileUrlsRef = useRef(new Set<string>());
  const mediaUpload = useMediaUpload();
  const compression = useVideoCompression();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const payload = useMemo<CoursePublicationDraft>(
    () => ({
      title,
      description,
      thumbnailUrl,
      visibility,
      price,
      discount,
      level,
      requirements,
      whatYouLearn,
      tags,
      issueCertificate,
      accessType,
      accessDays,
      lessonOrder,
      allowComments,
      allowReviews,
      allowDownloads,
      modules,
    }),
    [
      accessDays,
      accessType,
      allowComments,
      allowDownloads,
      allowReviews,
      description,
      discount,
      issueCertificate,
      lessonOrder,
      level,
      modules,
      price,
      requirements,
      tags,
      thumbnailUrl,
      title,
      visibility,
      whatYouLearn,
    ],
  );

  const restoreDraft = useCallback((saved: CoursePublicationDraft) => {
    setTitle(saved.title ?? "");
    setDescription(saved.description ?? "");
    setThumbnailUrl(saved.thumbnailUrl ?? "");
    setThumbnailPreview(saved.thumbnailUrl ?? "");
    setVisibility(saved.visibility ?? "free");
    setPrice(saved.price ?? "0");
    setDiscount(saved.discount ?? "0");
    setLevel(saved.level ?? "beginner");
    setRequirements(saved.requirements ?? "");
    setWhatYouLearn(saved.whatYouLearn ?? "");
    setTags(saved.tags ?? []);
    setIssueCertificate(saved.issueCertificate ?? true);
    setAccessType(saved.accessType ?? "lifetime");
    setAccessDays(saved.accessDays ?? "365");
    setLessonOrder(saved.lessonOrder ?? "free");
    setAllowComments(saved.allowComments ?? true);
    setAllowReviews(saved.allowReviews ?? true);
    setAllowDownloads(saved.allowDownloads ?? true);
    setModules(saved.modules?.length ? saved.modules : [emptyCourseModule()]);
  }, []);

  const requestedDraftKey = searchParams.get("draft");
  const canResumeRequestedDraft =
    !editId && isNewPublicationDraftKey("curso", requestedDraftKey);
  const [generatedDraftKey] = useState(() =>
    createNewPublicationDraftKey("curso"),
  );

  const draftKey = editId
    ? `curso:edit:${editId}`
    : canResumeRequestedDraft
      ? requestedDraftKey!
      : generatedDraftKey;

  useEffect(() => {
    if (editId || canResumeRequestedDraft) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("draft", generatedDraftKey);
    setSearchParams(nextParams, { replace: true });
  }, [
    canResumeRequestedDraft,
    editId,
    generatedDraftKey,
    searchParams,
    setSearchParams,
  ]);

  const draft = usePublicationDraft({
    userId: user?.id,
    draftKey,
    kind: "curso",
    sourceType: editId ? "course" : null,
    sourceId: editId,
    payload,
    enabled: sourceLoaded,
    onRestore: restoreDraft,
  });

  useEffect(() => {
    if (!editId || !user) return;
    let cancelled = false;
    (async () => {
      const client = supabase as any;
      const { data: course, error } = await client
        .from("courses")
        .select("*")
        .eq("id", editId)
        .eq("creator_id", user.id)
        .single();
      if (cancelled) return;
      if (error || !course) {
        toast.error("Não foi possível abrir este curso.");
        navigate("/studio/contents", { replace: true });
        return;
      }
      const { data: moduleRows } = await client
        .from("course_modules")
        .select("*")
        .eq("course_id", editId)
        .order("order_index");
      const moduleIds = (moduleRows ?? []).map((row: any) => row.id);
      const [lessonsResult, quizzesResult, materialsResult] = moduleIds.length
        ? await Promise.all([
            client
              .from("course_lessons")
              .select("*")
              .in("module_id", moduleIds)
              .order("order_index"),
            client
              .from("course_quizzes")
              .select("*")
              .in("module_id", moduleIds)
              .order("order_index"),
            client
              .from("course_materials")
              .select("*")
              .in("module_id", moduleIds)
              .order("created_at"),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }];
      const mapped: CourseModuleDraft[] = (moduleRows ?? []).map(
        (module: any) => ({
          id: module.id,
          title: module.title,
          description: module.description ?? "",
          lessons: (lessonsResult.data ?? [])
            .filter((item: any) => item.module_id === module.id)
            .map((item: any) => ({
              id: item.id,
              title: item.title,
              description: item.description ?? "",
              lessonType: item.lesson_type ?? "video",
              body: item.body ?? "",
              fileUrl: item.video_url ?? "",
              mediaAssetId: item.media_asset_id ?? null,
              videoProvider: null,
              duration: item.duration_seconds ?? 0,
              isPreview: item.is_preview ?? false,
              uploadState:
                item.lesson_type === "text" || item.media_asset_id
                  ? "ready"
                  : "idle",
            })),
          quizzes: (quizzesResult.data ?? [])
            .filter((item: any) => item.module_id === module.id)
            .map((item: any) => ({
              id: item.id,
              title: item.title,
              description: item.description ?? "",
              questions: item.questions ?? [],
              passingScore: item.passing_score ?? 70,
              maxAttempts: item.max_attempts ?? 3,
            })),
          materials: (materialsResult.data ?? [])
            .filter((item: any) => item.module_id === module.id)
            .map((item: any) => ({
              id: item.id,
              title: item.title,
              description: item.description ?? "",
              fileUrl: item.file_url,
              fileType: item.file_type,
              fileSize: item.file_size ?? 0,
            })),
        }),
      );
      const restored: CoursePublicationDraft = {
        title: course.title,
        description: course.description ?? "",
        thumbnailUrl: course.thumbnail_url ?? "",
        visibility: course.visibility ?? "free",
        price: String(course.price ?? 0),
        discount: String(course.discount ?? 0),
        level: course.level ?? "beginner",
        requirements: course.requirements ?? "",
        whatYouLearn: course.what_you_learn ?? "",
        tags: course.tags ?? [],
        issueCertificate: course.issue_certificate ?? true,
        accessType: course.access_type ?? "lifetime",
        accessDays: String(course.access_days ?? 365),
        lessonOrder: course.lesson_order ?? "free",
        allowComments: course.allow_comments ?? true,
        allowReviews: course.allow_reviews ?? true,
        allowDownloads: course.allow_downloads ?? true,
        modules: mapped.length ? mapped : [emptyCourseModule()],
      };
      setOriginalStatus(course.status);
      restoreDraft(restored);
      setSourceLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [editId, navigate, restoreDraft, user]);

  useEffect(() => {
    const target = activeLessonUploadRef.current;
    if (!target) return;
    setModules((current) =>
      current.map((module) =>
        module.id !== target.moduleId
          ? module
          : {
              ...module,
              lessons: module.lessons.map((lesson) =>
                lesson.id === target.lessonId
                  ? { ...lesson, uploadState: mediaUpload.state }
                  : lesson,
              ),
            },
      ),
    );
    if (["ready", "failed", "cancelled"].includes(mediaUpload.state))
      activeLessonUploadRef.current = null;
  }, [mediaUpload.state]);

  const updateModule = (
    moduleId: string,
    updater: (module: CourseModuleDraft) => CourseModuleDraft,
  ) =>
    setModules((current) =>
      current.map((module) =>
        module.id === moduleId ? updater(module) : module,
      ),
    );
  const selectedModule =
    "moduleId" in selection
      ? modules.find((module) => module.id === selection.moduleId)
      : undefined;
  const selectedLesson =
    selection.type === "lesson"
      ? selectedModule?.lessons.find((item) => item.id === selection.itemId)
      : undefined;
  const selectedQuiz =
    selection.type === "quiz"
      ? selectedModule?.quizzes.find((item) => item.id === selection.itemId)
      : undefined;
  const selectedMaterial =
    selection.type === "material"
      ? selectedModule?.materials.find((item) => item.id === selection.itemId)
      : undefined;

  const addModule = () => {
    const module = emptyCourseModule();
    setModules((items) => [...items, module]);
    setSelection({ type: "module", moduleId: module.id });
  };
  const addLesson = (moduleId: string) => {
    const lesson = emptyCourseLesson();
    updateModule(moduleId, (module) => ({
      ...module,
      lessons: [...module.lessons, lesson],
    }));
    setSelection({ type: "lesson", moduleId, itemId: lesson.id });
  };
  const addQuiz = (moduleId: string) => {
    const quiz = emptyCourseQuiz();
    updateModule(moduleId, (module) => ({
      ...module,
      quizzes: [...module.quizzes, quiz],
    }));
    setSelection({ type: "quiz", moduleId, itemId: quiz.id });
  };
  const addMaterial = (moduleId: string) => {
    const material = emptyCourseMaterial();
    updateModule(moduleId, (module) => ({
      ...module,
      materials: [...module.materials, material],
    }));
    setSelection({ type: "material", moduleId, itemId: material.id });
  };
  const abandonAsset = (assetId?: string | null) => {
    if (assetId)
      void (supabase as any).rpc("abandon_media_asset", {
        p_media_asset_id: assetId,
      });
  };
  const removeStoredCourseFile = async (url?: string) => {
    if (!url || !user) return;
    const marker = "/storage/v1/object/public/courses/";
    const index = url.indexOf(marker);
    if (index < 0) return;
    const objectPath = decodeURIComponent(url.slice(index + marker.length));
    const { data: fileRecord } = await supabase
      .from("publication_draft_files")
      .select("id")
      .eq("owner_id", user.id)
      .eq("bucket", "courses")
      .eq("object_path", objectPath)
      .eq("state", "draft")
      .maybeSingle();
    if (!fileRecord && !temporaryFileUrlsRef.current.has(url)) return;
    temporaryFileUrlsRef.current.delete(url);
    await supabase.storage.from("courses").remove([objectPath]);
    if (fileRecord)
      await supabase
        .from("publication_draft_files")
        .update({ state: "deleted", updated_at: new Date().toISOString() })
        .eq("id", fileRecord.id);
  };
  const removeModule = (moduleId: string) => {
    const removed = modules.find((item) => item.id === moduleId);
    removed?.lessons.forEach((lesson) => abandonAsset(lesson.mediaAssetId));
    removed?.materials.forEach(
      (material) => void removeStoredCourseFile(material.fileUrl),
    );
    setModules((items) => items.filter((item) => item.id !== moduleId));
    setSelection({ type: "course" });
  };
  const removeItem = (
    moduleId: string,
    type: "lesson" | "quiz" | "material",
    itemId: string,
  ) => {
    const module = modules.find((item) => item.id === moduleId);
    if (type === "lesson")
      abandonAsset(
        module?.lessons.find((item) => item.id === itemId)?.mediaAssetId,
      );
    if (type === "material")
      void removeStoredCourseFile(
        module?.materials.find((item) => item.id === itemId)?.fileUrl,
      );
    updateModule(moduleId, (current) =>
      type === "lesson"
        ? {
            ...current,
            lessons: current.lessons.filter((item) => item.id !== itemId),
          }
        : type === "quiz"
          ? {
              ...current,
              quizzes: current.quizzes.filter((item) => item.id !== itemId),
            }
          : {
              ...current,
              materials: current.materials.filter((item) => item.id !== itemId),
            },
    );
    setSelection({ type: "module", moduleId });
  };

  const handleModuleDrag = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setModules((items) =>
      arrayMove(
        items,
        items.findIndex((item) => item.id === active.id),
        items.findIndex((item) => item.id === over.id),
      ),
    );
  };
  const handleLessonDrag =
    (moduleId: string) =>
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      updateModule(moduleId, (module) => ({
        ...module,
        lessons: arrayMove(
          module.lessons,
          module.lessons.findIndex((item) => item.id === active.id),
          module.lessons.findIndex((item) => item.id === over.id),
        ),
      }));
    };

  const uploadCover = async (file: File) => {
    if (!user) return;
    setThumbnailUploading(true);
    setThumbnailPreview(URL.createObjectURL(file));
    try {
      const compressed = await compressImage(file, 1600, 900, 0.85);
      const extension = compressed.name.split(".").pop() || "jpg";
      const path = `covers/${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from("courses")
        .upload(path, compressed, { cacheControl: "31536000" });
      if (error) throw error;
      const { data } = supabase.storage.from("courses").getPublicUrl(path);
      setThumbnailUrl(data.publicUrl);
      toast.success("Capa pronta.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a capa.",
      );
    } finally {
      setThumbnailUploading(false);
    }
  };

  const uploadLessonMedia = async (
    moduleId: string,
    lesson: CourseLessonDraft,
    file: File,
  ) => {
    const expectsAudio = lesson.lessonType === "audio";
    if (
      (expectsAudio && !file.type.startsWith("audio/")) ||
      (!expectsAudio && !file.type.startsWith("video/"))
    ) {
      toast.error(
        expectsAudio
          ? "Escolha um arquivo de áudio."
          : "Escolha um arquivo de vídeo.",
      );
      return;
    }
    try {
      const saved = await draft.saveNow();
      if (!isPersistedPublicationDraft(saved))
        throw new Error(
          "Conecte-se à internet para iniciar o envio. O curso continua salvo neste dispositivo.",
        );
      let prepared = file;
      if (!expectsAudio) {
        try {
          prepared = await compression.compressVideo(file, {
            quality: "balanced",
            maxWidth: 1920,
            maxHeight: 1080,
          });
        } catch {
          prepared = file;
        }
      }
      activeLessonUploadRef.current = { moduleId, lessonId: lesson.id };
      const result = await mediaUpload.upload({
        file: prepared,
        title: lesson.title || file.name,
        mediaType: expectsAudio ? "audio" : "video",
        draftId: saved?.id ?? draft.draftId,
        slotKey: `lesson:${lesson.id}`,
        onTargetCreated: (target) => {
          if (
            lesson.mediaAssetId &&
            lesson.mediaAssetId !== target.mediaAssetId
          )
            abandonAsset(lesson.mediaAssetId);
          updateModule(moduleId, (module) => ({
            ...module,
            lessons: module.lessons.map((item) =>
              item.id === lesson.id
                ? {
                    ...item,
                    fileUrl: target.fileUrl,
                    mediaAssetId: target.mediaAssetId,
                    videoProvider: target.provider,
                    uploadState: "uploading",
                  }
                : item,
            ),
          }));
        },
      });
      if (lesson.mediaAssetId && lesson.mediaAssetId !== result.mediaAssetId)
        abandonAsset(lesson.mediaAssetId);
      const element = document.createElement(expectsAudio ? "audio" : "video");
      element.preload = "metadata";
      element.src = URL.createObjectURL(file);
      element.onloadedmetadata = () =>
        updateModule(moduleId, (module) => ({
          ...module,
          lessons: module.lessons.map((item) =>
            item.id === lesson.id
              ? { ...item, duration: Math.floor(element.duration || 0) }
              : item,
          ),
        }));
      updateModule(moduleId, (module) => ({
        ...module,
        lessons: module.lessons.map((item) =>
          item.id === lesson.id
            ? {
                ...item,
                fileUrl: result.fileUrl,
                mediaAssetId: result.mediaAssetId,
                videoProvider: result.provider,
                uploadState: "processing",
              }
            : item,
        ),
      }));
      toast.success(
        "Arquivo enviado. A aula ficará pronta após o processamento.",
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.error(
          error instanceof Error
            ? error.message
            : "Não foi possível enviar a mídia.",
        );
    }
  };

  const uploadMaterial = async (
    moduleId: string,
    materialId: string,
    file: File,
  ) => {
    if (!user) return;
    setMaterialUploading(materialId);
    try {
      const saved = await draft.saveNow();
      if (!isPersistedPublicationDraft(saved))
        throw new Error(
          "Conecte-se à internet para anexar o material. O restante do curso continua salvo neste dispositivo.",
        );
      const previousUrl = modules
        .find((module) => module.id === moduleId)
        ?.materials.find((item) => item.id === materialId)?.fileUrl;
      const extension = file.name.split(".").pop() || "bin";
      const path = `materials/${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from("courses")
        .upload(path, file, { cacheControl: "31536000" });
      if (error) throw error;
      const { data } = supabase.storage.from("courses").getPublicUrl(path);
      const { error: fileRecordError } = await supabase
        .from("publication_draft_files")
        .insert({
          draft_id: saved!.id,
          owner_id: user.id,
          bucket: "courses",
          object_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
        });
      if (fileRecordError) {
        await supabase.storage.from("courses").remove([path]);
        throw fileRecordError;
      }
      temporaryFileUrlsRef.current.add(data.publicUrl);
      updateModule(moduleId, (module) => ({
        ...module,
        materials: module.materials.map((item) =>
          item.id === materialId
            ? {
                ...item,
                title: item.title || file.name,
                fileUrl: data.publicUrl,
                fileType: file.type || "application/octet-stream",
                fileSize: file.size,
              }
            : item,
        ),
      }));
      if (previousUrl && previousUrl !== data.publicUrl)
        void removeStoredCourseFile(previousUrl);
      toast.success("Material anexado.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o material.",
      );
    } finally {
      setMaterialUploading(null);
    }
  };

  const generateTags = async () => {
    if (!title.trim()) {
      toast.error("Escreva o título antes de gerar tags.");
      return;
    }
    setIsGeneratingTags(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-tags", {
        body: { title, description, contentType: "curso" },
      });
      if (error) throw error;
      setTags(data?.tags ?? []);
    } catch {
      toast.error("Não foi possível sugerir tags agora.");
    } finally {
      setIsGeneratingTags(false);
    }
  };
  const issues = useMemo(() => getCourseDraftIssues(payload), [payload]);
  const totalLessons = modules.reduce(
    (total, module) => total + module.lessons.length,
    0,
  );
  const totalUnits = modules.reduce(
    (total, module) => total + module.lessons.length + module.quizzes.length,
    0,
  );
  const totalDuration = modules
    .flatMap((module) => module.lessons)
    .reduce((total, lesson) => total + lesson.duration, 0);

  const submit = async () => {
    if (issues.length) {
      toast.error(issues[0]);
      return;
    }
    setSubmitting(true);
    try {
      const saved = await draft.saveNow();
      const activeId = isPersistedPublicationDraft(saved) ? saved!.id : null;
      if (!activeId)
        throw new Error(
          "Conecte-se à internet para enviar o curso para análise.",
        );
      const { data, error } = await (supabase as any).rpc(
        "submit_course_publication",
        { p_draft_id: activeId },
      );
      if (error) throw error;
      draft.clearLocal();
      toast.success(
        data?.isRevision
          ? "Revisão enviada. O curso atual continua publicado."
          : "Curso enviado para análise.",
      );
      navigate("/studio/contents");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar o curso.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  const discardCourseDraft = async () => {
    modules
      .flatMap((module) => module.lessons)
      .forEach((lesson) => abandonAsset(lesson.mediaAssetId));
    await Promise.all(
      modules
        .flatMap((module) => module.materials)
        .map((material) => removeStoredCourseFile(material.fileUrl)),
    );
    await draft.discard();
    setDiscardOpen(false);
    navigate("/studio/contents");
  };

  if (loading || !sourceLoaded)
    return (
      <div className="cf-v2 studio-publish-loading">
        <LoaderCircle className="animate-spin" />
        <strong>Preparando o construtor...</strong>
      </div>
    );
  if (!user || (role !== "creator" && role !== "admin"))
    return <Navigate to="/" replace />;
  if (profile?.creator_status !== "approved" && role !== "admin")
    return (
      <AppShell
        variant="studio"
        title="Criar curso"
        contentClassName="studio-page-shell"
      >
        <div className="studio-access-state">
          <BookOpen />
          <h1>Seu Studio ainda não está liberado</h1>
          <p>Quando seu perfil for aprovado, você poderá criar cursos.</p>
        </div>
      </AppShell>
    );
  const saveIcon =
    draft.state === "offline" ? (
      <CloudOff />
    ) : draft.state === "saving" ? (
      <LoaderCircle className="animate-spin" />
    ) : (
      <Cloud />
    );

  return (
    <AppShell
      variant="studio"
      title={editId ? "Editar curso" : "Novo curso"}
      contentClassName="studio-page-shell"
    >
      <CreatorTemplate
        className="studio-template studio-publish-template"
        width="full"
        density="comfortable"
        header={
          <PageHeader
            title={editId ? "Edite seu curso." : "Construa seu curso."}
            description={
              originalStatus === "approved"
                ? "O curso publicado continua no ar enquanto esta revisão é analisada."
                : "Organize módulos, aulas, quizzes e materiais sem perder o progresso."
            }
            action={
              <span className="studio-draft-state" data-state={draft.state}>
                {saveIcon}
                {draft.label}
              </span>
            }
          />
        }
        toolbar={<StudioNavigation />}
      >
        <div className="course-builder-layout">
          <aside className="course-outline">
            <div className="course-outline-header">
              <div>
                <strong>Estrutura</strong>
                <span>
                  {modules.length} {modules.length === 1 ? "módulo" : "módulos"}
                </span>
              </div>
              <V2Button
                size="sm"
                variant="quiet"
                leadingIcon={<Plus />}
                onClick={addModule}
              >
                Módulo
              </V2Button>
            </div>
            <button
              type="button"
              className="course-outline-course"
              data-active={selection.type === "course" || undefined}
              onClick={() => setSelection({ type: "course" })}
            >
              <BookOpen />
              <span>
                <strong>Informações do curso</strong>
                <small>Capa, acesso e configurações</small>
              </span>
            </button>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleModuleDrag}
            >
              <SortableContext
                items={modules.map((module) => module.id)}
                strategy={verticalListSortingStrategy}
              >
                {modules.map((module, moduleIndex) => (
                  <section className="course-outline-module" key={module.id}>
                    <SortableItem
                      id={module.id}
                      active={
                        selection.type === "module" &&
                        selection.moduleId === module.id
                      }
                      onClick={() =>
                        setSelection({ type: "module", moduleId: module.id })
                      }
                    >
                      <Layers3 />
                      <span>
                        <strong>
                          {module.title || `Módulo ${moduleIndex + 1}`}
                        </strong>
                        <small>
                          {module.lessons.length + module.quizzes.length}{" "}
                          unidades
                        </small>
                      </span>
                    </SortableItem>
                    <div className="course-outline-units">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleLessonDrag(module.id)}
                      >
                        <SortableContext
                          items={module.lessons.map((lesson) => lesson.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {module.lessons.map((lesson) => (
                            <SortableItem
                              key={lesson.id}
                              id={lesson.id}
                              active={
                                selection.type === "lesson" &&
                                selection.itemId === lesson.id
                              }
                              onClick={() =>
                                setSelection({
                                  type: "lesson",
                                  moduleId: module.id,
                                  itemId: lesson.id,
                                })
                              }
                            >
                              {lesson.lessonType === "audio" ? (
                                <FileAudio />
                              ) : lesson.lessonType === "text" ? (
                                <FileText />
                              ) : (
                                <FileVideo />
                              )}
                              <span>
                                <strong>
                                  {lesson.title || "Aula sem título"}
                                </strong>
                                <small>
                                  {lesson.lessonType === "text"
                                    ? "Texto"
                                    : formatDuration(lesson.duration)}
                                </small>
                              </span>
                            </SortableItem>
                          ))}
                        </SortableContext>
                      </DndContext>
                      {module.quizzes.map((quiz) => (
                        <button
                          key={quiz.id}
                          type="button"
                          className="course-outline-item course-outline-item--fixed"
                          data-active={
                            (selection.type === "quiz" &&
                              selection.itemId === quiz.id) ||
                            undefined
                          }
                          onClick={() =>
                            setSelection({
                              type: "quiz",
                              moduleId: module.id,
                              itemId: quiz.id,
                            })
                          }
                        >
                          <span className="course-outline-grip">
                            <Archive />
                          </span>
                          <span>
                            <strong>{quiz.title || "Quiz sem título"}</strong>
                            <small>{quiz.questions.length} questões</small>
                          </span>
                        </button>
                      ))}
                      {module.materials.map((material) => (
                        <button
                          key={material.id}
                          type="button"
                          className="course-outline-item course-outline-item--fixed"
                          data-active={
                            (selection.type === "material" &&
                              selection.itemId === material.id) ||
                            undefined
                          }
                          onClick={() =>
                            setSelection({
                              type: "material",
                              moduleId: module.id,
                              itemId: material.id,
                            })
                          }
                        >
                          <span className="course-outline-grip">
                            <File />
                          </span>
                          <span>
                            <strong>
                              {material.title || "Material sem título"}
                            </strong>
                            <small>
                              {material.fileUrl ? "Anexado" : "Pendente"}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="course-outline-add">
                      <button
                        type="button"
                        onClick={() => addLesson(module.id)}
                      >
                        + Aula
                      </button>
                      <button type="button" onClick={() => addQuiz(module.id)}>
                        + Quiz
                      </button>
                      <button
                        type="button"
                        onClick={() => addMaterial(module.id)}
                      >
                        + Material
                      </button>
                    </div>
                  </section>
                ))}
              </SortableContext>
            </DndContext>
          </aside>

          <section className="course-unit-editor">
            {selection.type === "course" && (
              <CourseInfoEditor
                payload={payload}
                setTitle={setTitle}
                setDescription={setDescription}
                setVisibility={setVisibility}
                setPrice={setPrice}
                setDiscount={setDiscount}
                setLevel={setLevel}
                setRequirements={setRequirements}
                setWhatYouLearn={setWhatYouLearn}
                setTags={setTags}
                generateTags={generateTags}
                generatingTags={isGeneratingTags}
                thumbnailPreview={thumbnailPreview}
                thumbnailUploading={thumbnailUploading}
                uploadCover={uploadCover}
                setIssueCertificate={setIssueCertificate}
                setAccessType={setAccessType}
                setAccessDays={setAccessDays}
                setLessonOrder={setLessonOrder}
                setAllowComments={setAllowComments}
                setAllowReviews={setAllowReviews}
                setAllowDownloads={setAllowDownloads}
              />
            )}
            {selection.type === "module" && selectedModule && (
              <V2Card elevation="panel">
                <V2CardHeader>
                  <div className="studio-publish-heading">
                    <span className="studio-icon">
                      <Layers3 />
                    </span>
                    <div>
                      <h2>Dados do módulo</h2>
                      <p>Um nome claro ajuda o aluno a entender a sequência.</p>
                    </div>
                  </div>
                  <V2Button
                    variant="quiet"
                    size="sm"
                    leadingIcon={<Trash2 />}
                    onClick={() => removeModule(selectedModule.id)}
                  >
                    Remover
                  </V2Button>
                </V2CardHeader>
                <V2CardContent className="studio-publish-fields">
                  <V2Input
                    label="Nome do módulo"
                    value={selectedModule.title}
                    onChange={(event) =>
                      updateModule(selectedModule.id, (module) => ({
                        ...module,
                        title: event.target.value,
                      }))
                    }
                    placeholder="Ex.: Fundamentos"
                  />
                  <V2Textarea
                    label="Descrição"
                    value={selectedModule.description}
                    onChange={(event) =>
                      updateModule(selectedModule.id, (module) => ({
                        ...module,
                        description: event.target.value,
                      }))
                    }
                    placeholder="Explique o que será estudado neste módulo"
                  />
                  <div className="course-quick-add">
                    <V2Button
                      leadingIcon={<FileVideo />}
                      onClick={() => addLesson(selectedModule.id)}
                    >
                      Adicionar aula
                    </V2Button>
                    <V2Button
                      variant="secondary"
                      leadingIcon={<Archive />}
                      onClick={() => addQuiz(selectedModule.id)}
                    >
                      Adicionar quiz
                    </V2Button>
                    <V2Button
                      variant="secondary"
                      leadingIcon={<File />}
                      onClick={() => addMaterial(selectedModule.id)}
                    >
                      Anexar material
                    </V2Button>
                  </div>
                </V2CardContent>
              </V2Card>
            )}
            {selection.type === "lesson" &&
              selectedModule &&
              selectedLesson && (
                <LessonEditor
                  lesson={selectedLesson}
                  upload={uploadLessonMedia}
                  progress={
                    activeLessonUploadRef.current?.lessonId ===
                    selectedLesson.id
                      ? mediaUpload.progress
                      : 0
                  }
                  error={
                    activeLessonUploadRef.current?.lessonId ===
                    selectedLesson.id
                      ? mediaUpload.error
                      : null
                  }
                  update={(changes) =>
                    updateModule(selectedModule.id, (module) => ({
                      ...module,
                      lessons: module.lessons.map((item) =>
                        item.id === selectedLesson.id
                          ? { ...item, ...changes }
                          : item,
                      ),
                    }))
                  }
                  changeType={(type) => {
                    if (type === "text")
                      abandonAsset(selectedLesson.mediaAssetId);
                    updateModule(selectedModule.id, (module) => ({
                      ...module,
                      lessons: module.lessons.map((item) =>
                        item.id === selectedLesson.id
                          ? {
                              ...item,
                              lessonType: type,
                              body: type === "text" ? item.body : "",
                              fileUrl: type === "text" ? "" : item.fileUrl,
                              mediaAssetId:
                                type === "text" ? null : item.mediaAssetId,
                              uploadState:
                                type === "text" ? "ready" : item.uploadState,
                            }
                          : item,
                      ),
                    }));
                  }}
                  remove={() =>
                    removeItem(selectedModule.id, "lesson", selectedLesson.id)
                  }
                  moduleId={selectedModule.id}
                />
              )}
            {selection.type === "quiz" && selectedModule && selectedQuiz && (
              <QuizEditor
                quiz={selectedQuiz}
                onUpdate={(quiz: CourseQuizDraft) =>
                  updateModule(selectedModule.id, (module) => ({
                    ...module,
                    quizzes: module.quizzes.map((item) =>
                      item.id === selectedQuiz.id ? quiz : item,
                    ),
                  }))
                }
                onClose={() =>
                  setSelection({ type: "module", moduleId: selectedModule.id })
                }
              />
            )}
            {selection.type === "material" &&
              selectedModule &&
              selectedMaterial && (
                <V2Card elevation="panel">
                  <V2CardHeader>
                    <div className="studio-publish-heading">
                      <span className="studio-icon">
                        <File />
                      </span>
                      <div>
                        <h2>Material complementar</h2>
                        <p>Anexe um arquivo real para acompanhar o módulo.</p>
                      </div>
                    </div>
                    <V2Button
                      variant="quiet"
                      size="sm"
                      leadingIcon={<Trash2 />}
                      onClick={() =>
                        removeItem(
                          selectedModule.id,
                          "material",
                          selectedMaterial.id,
                        )
                      }
                    >
                      Remover
                    </V2Button>
                  </V2CardHeader>
                  <V2CardContent className="studio-publish-fields">
                    <V2Input
                      label="Nome do material"
                      value={selectedMaterial.title}
                      onChange={(event) =>
                        updateModule(selectedModule.id, (module) => ({
                          ...module,
                          materials: module.materials.map((item) =>
                            item.id === selectedMaterial.id
                              ? { ...item, title: event.target.value }
                              : item,
                          ),
                        }))
                      }
                    />
                    <V2Textarea
                      label="Descrição"
                      value={selectedMaterial.description}
                      onChange={(event) =>
                        updateModule(selectedModule.id, (module) => ({
                          ...module,
                          materials: module.materials.map((item) =>
                            item.id === selectedMaterial.id
                              ? { ...item, description: event.target.value }
                              : item,
                          ),
                        }))
                      }
                    />
                    {selectedMaterial.fileUrl ? (
                      <div className="course-file-ready">
                        <Check />
                        <span>
                          <strong>{selectedMaterial.title}</strong>
                          <small>
                            {selectedMaterial.fileType} ·{" "}
                            {Math.ceil(selectedMaterial.fileSize / 1024)} KB
                          </small>
                        </span>
                        <label>
                          <span>Substituir</span>
                          <input
                            type="file"
                            onChange={(event) =>
                              event.target.files?.[0] &&
                              void uploadMaterial(
                                selectedModule.id,
                                selectedMaterial.id,
                                event.target.files[0],
                              )
                            }
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="studio-upload-dropzone studio-upload-dropzone--compact">
                        <UploadCloud />
                        <strong>
                          {materialUploading === selectedMaterial.id
                            ? "Enviando material..."
                            : "Escolha o arquivo"}
                        </strong>
                        <span>
                          PDF, planilha, apresentação, documento ou arquivo
                          compactado.
                        </span>
                        <input
                          type="file"
                          disabled={materialUploading === selectedMaterial.id}
                          onChange={(event) =>
                            event.target.files?.[0] &&
                            void uploadMaterial(
                              selectedModule.id,
                              selectedMaterial.id,
                              event.target.files[0],
                            )
                          }
                        />
                      </label>
                    )}
                  </V2CardContent>
                </V2Card>
              )}
          </section>

          <aside className="course-publish-panel">
            <V2Card elevation="raised">
              <V2CardHeader>
                <div>
                  <h2>Publicação</h2>
                  <p>
                    O curso pode ficar incompleto enquanto estiver em rascunho.
                  </p>
                </div>
              </V2CardHeader>
              <V2CardContent>
                <div
                  className="studio-review-status"
                  data-complete={!issues.length || undefined}
                >
                  {issues.length ? <CircleAlert /> : <Check />}
                  <strong>
                    {issues.length
                      ? `${issues.length} ${issues.length === 1 ? "pendência" : "pendências"}`
                      : "Pronto para análise"}
                  </strong>
                </div>
                <ul className="studio-review-list">
                  {issues.length ? (
                    issues.slice(0, 6).map((issue) => (
                      <li key={issue}>
                        <span />
                        {issue}
                      </li>
                    ))
                  ) : (
                    <li>
                      <Check />
                      Todo o curso será criado em uma única operação.
                    </li>
                  )}
                </ul>
                {issues.length > 6 && (
                  <p className="course-more-issues">
                    e mais {issues.length - 6}
                  </p>
                )}
                <dl className="studio-review-summary">
                  <div>
                    <dt>Módulos</dt>
                    <dd>{modules.length}</dd>
                  </div>
                  <div>
                    <dt>Unidades</dt>
                    <dd>{totalUnits}</dd>
                  </div>
                  <div>
                    <dt>Duração em mídia</dt>
                    <dd>{formatDuration(totalDuration)}</dd>
                  </div>
                  <div>
                    <dt>Acesso</dt>
                    <dd>
                      {
                        visibilityOptions.find((item) => item.id === visibility)
                          ?.label
                      }
                    </dd>
                  </div>
                </dl>
              </V2CardContent>
              <div className="studio-review-actions">
                <V2Button
                  variant="secondary"
                  leadingIcon={<Eye />}
                  onClick={() => setPreviewOpen(true)}
                >
                  Pré-visualizar
                </V2Button>
                <V2Button
                  leadingIcon={
                    submitting ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Send />
                    )
                  }
                  disabled={submitting || issues.length > 0}
                  onClick={() => void submit()}
                >
                  {submitting ? "Enviando..." : "Enviar para análise"}
                </V2Button>
                <V2Button
                  variant="quiet"
                  leadingIcon={<Save />}
                  onClick={() => void draft.saveNow()}
                >
                  Salvar rascunho
                </V2Button>
                <V2Button
                  variant="quiet"
                  leadingIcon={<Trash2 />}
                  onClick={() => setDiscardOpen(true)}
                >
                  Descartar rascunho
                </V2Button>
              </div>
            </V2Card>
          </aside>
        </div>
      </CreatorTemplate>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="studio-preview-dialog course-preview-dialog">
          <DialogHeader>
            <DialogTitle>Prévia do curso</DialogTitle>
            <DialogDescription>
              Confira a apresentação e a ordem que o aluno encontrará.
            </DialogDescription>
          </DialogHeader>
          <div className="course-preview">
            <div className="course-preview-hero">
              {thumbnailPreview ? (
                <img src={thumbnailPreview} alt="" />
              ) : (
                <div className="studio-preview-placeholder">
                  <ImagePlus />
                </div>
              )}
              <div>
                <V2Badge>Curso</V2Badge>
                <h2>{title || "Título do curso"}</h2>
                <p>{description || "A descrição do curso aparecerá aqui."}</p>
                <span>
                  {totalLessons} aulas · {formatDuration(totalDuration)}
                </span>
              </div>
            </div>
            <ol>
              {modules.map((module, index) => (
                <li key={module.id}>
                  <strong>
                    {index + 1}. {module.title || "Módulo sem título"}
                  </strong>
                  <span>
                    {module.lessons.length} aulas · {module.quizzes.length}{" "}
                    quizzes · {module.materials.length} materiais
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="studio-preview-dialog studio-discard-dialog">
          <DialogHeader>
            <DialogTitle>Descartar este curso?</DialogTitle>
            <DialogDescription>
              A estrutura que ainda não foi enviada e os arquivos vinculados ao
              rascunho serão removidos.
            </DialogDescription>
          </DialogHeader>
          <div className="studio-dialog-actions">
            <V2Button variant="secondary" onClick={() => setDiscardOpen(false)}>
              Continuar editando
            </V2Button>
            <V2Button
              leadingIcon={<Trash2 />}
              onClick={() => void discardCourseDraft()}
            >
              Descartar rascunho
            </V2Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

export default function StudioUploadCursoRoute() {
  const location = useLocation();
  return <StudioUploadCurso key={`${location.pathname}${location.search}`} />;
}

function CourseInfoEditor(props: {
  payload: CoursePublicationDraft;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setVisibility: (value: PublicationVisibility) => void;
  setPrice: (value: string) => void;
  setDiscount: (value: string) => void;
  setLevel: (value: CoursePublicationDraft["level"]) => void;
  setRequirements: (value: string) => void;
  setWhatYouLearn: (value: string) => void;
  setTags: (value: string[]) => void;
  generateTags: () => void;
  generatingTags: boolean;
  thumbnailPreview: string;
  thumbnailUploading: boolean;
  uploadCover: (file: File) => void;
  setIssueCertificate: (value: boolean) => void;
  setAccessType: (value: CoursePublicationDraft["accessType"]) => void;
  setAccessDays: (value: string) => void;
  setLessonOrder: (value: CoursePublicationDraft["lessonOrder"]) => void;
  setAllowComments: (value: boolean) => void;
  setAllowReviews: (value: boolean) => void;
  setAllowDownloads: (value: boolean) => void;
}) {
  const { payload } = props;
  return (
    <>
      <V2Card elevation="panel">
        <V2CardHeader>
          <div className="studio-publish-heading">
            <span className="studio-icon">
              <BookOpen />
            </span>
            <div>
              <h2>Informações do curso</h2>
              <p>Diga para quem é o curso e o que será aprendido.</p>
            </div>
          </div>
        </V2CardHeader>
        <V2CardContent className="studio-publish-fields">
          <V2Input
            label="Título"
            value={payload.title}
            onChange={(event) => props.setTitle(event.target.value)}
          />
          <V2Textarea
            label="Descrição"
            value={payload.description}
            onChange={(event) => props.setDescription(event.target.value)}
          />
          <div className="course-two-fields">
            <label className="cf2-field">
              <span className="cf2-field__label">Nível</span>
              <select
                className="cf2-input"
                value={payload.level}
                onChange={(event) =>
                  props.setLevel(
                    event.target.value as CoursePublicationDraft["level"],
                  )
                }
              >
                <option value="beginner">Iniciante</option>
                <option value="intermediate">Intermediário</option>
                <option value="advanced">Avançado</option>
              </select>
            </label>
            <div className="cf2-field">
              <span className="cf2-field__label">Tags</span>
              <TagsInput
                tags={payload.tags}
                onChange={props.setTags}
                onGenerateTags={props.generateTags}
                isGenerating={props.generatingTags}
              />
            </div>
          </div>
          <V2Textarea
            label="O que a pessoa vai aprender"
            value={payload.whatYouLearn}
            onChange={(event) => props.setWhatYouLearn(event.target.value)}
          />
          <V2Textarea
            label="O que é necessário antes de começar"
            value={payload.requirements}
            onChange={(event) => props.setRequirements(event.target.value)}
          />
        </V2CardContent>
      </V2Card>
      <V2Card elevation="panel">
        <V2CardHeader>
          <div className="studio-publish-heading">
            <span className="studio-icon">
              <ImagePlus />
            </span>
            <div>
              <h2>Capa</h2>
              <p>Use uma imagem horizontal e nítida.</p>
            </div>
          </div>
        </V2CardHeader>
        <V2CardContent>
          <label
            className={`studio-cover-upload ${props.thumbnailPreview ? "has-image" : ""}`}
          >
            {props.thumbnailPreview ? (
              <img src={props.thumbnailPreview} alt="Prévia da capa" />
            ) : (
              <>
                <ImagePlus />
                <strong>Adicionar capa</strong>
                <span>JPG, PNG ou WebP no formato 16:9.</span>
              </>
            )}
            {props.thumbnailUploading && (
              <span className="studio-cover-upload__loading">
                <LoaderCircle className="animate-spin" />
                Enviando...
              </span>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) =>
                event.target.files?.[0] &&
                props.uploadCover(event.target.files[0])
              }
            />
          </label>
        </V2CardContent>
      </V2Card>
      <V2Card elevation="panel">
        <V2CardHeader>
          <div className="studio-publish-heading">
            <span className="studio-icon">
              <Settings2 />
            </span>
            <div>
              <h2>Acesso e experiência</h2>
              <p>Estas opções serão aplicadas ao curso publicado.</p>
            </div>
          </div>
        </V2CardHeader>
        <V2CardContent className="studio-publish-fields">
          <div className="studio-access-options">
            {visibilityOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                data-selected={payload.visibility === option.id || undefined}
                onClick={() => props.setVisibility(option.id)}
              >
                <span>{payload.visibility === option.id && <Check />}</span>
                <div>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </div>
              </button>
            ))}
            {payload.visibility === "paid" && (
              <div className="studio-price-fields">
                <V2Input
                  label="Preço em reais"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={payload.price}
                  onChange={(event) => props.setPrice(event.target.value)}
                />
                <V2Input
                  label="Desconto (%)"
                  type="number"
                  min="0"
                  max="100"
                  value={payload.discount}
                  onChange={(event) => props.setDiscount(event.target.value)}
                />
              </div>
            )}
          </div>
          <div className="course-settings-grid">
            <Toggle
              label="Emitir certificado"
              checked={payload.issueCertificate}
              onChange={props.setIssueCertificate}
            />
            <Toggle
              label="Permitir comentários"
              checked={payload.allowComments}
              onChange={props.setAllowComments}
            />
            <Toggle
              label="Permitir avaliações"
              checked={payload.allowReviews}
              onChange={props.setAllowReviews}
            />
            <Toggle
              label="Permitir downloads"
              checked={payload.allowDownloads}
              onChange={props.setAllowDownloads}
            />
            <label className="cf2-field">
              <span className="cf2-field__label">Prazo de acesso</span>
              <select
                className="cf2-input"
                value={payload.accessType}
                onChange={(event) =>
                  props.setAccessType(
                    event.target.value as CoursePublicationDraft["accessType"],
                  )
                }
              >
                <option value="lifetime">Sem prazo</option>
                <option value="limited">Prazo definido</option>
              </select>
            </label>
            {payload.accessType === "limited" && (
              <V2Input
                label="Dias de acesso"
                type="number"
                min="1"
                value={payload.accessDays}
                onChange={(event) => props.setAccessDays(event.target.value)}
              />
            )}
            <label className="cf2-field">
              <span className="cf2-field__label">Ordem das aulas</span>
              <select
                className="cf2-input"
                value={payload.lessonOrder}
                onChange={(event) =>
                  props.setLessonOrder(
                    event.target.value as CoursePublicationDraft["lessonOrder"],
                  )
                }
              >
                <option value="free">Livre</option>
                <option value="sequential">Sequencial</option>
              </select>
            </label>
          </div>
        </V2CardContent>
      </V2Card>
    </>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="course-toggle">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span>{label}</span>
    </label>
  );
}

function LessonEditor({
  lesson,
  moduleId,
  update,
  changeType,
  remove,
  upload,
  progress,
  error,
}: {
  lesson: CourseLessonDraft;
  moduleId: string;
  update: (changes: Partial<CourseLessonDraft>) => void;
  changeType: (type: CourseLessonDraft["lessonType"]) => void;
  remove: () => void;
  upload: (moduleId: string, lesson: CourseLessonDraft, file: File) => void;
  progress: number;
  error: string | null;
}) {
  const MediaIcon = lesson.lessonType === "audio" ? FileAudio : FileVideo;
  return (
    <V2Card elevation="panel">
      <V2CardHeader>
        <div className="studio-publish-heading">
          <span className="studio-icon">
            <MediaIcon />
          </span>
          <div>
            <h2>Editar aula</h2>
            <p>Escolha vídeo, áudio ou texto para esta unidade.</p>
          </div>
        </div>
        <V2Button
          variant="quiet"
          size="sm"
          leadingIcon={<Trash2 />}
          onClick={remove}
        >
          Remover
        </V2Button>
      </V2CardHeader>
      <V2CardContent className="studio-publish-fields">
        <div className="course-lesson-types">
          {(["video", "audio", "text"] as const).map((type) => (
            <button
              type="button"
              key={type}
              data-selected={lesson.lessonType === type || undefined}
              onClick={() => changeType(type)}
            >
              {type === "video" ? (
                <FileVideo />
              ) : type === "audio" ? (
                <FileAudio />
              ) : (
                <FileText />
              )}
              <span>
                {type === "video"
                  ? "Vídeo"
                  : type === "audio"
                    ? "Áudio"
                    : "Texto"}
              </span>
            </button>
          ))}
        </div>
        <V2Input
          label="Título da aula"
          value={lesson.title}
          onChange={(event) => update({ title: event.target.value })}
        />
        <V2Textarea
          label="Descrição"
          value={lesson.description}
          onChange={(event) => update({ description: event.target.value })}
        />
        {lesson.lessonType === "text" ? (
          <V2Textarea
            label="Conteúdo da aula"
            rows={14}
            value={lesson.body}
            onChange={(event) => update({ body: event.target.value })}
            placeholder="Escreva a aula aqui. A formatação avançada poderá ser aplicada depois."
          />
        ) : lesson.mediaAssetId ? (
          <div className="course-media-ready">
            <MediaIcon />
            <span>
              <strong>
                {lesson.uploadState === "ready"
                  ? "Mídia pronta"
                  : lesson.uploadState === "failed"
                    ? "Falha no processamento"
                    : "Processando mídia"}
              </strong>
              <small>{formatDuration(lesson.duration)}</small>
            </span>
            <label>
              <span>Substituir</span>
              <input
                type="file"
                accept={lesson.lessonType === "audio" ? "audio/*" : "video/*"}
                onChange={(event) =>
                  event.target.files?.[0] &&
                  upload(moduleId, lesson, event.target.files[0])
                }
              />
            </label>
          </div>
        ) : (
          <label className="studio-upload-dropzone">
            <UploadCloud />
            <strong>
              Escolha {lesson.lessonType === "audio" ? "o áudio" : "o vídeo"}
            </strong>
            <span>Você pode continuar editando o curso durante o envio.</span>
            <input
              type="file"
              accept={lesson.lessonType === "audio" ? "audio/*" : "video/*"}
              onChange={(event) =>
                event.target.files?.[0] &&
                upload(moduleId, lesson, event.target.files[0])
              }
            />
          </label>
        )}
        {progress > 0 && progress < 100 && (
          <div className="studio-upload-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
        {error && (
          <p className="studio-inline-error">
            <CircleAlert />
            {error}
          </p>
        )}
        <Toggle
          label="Liberar esta aula como prévia"
          checked={lesson.isPreview}
          onChange={(value) => update({ isPreview: value })}
        />
      </V2CardContent>
    </V2Card>
  );
}
