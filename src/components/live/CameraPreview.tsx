import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Video, VideoOff, Mic, MicOff, RefreshCw, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

interface CameraPreviewProps {
  stream: MediaStream | null;
  isCameraOn: boolean;
  isMicOn: boolean;
  audioLevel: number;
  cameras: { deviceId: string; label: string }[];
  microphones: { deviceId: string; label: string }[];
  selectedCamera: string | null;
  selectedMicrophone: string | null;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onFlipCamera: () => void;
  onSelectCamera: (deviceId: string) => void;
  onSelectMicrophone: (deviceId: string) => void;
  className?: string;
  showControls?: boolean;
  showSettings?: boolean;
  size?: "sm" | "md" | "lg" | "full";
}

export function CameraPreview({
  stream,
  isCameraOn,
  isMicOn,
  audioLevel,
  cameras,
  microphones,
  selectedCamera,
  selectedMicrophone,
  onToggleCamera,
  onToggleMic,
  onFlipCamera,
  onSelectCamera,
  onSelectMicrophone,
  className,
  showControls = true,
  showSettings = true,
  size = "lg",
}: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const sizeClasses = {
    sm: "w-32 h-24",
    md: "w-64 h-48",
    lg: "w-full max-w-2xl aspect-video",
    full: "w-full h-full",
  };

  return (
    <div className={cn("relative rounded-xl overflow-hidden bg-black", sizeClasses[size], className)}>
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          !isCameraOn && "opacity-0"
        )}
      />
      
      {/* Camera Off Overlay */}
      {!isCameraOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <VideoOff className="w-12 h-12 text-muted-foreground" />
        </div>
      )}
      
      {/* Audio Level Indicator */}
      {isMicOn && (
        <div className="absolute top-3 right-3 w-1.5 h-16 bg-black/30 rounded-full overflow-hidden">
          <div
            className="w-full bg-green-500 transition-all duration-75 rounded-full"
            style={{
              height: `${Math.min(audioLevel * 100, 100)}%`,
              marginTop: "auto",
            }}
          />
        </div>
      )}
      
      {/* Controls */}
      {showControls && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full p-2">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "rounded-full h-10 w-10 text-white hover:bg-white/20",
              !isCameraOn && "bg-destructive hover:bg-destructive/80"
            )}
            onClick={onToggleCamera}
          >
            {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "rounded-full h-10 w-10 text-white hover:bg-white/20",
              !isMicOn && "bg-destructive hover:bg-destructive/80"
            )}
            onClick={onToggleMic}
          >
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </Button>
          
          {cameras.length > 1 && (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full h-10 w-10 text-white hover:bg-white/20"
              onClick={onFlipCamera}
            >
              <RefreshCw className="w-5 h-5" />
            </Button>
          )}
          
          {showSettings && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full h-10 w-10 text-white hover:bg-white/20"
                >
                  <Settings className="w-5 h-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="center">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Câmera</Label>
                    <Select value={selectedCamera || ""} onValueChange={onSelectCamera}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a câmera" />
                      </SelectTrigger>
                      <SelectContent>
                        {cameras.map((camera) => (
                          <SelectItem key={camera.deviceId} value={camera.deviceId}>
                            {camera.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Microfone</Label>
                    <Select value={selectedMicrophone || ""} onValueChange={onSelectMicrophone}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o microfone" />
                      </SelectTrigger>
                      <SelectContent>
                        {microphones.map((mic) => (
                          <SelectItem key={mic.deviceId} value={mic.deviceId}>
                            {mic.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Nível do Áudio</Label>
                    <Progress value={audioLevel * 100} className="h-2" />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
}
