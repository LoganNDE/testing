import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const defaultPdf = 'C:\\Users\\logan\\Desktop\\Facturas-2024\\IFS_HPC_v3_standard_es-1.pdf';
const defaultText = resolve(projectRoot, 'extracted_ifs_hpc_part2.txt');
const outputPath = resolve(projectRoot, 'src/data/ifs_hpc_parte_2_requisitos_completo.json');
const pdftotext = 'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe';

const pdfPath = process.argv[2] ? resolve(process.argv[2]) : defaultPdf;

function ensureExtractedText() {
  if (existsSync(defaultText)) return;

  if (!existsSync(pdftotext)) {
    throw new Error(`No se encuentra pdftotext en ${pdftotext}`);
  }

  const result = spawnSync(pdftotext, ['-f', '54', '-l', '82', '-layout', '-enc', 'UTF-8', pdfPath, defaultText], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || 'No se pudo extraer el texto del PDF.');
  }
}

function normalizeLine(line) {
  return line
    .replace(/\f/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u2002|\u2003|\u2004|\u2005|\u2006|\u2007|\u2008|\u2009|\u200a|\u202f|\u205f|\u3000/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/[ \t]+$/g, '');
}

function isNoiseLine(trimmed) {
  if (!trimmed) return true;
  if (trimmed === 'PARTE 2') return true;
  if (trimmed === 'Lista de requisitos de Auditoría IFS HPC') return true;
  if (trimmed.startsWith('Sobre los requisitos:')) return true;
  if (/^Auditoría IFS HPC\.?\.?$/.test(trimmed)) return true;
  if (/^\d+\s+IFS HPC VERSIÓN 3$/.test(trimmed)) return true;
  if (/^IFS HPC VERSIÓN 3\s+\d+$/.test(trimmed)) return true;
  if (/^\d+$/.test(trimmed)) return true;
  return false;
}

function cleanTextBlock(lines) {
  const result = [];

  for (const originalLine of lines) {
    const line = normalizeLine(originalLine);
    const trimmed = line.trim();
    if (isNoiseLine(trimmed)) continue;

    if (result.length === 0) {
      result.push(trimmed);
      continue;
    }

    const previous = result[result.length - 1];
    const isBullet = trimmed.startsWith('•');
    const previousEndsParagraph = /[:.;]$/.test(previous) || previous.startsWith('•');
    const previousHyphenates = /-$/.test(previous);

    if (isBullet) {
      result.push(trimmed);
    } else if (previousHyphenates) {
      result[result.length - 1] = `${previous.slice(0, -1)}${trimmed}`;
    } else if (previousEndsParagraph) {
      result.push(trimmed);
    } else {
      result[result.length - 1] = `${previous} ${trimmed}`;
    }
  }

  return result.join('\n').replace(/[ \t]+/g, ' ').trim();
}

function extractItems(text) {
  const pages = text.split('\f');
  const items = [];
  let current = null;

  pages.forEach((pageText, pageIndex) => {
    const page = 54 + pageIndex;
    for (const rawLine of pageText.split(/\r?\n/)) {
      const line = normalizeLine(rawLine);
      const trimmed = line.trim();
      if (isNoiseLine(trimmed)) continue;

      const match = trimmed.match(/^([1-6](?:\.\d+)*)(\*)?\s+(.*)$/);
      if (match) {
        const [, numero, star = '', rest = ''] = match;
        const normalizedNumber = numero === '3.2.2' && current?.numero?.startsWith('3.3') ? '3.3.2' : numero;
        current = {
          numero: normalizedNumber,
          starred: Boolean(star),
          page,
          lines: [rest.trim()],
        };
        items.push(current);
        continue;
      }

      if (current) current.lines.push(line);
    }
  });

  return items;
}

function koNumber(text) {
  const match = text.match(/\bKO\s*N[°º]\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function toNode(item, children) {
  const level = item.numero.split('.').length;
  const hasChildren = children.length > 0;
  const body = cleanTextBlock(item.lines);
  const base = {
    numero: item.numero,
    tipo: hasChildren ? (level === 1 ? 'capitulo' : 'seccion') : 'punto',
    titulo: hasChildren ? body : null,
    texto: '',
    requiere_info_adicional_informe: item.starred,
    ko: null,
    pagina_inicio: item.page,
    children,
  };

  if (hasChildren) return base;

  return {
    ...base,
    titulo: null,
    texto: body,
    ko: koNumber(body),
  };
}

function buildTree(items) {
  const nodesByNumber = new Map();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const children = Array.from(nodesByNumber.values())
      .filter((node) => node.numero.startsWith(`${item.numero}.`) && node.numero.split('.').length === item.numero.split('.').length + 1)
      .sort((a, b) => compareNumbers(a.numero, b.numero));
    nodesByNumber.set(item.numero, toNode(item, children));
  }

  return Array.from(nodesByNumber.values())
    .filter((node) => node.numero.split('.').length === 1)
    .sort((a, b) => compareNumbers(a.numero, b.numero));
}

function compareNumbers(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function flatten(nodes, output = []) {
  for (const node of nodes) {
    output.push({
      numero: node.numero,
      tipo: node.tipo,
      titulo: node.titulo,
      texto: node.texto,
      requiere_info_adicional_informe: node.requiere_info_adicional_informe,
      ko: node.ko,
      pagina_inicio: node.pagina_inicio,
    });
    flatten(node.children, output);
  }
  return output;
}

ensureExtractedText();

const extractedText = readFileSync(defaultText, 'utf8');
const items = extractItems(extractedText);
const estructura = buildTree(items);
const puntosFlat = flatten(estructura);
const puntosAuditables = puntosFlat.filter((point) => point.tipo === 'punto');

const payload = {
  metadata: {
    norma: 'IFS HPC versión 3',
    parte: 'Parte 2 - Lista de requisitos de Auditoría IFS HPC',
    idioma: 'es',
    fuente: 'IFS_HPC_v3_standard_es-1.pdf',
    paginas_fuente: '54-82',
    generado: new Date().toISOString().slice(0, 10),
    extraccion: 'pdftotext -layout; estructura reconstruida por numeración jerárquica',
    criterios: {
      titulo: 'Solo se rellena en capítulos y secciones. Los puntos auditables usan titulo null para evitar títulos inferidos.',
      texto: 'Contiene el texto completo del punto auditable extraído bajo su numeración.',
    },
  },
  estructura,
  puntos_flat: puntosFlat,
  resumen: {
    nodos_totales: puntosFlat.length,
    puntos_auditables: puntosAuditables.length,
    puntos_ko: puntosAuditables.filter((point) => point.ko !== null).length,
    puntos_con_info_adicional_obligatoria: puntosAuditables.filter((point) => point.requiere_info_adicional_informe).length,
  },
};

writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      outputPath,
      nodos: payload.resumen.nodos_totales,
      auditables: payload.resumen.puntos_auditables,
      ko: payload.resumen.puntos_ko,
      infoAdicional: payload.resumen.puntos_con_info_adicional_obligatoria,
    },
    null,
    2,
  ),
);
