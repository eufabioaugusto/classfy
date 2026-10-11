import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { GlobalLoader } from '@/components/GlobalLoader';
import { StudioProjectsWorkspace } from '@/components/studio/editor/StudioProjectsWorkspace';

export default function StudioProjects() {
  const { user, role, loading } = useAuth();
  if (loading) return <GlobalLoader label="Abrindo seus projetos" />;
  if (!user) return <Navigate to="/auth" replace />;
  if (role !== 'creator' && role !== 'admin') return <Navigate to="/" replace />;
  return <StudioProjectsWorkspace key={user.id} owner={user.id} />;
}
