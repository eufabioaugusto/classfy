import { useState, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export type CompressionQuality = 'high' | 'balanced' | 'fast';

export interface CompressionOptions {
  quality?: CompressionQuality;
  maxWidth?: number;
  maxHeight?: number;
  targetBitrate?: string;
  trimStart?: number;
  trimEnd?: number;
}

export interface CompressionState {
  isLoading: boolean;
  isCompressing: boolean;
  progress: number;
  stage: 'idle' | 'loading' | 'analyzing' | 'compressing' | 'finalizing' | 'complete' | 'error';
  message: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}

interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
  bitrate: number;
}

const QUALITY_PRESETS: Record<CompressionQuality, { crf: number; preset: string; audioBitrate: string }> = {
  high: { crf: 23, preset: 'slow', audioBitrate: '192k' },
  balanced: { crf: 28, preset: 'medium', audioBitrate: '128k' },
  fast: { crf: 32, preset: 'veryfast', audioBitrate: '96k' },
};

// Compression thresholds
const SIZE_THRESHOLD_MB = 50; // Only compress if file > 50MB
const BITRATE_THRESHOLD_KBPS = 8000; // Only compress if bitrate > 8Mbps

export function useVideoCompression() {
  const [state, setState] = useState<CompressionState>({
    isLoading: false,
    isCompressing: false,
    progress: 0,
    stage: 'idle',
    message: '',
    originalSize: 0,
    compressedSize: 0,
    compressionRatio: 0,
  });

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const abortRef = useRef(false);

  const loadFFmpeg = useCallback(async () => {
    if (ffmpegRef.current?.loaded) return ffmpegRef.current;

    setState(prev => ({ ...prev, isLoading: true, stage: 'loading', message: 'Carregando compressor...' }));

    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;

    ffmpeg.on('progress', ({ progress, time }) => {
      const percent = Math.min(Math.round(progress * 100), 99);
      setState(prev => ({
        ...prev,
        progress: percent,
        message: `Comprimindo... ${percent}%`,
      }));
    });

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    try {
      // Load FFmpeg with CDN URLs for SharedArrayBuffer support
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      setState(prev => ({ ...prev, isLoading: false, message: '' }));
      return ffmpeg;
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        stage: 'error',
        message: 'Erro ao carregar compressor. Usando upload direto.',
      }));
      throw error;
    }
  }, []);

  const getVideoMetadata = useCallback((file: File): Promise<VideoMetadata> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      video.onloadedmetadata = () => {
        const duration = video.duration;
        const bitrate = (file.size * 8) / duration / 1000; // kbps
        
        resolve({
          width: video.videoWidth,
          height: video.videoHeight,
          duration,
          bitrate,
        });
        
        URL.revokeObjectURL(video.src);
      };

      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Failed to load video metadata'));
      };

      video.src = URL.createObjectURL(file);
    });
  }, []);

  const shouldCompress = useCallback(async (file: File): Promise<{ compress: boolean; reason: string }> => {
    const fileSizeMB = file.size / (1024 * 1024);
    
    // Skip if file is small
    if (fileSizeMB < SIZE_THRESHOLD_MB) {
      return { compress: false, reason: `Arquivo pequeno (${fileSizeMB.toFixed(1)}MB < ${SIZE_THRESHOLD_MB}MB)` };
    }

    try {
      const metadata = await getVideoMetadata(file);
      
      // Check bitrate
      if (metadata.bitrate < BITRATE_THRESHOLD_KBPS) {
        return { compress: false, reason: `Bitrate já otimizado (${(metadata.bitrate / 1000).toFixed(1)}Mbps)` };
      }

      return { 
        compress: true, 
        reason: `Otimizando: ${fileSizeMB.toFixed(0)}MB, ${(metadata.bitrate / 1000).toFixed(1)}Mbps, ${metadata.width}x${metadata.height}` 
      };
    } catch (error) {
      // If we can't read metadata, still try to compress large files
      if (fileSizeMB > 100) {
        return { compress: true, reason: 'Arquivo grande, comprimindo...' };
      }
      return { compress: false, reason: 'Não foi possível analisar o vídeo' };
    }
  }, [getVideoMetadata]);

  const compressVideo = useCallback(async (
    file: File,
    options: CompressionOptions = {}
  ): Promise<File> => {
    const {
      quality = 'balanced',
      maxWidth = 1920,
      maxHeight = 1080,
      trimStart,
      trimEnd,
    } = options;

    abortRef.current = false;

    setState(prev => ({
      ...prev,
      stage: 'analyzing',
      message: 'Analisando vídeo...',
      originalSize: file.size,
      compressedSize: 0,
      compressionRatio: 0,
    }));

    // Get metadata first (needed for trim check)
    let metadata: VideoMetadata;
    try {
      metadata = await getVideoMetadata(file);
    } catch {
      metadata = { width: 1920, height: 1080, duration: 0, bitrate: 0 };
    }

    // Check if trim is needed
    const needsTrim = (trimStart !== undefined && trimStart > 0.5) ||
                      (trimEnd !== undefined && metadata.duration > 0 && trimEnd < metadata.duration - 0.5);

    // Check if compression is needed
    const { compress, reason } = await shouldCompress(file);
    
    if (!compress && !needsTrim) {
      console.log('Skipping processing:', reason);
      setState(prev => ({
        ...prev,
        stage: 'complete',
        message: reason,
        compressedSize: file.size,
        compressionRatio: 0,
      }));
      return file;
    }

    try {
      const ffmpeg = await loadFFmpeg();
      if (!ffmpeg) throw new Error('FFmpeg not loaded');

      if (abortRef.current) throw new Error('Compression aborted');

      setState(prev => ({
        ...prev,
        isCompressing: true,
        stage: 'compressing',
        progress: 0,
        message: needsTrim ? 'Cortando e processando...' : 'Iniciando compressão...',
      }));

      const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
      const outputName = 'output.mp4';

      await ffmpeg.writeFile(inputName, await fetchFile(file));

      if (abortRef.current) throw new Error('Compression aborted');

      // Build FFmpeg args
      const args: string[] = [];

      // Seek before input for fast seeking (when trimming)
      if (needsTrim && trimStart && trimStart > 0.5) {
        args.push('-ss', trimStart.toFixed(2));
      }

      args.push('-i', inputName);

      // Trim duration
      if (needsTrim) {
        const clipDuration = (trimEnd ?? metadata.duration) - (trimStart ?? 0);
        args.push('-t', clipDuration.toFixed(2));
      }

      if (compress) {
        // Full re-encoding with compression
        const preset = QUALITY_PRESETS[quality];

        if (metadata.width > maxWidth || metadata.height > maxHeight) {
          const scale = Math.min(maxWidth / metadata.width, maxHeight / metadata.height);
          const newWidth = Math.floor(metadata.width * scale / 2) * 2;
          const newHeight = Math.floor(metadata.height * scale / 2) * 2;
          args.push('-vf', `scale=${newWidth}:${newHeight}`);
        }

        args.push(
          '-c:v', 'libx264',
          '-preset', preset.preset,
          '-crf', preset.crf.toString(),
          '-c:a', 'aac',
          '-b:a', preset.audioBitrate,
        );
      } else {
        // Fast copy (trim only, no re-encoding)
        args.push('-c', 'copy');
      }

      args.push('-movflags', '+faststart', '-y', outputName);

      console.log('FFmpeg command:', args.join(' '));

      await ffmpeg.exec(args);

      if (abortRef.current) throw new Error('Compression aborted');

      setState(prev => ({
        ...prev,
        stage: 'finalizing',
        progress: 99,
        message: 'Finalizando...',
      }));

      const data = await ffmpeg.readFile(outputName);
      let processedBlob: Blob;
      if (typeof data === 'string') {
        processedBlob = new Blob([data], { type: 'video/mp4' });
      } else {
        const copy = new Uint8Array(data.length);
        copy.set(data);
        processedBlob = new Blob([copy], { type: 'video/mp4' });
      }

      const processedFile = new File(
        [processedBlob],
        file.name.replace(/\.[^/.]+$/, '.mp4'),
        { type: 'video/mp4' }
      );

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);

      const ratio = ((file.size - processedFile.size) / file.size) * 100;

      setState(prev => ({
        ...prev,
        isCompressing: false,
        stage: 'complete',
        progress: 100,
        message: needsTrim
          ? `Cortado${ratio > 5 ? ` e comprimido ${ratio.toFixed(0)}%` : ''}!`
          : `Comprimido! Redução de ${ratio.toFixed(0)}%`,
        compressedSize: processedFile.size,
        compressionRatio: ratio,
      }));

      return processedFile;
    } catch (error: any) {
      console.error('Processing error:', error);
      
      setState(prev => ({
        ...prev,
        isCompressing: false,
        stage: 'error',
        message: error.message === 'Compression aborted' 
          ? 'Processamento cancelado' 
          : 'Erro no processamento. Usando arquivo original.',
        compressedSize: file.size,
        compressionRatio: 0,
      }));

      return file;
    }
  }, [loadFFmpeg, shouldCompress, getVideoMetadata]);

  const abort = useCallback(() => {
    abortRef.current = true;
    setState(prev => ({
      ...prev,
      isCompressing: false,
      stage: 'idle',
      message: 'Compressão cancelada',
      progress: 0,
    }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current = false;
    setState({
      isLoading: false,
      isCompressing: false,
      progress: 0,
      stage: 'idle',
      message: '',
      originalSize: 0,
      compressedSize: 0,
      compressionRatio: 0,
    });
  }, []);

  return {
    ...state,
    compressVideo,
    shouldCompress,
    abort,
    reset,
  };
}
