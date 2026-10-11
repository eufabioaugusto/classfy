// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createProject, saveProject, storeExport } from './storage';
import { parseStudioHandoff, readStudioHandoff } from './handoff';

describe('publicação de um projeto do Studio', () => {
  it('recupera o arquivo e nome originais da versão preparada', async () => {
    const owner = crypto.randomUUID();
    const project = await createProject(owner, 'aula', 'Aula preparada');
    const file = new File(['arquivo renderizado'], 'minha-aula.mp4', { type: 'video/mp4' });
    await storeExport(owner, project.id, file, project.revision);
    const handoff = await readStudioHandoff(owner, { projectId: project.id, revision: 0 }, 'aula');
    expect(handoff.file.name).toBe('minha-aula.mp4');
    expect(await handoff.file.text()).toBe('arquivo renderizado');
    expect(handoff.project.id).toBe(project.id);
  });

  it('não entrega mídia a outra conta ou a outro formato de publicação', async () => {
    const owner = crypto.randomUUID();
    const project = await createProject(owner, 'podcast');
    await storeExport(owner, project.id, new File(['áudio'], 'episodio.m4a', { type: 'audio/mp4' }), 0);
    const request = { projectId: project.id, revision: 0 };
    await expect(readStudioHandoff(crypto.randomUUID(), request, 'podcast')).rejects.toThrow('conta e navegador');
    await expect(readStudioHandoff(owner, request, 'aula')).rejects.toThrow('formato');
    expect((await readStudioHandoff(owner, request, 'podcast')).file.type).toBe('audio/mp4');
  });

  it('bloqueia uma exportação antiga quando a montagem já mudou', async () => {
    const owner = crypto.randomUUID();
    const project = await createProject(owner, 'short');
    await storeExport(owner, project.id, new File(['vídeo'], 'short.mp4', { type: 'video/mp4' }), 0);
    await saveProject(owner, { ...project, title: 'Montagem atual' });
    await expect(readStudioHandoff(owner, { projectId: project.id, revision: 0 }, 'short')).rejects.toThrow('montagem mudou');
    await expect(readStudioHandoff(owner, { projectId: project.id, revision: 1 }, 'short')).rejects.toThrow('arquivo preparado');
  });

  it('ignora uploads comuns e rejeita referências incompletas ou inválidas', () => {
    expect(parseStudioHandoff(new URLSearchParams('type=aula'))).toBeNull();
    expect(parseStudioHandoff(new URLSearchParams('studioProject=p-1&studioRevision=12'))).toEqual({ projectId: 'p-1', revision: 12 });
    for (const query of ['studioProject=p-1', 'studioRevision=1', 'studioProject=a/b&studioRevision=1', 'studioProject=p&studioRevision=-1', 'studioProject=p&studioRevision=9007199254740992']) {
      expect(() => parseStudioHandoff(new URLSearchParams(query))).toThrow();
    }
  });
});
