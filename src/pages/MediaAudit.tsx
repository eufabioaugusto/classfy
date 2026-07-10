import React, { useEffect, useState } from 'react';
import { addAuditListener, clearAuditLogs, printConsoleTable, AuditEntry } from '../lib/mediaMonitor';
import { 
  Database, 
  AlertTriangle, 
  Trash2, 
  RefreshCw, 
  FileAudio, 
  FileImage, 
  FileVideo, 
  File, 
  ExternalLink, 
  ShieldAlert, 
  Layers, 
  Search, 
  ChevronRight, 
  TrendingDown, 
  Info 
} from 'lucide-react';

export default function MediaAudit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'heaviest' | 'duplicates' | 'misplaced' | 'thumbs' | 'raw'>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSupabaseOnly, setFilterSupabaseOnly] = useState(false);

  useEffect(() => {
    // Register audit listener to receive real-time data
    const unsubscribe = addAuditListener((newEntries) => {
      setEntries([...newEntries]);
    });
    return unsubscribe;
  }, []);

  // Safe client-side check
  if (typeof window === 'undefined') {
    return null;
  }

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Group entries by URL to perform aggregation
  const getAggregatedData = () => {
    const urlMap = new Map<string, AuditEntry[]>();
    for (const entry of entries) {
      if (!urlMap.has(entry.url)) {
        urlMap.set(entry.url, []);
      }
      urlMap.get(entry.url)!.push(entry);
    }

    const list: {
      url: string;
      mediaType: 'image' | 'video' | 'audio' | 'other';
      extension: string;
      routes: string[];
      sizeBytes: number;
      totalSizeBytes: number;
      loadCount: number;
      avgDurationMs: number;
      isSupabase: boolean;
      status: number;
      isMisplaced: boolean;
      isHeavyThumb: boolean;
    }[] = [];

    urlMap.forEach((items, url) => {
      const first = items[0];
      const count = items.length;
      const sizeBytes = first.sizeBytes;
      const totalSizeBytes = sizeBytes * count;
      const avgDurationMs = items.reduce((acc, curr) => acc + curr.durationMs, 0) / count;

      // Unique list of routes
      const routes = Array.from(new Set(items.map(item => item.route)));

      // Alert conditions
      const isPlayerRoute = routes.some(r => 
        r.startsWith('/watch') || 
        r.startsWith('/listen') || 
        r.startsWith('/shorts') || 
        r.startsWith('/live')
      );
      const isMisplaced = (first.mediaType === 'video' || first.mediaType === 'audio') && !isPlayerRoute;
      const isHeavyThumb = first.mediaType === 'image' && sizeBytes > 300 * 1024;

      list.push({
        url,
        mediaType: first.mediaType,
        extension: first.extension,
        routes,
        sizeBytes,
        totalSizeBytes,
        loadCount: count,
        avgDurationMs,
        isSupabase: first.isSupabase,
        status: first.status,
        isMisplaced,
        isHeavyThumb
      });
    });

    return list;
  };

  const aggregated = getAggregatedData();

  // Filters logic
  const filteredAggregated = aggregated.filter(item => {
    const matchesSearch = item.url.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.extension.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSupabase = !filterSupabaseOnly || item.isSupabase;
    return matchesSearch && matchesSupabase;
  });

  // Calculate high level metrics
  const totalTransferredBytes = aggregated.reduce((acc, curr) => acc + curr.totalSizeBytes, 0);
  const totalSupabaseBytes = aggregated.reduce((acc, curr) => acc + (curr.isSupabase ? curr.totalSizeBytes : 0), 0);
  const totalRequests = entries.length;
  
  // Total by type
  const typeBytes = {
    image: aggregated.reduce((acc, curr) => acc + (curr.mediaType === 'image' ? curr.totalSizeBytes : 0), 0),
    video: aggregated.reduce((acc, curr) => acc + (curr.mediaType === 'video' ? curr.totalSizeBytes : 0), 0),
    audio: aggregated.reduce((acc, curr) => acc + (curr.mediaType === 'audio' ? curr.totalSizeBytes : 0), 0),
    other: aggregated.reduce((acc, curr) => acc + (curr.mediaType === 'other' ? curr.totalSizeBytes : 0), 0),
  };

  const typeCounts = {
    image: entries.filter(e => e.mediaType === 'image').length,
    video: entries.filter(e => e.mediaType === 'video').length,
    audio: entries.filter(e => e.mediaType === 'audio').length,
    other: entries.filter(e => e.mediaType === 'other').length,
  };

  // Duplicate calls overhead
  const duplicateOverheadBytes = aggregated.reduce((acc, curr) => {
    if (curr.loadCount > 1) {
      return acc + (curr.sizeBytes * (curr.loadCount - 1));
    }
    return acc;
  }, 0);
  const totalDuplicatesCount = aggregated.reduce((acc, curr) => acc + (curr.loadCount > 1 ? curr.loadCount - 1 : 0), 0);

  // Heaviest files (Top 20)
  const heaviestFiles = [...aggregated]
    .sort((a, b) => b.totalSizeBytes - a.totalSizeBytes)
    .slice(0, 20);

  // Duplicate files details
  const duplicateFiles = [...aggregated]
    .filter(item => item.loadCount > 1)
    .sort((a, b) => (b.sizeBytes * (b.loadCount - 1)) - (a.sizeBytes * (a.loadCount - 1)));

  // Misplaced player media
  const misplacedMedia = aggregated.filter(item => item.isMisplaced);

  // Heavy thumbnails (> 300 KB)
  const heavyThumbs = aggregated.filter(item => item.isHeavyThumb);

  const getMediaIcon = (type: string) => {
    switch (type) {
      case 'image': return <FileImage className="w-4 h-4 text-emerald-400" />;
      case 'video': return <FileVideo className="w-4 h-4 text-rose-400" />;
      case 'audio': return <FileAudio className="w-4 h-4 text-cyan-400" />;
      default: return <File className="w-4 h-4 text-zinc-400" />;
    }
  };

  const truncateUrl = (url: string, limit = 80) => {
    if (url.length <= limit) return url;
    return url.substring(0, limit / 2) + '...' + url.substring(url.length - (limit / 2 - 3));
  };

  return (
    <div className="min-h-screen bg-black text-zinc-100 p-6 md:p-10 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-zinc-800 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 text-xs font-semibold bg-rose-500/20 text-rose-400 rounded-full border border-rose-500/30">DEV ONLY</span>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              Classfy Media Auditor
            </h1>
          </div>
          <p className="text-zinc-400 text-sm mt-1">
            Mapeamento de cache, download e duplicados em tempo real (Sessão Atual)
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              printConsoleTable();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-200 text-sm font-medium rounded-lg transition-all"
            title="Gera tabela interativa com console.table"
          >
            <RefreshCw className="w-4 h-4" />
            Console.table
          </button>
          
          <button 
            onClick={() => {
              if (confirm('Deseja limpar todos os registros de mídia desta sessão?')) {
                clearAuditLogs();
              }
            }}
            className="flex items-center gap-2 px-4 py-2 bg-rose-950/40 hover:bg-rose-950/60 border border-rose-900/30 hover:border-rose-900/50 text-rose-300 text-sm font-medium rounded-lg transition-all"
          >
            <Trash2 className="w-4 h-4" />
            Limpar Auditoria
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Loaded Card */}
        <div className="bg-zinc-900/40 border border-zinc-850 p-6 rounded-xl relative overflow-hidden backdrop-blur-sm">
          <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-2xl -translate-y-6 translate-x-6" />
          <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">Total Carregado</p>
          <p className="text-3xl font-extrabold mt-2 text-zinc-100">
            {formatBytes(totalTransferredBytes)}
          </p>
          <div className="flex items-center gap-2 mt-2 text-zinc-400 text-xs">
            <span>{totalRequests} requisições de mídia</span>
          </div>
        </div>

        {/* Supabase Storage Card */}
        <div className="bg-zinc-900/40 border border-zinc-850 p-6 rounded-xl relative overflow-hidden backdrop-blur-sm">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl -translate-y-6 translate-x-6" />
          <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">Supabase Storage/CDN</p>
          <p className="text-3xl font-extrabold mt-2 text-emerald-400">
            {formatBytes(totalSupabaseBytes)}
          </p>
          <div className="flex items-center gap-2 mt-2 text-zinc-400 text-xs">
            <Database className="w-3.5 h-3.5 text-emerald-500" />
            <span>
              {((totalSupabaseBytes / (totalTransferredBytes || 1)) * 100).toFixed(0)}% do peso total
            </span>
          </div>
        </div>

        {/* Duplications Overhead Card */}
        <div className="bg-zinc-900/40 border border-zinc-850 p-6 rounded-xl relative overflow-hidden backdrop-blur-sm">
          <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-500/5 rounded-full blur-2xl -translate-y-6 translate-x-6" />
          <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">Perda por Duplicidade</p>
          <p className="text-3xl font-extrabold mt-2 text-yellow-500">
            {formatBytes(duplicateOverheadBytes)}
          </p>
          <div className="flex items-center gap-2 mt-2 text-zinc-400 text-xs">
            <TrendingDown className="w-3.5 h-3.5 text-yellow-500" />
            <span>{totalDuplicatesCount} chamadas repetidas</span>
          </div>
        </div>

        {/* Alerts Card */}
        <div className="bg-zinc-900/40 border border-zinc-850 p-6 rounded-xl relative overflow-hidden backdrop-blur-sm">
          <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-full blur-2xl -translate-y-6 translate-x-6" />
          <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">Problemas de Layout</p>
          <p className="text-3xl font-extrabold mt-2 text-orange-400">
            {misplacedMedia.length + heavyThumbs.length}
          </p>
          <div className="flex items-center gap-2 mt-2 text-zinc-400 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
            <span>
              {misplacedMedia.length} desvios, {heavyThumbs.length} thumbs pesadas
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Layout */}
      <div className="flex flex-wrap border-b border-zinc-800 gap-1 mb-6">
        <button 
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${activeTab === 'overview' ? 'border-rose-500 text-rose-400 bg-zinc-900/30' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Resumo Geral
        </button>
        <button 
          onClick={() => setActiveTab('heaviest')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${activeTab === 'heaviest' ? 'border-rose-500 text-rose-400 bg-zinc-900/30' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Top 20 Pesados
        </button>
        <button 
          onClick={() => setActiveTab('duplicates')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${activeTab === 'duplicates' ? 'border-rose-500 text-rose-400 bg-zinc-900/30' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Repetidos ({duplicateFiles.length})
        </button>
        <button 
          onClick={() => setActiveTab('misplaced')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${activeTab === 'misplaced' ? 'border-rose-500 text-rose-400 bg-zinc-900/30' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Carregamento Indevido ({misplacedMedia.length})
        </button>
        <button 
          onClick={() => setActiveTab('thumbs')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${activeTab === 'thumbs' ? 'border-rose-500 text-rose-400 bg-zinc-900/30' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Thumbs &gt; 300 KB ({heavyThumbs.length})
        </button>
        <button 
          onClick={() => setActiveTab('raw')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ${activeTab === 'raw' ? 'border-rose-500 text-rose-400 bg-zinc-900/30' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Todos ({entries.length})
        </button>
      </div>

      {/* TAB CONTENT: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Media Breakdown */}
          <div className="lg:col-span-2 bg-zinc-900/20 border border-zinc-850 p-6 rounded-xl">
            <h3 className="text-lg font-bold mb-4 text-zinc-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-rose-500" />
              Consumo por Tipo de Mídia
            </h3>
            <div className="space-y-5">
              {(['video', 'image', 'audio', 'other'] as const).map(type => {
                const size = typeBytes[type];
                const count = typeCounts[type];
                const pct = totalTransferredBytes > 0 ? (size / totalTransferredBytes) * 100 : 0;
                return (
                  <div key={type} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        {getMediaIcon(type)}
                        <span className="font-semibold uppercase tracking-wider text-xs text-zinc-300">{type}</span>
                        <span className="text-zinc-500 text-xs">({count} reqs)</span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-zinc-200">{formatBytes(size)}</span>
                        <span className="text-zinc-500 text-xs ml-2">({pct.toFixed(1)}%)</span>
                      </div>
                    </div>
                    {/* Bar */}
                    <div className="w-full bg-zinc-800/60 rounded-full h-2.5 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${
                          type === 'video' ? 'bg-rose-500' :
                          type === 'image' ? 'bg-emerald-500' :
                          type === 'audio' ? 'bg-cyan-500' : 'bg-zinc-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Supabase Storage Alert note */}
            <div className="mt-8 p-4 bg-zinc-900/50 rounded-lg border border-zinc-800 text-xs text-zinc-400 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p>
                Arquivos do <strong>Supabase Storage</strong> representam o maior gargalo pois trafegam diretamente pela CDN do banco. O excesso de cache cobrado pelo Supabase decorre de múltiplos downloads redundantes de assets de vídeo e imagens pesadas. Reduzir chamadas duplicadas e otimizar compressão de thumbnails são as formas mais rápidas de diminuir a fatura.
              </p>
            </div>
          </div>

          {/* Right Column: Recommendations */}
          <div className="bg-zinc-900/20 border border-zinc-850 p-6 rounded-xl">
            <h3 className="text-lg font-bold mb-4 text-zinc-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-orange-400" />
              Diagnóstico Automático
            </h3>
            
            <div className="space-y-4">
              {/* Check 1: Duplicate overhead */}
              <div className="p-4 bg-zinc-900/40 rounded-lg border border-zinc-800">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Overhead por Duplicidade</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm font-bold text-zinc-100">
                    {formatBytes(duplicateOverheadBytes)} perdidos
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${duplicateOverheadBytes > 10 * 1024 * 1024 ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                    {duplicateOverheadBytes > 10 * 1024 * 1024 ? 'CRÍTICO' : 'SEGURO'}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-2">
                  Representa mídias baixadas mais de uma vez. Implemente React context ou state caching para carregar uma vez e reutilizar.
                </p>
              </div>

              {/* Check 2: Unnecessary Player Loads */}
              <div className="p-4 bg-zinc-900/40 rounded-lg border border-zinc-800">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Vídeos carregados indevidamente</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm font-bold text-zinc-100">
                    {misplacedMedia.length} arquivos detectados
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${misplacedMedia.length > 0 ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                    {misplacedMedia.length > 0 ? 'ALERTA' : 'SEGURO'}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-2">
                  Carregar vídeos fora das páginas de player (`/watch`, `/listen`, `/shorts`, `/live`) consome banda prematuramente. Substitua tags &lt;video&gt; por thumbnails de imagem com overlay.
                </p>
              </div>

              {/* Check 3: Large thumbnails */}
              <div className="p-4 bg-zinc-900/40 rounded-lg border border-zinc-800">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Thumbnails &gt; 300 KB</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm font-bold text-zinc-100">
                    {heavyThumbs.length} thumbnails pesadas
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${heavyThumbs.length > 0 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                    {heavyThumbs.length > 0 ? 'OTIMIZAR' : 'SEGURO'}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 mt-2">
                  Thumbnails de capa não devem exceder 300 KB. Utilize compressão WebP/AVIF e re-dimensione no Supabase Storage Image Transformations se disponível.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: HEAVIEST */}
      {activeTab === 'heaviest' && (
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="text-lg font-bold text-zinc-100">Top 20 Arquivos Mais Pesados (Por Volume Total)</h3>
            <span className="text-xs text-zinc-400">Ordenado por Peso Total Carregado</span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/40 border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-3.5">Mídia</th>
                  <th className="px-6 py-3.5">Tamanho Unitário</th>
                  <th className="px-6 py-3.5">Total Baixado</th>
                  <th className="px-6 py-3.5 text-center">Reqs</th>
                  <th className="px-6 py-3.5">Rotas de Carregamento</th>
                  <th className="px-6 py-3.5">Tempo Médio</th>
                  <th className="px-6 py-3.5 text-center">Supabase</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {heaviestFiles.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-zinc-500">Nenhum registro de mídia coletado.</td>
                  </tr>
                ) : (
                  heaviestFiles.map((item, idx) => (
                    <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="px-6 py-4 flex flex-col gap-1 max-w-md">
                        <div className="flex items-center gap-2">
                          {getMediaIcon(item.mediaType)}
                          <span className="font-semibold text-zinc-100">{item.extension.toUpperCase()}</span>
                          {item.isMisplaced && <span className="px-1.5 py-0.5 text-[9px] font-bold bg-rose-500/20 text-rose-400 rounded border border-rose-500/20">FORA DO PLAYER</span>}
                          {item.isHeavyThumb && <span className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-400 rounded border border-amber-500/20">THUMB PESADA</span>}
                        </div>
                        <a 
                          href={item.url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-xs text-zinc-400 hover:text-rose-400 transition-colors flex items-center gap-1 break-all"
                        >
                          {truncateUrl(item.url)}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-6 py-4 font-medium text-zinc-200">
                        {item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : 'CORS/Unknown'}
                      </td>
                      <td className="px-6 py-4 font-bold text-zinc-100">
                        {item.totalSizeBytes > 0 ? formatBytes(item.totalSizeBytes) : 'Unknown'}
                      </td>
                      <td className="px-6 py-4 text-center font-semibold text-zinc-300">
                        {item.loadCount}
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {item.routes.map((r, rIdx) => (
                            <span key={rIdx} className="px-1.5 py-0.5 bg-zinc-800 rounded border border-zinc-700">{r}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-zinc-400 font-mono text-xs">
                        {item.avgDurationMs.toFixed(0)}ms
                      </td>
                      <td className="px-6 py-4 text-center">
                        {item.isSupabase ? <span className="text-emerald-400 text-sm">✅</span> : <span className="text-zinc-600 text-sm">❌</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: DUPLICATES */}
      {activeTab === 'duplicates' && (
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-zinc-100">Arquivos Carregados Multiplas Vezes</h3>
              <p className="text-xs text-zinc-400 mt-1">
                Arquivos que sofreram re-download redundante durante esta sessão
              </p>
            </div>
            <span className="text-sm font-semibold text-yellow-500">
              Desperdício: {formatBytes(duplicateOverheadBytes)}
            </span>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/40 border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-3.5">Mídia</th>
                  <th className="px-6 py-3.5">Tamanho do Arquivo</th>
                  <th className="px-6 py-3.5">Tamanho Desperdiçado</th>
                  <th className="px-6 py-3.5 text-center">Vezes Chamado</th>
                  <th className="px-6 py-3.5">Rotas de Chamada</th>
                  <th className="px-6 py-3.5 text-center">Supabase</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {duplicateFiles.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-zinc-500">Nenhum arquivo duplicado foi detectado. Muito bem!</td>
                  </tr>
                ) : (
                  duplicateFiles.map((item, idx) => {
                    const overhead = item.sizeBytes * (item.loadCount - 1);
                    return (
                      <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="px-6 py-4 flex flex-col gap-1 max-w-md">
                          <div className="flex items-center gap-2">
                            {getMediaIcon(item.mediaType)}
                            <span className="font-semibold text-zinc-100">{item.extension.toUpperCase()}</span>
                          </div>
                          <a 
                            href={item.url} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-xs text-zinc-400 hover:text-rose-400 transition-colors flex items-center gap-1 break-all"
                          >
                            {truncateUrl(item.url)}
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </td>
                        <td className="px-6 py-4 font-medium text-zinc-200">
                          {formatBytes(item.sizeBytes)}
                        </td>
                        <td className="px-6 py-4 font-bold text-yellow-500">
                          {formatBytes(overhead)}
                        </td>
                        <td className="px-6 py-4 text-center font-bold text-zinc-100">
                          {item.loadCount}x
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-400">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {item.routes.map((r, rIdx) => (
                              <span key={rIdx} className="px-1.5 py-0.5 bg-zinc-800 rounded border border-zinc-700">{r}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {item.isSupabase ? <span className="text-emerald-400 text-sm">✅</span> : <span className="text-zinc-600 text-sm">❌</span>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: MISPLACED */}
      {activeTab === 'misplaced' && (
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-zinc-800">
            <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5 text-rose-500" />
              Mídia Carregada Fora das Rotas de Player
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              Vídeos/áudios carregados em rotas genéricas (ex: home, perfil, conta) que deveriam aguardar clique do usuário ou usar apenas thumbnails estáticas.
            </p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/40 border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-3.5">Arquivo</th>
                  <th className="px-6 py-3.5">Tamanho</th>
                  <th className="px-6 py-3.5 text-center">Reqs</th>
                  <th className="px-6 py-3.5">Onde Carregou</th>
                  <th className="px-6 py-3.5 text-center">Supabase</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {misplacedMedia.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">Nenhum desvio detectado. Todos os vídeos e áudios estão em rotas apropriadas!</td>
                  </tr>
                ) : (
                  misplacedMedia.map((item, idx) => (
                    <tr key={idx} className="hover:bg-rose-950/10 transition-colors">
                      <td className="px-6 py-4 flex flex-col gap-1 max-w-md">
                        <div className="flex items-center gap-2">
                          {getMediaIcon(item.mediaType)}
                          <span className="font-semibold text-rose-300">{item.extension.toUpperCase()}</span>
                        </div>
                        <a 
                          href={item.url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-xs text-zinc-400 hover:text-rose-400 transition-colors flex items-center gap-1 break-all"
                        >
                          {truncateUrl(item.url)}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-6 py-4 font-bold text-zinc-200">
                        {formatBytes(item.sizeBytes)}
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-zinc-100">
                        {item.loadCount}
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {item.routes.map((r, rIdx) => (
                            <span key={rIdx} className="px-1.5 py-0.5 bg-rose-500/10 text-rose-400 rounded border border-rose-500/20">{r}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {item.isSupabase ? <span className="text-emerald-400 text-sm">✅</span> : <span className="text-zinc-600 text-sm">❌</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: THUMBS */}
      {activeTab === 'thumbs' && (
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-zinc-800">
            <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2 text-amber-400">
              <FileImage className="w-5 h-5 text-amber-500" />
              Thumbnails / Imagens maiores que 300 KB
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              Imagens que excedem o tamanho recomendado para banners e miniaturas do front-end. Otimize comprimindo e convertendo para WebP/AVIF.
            </p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/40 border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-3.5">Imagem</th>
                  <th className="px-6 py-3.5">Tamanho da Imagem</th>
                  <th className="px-6 py-3.5 text-center">Reqs</th>
                  <th className="px-6 py-3.5">Onde Carregou</th>
                  <th className="px-6 py-3.5 text-center">Supabase</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {heavyThumbs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">Nenhuma imagem ultrapassa 300 KB. Excelente otimização!</td>
                  </tr>
                ) : (
                  heavyThumbs.map((item, idx) => (
                    <tr key={idx} className="hover:bg-amber-950/10 transition-colors">
                      <td className="px-6 py-4 flex flex-col gap-1 max-w-md">
                        <div className="flex items-center gap-2">
                          <FileImage className="w-4 h-4 text-amber-400" />
                          <span className="font-semibold text-amber-300">{item.extension.toUpperCase()}</span>
                        </div>
                        <a 
                          href={item.url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-xs text-zinc-400 hover:text-rose-400 transition-colors flex items-center gap-1 break-all"
                        >
                          {truncateUrl(item.url)}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-6 py-4 font-bold text-amber-400">
                        {formatBytes(item.sizeBytes)}
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-zinc-100">
                        {item.loadCount}
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {item.routes.map((r, rIdx) => (
                            <span key={rIdx} className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded border border-amber-500/20">{r}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {item.isSupabase ? <span className="text-emerald-400 text-sm">✅</span> : <span className="text-zinc-600 text-sm">❌</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: RAW */}
      {activeTab === 'raw' && (
        <div className="bg-zinc-900/20 border border-zinc-850 rounded-xl overflow-hidden animate-fade-in">
          {/* Filters controls */}
          <div className="p-4 border-b border-zinc-800 bg-zinc-900/40 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
              <input 
                type="text" 
                placeholder="Filtrar por URL ou extensão..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-750 focus:border-zinc-700 rounded-lg py-2 pl-9 pr-4 text-sm text-zinc-200 placeholder-zinc-500 outline-none transition-all"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="supabase-only"
                checked={filterSupabaseOnly}
                onChange={e => setFilterSupabaseOnly(e.target.checked)}
                className="rounded border-zinc-800 bg-zinc-950 text-rose-500 focus:ring-rose-500 focus:ring-opacity-25 w-4 h-4"
              />
              <label htmlFor="supabase-only" className="text-xs text-zinc-400 font-semibold cursor-pointer select-none">
                Mostrar apenas Supabase Storage
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="text-xs text-zinc-500 uppercase bg-zinc-900/40 border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-3.5">Mídia</th>
                  <th className="px-6 py-3.5">Tamanho</th>
                  <th className="px-6 py-3.5">Chamadas</th>
                  <th className="px-6 py-3.5">Rotas de Origem</th>
                  <th className="px-6 py-3.5 text-center">Supabase</th>
                  <th className="px-6 py-3.5">Tempo Médio</th>
                  <th className="px-6 py-3.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {filteredAggregated.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-zinc-500">Nenhum registro corresponde aos filtros definidos.</td>
                  </tr>
                ) : (
                  filteredAggregated.map((item, idx) => (
                    <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="px-6 py-4 flex flex-col gap-1 max-w-lg">
                        <div className="flex items-center gap-2">
                          {getMediaIcon(item.mediaType)}
                          <span className="font-semibold text-zinc-200">{item.extension.toUpperCase()}</span>
                        </div>
                        <a 
                          href={item.url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-xs text-zinc-400 hover:text-rose-400 transition-colors flex items-center gap-1 break-all"
                        >
                          {truncateUrl(item.url, 100)}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </td>
                      <td className="px-6 py-4 font-medium text-zinc-200">
                        {item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : 'CORS/Unknown'}
                      </td>
                      <td className="px-6 py-4 text-zinc-100 font-bold text-center">
                        {item.loadCount}x
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {item.routes.map((r, rIdx) => (
                            <span key={rIdx} className="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700">{r}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {item.isSupabase ? <span className="text-emerald-400 text-sm">✅</span> : <span className="text-zinc-600 text-sm">❌</span>}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-zinc-400">
                        {item.avgDurationMs.toFixed(0)}ms
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.status >= 200 && item.status < 300 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                          item.status >= 300 && item.status < 400 ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 
                          'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {item.status || '304/Cached'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
