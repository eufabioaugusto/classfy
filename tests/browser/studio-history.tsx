/** Vite-only fixture for actual BrowserRouter POP navigation. It is not an App
 * route, has no backend, and is excluded from the production entry/build. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import { StudioEditorWorkspace } from '../../src/components/studio/editor/StudioEditorWorkspace';
import { StudioProjectsWorkspace } from '../../src/components/studio/editor/StudioProjectsWorkspace';
import { initializeStudioExitGuard } from '../../src/components/studio/editor/useStudioExitGuard';
import '../../src/index.css';

const owner = 'studio-browser-history-qa';
function Editor() {
  const { id } = useParams();
  return <StudioEditorWorkspace owner={owner} projectId={id!} />;
}
// The browser fixture is entered through its HTML file, then the real router
// owns its history. Use studio-workspace.html for the separate reload test.
history.replaceState(null, '', '/studio/projects');
initializeStudioExitGuard();
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><Routes>
  <Route path="/studio/projects" element={<StudioProjectsWorkspace owner={owner} />} />
  <Route path="/studio/projects/:id" element={<Editor />} />
</Routes></BrowserRouter></React.StrictMode>);
