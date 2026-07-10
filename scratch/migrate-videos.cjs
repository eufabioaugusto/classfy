const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Configs - can be set via env vars or pasted directly
const SUPABASE_URL = process.env.SUPABASE_URL || "https://jeqezibfollsvdknfebj.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUNNY_STREAM_API_KEY = process.env.BUNNY_STREAM_API_KEY || "77a97d98-bed3-4c0c-b2364a96b135-e3cd-4bd9";
const BUNNY_STREAM_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID || "700986";
const BUNNY_STREAM_CDN_HOSTNAME = process.env.BUNNY_STREAM_CDN_HOSTNAME || "vz-42560f79-6f8.b-cdn.net";

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERRO: Voce deve fornecer a variavel de ambiente SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Como rodar: SUPABASE_SERVICE_ROLE_KEY=\"sua-chave-service-role\" node scratch/migrate-videos.cjs");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Helper to download a file
const downloadFile = (url, destPath) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Erro de download: Status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
};

// Helper to upload to Bunny Stream
const uploadToBunny = (libraryId, videoId, apiKey, filePath) => {
  return new Promise((resolve, reject) => {
    const stats = fs.statSync(filePath);
    const readStream = fs.createReadStream(filePath);
    
    const req = https.request(
      `https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}`,
      {
        method: 'PUT',
        headers: {
          'AccessKey': apiKey,
          'Content-Type': 'application/octet-stream',
          'Content-Length': stats.size,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(body || '{}'));
          } else {
            reject(new Error(`Erro no upload para o Bunny: Status ${res.statusCode} | ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    readStream.pipe(req);
  });
};

async function startMigration() {
  console.log("=== INICIANDO MIGRACAO DE VIDEOS SUPABASE -> BUNNY STREAM ===");
  
  // 1. Query videos still served by Supabase
  const { data: contents, error } = await supabase
    .from('contents')
    .select('id, title, file_url, content_type, thumbnail_url')
    .in('content_type', ['aula', 'short'])
    .or('video_provider.eq.supabase,video_provider.is.null');

  if (error) {
    console.error("Erro ao buscar conteudos no Supabase:", error);
    return;
  }

  console.log(`Encontrados ${contents.length} videos para migrar.`);

  for (let i = 0; i < contents.length; i++) {
    const video = contents[i];
    console.log(`\n[${i + 1}/${contents.length}] Migrando: "${video.title}" (ID: ${video.id})`);
    
    if (!video.file_url) {
      console.log(`-> Pulado: URL do arquivo vazia.`);
      continue;
    }

    const tempFilePath = path.join(__dirname, `temp_${video.id}.mp4`);
    
    try {
      // 1. Download file from Supabase Storage
      console.log(`-> Baixando do Supabase Storage...`);
      await downloadFile(video.file_url, tempFilePath);
      console.log(`-> Download concluido. Tamanho local: ${(fs.statSync(tempFilePath).size / 1024 / 1024).toFixed(2)} MB`);

      // 2. Create Video Entry in Bunny
      console.log(`-> Criando entrada de video no Bunny Stream...`);
      const createRes = await fetch(`https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos`, {
        method: 'POST',
        headers: {
          'AccessKey': BUNNY_STREAM_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: video.title }),
      });

      if (!createRes.ok) {
        throw new Error(`Falha ao criar video no Bunny: Status ${createRes.status}`);
      }

      const createData = await createRes.json();
      const bunnyVideoId = createData.guid;
      console.log(`-> Video criado na Bunny com ID: ${bunnyVideoId}`);

      // 3. Upload File to Bunny
      console.log(`-> Enviando arquivo para a Bunny CDN...`);
      await uploadToBunny(BUNNY_STREAM_LIBRARY_ID, bunnyVideoId, BUNNY_STREAM_API_KEY, tempFilePath);
      console.log(`-> Upload Bunny CDN concluido com sucesso!`);

      // 4. Update Database
      const hlsUrl = `https://${BUNNY_STREAM_CDN_HOSTNAME}/${bunnyVideoId}/playlist.m3u8`;
      const thumbnailUrl = `https://${BUNNY_STREAM_CDN_HOSTNAME}/${bunnyVideoId}/thumbnail.jpg`;

      const updateData = {
        video_provider: 'bunny',
        bunny_library_id: BUNNY_STREAM_LIBRARY_ID,
        bunny_video_id: bunnyVideoId,
        bunny_status: 'processing', // starts transcoding
        bunny_hls_url: hlsUrl,
        bunny_thumbnail_url: thumbnailUrl,
        file_url: hlsUrl, // Overwrite main file_url for players fallback
      };

      if (!video.thumbnail_url) {
        updateData.thumbnail_url = thumbnailUrl;
      }

      const { error: dbError } = await supabase
        .from('contents')
        .update(updateData)
        .eq('id', video.id);

      if (dbError) throw dbError;
      console.log(`-> Banco de dados atualizado para Bunny Stream!`);

    } catch (err) {
      console.error(`X Falha ao migrar "${video.title}":`, err.message);
    } finally {
      // Cleanup temp file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`-> Arquivo temporario limpo.`);
      }
    }
  }

  console.log("\n=== MIGRACAO CONCLUIDA ===");
  console.log("Nota: Os videos estao sendo codificados na Bunny. Os webhooks atualizarao o status para 'ready'.");
  console.log("Agora voce pode limpar/esvaziar o bucket 'contents' no Supabase Storage para liberar espaço!");
}

startMigration();
