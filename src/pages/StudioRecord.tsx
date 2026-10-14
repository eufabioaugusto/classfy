import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { GlobalLoader } from '@/components/GlobalLoader';
import { StudioRecordingWorkspace } from '@/components/studio/editor/StudioRecordingWorkspace';
import type { StudioKind } from '../../shared/studio';
import { useState } from 'react';
import { useStudioPremiumEntitlement } from '@/components/studio/editor/useStudioPremiumEntitlement';
import { StudioScenesUpgradeDialog } from '@/components/studio/editor/StudioScenesUpgradeDialog';

function StudioRecordSession({ owner, params }: { owner: string; params: URLSearchParams }) {
  const entitlement = useStudioPremiumEntitlement(owner);
  const [upgradeOpen, setUpgradeOpen] = useState(false), [upgradeFeature, setUpgradeFeature] = useState<'scenes' | 'iphone'>('scenes');
  const kind = params.get('kind');
  const initialKind: StudioKind | undefined = kind === 'aula' || kind === 'short' || kind === 'podcast' ? kind : undefined;
  return <>
    <StudioRecordingWorkspace owner={owner} initialKind={initialKind} initialTitle={params.get('title')?.slice(0, 160)}
      projectId={params.get('project') ?? undefined} canUseScenes={entitlement.canUseScenes} premiumLoading={entitlement.loading} onUpgradeScenes={() => { setUpgradeFeature('scenes'); setUpgradeOpen(true); }} onUpgradeRemote={() => { setUpgradeFeature('iphone'); setUpgradeOpen(true); }} />
    <StudioScenesUpgradeDialog owner={owner} open={upgradeOpen} onOpenChange={setUpgradeOpen} entitlement={entitlement} feature={upgradeFeature} />
  </>;
}

export default function StudioRecord() {
  const { user, role, loading } = useAuth();
  const [params] = useSearchParams();
  if (loading) return <GlobalLoader label="Abrindo gravação" />;
  if (!user) return <Navigate to="/auth" replace />;
  if (role !== 'creator' && role !== 'admin') return <Navigate to="/" replace />;
  return <StudioRecordSession key={user.id} owner={user.id} params={params} />;
}
