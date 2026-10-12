import { expect, it } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, migrateStudioProject, withStudioOutputSelection, withStudioTakes } from './model';

it.each(['aula', 'short'] as const)('as quatro resoluções de %s sobrevivem a salvar e reabrir sem alterar o original 4K', kind => {
  for (const [resolution, edge] of [['720p', 720], ['hd', 1080], ['2k', 1440], ['4k', 2160]] as const) {
    const editing = emptyStudioEditing(kind);
    editing.assets = [{ id: 'source', kind: 'video', uri: 'file:///source.mov', name: 'Original', durationTicks: 120000, width: 3840, height: 2160, frameRate: 30 }];
    editing.main = [{ id: 'clip', assetId: 'source', durationTicks: 120000, sourceStartTicks: 0, sourceEndTicks: 120000, rect: { x: 0, y: 0, width: 1, height: 1 }, rotationDegrees: 0, fit: 'contain', opacity: 1, gain: 1, fadeInTicks: 0, fadeOutTicks: 0, effect: 'natural' }];
    const project = withStudioTakes({ version: 2, id: 'p', ownerId: 'o', kind, title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing: withStudioOutputSelection(editing, { resolution, frameRate: 30 }), createdAt: '2026-10-12', updatedAt: '2026-10-12', revision: 0, state: 'draft', progress: 0 });
    const reopened = migrateStudioProject(JSON.parse(JSON.stringify(project)));
    const output = compileStudioRecipe(reopened).output;
    expect(output).toMatchObject({ width: kind === 'short' ? edge : edge * 16 / 9, height: kind === 'short' ? edge * 16 / 9 : edge, frameRateNumerator: 30 });
    expect(reopened.editing!.assets[0]).toMatchObject({ uri: 'file:///source.mov', width: 3840, height: 2160 });
  }
});
