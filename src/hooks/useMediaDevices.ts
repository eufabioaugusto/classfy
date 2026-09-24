import { useState, useEffect, useCallback, useRef } from "react";

interface MediaDevice {
  deviceId: string;
  label: string;
  kind: "videoinput" | "audioinput" | "audiooutput";
}

interface UseMediaDevicesReturn {
  // Stream
  stream: MediaStream | null;
  isStreamActive: boolean;
  
  // Devices
  cameras: MediaDevice[];
  microphones: MediaDevice[];
  speakers: MediaDevice[];
  
  // Selected devices
  selectedCamera: string | null;
  selectedMicrophone: string | null;
  
  // States
  isLoading: boolean;
  error: string | null;
  hasPermission: boolean;
  
  // Camera controls
  isCameraOn: boolean;
  isMicOn: boolean;
  isFacingUser: boolean;
  
  // Audio levels
  audioLevel: number;
  
  // Actions
  startStream: (constraints?: MediaStreamConstraints) => Promise<void>;
  stopStream: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  flipCamera: () => Promise<void>;
  selectCamera: (deviceId: string) => Promise<void>;
  selectMicrophone: (deviceId: string) => Promise<void>;
  requestPermissions: () => Promise<boolean>;
}

const widescreen = { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } };

export function useMediaDevices(): UseMediaDevicesReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDevice[]>([]);
  const [microphones, setMicrophones] = useState<MediaDevice[]>([]);
  const [speakers, setSpeakers] = useState<MediaDevice[]>([]);
  
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [selectedMicrophone, setSelectedMicrophone] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isFacingUser, setIsFacingUser] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Enumerate available devices
  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const videoInputs = devices
        .filter(d => d.kind === "videoinput")
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${d.deviceId.slice(0, 5)}`,
          kind: d.kind as "videoinput",
        }));
      
      const audioInputs = devices
        .filter(d => d.kind === "audioinput")
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 5)}`,
          kind: d.kind as "audioinput",
        }));
      
      const audioOutputs = devices
        .filter(d => d.kind === "audiooutput")
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker ${d.deviceId.slice(0, 5)}`,
          kind: d.kind as "audiooutput",
        }));
      
      setCameras(videoInputs);
      setMicrophones(audioInputs);
      setSpeakers(audioOutputs);
      
      // Set defaults if not selected
      if (!selectedCamera && videoInputs.length > 0) {
        setSelectedCamera(videoInputs[0].deviceId);
      }
      if (!selectedMicrophone && audioInputs.length > 0) {
        setSelectedMicrophone(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.error("Error enumerating devices:", err);
    }
  }, [selectedCamera, selectedMicrophone]);

  // Request permissions
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      setError(null);
      
      const tempStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      // Stop tracks immediately, just wanted permissions
      tempStream.getTracks().forEach(track => track.stop());
      
      setHasPermission(true);
      await enumerateDevices();
      
      return true;
    } catch (err: any) {
      setError(err.message || "Permissão negada para câmera/microfone");
      setHasPermission(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [enumerateDevices]);

  // Start media stream
  const startStream = useCallback(async (constraints?: MediaStreamConstraints) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Stop existing stream
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      if (audioContextRef.current) void audioContextRef.current.close();
      audioContextRef.current = null;
      
      const defaultConstraints: MediaStreamConstraints = {
        video: selectedCamera
          ? { ...widescreen, deviceId: { exact: selectedCamera }, facingMode: isFacingUser ? "user" : "environment" }
          : { ...widescreen, facingMode: isFacingUser ? "user" : "environment" },
        audio: selectedMicrophone
          ? { deviceId: { exact: selectedMicrophone } }
          : true,
      };
      
      const mediaStream = await navigator.mediaDevices.getUserMedia(
        constraints || defaultConstraints
      );
      
      setStream(mediaStream);
      streamRef.current = mediaStream;
      setHasPermission(true);
      setIsCameraOn(true);
      setIsMicOn(true);
      
      // Set up audio level monitoring
      setupAudioMonitoring(mediaStream);
      
      // Enumerate devices again to get labels
      await enumerateDevices();
    } catch (err: any) {
      console.error("Error starting stream:", err);
      setError(err.message || "Erro ao acessar câmera/microfone");
      setHasPermission(false);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCamera, selectedMicrophone, isFacingUser, enumerateDevices]);

  // Setup audio level monitoring
  const setupAudioMonitoring = useCallback((mediaStream: MediaStream) => {
    try {
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(mediaStream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      
      let lastSample = 0;
      const updateLevel = (time: number) => {
        // A 60 fps React update can compete with video encoding on mobile devices.
        if (analyserRef.current && time - lastSample >= 120) {
          lastSample = time;
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          setAudioLevel(average / 255);
        }
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    } catch (err) {
      console.error("Error setting up audio monitoring:", err);
    }
  }, []);

  // Stop media stream
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStream(null);
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    setAudioLevel(0);
  }, []);

  // Toggle camera
  const toggleCamera = useCallback(() => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  }, [stream]);

  // Toggle microphone
  const toggleMic = useCallback(() => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  }, [stream]);

  // Flip camera (front/back)
  const flipCamera = useCallback(async () => {
    setIsFacingUser(prev => !prev);
    
    if (stream) {
      await startStream({
        video: { ...widescreen, facingMode: !isFacingUser ? "user" : "environment" },
        audio: selectedMicrophone
          ? { deviceId: { exact: selectedMicrophone } }
          : true,
      });
    }
  }, [stream, isFacingUser, selectedMicrophone, startStream]);

  // Select camera
  const selectCamera = useCallback(async (deviceId: string) => {
    setSelectedCamera(deviceId);
    
    if (stream) {
      await startStream({
        video: { ...widescreen, deviceId: { exact: deviceId } },
        audio: selectedMicrophone
          ? { deviceId: { exact: selectedMicrophone } }
          : true,
      });
    }
  }, [stream, selectedMicrophone, startStream]);

  // Select microphone
  const selectMicrophone = useCallback(async (deviceId: string) => {
    setSelectedMicrophone(deviceId);
    
    if (stream) {
      await startStream({
        video: selectedCamera
          ? { ...widescreen, deviceId: { exact: selectedCamera } }
          : widescreen,
        audio: { deviceId: { exact: deviceId } },
      });
    }
  }, [stream, selectedCamera, startStream]);

  // Listen for device changes
  useEffect(() => {
    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerateDevices);
    };
  }, [enumerateDevices]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  return {
    stream,
    isStreamActive: !!stream,
    cameras,
    microphones,
    speakers,
    selectedCamera,
    selectedMicrophone,
    isLoading,
    error,
    hasPermission,
    isCameraOn,
    isMicOn,
    isFacingUser,
    audioLevel,
    startStream,
    stopStream,
    toggleCamera,
    toggleMic,
    flipCamera,
    selectCamera,
    selectMicrophone,
    requestPermissions,
  };
}
