import { Activity, Copy } from "lucide-react";
import { toast } from "sonner";
import type { LiveDiagnosticReport } from "@/hooks/useLiveDiagnostics";

type Props = {
  report: LiveDiagnosticReport;
  lastSavedAt: string | null;
  saveError: boolean;
  dark?: boolean;
};

const routeNames: Record<LiveDiagnosticReport["route"], string> = {
  waiting: "Aguardando vídeo", webrtc: "Tempo real", hls: "Reserva", replay: "Gravação", ended: "Encerrada",
};

const fallbackNames: Record<LiveDiagnosticReport["fallbackReason"], string> = {
  none: "—", token: "Acesso à sala demorou", connect: "Conexão direta demorou",
  timeout: "Vídeo demorou a chegar", host_left: "Host saiu da sala",
  room_left: "Sala desconectada", hls_error: "Reserva indisponível",
};

const qualityNames: Record<LiveDiagnosticReport["quality"], string> = {
  excellent: "Excelente", good: "Boa", poor: "Instável", lost: "Sem conexão", unknown: "Aguardando dados",
};

function summary(report: LiveDiagnosticReport) {
  if (report.route === "hls") return "O vídeo está usando a rota de reserva. Ela costuma acumular mais atraso; confira o motivo abaixo.";
  if (report.route === "webrtc" && (report.quality === "poor" || report.quality === "lost" || (report.metrics.stalls ?? 0) > 0)) {
    return "A conexão direta apresentou instabilidade. Compare perda de pacotes, pausas e rede nos dois aparelhos.";
  }
  if (report.route === "webrtc") return "O vídeo está na conexão direta. Compare os horários do chat e o teste de fala para identificar onde está o atraso.";
  if (report.route === "ended") return "A transmissão terminou. Os últimos horários e métricas continuam disponíveis para comparação.";
  return "Aguardando o vídeo. O painel vai mostrar o tempo de entrada e a rota usada assim que a transmissão começar.";
}

const eventNames: Record<string, string> = {
  page_opened: "Página aberta", preview_ready: "Prévia pronta", start_clicked: "Iniciar solicitado",
  room_connected: "Sala conectada", tracks_published: "Câmera e microfone enviados",
  bridge_started: "Preparação da entrega iniciada", bridge_stalled: "Preparação demorando", bridge_restarted: "Entrega reiniciada", public_live: "Disponível ao público",
  viewer_live: "Live detectada", rtc_connected: "Conexão direta estabelecida",
  viewer_token_requested: "Acesso direto solicitado", viewer_token_ready: "Acesso direto pronto", viewer_token_failed: "Acesso direto falhou",
  rtc_connect_started: "Conectando à sala", rtc_connect_failed: "Conexão à sala falhou", rtc_track_subscribed: "Vídeo direto recebido",
  rtc_first_frame: "Primeiro quadro direto", hls_first_frame: "Primeiro quadro da reserva",
  fallback: "Reserva acionada", reconnecting: "Reconectando", reconnected: "Reconectado",
  audio_blocked: "Som bloqueado pelo navegador", chat_sent: "Mensagem enviada",
  chat_received: "Mensagem recebida", playback_stalled: "Vídeo aguardando dados", end_requested: "Encerrar solicitado",
  end_confirmed: "Encerramento confirmado", ended: "Transmissão encerrada",
};

const number = (value: number | null | undefined, unit = "", digits = 0) =>
  typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "—";
const time = (value: string) => new Date(value).toLocaleTimeString("pt-BR", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });

export function LiveDiagnosticsPanel({ report, lastSavedAt, saveError, dark = false }: Props) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      toast.success("Dados da conexão copiados.");
    } catch { toast.error("Não foi possível copiar os dados da conexão."); }
  };

  return <details className={`min-w-0 rounded-xl border text-sm ${dark ? "border-white/15 bg-white/[0.04] text-white" : "border-border bg-card text-foreground"}`}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 font-medium [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2"><Activity className="h-4 w-4" /> {routeNames[report.route]}</span>
      <span className="text-xs opacity-70">Detalhes</span>
    </summary>
    <div className={`space-y-3 border-t p-3 ${dark ? "border-white/15" : "border-border"}`}>
      <p className="text-xs opacity-70">Dados técnicos para o beta. Não registra áudio, vídeo ou texto das mensagens.</p>
      <p className={`rounded-lg p-2 text-xs ${dark ? "bg-white/10" : "bg-muted"}`}>{summary(report)}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <div>Aparelho <strong className="block text-sm">{report.deviceClass === "mobile" ? "Celular" : "Computador"}</strong></div>
        <div>Rede estimada <strong className="block text-sm">{report.networkHint === "unknown" ? "—" : report.networkHint}</strong></div>
        <div>Rota <strong className="block text-sm">{routeNames[report.route]}</strong></div>
        <div>Conexão <strong className="block text-sm">{qualityNames[report.quality]}</strong></div>
        <div>{report.role === "host" ? "Até ficar ao vivo" : "Primeiro vídeo"} <strong className="block text-sm">{number(report.metrics.firstFrameMs, " ms")}</strong></div>
        {report.role === "viewer" && <div>Acesso à sala <strong className="block text-sm">{number(report.metrics.viewerTokenMs, " ms")}</strong></div>}
        {report.role === "viewer" && <div>Conexão à sala <strong className="block text-sm">{number(report.metrics.roomConnectMs, " ms")}</strong></div>}
        {report.role === "viewer" && <div>Vídeo direto recebido <strong className="block text-sm">{number(report.metrics.viewerTrackMs, " ms")}</strong></div>}
        <div>Taxa de vídeo <strong className="block text-sm">{number(report.metrics.bitrateKbps, " kb/s")}</strong></div>
        <div>Taxa de áudio <strong className="block text-sm">{number(report.metrics.audioBitrateKbps, " kb/s")}</strong></div>
        <div>Quadros/s <strong className="block text-sm">{number(report.metrics.framesPerSecond, "", 1)}</strong></div>
        <div>Pacotes perdidos <strong className="block text-sm">{number(report.metrics.packetsLost)}</strong></div>
        <div>Oscilação <strong className="block text-sm">{number(report.metrics.jitterMs, " ms")}</strong></div>
        <div>Áudio perdido <strong className="block text-sm">{number(report.metrics.audioPacketsLost)}</strong></div>
        <div>Oscilação do áudio <strong className="block text-sm">{number(report.metrics.audioJitterMs, " ms")}</strong></div>
        <div>Rede (RTT) <strong className="block text-sm">{number(report.metrics.rttMs, " ms")}</strong></div>
        <div>Buffer <strong className="block text-sm">{number(report.metrics.bufferSeconds, " s", 1)}</strong></div>
        <div>Atraso do player <strong className="block text-sm">{number(report.metrics.playbackLatencySeconds, " s", 1)}</strong></div>
        <div>Reconexões <strong className="block text-sm">{number(report.metrics.reconnects)}</strong></div>
        <div>Pausas de carga <strong className="block text-sm">{number(report.metrics.stalls)}</strong></div>
        <div>Quadros perdidos <strong className="block text-sm">{number(report.metrics.droppedFrames)}</strong></div>
        <div>Motivo da reserva <strong className="block break-words text-sm">{fallbackNames[report.fallbackReason]}</strong></div>
        <div>Teste do relógio <strong className="block text-sm">{number(report.clockProbeMs, " ms")}</strong></div>
      </div>
      {[report.lastChatSent, report.lastChatReceived].filter(Boolean).map((chat) => chat && <div key={chat.direction} className={`rounded-lg border p-2 text-xs ${dark ? "border-white/15" : "border-border"}`}>
        <strong>Última mensagem {chat.direction === "sent" ? "enviada" : "recebida"}</strong>
        <p>ID {chat.messageId.slice(0, 8)} · servidor {time(chat.serverCreatedAt)} · este aparelho {time(chat.clientObservedAt)}</p>
        <p>{chat.direction === "sent" ? `Resposta do servidor: ${number(chat.acknowledgementMs, " ms")}` : `Chegada após registro: ${number(chat.approximateTransitMs, " ms")} (estimativa com relógio ajustado)`}</p>
      </div>)}
      <div className="max-h-32 space-y-1 overflow-auto text-xs opacity-80">
        {report.events.slice(-12).map((event, index) => <p key={`${event.at}-${index}`}>{time(event.at)} · {eventNames[event.type] ?? event.type}</p>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="opacity-70">{saveError ? "Não foi possível salvar; copie os dados da conexão" : lastSavedAt ? `Salvo às ${time(lastSavedAt)}` : "Preparando registro..."}</span>
        <button type="button" onClick={() => void copy()} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-medium ${dark ? "border-white/25 hover:bg-white/10" : "border-border hover:bg-muted"}`}><Copy className="h-3.5 w-3.5" /> Copiar dados</button>
      </div>
    </div>
  </details>;
}
