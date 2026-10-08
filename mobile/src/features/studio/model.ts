export type StudioKind = 'aula' | 'short' | 'podcast';
export type StudioVisibility = 'free' | 'pro' | 'premium' | 'paid';
export type StudioState = 'draft' | 'preparing' | 'uploading' | 'processing' | 'ready' | 'submitted' | 'error';
export type StudioTake = {
  id: string;
  uri: string;
  name: string;
  duration: number;
  start: number;
  end: number;
  width?: number;
  height?: number;
  thumbnailUri?: string;
};
export type StudioProject = {
  version: 1;
  id: string;
  ownerId: string;
  kind: StudioKind;
  title: string;
  description: string;
  objective: string;
  audience: string;
  script: string;
  tags: string[];
  visibility: StudioVisibility;
  price: string;
  takes: StudioTake[];
  pendingTakes?: { id: string; uri: string; name: string; sourceUri?: string }[];
  coverUri?: string;
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  state: StudioState;
  progress: number;
  error?: string;
  remoteDraftId?: string;
  remoteSavedAt?: string;
  mediaAssetId?: string;
  videoProvider?: string;
  uploadSignature?: string;
  exportedUri?: string;
  exportedSignature?: string;
  uploadUrl?: string;
  uploadMethod?: 'PUT' | 'TUS' | 'MOCK';
  uploadHeaders?: Record<string, string>;
  uploadExpiresAt?: string;
  tusUrl?: string;
  submissionId?: string;
  contentId?: string;
};
export const studioFormats = [
  { kind: 'aula', title: 'Aula', detail: 'Uma ideia que merece profundidade.', ratio: '16:9' },
  { kind: 'short', title: 'Short', detail: 'Um aprendizado em até 3 minutos.', ratio: '9:16' },
  { kind: 'podcast', title: 'Podcast', detail: 'Dê voz ao seu conhecimento.', ratio: 'Áudio' },
] as const;
export function timelineDuration(takes: readonly StudioTake[]) {
  return takes.reduce((sum, take) => sum + Math.max(0, take.end - take.start), 0);
}
// Export and upload are reusable only while the original clips and cuts match.
export function timelineSignature(project: Pick<StudioProject, 'kind' | 'takes'>) {
  return JSON.stringify([project.kind, project.takes.map(t => [t.id, t.uri, t.start, t.end])]);
}
export function formatStudioDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
export function publicationIssues(project: StudioProject) {
  const issues: string[] = [];
  if (!project.title.trim()) issues.push('Adicione um título.');
  if (project.kind !== 'short' && !project.description.trim()) issues.push('Conte o que o aluno vai aprender.');
  if (!project.takes.length) issues.push('Grave ou importe seu conteúdo.');
  if (project.pendingTakes?.length) issues.push('Recupere ou retire os arquivos pendentes antes de enviar.');
  if (project.takes.some(t => !Number.isFinite(t.duration) || !Number.isFinite(t.start) || !Number.isFinite(t.end) || t.start < 0 || t.end > t.duration + 0.05 || t.end - t.start < 0.1)) issues.push('Revise os cortes dos takes.');
  if (project.kind === 'short' && timelineDuration(project.takes) > 180) issues.push('Shorts devem ter até 3 minutos.');
  if (!project.coverUri && !project.coverUrl) issues.push('Escolha uma capa.');
  if (project.visibility === 'paid' && (!Number.isFinite(Number(project.price.replace(',', '.'))) || Number(project.price.replace(',', '.')) <= 0)) issues.push('Defina um preço válido.');
  return issues;
}
export const studioStateLabel: Record<StudioState, string> = {
  draft: 'Rascunho', preparing: 'Preparando vídeo', uploading: 'Enviando',
  processing: 'Processando', ready: 'Pronto para enviar', submitted: 'Em curadoria', error: 'Envio interrompido',
};
// iOS may relocate the data container during an app update. Store-owned files
// are rebased to the current Documents root; arbitrary external files are not.
export function rebaseStudioProject(project: StudioProject, documentDirectory: string | null): StudioProject {
  if (!documentDirectory) return project;
  const relativeRoot = `classfy-studio/${project.ownerId}/${project.id}/`;
  const uri = (value?: string) => {
    if (!value) return value;
    const marker = `/Documents/${relativeRoot}`;
    const index = value.indexOf(marker);
    return index >= 0 ? `${documentDirectory}${relativeRoot}${value.slice(index + marker.length)}` : value;
  };
  const updated = { ...project, coverUri: uri(project.coverUri), exportedUri: uri(project.exportedUri),
    takes: project.takes.map(t => ({ ...t, uri: uri(t.uri)!, thumbnailUri: uri(t.thumbnailUri) })),
    pendingTakes: project.pendingTakes?.map(t => ({ ...t, uri: uri(t.uri)! })) };
  if (updated.exportedSignature && project.exportedSignature === timelineSignature(project)) updated.exportedSignature = timelineSignature(updated);
  if (updated.uploadSignature && project.uploadSignature === timelineSignature(project)) updated.uploadSignature = timelineSignature(updated);
  return updated;
}
