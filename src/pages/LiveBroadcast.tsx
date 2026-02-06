import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Radio, Users, Gift, PhoneOff, Loader2 } from "lucide-react";
import { useState, useRef } from "react";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useLiveChat } from "@/hooks/useLiveChat";
import { useLiveViewers } from "@/hooks/useLiveViewers";
import { CameraPreview } from "@/components/live/CameraPreview";
import { LiveChat } from "@/components/live/LiveChat";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Live {
  id: string;
  title: string;
  description: string | null;
  status: string;
  started_at: string | null;
  viewer_count: number;
  peak_viewers: number;
  total_gifts_value: number;
  creator_id: string;
}

export default function LiveBroadcast() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [live, setLive] = useState<Live | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEnding, setIsEnding] = useState(false);
  const [showEndDialog, setShowEndDialog] = useState(false);
  const [duration, setDuration] = useState(0);

  const {
    stream,
    isCameraOn,
    isMicOn,
    audioLevel,
    cameras,
    microphones,
    selectedCamera,
    selectedMicrophone,
    toggleCamera,
    toggleMic,
    flipCamera,
    selectCamera,
    selectMicrophone,
    startStream,
    stopStream,
  } = useMediaDevices();

  const { messages, pinnedMessage, isLoading: chatLoading, isSending, sendMessage, deleteMessage, pinMessage, unpinMessage } = useLiveChat(id || null);
  const { viewerCount, peakViewers } = useLiveViewers(id || null);

  // Fetch live data
  useEffect(() => {
    if (!id || !user) return;

    const fetchLive = async () => {
      const { data, error } = await supabase
        .from("lives")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) {
        toast.error("Live não encontrada");
        navigate("/studio");
        return;
      }

      if (data.creator_id !== user.id) {
        toast.error("Você não é o dono desta live");
        navigate("/studio");
        return;
      }

      setLive(data);
      setIsLoading(false);
      startStream();
    };

    fetchLive();

    return () => {
      stopStream();
    };
  }, [id, user]);

  // Duration timer
  useEffect(() => {
    if (!live?.started_at) return;

    const startTime = new Date(live.started_at).getTime();
    const interval = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [live?.started_at]);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0
      ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      : `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleEndLive = async () => {
    if (!id) return;

    setIsEnding(true);

    try {
      await supabase
        .from("lives")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
        })
        .eq("id", id);

      stopStream();
      toast.success("Live encerrada!");
      navigate("/studio/contents");
    } catch (error: any) {
      toast.error(error.message || "Erro ao encerrar live");
    } finally {
      setIsEnding(false);
      setShowEndDialog(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Main Video Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="flex items-center justify-between p-4 bg-black/80">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive rounded-full">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              <span className="text-sm font-medium">AO VIVO</span>
            </div>
            <span className="text-sm text-muted-foreground">{formatDuration(duration)}</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4" />
              <span>{viewerCount}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-yellow-500">
              <Gift className="w-4 h-4" />
              <span>R$ {(live?.total_gifts_value || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Video */}
        <div className="flex-1 relative">
          <CameraPreview
            stream={stream}
            isCameraOn={isCameraOn}
            isMicOn={isMicOn}
            audioLevel={audioLevel}
            cameras={cameras}
            microphones={microphones}
            selectedCamera={selectedCamera}
            selectedMicrophone={selectedMicrophone}
            onToggleCamera={toggleCamera}
            onToggleMic={toggleMic}
            onFlipCamera={flipCamera}
            onSelectCamera={selectCamera}
            onSelectMicrophone={selectMicrophone}
            size="full"
          />
        </div>

        {/* Bottom Controls */}
        <div className="p-4 bg-black/80 flex items-center justify-center gap-4">
          <Button
            variant="destructive"
            size="lg"
            onClick={() => setShowEndDialog(true)}
            className="gap-2"
          >
            <PhoneOff className="w-5 h-5" />
            Encerrar Live
          </Button>
        </div>
      </div>

      {/* Chat Sidebar */}
      <div className="w-80 border-l border-border flex flex-col bg-card">
        <div className="p-3 border-b">
          <h3 className="font-semibold">{live?.title}</h3>
          <p className="text-xs text-muted-foreground">Pico: {peakViewers} espectadores</p>
        </div>
        <div className="flex-1">
          <LiveChat
            messages={messages}
            pinnedMessage={pinnedMessage}
            isLoading={chatLoading}
            isSending={isSending}
            onSendMessage={sendMessage}
            onDeleteMessage={deleteMessage}
            onPinMessage={pinMessage}
            onUnpinMessage={unpinMessage}
            isCreator={true}
            className="h-full"
          />
        </div>
      </div>

      {/* End Live Dialog */}
      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar Transmissão?</AlertDialogTitle>
            <AlertDialogDescription>
              Sua live será finalizada. Você poderá publicar a gravação depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar Live</AlertDialogCancel>
            <AlertDialogAction onClick={handleEndLive} disabled={isEnding} className="bg-destructive hover:bg-destructive/90">
              {isEnding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Encerrar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
