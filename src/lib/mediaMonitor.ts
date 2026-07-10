// Dev-only Media Consumption Monitor for Classfy Web
// This monitor is fully inert in production and safe for Next.js / SSR.

export interface AuditEntry {
  id: string;
  url: string;
  mediaType: 'image' | 'video' | 'audio' | 'other';
  extension: string;
  route: string;
  sizeBytes: number;
  durationMs: number;
  status: number;
  isSupabase: boolean;
  timestamp: number;
  initiatorType: string;
}

// Global reference for current route
let currentRoute = typeof window !== 'undefined' ? window.location.pathname : '/';

// Cache for URL sizes to prevent duplicate network HEAD calls
const sizeCache = new Map<string, number>();

// In-memory callbacks for visual panel updates
const listeners = new Set<(entries: AuditEntry[]) => void>();

// Helper to determine media type and extension
export function getMediaTypeAndExt(urlStr: string): { type: 'image' | 'video' | 'audio' | 'other'; ext: string } {
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname;
    const parts = pathname.split('.');
    let ext = parts.length > 1 ? parts.pop()!.toLowerCase().split('?')[0] : '';
    
    // Clean up extension in case of hash/params (e.g. video.mp4#t=0.5)
    ext = ext.split('#')[0];

    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tiff', 'ico'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'mkv', 'flv', 'avi', 'm3u8', 'ts'];
    const audioExts = ['mp3', 'wav', 'aac', 'flac', 'm4a', 'wma'];

    if (imageExts.includes(ext)) return { type: 'image', ext };
    if (videoExts.includes(ext)) return { type: 'video', ext };
    if (audioExts.includes(ext)) return { type: 'audio', ext };

    // Fallback detection using URL queries or paths
    const lowerUrl = urlStr.toLowerCase();
    if (lowerUrl.includes('content-type=video') || lowerUrl.includes('mime=video') || lowerUrl.includes('/video/')) {
      return { type: 'video', ext: ext || 'mp4' };
    }
    if (lowerUrl.includes('content-type=image') || lowerUrl.includes('mime=image') || lowerUrl.includes('/image/')) {
      return { type: 'image', ext: ext || 'png' };
    }
    if (lowerUrl.includes('content-type=audio') || lowerUrl.includes('mime=audio') || lowerUrl.includes('/audio/')) {
      return { type: 'audio', ext: ext || 'mp3' };
    }

    return { type: 'other', ext };
  } catch {
    return { type: 'other', ext: '' };
  }
}

// Check if a URL belongs to Supabase Storage
export function checkIsSupabase(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return url.hostname.includes('supabase.co') && url.pathname.includes('/storage/v1');
  } catch {
    return urlStr.includes('.supabase.co/storage/v1');
  }
}

// Fetch file size via HEAD request in the background
async function fetchAssetSize(url: string): Promise<number> {
  if (sizeCache.has(url)) return sizeCache.get(url)!;

  try {
    const cachedSizes = JSON.parse(sessionStorage.getItem('classfy_media_sizes') || '{}');
    if (cachedSizes[url] !== undefined) {
      sizeCache.set(url, cachedSizes[url]);
      return cachedSizes[url];
    }
  } catch {}

  // Skip dev assets, hot-reload, ws, or already audited requests
  if (!url.startsWith('http') || url.includes('dev-audit=true') || url.includes('/vite-client') || url.includes('/@vite')) {
    return 0;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s timeout

    // Add query parameter to avoid recursive intercepting
    const separator = url.includes('?') ? '&' : '?';
    const auditUrl = url + separator + 'dev-audit=true';

    const res = await fetch(auditUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'x-dev-audit': 'true' }
    });
    clearTimeout(timeoutId);

    const lenStr = res.headers.get('content-length');
    if (lenStr) {
      const size = parseInt(lenStr, 10);
      sizeCache.set(url, size);

      // Save to sessionStorage
      try {
        const cachedSizes = JSON.parse(sessionStorage.getItem('classfy_media_sizes') || '{}');
        cachedSizes[url] = size;
        sessionStorage.setItem('classfy_media_sizes', JSON.stringify(cachedSizes));
      } catch {}

      return size;
    }
  } catch {
    // Fail silently (CORS or network error)
  }

  sizeCache.set(url, 0);
  return 0;
}

// Save audit log to sessionStorage
function saveAuditEntry(entry: AuditEntry) {
  if (typeof window === 'undefined') return;

  try {
    const logs: AuditEntry[] = JSON.parse(sessionStorage.getItem('classfy_media_audit_logs') || '[]');
    
    // Prevent exactly duplicate events (e.g. duplicate observer trigger)
    const exists = logs.some(l => l.url === entry.url && Math.abs(l.timestamp - entry.timestamp) < 100);
    if (!exists) {
      logs.push(entry);
      sessionStorage.setItem('classfy_media_audit_logs', JSON.stringify(logs));
      notifyListeners(logs);
      debouncedPrint();
    }
  } catch (e) {
    console.error('[MediaMonitor] Failed to write to sessionStorage:', e);
  }
}

// Intercept window.fetch to capture network media requests
function patchFetch() {
  if (typeof window === 'undefined') return;

  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
    
    // Skip if it's our own dev-audit request
    const isAudit = (init?.headers && (init.headers as any)['x-dev-audit']) || url.includes('dev-audit=true');
    if (isAudit) {
      return originalFetch.apply(this, arguments as any);
    }

    const startTime = performance.now();
    try {
      const response = await originalFetch.apply(this, arguments as any);
      const duration = performance.now() - startTime;
      
      // Analyze response asynchronously
      processFetchResponse(url, response, duration);
      
      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      processFetchResponse(url, null, duration);
      throw error;
    }
  };
}

async function processFetchResponse(url: string, response: Response | null, duration: number) {
  const { type, ext } = getMediaTypeAndExt(url);
  const isSupabase = checkIsSupabase(url);
  
  // We care about media files, Supabase Storage resources, or other assets
  if (type === 'other' && !isSupabase) return;

  let size = 0;
  let status = response?.status || 0;

  if (response) {
    const lenStr = response.headers.get('content-length');
    if (lenStr) {
      size = parseInt(lenStr, 10);
    }
  }

  // If size is 0 and it's Supabase Storage or a key media file, resolve it using HEAD
  if (size === 0 && url.startsWith('http')) {
    size = await fetchAssetSize(url);
  }

  const entry: AuditEntry = {
    id: `${Date.now()}-${Math.random()}`,
    url,
    mediaType: type,
    extension: ext,
    route: currentRoute,
    sizeBytes: size,
    durationMs: duration,
    status,
    isSupabase,
    timestamp: Date.now(),
    initiatorType: 'fetch'
  };

  saveAuditEntry(entry);
}

// Observe static resources (images, video elements, stylesheet assets, etc.)
function startResourceObserver() {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        const resEntry = entry as PerformanceResourceTiming;
        const url = resEntry.name;
        
        // Skip hot module replacement, websocket, local files, and audit requests
        if (url.includes('dev-audit=true') || url.includes('/vite-client') || url.includes('/@vite') || url.startsWith('ws') || url.includes('localhost:5173/src/')) {
          continue;
        }

        const { type, ext } = getMediaTypeAndExt(url);
        const isSupabase = checkIsSupabase(url);

        // Track media files or Supabase storage resources
        if (type === 'other' && !isSupabase) continue;

        let size = resEntry.transferSize || resEntry.decodedBodySize || resEntry.encodedBodySize || 0;
        
        const auditEntry: AuditEntry = {
          id: `${Date.now()}-${Math.random()}`,
          url,
          mediaType: type,
          extension: ext,
          route: currentRoute,
          sizeBytes: size,
          durationMs: resEntry.duration,
          status: 200, // standard resource load is typically 200/304
          isSupabase,
          timestamp: Date.now(),
          initiatorType: resEntry.initiatorType || 'other'
        };

        if (size === 0 && url.startsWith('http')) {
          // Asynchronously fetch size and save
          fetchAssetSize(url).then((resolvedSize) => {
            if (resolvedSize > 0) {
              auditEntry.sizeBytes = resolvedSize;
              saveAuditEntry(auditEntry);
            }
          });
        } else {
          saveAuditEntry(auditEntry);
        }
      }
    });

    observer.observe({ type: 'resource', buffered: true });
  } catch (e) {
    console.warn('[MediaMonitor] PerformanceObserver failed to start:', e);
  }
}

// Hook router state changes to track page pathname
function listenToRouteChanges() {
  if (typeof window === 'undefined') return;

  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;

  window.history.pushState = function(...args) {
    originalPush.apply(this, args);
    currentRoute = window.location.pathname;
  };

  window.history.replaceState = function(...args) {
    originalReplace.apply(this, args);
    currentRoute = window.location.pathname;
  };

  window.addEventListener('popstate', () => {
    currentRoute = window.location.pathname;
  });
}

// Throttled console table logging
let printTimeout: any = null;
function debouncedPrint() {
  if (printTimeout) clearTimeout(printTimeout);
  printTimeout = setTimeout(() => {
    printConsoleTable();
  }, 1500);
}

// Aggregate and log audit records to the dev console
export function printConsoleTable() {
  if (typeof window === 'undefined') return;

  try {
    const logs: AuditEntry[] = JSON.parse(sessionStorage.getItem('classfy_media_audit_logs') || '[]');
    if (logs.length === 0) return;

    // Group logs by URL
    const urlMap = new Map<string, AuditEntry[]>();
    for (const log of logs) {
      if (!urlMap.has(log.url)) {
        urlMap.set(log.url, []);
      }
      urlMap.get(log.url)!.push(log);
    }

    const tableData: any[] = [];
    let totalBytes = 0;
    let totalSupabaseBytes = 0;
    let duplicateRequestsCount = 0;
    let alertsCount = 0;
    let largeThumbsCount = 0;

    urlMap.forEach((entries, url) => {
      const first = entries[0];
      const count = entries.length;
      const sizeBytes = first.sizeBytes;
      const totalFileBytes = sizeBytes * count;
      totalBytes += totalFileBytes;
      
      if (first.isSupabase) {
        totalSupabaseBytes += totalFileBytes;
      }
      if (count > 1) {
        duplicateRequestsCount += (count - 1);
      }

      // Check for misplaced video/audio
      const isPlayerRoute = first.route.startsWith('/watch') || 
                            first.route.startsWith('/listen') || 
                            first.route.startsWith('/shorts') || 
                            first.route.startsWith('/live');
      const isMisplaced = (first.mediaType === 'video' || first.mediaType === 'audio') && !isPlayerRoute;
      if (isMisplaced) {
        alertsCount += count;
      }

      // Check for large thumbnail
      const isThumbnail = first.mediaType === 'image' && sizeBytes > 300 * 1024;
      if (isThumbnail) {
        largeThumbsCount += count;
      }

      // Truncate URL for console table view
      let truncatedUrl = url;
      if (url.length > 60) {
        truncatedUrl = url.substring(0, 30) + '...' + url.substring(url.length - 27);
      }

      tableData.push({
        'URL': truncatedUrl,
        'Type': first.mediaType.toUpperCase(),
        'Ext': first.extension,
        'Main Route': first.route,
        'Size': sizeBytes > 0 ? `${(sizeBytes / 1024).toFixed(1)} KB` : 'CORS/Unknown',
        'Total Size': totalFileBytes > 0 ? `${(totalFileBytes / 1024).toFixed(1)} KB` : 'Unknown',
        'Calls': count,
        'Avg Time': `${(entries.reduce((acc, curr) => acc + curr.durationMs, 0) / count).toFixed(0)}ms`,
        'Supabase': first.isSupabase ? '✅' : '❌',
        'Status': first.status,
        'Alert': isMisplaced ? '⚠️ MISPLACED PLAYER' : (isThumbnail ? '🖼️ HEAVY THUMB (>300KB)' : 'Ok')
      });
    });

    // Sort by Total Size descending
    tableData.sort((a, b) => {
      const aVal = parseFloat(a['Total Size']);
      const bVal = parseFloat(b['Total Size']);
      if (isNaN(aVal)) return 1;
      if (isNaN(bVal)) return -1;
      return bVal - aVal;
    });

    console.group(`📊 CLASSFY MEDIA AUDIT SESSION SUMMARY (${logs.length} requests)`);
    console.log(`💾 Total Transferred: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`☁️ Supabase Storage: ${(totalSupabaseBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`🔄 Duplicate Requests Overhead: ${duplicateRequestsCount} duplicate calls`);
    
    if (alertsCount > 0) {
      console.warn(`🚨 Alert: ${alertsCount} videos/audios loaded OUTSIDE player routes (/watch, /listen, /shorts, /live)!`);
    }
    if (largeThumbsCount > 0) {
      console.warn(`🖼️ Alert: ${largeThumbsCount} thumbnails exceed recommended 300 KB limit!`);
    }

    console.table(tableData.slice(0, 20)); // Limit to top 20 heaviest items
    console.groupEnd();

  } catch (e) {
    console.error('[MediaMonitor] Error creating console table summary:', e);
  }
}

// Register visual listener callback
export function addAuditListener(cb: (entries: AuditEntry[]) => void) {
  listeners.add(cb);
  // Initial fire with current data
  if (typeof window !== 'undefined') {
    try {
      const logs = JSON.parse(sessionStorage.getItem('classfy_media_audit_logs') || '[]');
      cb(logs);
    } catch {}
  }
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners(entries: AuditEntry[]) {
  listeners.forEach(cb => cb(entries));
}

// Clear all logs in sessionStorage
export function clearAuditLogs() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem('classfy_media_audit_logs');
    notifyListeners([]);
    console.clear();
    console.log('✅ Classfy Media Audit Session logs cleared.');
  } catch {}
}

// Initialization function called on client entry in development
export function initMediaMonitor() {
  if (typeof window === 'undefined') return;

  // Double check environment (DEV mode only)
  if (!import.meta.env.DEV) return;

  // Prevent double patching
  if ((window as any).__CLASSFY_MEDIA_MONITOR_INITIALIZED__) return;
  (window as any).__CLASSFY_MEDIA_MONITOR_INITIALIZED__ = true;

  console.log('🚀 Classfy Media Consumption Monitor initialized in development mode.');
  
  patchFetch();
  startResourceObserver();
  listenToRouteChanges();

  // Print first summary after short delay (to capture initial page assets)
  setTimeout(() => {
    printConsoleTable();
  }, 3000);
}
