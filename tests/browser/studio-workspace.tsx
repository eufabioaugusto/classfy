/** Local Vite-only QA entry. It is not an App route and is not in the production build. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { StudioEditorWorkspace } from '../../src/components/studio/editor/StudioEditorWorkspace';
import { StudioProjectsWorkspace } from '../../src/components/studio/editor/StudioProjectsWorkspace';
import { StudioEditorHandoff } from '../../src/components/studio/editor/StudioEditorHandoff';
import '../../src/index.css';

const owner = 'studio-browser-workspace-qa';
const initialId = new URLSearchParams(location.search).get('project');
function Editor() { const { id } = useParams(); return <StudioEditorWorkspace owner={owner} projectId={id!} />; }
function Handoff() {
  const [params] = useSearchParams();
  const [file, setFile] = React.useState<File | null>(null);
  return <div className="se-loading"><h1>QA da preparação de publicação</h1><StudioEditorHandoff owner={owner} kind={params.get('type') ?? 'aula'} disabled={false} onUse={async value => { setFile(value.file); }} /><p role="status">{file ? `Arquivo recuperado: ${file.name} (${file.size} bytes)` : 'Aguardando arquivo'}</p></div>;
}
function App() {
  const route = useLocation();
  React.useEffect(() => {
    const id = route.pathname.match(/^\/studio\/projects\/([^/]+)$/)?.[1];
    history.replaceState(null, '', `/tests/browser/studio-workspace.html${id ? `?project=${encodeURIComponent(id)}` : ''}`);
  }, [route.pathname]);
  return <Routes><Route path="/studio/projects" element={<StudioProjectsWorkspace owner={owner} />} /><Route path="/studio/projects/:id" element={<Editor />} /><Route path="/studio/upload" element={<Handoff />} /></Routes>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><MemoryRouter initialEntries={[initialId ? `/studio/projects/${initialId}` : '/studio/projects']}><App /></MemoryRouter></React.StrictMode>);
