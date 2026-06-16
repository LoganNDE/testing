const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';
const DEFAULT_AUDIT_MODEL = 'gpt-5.5';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}. Define la variable en .env o en el entorno.`);
  return value;
}

function compactPoint(point) {
  return {
    id: point.id,
    code: point.code,
    title: point.title,
    sectionPath: point.sectionPath,
    requirement: point.requirement || point.description,
    mandatory: Boolean(point.mandatory),
    ko: point.ko ?? null,
  };
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
          required: ['pointId', 'pointCode', 'status', 'comment', 'extraData', 'evidence', 'correctiveAction', 'responsible', 'dueDate', 'confidence', 'sourceText'],
          properties: {
            pointId: { type: 'string' },
            pointCode: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'fail', 'not_applicable', 'pending'] },
            comment: { type: 'string' },
            extraData: { type: 'string' },
            evidence: { type: 'string' },
            correctiveAction: { type: 'string' },
            responsible: { type: 'string' },
            dueDate: { type: 'string' },
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
  const form = new FormData();
  form.append('file', file, file.name || 'audit-audio.webm');
  form.append('model', process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL);
  form.append('language', 'es');
  form.append(
    'prompt',
    'Auditoria IFS HPC en espanol. El auditor dicta codigos de requisitos como 1.1.1, estados conforme, no conforme o no aplica, comentarios, evidencias y datos adicionales.',
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
  const compactPoints = points.map(compactPoint);
  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_AUDIT_MODEL || DEFAULT_AUDIT_MODEL,
      reasoning: { effort: 'low' },
      input: [
        {
          role: 'developer',
          content:
            'Eres un asistente experto en auditorias IFS HPC. Extrae solo requisitos auditados explicitamente en la transcripcion. Relaciona cada fragmento con un unico punto de la lista. No inventes datos. Si hay duda de estado usa pending y baja confianza. Devuelve JSON estricto.',
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
            fields: ['comment', 'extraData', 'evidence', 'correctiveAction', 'responsible', 'dueDate'],
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
  return JSON.parse(text);
}

export async function processVoiceAudit({ file, transcript, points }) {
  const transcribedText = file && file.size ? await transcribeAudio(file) : '';
  const finalTranscript = [transcript, transcribedText].filter(Boolean).join('\n').trim();
  if (!finalTranscript) throw new Error('No hay audio ni transcripcion para procesar.');

  const extraction = await extractAuditFromTranscript({ transcript: finalTranscript, points });
  return {
    transcript: finalTranscript,
    ...extraction,
  };
}
