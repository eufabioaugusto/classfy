import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { CalendarClock, Camera, Check, MessageSquare, Radio, Server, ShieldCheck, VideoOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import { V2Badge, V2Button, V2Card, V2CardContent, V2CardHeader } from "@/components/v2";
import "@/styles/studio-v2.css";
import "@/styles/studio-publish-v2.css";

const experimentalLiveEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_EXPERIMENTAL_LIVE === "true";

export default function StudioLive() {
  const { user, role, loading } = useAuth();
  if (loading) return <div className="cf-v2 studio-publish-loading"><strong>Preparando o Studio...</strong></div>;
  if (!user || (role !== "creator" && role !== "admin")) return <Navigate to="/" replace />;
  if (experimentalLiveEnabled) return <ExperimentalDeviceLab />;

  return <AppShell variant="studio" title="Transmissões ao vivo" contentClassName="studio-page-shell">
    <CreatorTemplate className="studio-template studio-publish-template" width="wide" density="comfortable" header={<PageHeader title="Lives estão em preparação." description="Estamos construindo a infraestrutura necessária para transmitir com estabilidade, gravação e moderação." action={<V2Badge variant="neutral">Ainda não disponível</V2Badge>} />} toolbar={<StudioNavigation />}>
      <div className="live-roadmap-layout">
        <V2Card className="live-roadmap-hero" elevation="raised"><V2CardContent><span className="live-roadmap-icon"><Radio /></span><h2>Quando for liberado, o ao vivo será realmente ao vivo.</h2><p>Esta página não cria uma transmissão nem solicita acesso à sua câmera. O recurso só será aberto quando o servidor de mídia confirmar que a sala está pronta para receber e distribuir o sinal.</p><div className="live-roadmap-status"><ShieldCheck /><span><strong>Nenhuma live falsa será publicada</strong><small>Um conteúdo só poderá aparecer como “ao vivo” depois da confirmação do provedor.</small></span></div></V2CardContent></V2Card>
        <V2Card elevation="panel"><V2CardHeader><div className="studio-publish-heading"><span className="studio-icon"><Server /></span><div><h2>O que estamos preparando</h2><p>A experiência completa, da sala ao replay.</p></div></div></V2CardHeader><V2CardContent><ul className="live-roadmap-list"><li><Check /><span><strong>Transmissão estável</strong><small>Sala com câmera, microfone e distribuição para espectadores.</small></span></li><li><CalendarClock /><span><strong>Agora ou agendada</strong><small>Início imediato, sala de espera e horário marcado.</small></span></li><li><MessageSquare /><span><strong>Chat e moderação</strong><small>Controles para manter a conversa segura.</small></span></li><li><Camera /><span><strong>Replay como rascunho</strong><small>A gravação volta para o Studio e só é publicada depois da sua revisão.</small></span></li></ul></V2CardContent></V2Card>
      </div>
    </CreatorTemplate>
  </AppShell>;
}

function ExperimentalDeviceLab() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream]);
  const requestPreview = async () => {
    setError("");
    try { setStream(await navigator.mediaDevices.getUserMedia({ video: true, audio: true })); }
    catch { setError("Não foi possível abrir a câmera e o microfone neste navegador."); }
  };
  return <AppShell variant="studio" title="Laboratório de live" contentClassName="studio-page-shell"><CreatorTemplate className="studio-template studio-publish-template" width="wide" density="comfortable" header={<PageHeader title="Laboratório de dispositivos." description="Ambiente local para testar câmera e microfone. Ele não cria nem publica transmissões." action={<V2Badge variant="warning">Somente desenvolvimento</V2Badge>} />} toolbar={<StudioNavigation />}><V2Card elevation="panel"><V2CardHeader><div className="studio-publish-heading"><span className="studio-icon"><Camera /></span><div><h2>Prévia local</h2><p>O navegador só pedirá permissão depois do seu clique.</p></div></div></V2CardHeader><V2CardContent className="live-device-lab">{stream ? <video ref={(node) => { if (node) node.srcObject = stream; }} autoPlay muted playsInline /> : <div><VideoOff /><p>Nenhum dispositivo aberto.</p><V2Button onClick={() => void requestPreview()}>Testar câmera e microfone</V2Button></div>}{error && <p className="studio-inline-error">{error}</p>}</V2CardContent></V2Card></CreatorTemplate></AppShell>;
}
