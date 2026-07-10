// Dev-only Media Consumption Monitor for Classfy Mobile (React Native / Expo)
// This file is fully inert in production builds.

let initialized = false;
const requestCounts = new Map<string, number>();

// Declare dev global variable for TypeScript safety
declare const __DEV__: boolean;

export function initMobileMediaMonitor() {
  // Only run in development
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (initialized) return;
  initialized = true;

  console.log('🚀 Classfy Mobile Media Consumption Monitor initialized in development mode.');

  const originalFetch = global.fetch;
  global.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
    
    // Skip metro packager bundle, hot reload, logs, and development helpers
    if (
      url.includes('/logs') || 
      url.includes('/symbolicate') || 
      url.includes('hot-update') || 
      url.includes('debugger') ||
      url.includes('localhost:') || 
      url.includes('192.168.') || // local development ip
      url.includes('10.0.2.2:')    // android emulator
    ) {
      return originalFetch.apply(this, arguments as any);
    }

    const startTime = Date.now();
    try {
      const response = await originalFetch.apply(this, arguments as any);
      const duration = Date.now() - startTime;
      
      logMobileRequest(url, response, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logMobileRequest(url, null, duration, error);
      throw error;
    }
  };
}

function logMobileRequest(url: string, response: Response | null, duration: number, error?: any) {
  const lowerUrl = url.toLowerCase();
  let ext = '';
  
  try {
    // Extract file extension from URL path
    const path = url.split('?')[0];
    const parts = path.split('.');
    if (parts.length > 1) {
      ext = parts.pop()!.toLowerCase();
    }
  } catch {}

  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'mkv', 'm3u8', 'ts'];
  const audioExts = ['mp3', 'wav', 'aac', 'flac', 'm4a'];

  let type: 'image' | 'video' | 'audio' | 'other' = 'other';
  if (imageExts.includes(ext) || lowerUrl.includes('content-type=image')) type = 'image';
  else if (videoExts.includes(ext) || lowerUrl.includes('content-type=video')) type = 'video';
  else if (audioExts.includes(ext) || lowerUrl.includes('content-type=audio')) type = 'audio';

  const isSupabase = url.includes('.supabase.co/storage/v1') || url.includes('/storage/v1/object/');
  
  // We care about media requests or Supabase storage requests
  if (type === 'other' && !isSupabase) return;

  // Track session load counts
  const count = (requestCounts.get(url) || 0) + 1;
  requestCounts.set(url, count);

  let sizeBytes = 0;
  if (response) {
    const lenStr = response.headers.get('content-length');
    if (lenStr) {
      sizeBytes = parseInt(lenStr, 10);
    }
  }

  const sizeText = sizeBytes > 0 ? `${(sizeBytes / 1024).toFixed(1)} KB` : 'Unknown (CORS / Cached)';
  const durationText = `${duration}ms`;
  const isDuplicate = count > 1;

  console.group(`📱 [MOBILE MEDIA LOG] ${type.toUpperCase()}`);
  console.log(`URL: ${url}`);
  console.log(`Status: ${response ? response.status : 'Failed/NetworkError'}`);
  console.log(`Size: ${sizeText}`);
  console.log(`Duration: ${durationText}`);
  console.log(`Supabase Storage: ${isSupabase ? '✅ Yes' : '❌ No'}`);
  console.log(`Session Call Count: ${count} ${isDuplicate ? '⚠️ DUPLICATE!' : ''}`);

  if (isDuplicate) {
    console.warn(`⚠️ Warning: Media URL requested ${count} times in the current session!`);
  }
  if (type === 'image' && sizeBytes > 300 * 1024) {
    console.warn(`🖼️ Warning: Thumbnail image is larger than 300 KB (${sizeText})!`);
  }
  console.groupEnd();
}
