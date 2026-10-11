import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { GlobalLoader } from '@/components/GlobalLoader';
import { StudioEditorWorkspace } from '@/components/studio/editor/StudioEditorWorkspace';

export default function StudioEditor() {
  const { user, role, loading } = useAuth();
  const { projectId } = useParams();
  if (loading) return <GlobalLoader label="Abrindo o editor" />;
  if (!user) return <Navigate to="/auth" replace />;
  if (role !== 'creator' && role !== 'admin') return <Navigate to="/" replace />;
  if (!projectId) return <Navigate to="/studio/projects" replace />;
  return <StudioEditorWorkspace key={`${user.id}:${projectId}`} owner={user.id} projectId={projectId} />;
}
