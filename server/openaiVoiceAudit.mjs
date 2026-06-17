const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
const DEFAULT_AUDIT_MODEL = 'gpt-4.1-mini';
const SUPPORTED_AUDIO_TYPES = new Map([
  ['audio/mp4', { extension: 'm4a', type: 'audio/mp4' }],
  ['audio/x-m4a', { extension: 'm4a', type: 'audio/mp4' }],
  ['audio/mpeg', { extension: 'mp3', type: 'audio/mpeg' }],
  ['audio/mp3', { extension: 'mp3', type: 'audio/mpeg' }],
  ['audio/ogg', { extension: 'ogg', type: 'audio/ogg' }],
  ['audio/wav', { extension: 'wav', type: 'audio/wav' }],
  ['audio/wave', { extension: 'wav', type: 'audio/wav' }],
  ['audio/webm', { extension: 'webm', type: 'audio/webm' }],
]);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}. Define la variable en .env o en el entorno.`);
  return value;
}

function compactPoint(point) {
  return {
    id: point.id,
    code: point.code,
    mandatory: Boolean(point.mandatory),
    ko: point.ko ?? null,
  };
}

function normalizePointCode(code) {
  return String(code || '').replace(/\*/g, '').trim();
}

function mentionedCodes(transcript, points) {
  const explicitCodes = new Set(
    Array.from(String(transcript || '').matchAll(/\b\d+(?:\.\d+){0,5}\*?\b/g), (match) => normalizePointCode(match[0])),
  );
  if (!explicitCodes.size) return [];

  const availableCodes = new Set(points.map((point) => normalizePointCode(point.code)));
  return Array.from(explicitCodes).filter((code) => availableCodes.has(code));
}

function outputTextFromResponse(responseJson) {
  if (typeof responseJson.output_text === 'string') return responseJson.output_text;
  const chunks = [];
  for (const item of responseJson.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function cleanFieldText(value) {
  return String(value || '')
    .replace(/^\s*(?:en\s+)?(?:comentarios?|observaciones?|notas?|datos adicionales|datos extras?|extras?|informacion adicional|datos)\s*[:.,-]?\s*/i, '')
    .replace(/^\s*[sS]\s*[:.,-]\s*/, '')
    .replace(/^\s*[:.,-]\s*/, '')
    .trim();
}

function extractLabeledText(sourceText, labelPattern) {
  const matches = Array.from(
    String(sourceText || '').matchAll(
      new RegExp(`(?:${labelPattern})\\s*[:.,-]?\\s*([\\s\\S]*?)(?=\\b(?:en\\s+)?(?:comentarios?|observaciones?|notas?|datos adicionales|dato adicional|informacion adicional|info adicional|datos extras?|extras?|datos|punto|requisito)\\b|$)`, 'gi'),
    ),
  );
  const candidates = matches.map((match) => cleanFieldText(match[1] ?? '')).filter(Boolean);
  return candidates.find((candidate) => !/^(?:o|y)$/i.test(candidate)) ?? '';
}

function normalizeExtraction(extraction) {
  return {
    ...extraction,
    items: (extraction.items ?? []).map((item) => {
      const comment = cleanFieldText(item.comment);
      const extraData =
        cleanFieldText(item.extraData) ||
        extractLabeledText(item.sourceText, 'datos adicionales|dato adicional|informacion adicional|info adicional|datos extras?|extras?|datos');

      return {
        ...item,
        comment,
        extraData,
      };
    }),
  };
}

function audioFileInfo(file) {
  const mimeType = String(file?.type || '').split(';')[0].trim().toLowerCase();
  return SUPPORTED_AUDIO_TYPES.get(mimeType) ?? SUPPORTED_AUDIO_TYPES.get('audio/webm');
}

async function normalizeAudioFile(file) {
  const info = audioFileInfo(file);
  const arrayBuffer = await file.arrayBuffer();
  return new File([arrayBuffer], `audit-audio.${info.extension}`, { type: info.type });
}

function auditExtractionSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'warnings'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pointId', 'pointCode', 'status', 'comment', 'extraData', 'confidence', 'sourceText'],
          properties: {
            pointId: { type: 'string' },
            pointCode: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'fail', 'not_applicable', 'pending'] },
            comment: { type: 'string' },
            extraData: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            sourceText: { type: 'string' },
          },
        },
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  };
}

export async function transcribeAudio(file) {
  const apiKey = requiredEnv('OPENAI_API_KEY');
  const normalizedFile = await normalizeAudioFile(file);
  const form = new FormData();
  form.append('file', normalizedFile, normalizedFile.name);
  form.append('model', process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL);
  form.append('language', 'es');
  form.append(
    'prompt',
    'Auditoria IFS HPC en espanol. El auditor dicta codigos de requisitos como 1.1.1, estados conforme, no conforme o no aplica, comentarios y datos adicionales.',
  );

  const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI transcription error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  return data.text || '';
}

export async function extractAuditFromTranscript({ transcript, points }) {
  const apiKey = requiredEnv('OPENAI_API_KEY');
  const codes = mentionedCodes(transcript, points);
  const candidatePoints = codes.length ? points.filter((point) => codes.includes(normalizePointCode(point.code))) : points;
  const compactPoints = candidatePoints.map(compactPoint);
  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_AUDIT_MODEL || DEFAULT_AUDIT_MODEL,
      reasoning: { effort: 'medium' },
      input: [
        {
          role: 'developer',
          content: [
            'Eres un extractor estructurado de auditorias IFS HPC en espanol.',
            'Tu tarea es convertir una transcripcion oral en items JSON, uno por cada punto auditado.',
            '',
            'Reglas obligatorias:',
            '1. Usa solo puntos presentes explicitamente en la transcripcion y que existan en la lista candidata.',
            '2. Para cada punto, identifica status: pass, fail, not_applicable o pending.',
            '3. El campo comment contiene SOLO el texto mencionado despues de una etiqueta de comentario.',
            '4. El campo extraData contiene SOLO el texto mencionado despues de una etiqueta de datos adicionales.',
            '5. Las etiquetas nunca deben aparecer dentro de comment ni extraData.',
            '6. Si aparece una nueva etiqueta, el texto anterior termina ahi y el texto siguiente pertenece al nuevo campo.',
            '7. No mezcles comment y extraData. Si el auditor esta hablando de comentarios, rellena comment. Cuando detectes datos adicionales, rellena extraData.',
            '8. Si un campo no se menciona para un punto, devuelve cadena vacia en ese campo.',
            '9. No inventes datos y no copies texto de otros puntos.',
            '',
            'Etiquetas equivalentes para comment:',
            '- comentario, comentarios, comentario de auditoria, observacion, observaciones, nota, notas, en comentario, en comentarios',
            '',
            'Etiquetas equivalentes para extraData:',
            '- datos adicionales, dato adicional, datos extra, datos extras, extras, informacion adicional, info adicional, como dato adicional, en datos adicionales',
            '',
            'Ejemplos de separacion:',
            'Texto: "1.1.1 conforme. en comentario, la politica esta aprobada. en datos adicionales, revisado version vigente."',
            'Salida: comment="la politica esta aprobada." extraData="revisado version vigente."',
            '',
            'Texto: "1.1.2 no conforme. en comentarios, falta comunicacion al personal y como dato adicional o datos adicionales me gustaria revisar el plan anual."',
            'Salida: comment="falta comunicacion al personal" extraData="me gustaria revisar el plan anual."',
            '',
            'Texto: "comentarios: texto uno. datos extras: texto dos."',
            'Salida: comment="texto uno." extraData="texto dos."',
            '',
            'Devuelve JSON estricto siguiendo el schema. Si hay duda de estado usa pending y baja confidence.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            transcript,
            allowedStatuses: {
              pass: 'Conforme, cumple, pasa o apto',
              fail: 'No conforme, no cumple o no pasa',
              not_applicable: 'No aplica o no aplicable',
              pending: 'Sin estado claro',
            },
            fields: ['comment', 'extraData'],
            fieldAliases: {
              comment: ['comentario', 'comentarios', 'comentario de auditoria', 'comentarios de auditoria', 'observacion', 'observaciones', 'nota', 'notas', 'en comentario', 'en comentarios'],
              extraData: ['datos adicionales', 'dato adicional', 'datos extra', 'datos extras', 'extras', 'informacion adicional', 'info adicional', 'como dato adicional', 'en datos adicionales'],
            },
            candidateSelection: codes.length ? 'explicit_codes_only' : 'compact_index_only',
            points: compactPoints,
          }),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'voice_audit_extraction',
          strict: true,
          schema: auditExtractionSchema(),
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI extraction error ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const text = outputTextFromResponse(data);
  return normalizeExtraction(JSON.parse(text));
}

export async function processVoiceAudit({ file, transcript, points }) {
  const transcribedText = file && file.size ? await transcribeAudio(file) : '';
  const finalTranscript = [transcript, transcribedText].filter(Boolean).join('\n').trim();
  if (!finalTranscript) throw new Error('No hay audio ni transcripcion para procesar.');

  const extraction = await extractAuditFromTranscript({ transcript: finalTranscript, points });
  return {
    transcript: finalTranscript,
    usageMode: 'openai-extraction',
    ...extraction,
  };
}
