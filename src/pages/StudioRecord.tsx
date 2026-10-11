import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { GlobalLoader } from '@/components/GlobalLoader';
import { StudioRecordingWorkspace } from '@/components/studio/editor/StudioRecordingWorkspace';
import type { StudioKind } from '../../shared/studio';

export default function StudioRecord() {
  const { user, role, loading } = useAuth();
  const [params] = useSearchParams();
  if (loading) return <GlobalLoader label="Abrindo gravação" />;
  if (!user) return <Navigate to="/auth" replace />;
  if (role !== 'creator' && role !== 'admin') return <Navigate to="/" replace />;
  const kind = params.get('kind');
  const initialKind: StudioKind | undefined = kind === 'aula' || kind === 'short' || kind === 'podcast' ? kind : undefined;
  return <StudioRecordingWorkspace key={user.id} owner={user.id} initialKind={initialKind}
    initialTitle={params.get('title')?.slice(0, 160)} projectId={params.get('project') ?? undefined} />;
}
