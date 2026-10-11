/** Dev-only BrowserRouter fixture. No Auth bypass is included in the App or build. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { StudioRecordingWorkspace } from '../../src/components/studio/editor/StudioRecordingWorkspace';
import { StudioEditorWorkspace } from '../../src/components/studio/editor/StudioEditorWorkspace';
import { StudioProjectsWorkspace } from '../../src/components/studio/editor/StudioProjectsWorkspace';
import { initializeStudioExitGuard } from '../../src/components/studio/editor/useStudioExitGuard';
import type { StudioKind } from '../../shared/studio';
import '../../src/index.css';

const owner = 'studio-browser-recording-flow-qa';
function Recording() {
  const [params] = useSearchParams();
  const kind = params.get('kind');
  return <StudioRecordingWorkspace owner={owner} initialKind={kind === 'aula' || kind === 'short' || kind === 'podcast' ? kind : undefined}
    initialTitle={params.get('title') ?? undefined} projectId={params.get('project') ?? undefined} />;
}
function Editor() { const { id } = useParams(); return <StudioEditorWorkspace owner={owner} projectId={id!} />; }
const initial = new URLSearchParams(location.search);
const resume = initial.get('resume'), editor = initial.get('editor'), kind = initial.get('kind') as StudioKind | null;
history.replaceState(null, '', editor ? `/studio/projects/${encodeURIComponent(editor)}` : resume ? `/studio/record?project=${encodeURIComponent(resume)}` : kind ? `/studio/record?kind=${encodeURIComponent(kind)}` : '/studio/projects');
initializeStudioExitGuard();
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Routes>
  <Route path="/studio/projects" element={<StudioProjectsWorkspace owner={owner} />} />
  <Route path="/studio/projects/:id" element={<Editor />} />
  <Route path="/studio/record" element={<Recording />} />
</Routes></BrowserRouter></React.StrictMode>);
