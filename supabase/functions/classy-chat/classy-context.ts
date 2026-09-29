import { selectTranscriptExcerpt } from "./classy-core.ts";

export type TutorReference = { type: "content" | "lesson" | "creator" | "study"; id: string };
export type ResolvedReference = { type: TutorReference["type"]; id: string; title: string; description?: string; creator?: string; transcript?: string; transcriptAvailable?: boolean; currentTime?: number; duration_seconds?: number; contentId?: string; body?: string; };

export function canReadContent(content: { status: string; visibility: string; creator_id: string }, userId: string, plan: string, admin: boolean, purchased: boolean) {
  if (admin || content.creator_id === userId) return true;
  if (content.status !== "approved") return false;
  if (content.visibility === "paid") return purchased;
  const rank: Record<string, number> = { free: 0, pro: 1, premium: 2 };
  return content.visibility in rank && (rank[plan] ?? 0) >= rank[content.visibility];
}

// Resolve IDs on the server: names and text sent by the browser never grant access.
export async function resolveTutorReferences(db: any, references: TutorReference[], userId: string, plan: string, currentVideoTime?: number): Promise<ResolvedReference[]> {
  const { data: role } = await db.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  const resolved: ResolvedReference[] = [];
  for (const reference of references) {
    if (reference.type === "creator") {
      const { data } = await db.from("profiles").select("id, display_name, bio, creator_status").eq("id", reference.id).maybeSingle();
      if (!data || data.creator_status !== "approved") throw new Error("REFERENCE_ACCESS_DENIED");
      resolved.push({ ...reference, title: data.display_name, description: String(data.bio || "").slice(0, 1200) });
      continue;
    }
    if (reference.type === "study") {
      const { data } = await db.from("studies").select("id, title, description, main_topic").eq("id", reference.id).eq("user_id", userId).maybeSingle();
      if (!data) throw new Error("REFERENCE_ACCESS_DENIED");
      const { data: state } = await db.from("study_ai_state").select("session_summary").eq("study_id", data.id).maybeSingle();
      resolved.push({ ...reference, title: data.title, description: String([data.description, data.main_topic, state?.session_summary].filter(Boolean).join("\n")).slice(0, 3000) });
      continue;
    }
    let contentId = reference.id;
    let lesson: any = null;
    if (reference.type === "lesson") {
      const { data } = await db.from("course_lessons").select("id, title, description, body, content_id, duration_seconds, is_preview, course:courses!inner(id, creator_id, status, visibility)").eq("id", reference.id).maybeSingle();
      if (!data) throw new Error("REFERENCE_ACCESS_DENIED");
      lesson = data;
      const course = data.course;
      let enrolled = false;
      if (course.visibility === "paid") {
        const { data: enrollment } = await db.from("course_enrollments").select("id").eq("user_id", userId).eq("course_id", course.id).maybeSingle();
        enrolled = !!enrollment;
      }
      const allowed = data.is_preview && course.status === "approved" || canReadContent(course, userId, plan, !!role, enrolled);
      if (!allowed) throw new Error("REFERENCE_ACCESS_DENIED");
      contentId = data.content_id;
    }
    let content: any = null;
    if (contentId) {
      const { data } = await db.from("contents").select("id, title, description, content_type, creator_id, status, visibility, duration_seconds, profiles!contents_creator_id_fkey(display_name)").eq("id", contentId).maybeSingle();
      content = data;
      if (!lesson) {
        let purchased = false;
        if (content?.visibility === "paid") {
          const { data: purchase } = await db.from("purchased_contents").select("id").eq("user_id", userId).eq("content_id", contentId).in("status", ["confirmed", "legacy_confirmed"]).maybeSingle();
          purchased = !!purchase;
        }
        if (!content || !canReadContent(content, userId, plan, !!role, purchased)) throw new Error("REFERENCE_ACCESS_DENIED");
      }
    }
    let transcript = "";
    if (contentId || lesson) {
      const { data } = await db.from(contentId ? "transcriptions" : "lesson_transcriptions").select("text").eq(contentId ? "content_id" : "lesson_id", contentId || lesson.id).maybeSingle();
      transcript = data?.text || "";
      if (!transcript && lesson && contentId) {
        const { data: own } = await db.from("lesson_transcriptions").select("text").eq("lesson_id", lesson.id).maybeSingle();
        transcript = own?.text || "";
      }
    }
    resolved.push({ ...reference, title: lesson?.title || content?.title, description: String(lesson?.description || content?.description || "").slice(0, 1200), creator: content?.profiles?.display_name, contentId: contentId || undefined, duration_seconds: lesson?.duration_seconds || content?.duration_seconds, transcriptAvailable: !!transcript, transcript: selectTranscriptExcerpt(transcript, resolved.length === 0 ? currentVideoTime : undefined, lesson?.duration_seconds || content?.duration_seconds), body: lesson?.body ? String(lesson.body).slice(0, 7000) : undefined, currentTime: resolved.length === 0 ? currentVideoTime : undefined });
  }
  return resolved;
}

export const studyModeInstructions: Record<string, string> = {
  explain: "Explique o conceito usando o material anexado, dê um exemplo concreto e termine com uma pergunta curta para verificar compreensão. Declare quando recorrer a conhecimento geral.",
  practice: "Proponha UM exercício relacionado ao material e ao nível do aluno. Espere a resposta antes de revelar a solução. Se o aluno respondeu a um exercício anterior, corrija com feedback específico e proponha o próximo passo.",
  review: "Faça uma pergunta de recuperação ativa sobre o material, sem revelar a resposta. Após a tentativa do aluno, corrija e concentre a revisão no que ele errou.",
  plan: "Organize um plano de estudo viável a partir do objetivo, tempo disponível e materiais reais. Se objetivo ou disponibilidade não estiverem claros, pergunte antes de criar o plano. Nunca invente aulas do catálogo.",
};
