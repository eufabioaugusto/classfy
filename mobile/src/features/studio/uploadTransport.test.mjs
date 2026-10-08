import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelStudioTransfer, decodeBase64Bytes, isUploadTargetExpired, parseTusOffset, resolveTusLocation, StudioUploadCancelledError, StudioUploadRestartError, uploadStudioFile } from './uploadTransport.ts';

const bytes = Uint8Array.from([0, 255, 21, 84, 35, 128, 42, 43, 44, 45]);
function fileSystem(overrides = {}) {
  return {
    EncodingType: { Base64: 'base64' }, FileSystemUploadType: { BINARY_CONTENT: 0 }, FileSystemSessionType: { FOREGROUND: 1 },
    readAsStringAsync: async (_uri, { position, length }) => Buffer.from(bytes.slice(position, position + length)).toString('base64'),
    ...overrides,
  };
}
function request(overrides = {}) {
  return { ownerId: 'owner', projectId: 'project', uri: 'file:///Documents/video.mp4', name: 'Aula ação.mp4', mimeType: 'video/mp4',
    fileSize: bytes.length, target: { mediaAssetId: 'asset', provider: 'bunny', method: 'TUS', uploadUrl: 'https://provider.test/tusupload', headers: { Signed: 'test-only' } },
    onTusUrl: async () => undefined, ...overrides };
}
const head = (offset) => new Response(null, { status: 200, headers: { 'Upload-Offset': String(offset) } });
const patchResponse = (offset) => new Response(null, { status: 204, headers: { 'Upload-Offset': String(offset) } });

test('offset de retomada rejeita valores inválidos e preserva bytes binários', () => {
  assert.equal(parseTusOffset('4', 10), 4);
  for (const value of [null, '-1', '1.5', '11', 'not-a-number']) assert.throws(() => parseTusOffset(value, 10));
  assert.deepEqual(decodeBase64Bytes(Buffer.from(bytes).toString('base64')), bytes);
});
test('destino de retomada não pode encaminhar assinatura a outra origem', () => {
  assert.equal(resolveTusLocation('/uploads/1', 'https://provider.test/tusupload'), 'https://provider.test/uploads/1');
  for (const location of ['https://other.test/1', 'http://provider.test/1', null]) assert.throws(() => resolveTusLocation(location, 'https://provider.test/tusupload'));
  assert.equal(isUploadTargetExpired(new Date(30_001).toISOString(), 15_000), false);
  assert.equal(isUploadTargetExpired(new Date(30_000).toISOString(), 15_000), true);
  assert.equal(isUploadTargetExpired('invalid'), true);
});
test('TUS retoma com HEAD do ponto confirmado sem reenviar os primeiros bytes', async () => {
  const reads = [];
  const sent = [];
  const progress = [];
  const fs = fileSystem({ readAsStringAsync: async (uri, options) => { reads.push(options); return fileSystem().readAsStringAsync(uri, options); } });
  await uploadStudioFile(request({ tusUrl: 'https://provider.test/uploads/1', onProgress: value => progress.push(value) }), {
    fileSystem: fs, chunkSize: 3,
    fetch: async (_url, options) => {
      if (options.method === 'HEAD') return head(4);
      assert.equal(options.method, 'PATCH');
      assert.equal(options.headers['Tus-Resumable'], '1.0.0');
      assert.equal(options.headers['Content-Type'], 'application/offset+octet-stream');
      sent.push([...new Uint8Array(options.body)]);
      return patchResponse(Number(options.headers['Upload-Offset']) + options.body.byteLength);
    },
  });
  assert.deepEqual(reads.map(r => [r.position, r.length]), [[4, 3], [7, 3]]);
  assert.deepEqual(sent, [[35, 128, 42], [43, 44, 45]]);
  assert.deepEqual(progress, [40, 70, 100]);
});
test('TUS salva o endereço antes da transferência e codifica nome UTF-8', async () => {
  const events = [];
  await uploadStudioFile(request({ onTusUrl: async url => { assert.equal(url, 'https://provider.test/uploads/1'); events.push('persist'); } }), {
    fileSystem: fileSystem(), chunkSize: 10,
    fetch: async (_url, options) => {
      events.push(options.method);
      if (options.method === 'POST') {
        assert.equal(options.headers['Upload-Length'], '10');
        const encodedName = options.headers['Upload-Metadata'].split(',')[0].slice('filename '.length);
        assert.equal(Buffer.from(encodedName, 'base64').toString(), 'Aula ação.mp4');
        return new Response(null, { status: 201, headers: { Location: '/uploads/1' } });
      }
      return options.method === 'HEAD' ? head(0) : patchResponse(10);
    },
  });
  assert.deepEqual(events, ['POST', 'persist', 'HEAD', 'PATCH']);
});
test('TUS não avança quando o servidor confirma um offset incorreto', async () => {
  let patches = 0;
  await assert.rejects(uploadStudioFile(request({ tusUrl: 'https://provider.test/uploads/1' }), {
    fileSystem: fileSystem(), chunkSize: 3,
    fetch: async (_url, options) => options.method === 'HEAD' ? head(0) : (patches += 1, patchResponse(2)),
  }), /não confirmou/);
  assert.equal(patches, 1);
});
test('upload expirado pode preparar novo destino em vez de repetir URL inválida', async () => {
  await assert.rejects(uploadStudioFile(request({ tusUrl: 'https://provider.test/uploads/1' }), {
    fileSystem: fileSystem(), fetch: async () => new Response(null, { status: 410 }),
  }), StudioUploadRestartError);
});
test('PUT envia binário nativo em foreground e só completa após HTTP de sucesso', async () => {
  const progress = [];
  await uploadStudioFile(request({ target: { mediaAssetId: 'asset', provider: 'mux', method: 'PUT', uploadUrl: 'https://provider.test/upload' }, onProgress: p => progress.push(p) }), {
    fileSystem: fileSystem({ createUploadTask: (_url, uri, options, onProgress) => {
      assert.equal(uri, 'file:///Documents/video.mp4');
      assert.deepEqual(options, { httpMethod: 'PUT', uploadType: 0, sessionType: 1, headers: { 'Content-Type': 'video/mp4' } });
      return { cancelAsync: async () => undefined, uploadAsync: async () => { onProgress({ totalBytesSent: 10, totalBytesExpectedToSend: 10 }); return { status: 200 }; } };
    } }),
  });
  assert.deepEqual(progress, [99, 100]);
});
test('cancelamento interrompe request sem apagar mídia remota', async () => {
  const methods = [];
  let notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const transfer = uploadStudioFile(request({ tusUrl: 'https://provider.test/uploads/1' }), {
    fileSystem: fileSystem(), fetch: async (_url, options) => {
      methods.push(options.method);
      notifyStarted();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    },
  });
  await started;
  await cancelStudioTransfer('owner', 'project');
  await assert.rejects(transfer, StudioUploadCancelledError);
  assert.deepEqual(methods, ['HEAD']);
});
test('ambiente mock não pode simular publicação concluída', async () => {
  await assert.rejects(uploadStudioFile(request({ target: { mediaAssetId: 'fake', provider: 'mock', method: 'MOCK', uploadUrl: 'https://provider.test/fake' } })), /não está disponível/);
});
