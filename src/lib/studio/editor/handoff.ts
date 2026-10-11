import { getExport, getProject } from './storage';
import type { StudioProject } from '../../../../shared/studio/model';

export type StudioHandoffRequest = { projectId: string; revision: number };
export type StudioHandoff = { project: StudioProject; file: File };

export function parseStudioHandoff(params: URLSearchParams): StudioHandoffRequest | null {
  const projectId = params.get('studioProject'), value = params.get('studioRevision');
  if (projectId === null && value === null) return null;
  if (!projectId || projectId.length > 160 || /[\s/\\]/.test(projectId) || value === null || !/^\d+$/.test(value)) {
    throw new Error('O link do projeto não é válido. Volte ao editor e prepare a publicação novamente.');
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) throw new Error('A versão do projeto não é válida.');
  return { projectId, revision };
}

export async function readStudioHandoff(owner: string, request: StudioHandoffRequest, kind: string): Promise<StudioHandoff> {
  if (!owner) throw new Error('Entre na sua conta para abrir o projeto.');
  const project = await getProject(owner, request.projectId);
  if (!project || project.ownerId !== owner) throw new Error('Este projeto não está disponível nesta conta e navegador.');
  if (project.kind !== kind) throw new Error('O formato da publicação é diferente do projeto. Volte ao editor.');
  if (project.revision !== request.revision) throw new Error('A montagem mudou. Prepare a publicação novamente no editor para usar a versão atual.');
  const file = await getExport(owner, project.id, request.revision);
  if (!file || file.size === 0) throw new Error('O arquivo preparado não está disponível. Volte ao editor e exporte novamente.');
  const mediaType = project.kind === 'podcast' ? 'audio/' : 'video/';
  if (!file.type.startsWith(mediaType)) throw new Error('O arquivo preparado não corresponde ao formato da publicação.');
  const latest = await getProject(owner, project.id);
  if (!latest || latest.revision !== request.revision || latest.ownerId !== owner) throw new Error('A montagem mudou enquanto o arquivo era aberto. Prepare a publicação novamente.');
  return { project, file };
}
