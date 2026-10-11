import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clapperboard, LoaderCircle } from 'lucide-react';
import { V2Button } from '@/components/v2';
import { parseStudioHandoff, readStudioHandoff, type StudioHandoff } from '@/lib/studio/editor/handoff';

export function StudioEditorHandoff({ owner, kind, disabled, onUse }: {
  owner: string; kind: string; disabled: boolean; onUse: (handoff: StudioHandoff) => void | Promise<void>;
}) {
  const [params] = useSearchParams(), navigate = useNavigate();
  const projectId = params.get('studioProject'), revision = params.get('studioRevision');
  const scope = JSON.stringify([owner, kind, projectId, revision]);
  const current = useRef(scope); current.current = scope;
  const latest = useRef({ disabled, onUse }); latest.current = { disabled, onUse };
  const operation = useRef<symbol | null>(null);
  const [state, setState] = useState<{ scope: string; handoff?: StudioHandoff; error?: string; busy?: boolean }>({ scope });
  useEffect(() => {
    let active = true; operation.current = null; setState({ scope });
    const requestParams = new URLSearchParams();
    if (projectId !== null) requestParams.set('studioProject', projectId);
    if (revision !== null) requestParams.set('studioRevision', revision);
    void (async () => {
      try {
        const request = parseStudioHandoff(requestParams);
        if (!request || !owner) return;
        const handoff = await readStudioHandoff(owner, request, kind);
        if (active && current.current === scope) setState({ scope, handoff });
      } catch (error) {
        if (active && current.current === scope) setState({ scope, error: error instanceof Error ? error.message : 'Não foi possível abrir o arquivo do editor.' });
      }
    })();
    return () => { active = false; operation.current = null; };
  }, [scope, owner, kind, projectId, revision]);
  if (projectId === null && revision === null) return null;
  const visible = state.scope === scope ? state : { scope };
  async function selectPreparedFile() {
    if (disabled || !visible.handoff || operation.current || current.current !== scope) return;
    const token = Symbol('studio-handoff'); operation.current = token;
    setState({ ...visible, busy: true });
    try {
      const request = parseStudioHandoff(params);
      if (!request) return;
      const handoff = await readStudioHandoff(owner, request, kind);
      if (operation.current !== token || current.current !== scope || latest.current.disabled) return;
      await latest.current.onUse(handoff);
      if (operation.current === token && current.current === scope) setState({ scope, handoff });
    } catch (error) {
      if (operation.current === token && current.current === scope) setState({ scope, error: error instanceof Error ? error.message : 'Não foi possível selecionar o arquivo.' });
    } finally {
      if (operation.current === token) {
        operation.current = null;
        if (current.current === scope) setState(value => value.scope === scope ? { ...value, busy: false } : value);
      }
    }
  }
  return <aside className="studio-editor-handoff" aria-label="Arquivo preparado no editor">
    <Clapperboard size={22} aria-hidden="true" />
    <div>
      <strong>{visible.handoff ? visible.handoff.project.title : 'Publicação do editor'}</strong>
      <p role={visible.error ? 'alert' : undefined}>{visible.error || (visible.handoff
        ? 'Sua montagem continua salva. Confira o arquivo e complete os dados da publicação.' : 'Abrindo o arquivo preparado…')}</p>
    </div>
    <V2Button variant="secondary" leadingIcon={<ArrowLeft size={15} />} onClick={() => navigate(visible.handoff ? `/studio/projects/${visible.handoff.project.id}` : '/studio/projects')}>
      Voltar ao editor
    </V2Button>
    {visible.handoff && <V2Button disabled={disabled || visible.busy} leadingIcon={visible.busy ? <LoaderCircle size={15} className="animate-spin" /> : undefined} onClick={() => void selectPreparedFile()}>
      Usar arquivo do editor
    </V2Button>}
  </aside>;
}
