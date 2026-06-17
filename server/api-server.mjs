import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { loadEnvFile } from './loadEnv.mjs';
import { processVoiceAudit } from './openaiVoiceAudit.mjs';

loadEnvFile();

const port = Number(process.env.API_PORT || 8787);
const host = process.env.API_HOST || '127.0.0.1';
const maxRequestBytes = Number(process.env.MAX_VOICE_AUDIT_BYTES || 25 * 1024 * 1024);
const maxAuditPoints = Number(process.env.MAX_AUDIT_POINTS || 500);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || 'http://127.0.0.1:5173',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end(JSON.stringify(payload));
}

async function parseMultipartRequest(request) {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength && contentLength > maxRequestBytes) {
    throw new Error('La grabacion o transcripcion supera el tamano maximo permitido.');
  }

  const webRequest = new Request(`http://127.0.0.1:${port}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: Readable.toWeb(request),
    duplex: 'half',
  });
  return webRequest.formData();
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (request.method !== 'POST' || request.url !== '/api/voice-audit') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  try {
    const form = await parseMultipartRequest(request);
    const file = form.get('audio');
    const transcript = String(form.get('transcript') || '');
    const points = JSON.parse(String(form.get('points') || '[]'));
    if (!Array.isArray(points) || points.length > maxAuditPoints) {
      sendJson(response, 400, { error: 'Listado de puntos invalido o demasiado grande.' });
      return;
    }

    const result = await processVoiceAudit({
      file: file instanceof File ? file : null,
      transcript,
      points,
    });

    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'No se pudo procesar la auditoria de voz.',
    });
  }
});

server.listen(port, host, () => {
  console.log(`Voice audit API listening on http://${host}:${port}`);
});
