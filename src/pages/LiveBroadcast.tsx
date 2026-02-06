import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Users, Gift, PhoneOff, Loader2, MessageCircle, X, Video, VideoOff, Mic, MicOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useLiveChat } from "@/hooks/useLiveChat";
import { useLiveViewers } from "@/hooks/useLiveViewers";
import { CameraPreview } from "@/components/live/CameraPreview";
import { LiveChat } from "@/components/live/LiveChat";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
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
  const [showChat, setShowChat] = useState(false);
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

  // Count unread messages (simple approximation - messages received while chat is closed)
  const unreadCount = !showChat ? messages.length : 0;

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-white relative">
      {/* Fullscreen Video */}
      <div className="absolute inset-0">
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
          className="w-full h-full"
          showControls={false}
        />
      </div>

      {/* Top Bar Overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive rounded-full">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <span className="text-sm font-medium">AO VIVO</span>
          </div>
          <span className="text-sm text-white/80">{formatDuration(duration)}</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm bg-black/40 px-3 py-1.5 rounded-full">
            <Users className="w-4 h-4" />
            <span>{viewerCount}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-yellow-500 bg-black/40 px-3 py-1.5 rounded-full">
            <Gift className="w-4 h-4" />
            <span>R$ {(live?.total_gifts_value || 0).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Bottom Controls Overlay */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-4 pb-6 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-center gap-3">
          {/* Chat Toggle Button */}
          <Button
            variant="outline"
            size="default"
            onClick={() => setShowChat(!showChat)}
            className={cn(
              "gap-2 bg-black/50 border-white/20 hover:bg-white/20 text-white relative",
              showChat && "bg-white/20"
            )}
          >
            <MessageCircle className="w-4 h-4" />
            Chat
            {unreadCount > 0 && !showChat && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-accent text-accent-foreground text-xs rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </Button>

          {/* Camera Controls */}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleCamera}
            className={cn(
              "bg-black/50 border-white/20 hover:bg-white/20 text-white",
              !isCameraOn && "bg-destructive border-destructive hover:bg-destructive/80"
            )}
          >
            {isCameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={toggleMic}
            className={cn(
              "bg-black/50 border-white/20 hover:bg-white/20 text-white",
              !isMicOn && "bg-destructive border-destructive hover:bg-destructive/80"
            )}
          >
            {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </Button>

          {cameras.length > 1 && (
            <Button
              variant="outline"
              size="icon"
              onClick={flipCamera}
              className="bg-black/50 border-white/20 hover:bg-white/20 text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          )}

          {/* End Live Button */}
          <Button
            variant="destructive"
            size="default"
            onClick={() => setShowEndDialog(true)}
            className="gap-2"
          >
            <PhoneOff className="w-4 h-4" />
            Encerrar Live
          </Button>
        </div>
      </div>

      {/* Chat Overlay Panel */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="absolute top-0 right-0 bottom-0 w-80 z-20 flex flex-col bg-card/95 backdrop-blur-lg border-l border-border"
          >
            {/* Chat Header */}
            <div className="flex items-center justify-between p-3 border-b">
              <div>
                <h3 className="font-semibold text-sm">{live?.title}</h3>
                <p className="text-xs text-muted-foreground">Pico: {peakViewers} espectadores</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowChat(false)}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Chat Content */}
            <div className="flex-1 overflow-hidden">
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
          </motion.div>
        )}
      </AnimatePresence>

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
