import type { StandardPoint } from '../types';

const pointKeys = [
  'estructura',
  'chapters',
  'sections',
  'subsections',
  'points',
  'items',
  'requirements',
  'sub_requirements',
  'clauses',
  'children',
  'subpoints',
];
const titleKeys = ['title', 'name', 'titulo', 'nombre', 'heading'];
const descriptionKeys = ['texto_completo', 'description', 'text', 'texto', 'descripcion', 'requirementText', 'detalle', 'content'];
const requirementKeys = ['texto_completo', 'requirement', 'criteria', 'criterio', 'specification', 'especificacion', 'texto'];
const codeKeys = ['code', 'id', 'number', 'numero', 'clause', 'punto', 'reference', 'ref'];
const mandatoryKeys = ['mandatory', 'required', 'obligatorio', 'ko', 'is_ko', 'must'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(obj: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' || typeof value === 'number') return cleanText(String(value).trim());
  }
  return fallback;
}

function getBoolean(obj: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = obj[key];
    if (key === 'ko' && (typeof value === 'number' || typeof value === 'string')) return String(value).trim() !== '';
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.toLowerCase().trim();
      if (['true', 'yes', 'si', 'sí', 'obligatorio', 'required', 'mandatory', 'ko'].includes(normalized)) return true;
    }
  }
  return false;
}

function cleanText(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!/[ÃÂâ]/.test(normalized)) return normalized;

  try {
    const bytes = Uint8Array.from(Array.from(normalized), (char) => char.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8', { fatal: false })
      .decode(bytes)
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  } catch {
    return normalized;
  }
}

function childArrays(obj: Record<string, unknown>): unknown[] {
  return pointKeys.flatMap((key) => {
    const value = obj[key];
    if (!Array.isArray(value)) return [];
    if (key === 'checklist' && value.every((item) => typeof item === 'string')) return [];
    return value;
  });
}

function inferPoint(obj: Record<string, unknown>, sectionPath: string[], index: number): StandardPoint | null {
  const code = getString(obj, codeKeys, sectionPath.length ? `${sectionPath.join('.')}.${index + 1}` : `${index + 1}`);
  const explicitTitle = getString(obj, titleKeys);
  const description = getString(obj, descriptionKeys);
  const title = explicitTitle || code;
  const requirement = getString(obj, requirementKeys, description);
  const hasMeaningfulText = Boolean(title || description || requirement);

  if (!hasMeaningfulText) return null;

  const ko =
    typeof obj.ko_number === 'number'
      ? obj.ko_number
      : typeof obj.ko === 'number'
        ? obj.ko
        : typeof obj.ko === 'string' && obj.ko.trim()
          ? Number(obj.ko)
          : null;
  const page = typeof obj.page === 'number' ? obj.page : typeof obj.pagina_inicio === 'number' ? obj.pagina_inicio : null;
  const requiresReportInfo = obj.requiere_info_adicional_informe === true || obj.requires_report_info === true;

  return {
    id: `std-${code.replace(/\s+/g, '-').replace(/[^\w.-]/g, '').toLowerCase()}-${index}`,
    code,
    title,
    description,
    sectionPath,
    requirement,
    mandatory: Boolean(ko) || obj.is_ko === true || getBoolean(obj, mandatoryKeys),
    ko,
    page,
    requiresReportInfo,
    raw: obj,
  };
}

function walk(node: unknown, path: string[] = [], output: StandardPoint[] = []): StandardPoint[] {
  if (Array.isArray(node)) {
    node.forEach((child, index) => walkWithIndex(child, path, output, index));
    return output;
  }

  if (!isRecord(node)) return output;

  const rootArrays = childArrays(node);
  if (rootArrays.length) {
    const sectionTitle = getString(node, titleKeys);
    const nextPath = sectionTitle ? [...path, sectionTitle] : path;
    rootArrays.forEach((child, index) => walkWithIndex(child, nextPath, output, index));
    return output;
  }

  const point = inferPoint(node, path, output.length);
  if (point) output.push(point);
  return output;
}

function walkWithIndex(node: unknown, path: string[], output: StandardPoint[], index: number): void {
  if (isRecord(node)) {
    const children = childArrays(node);
    if (children.length) {
      const type = getString(node, ['tipo']);
      const sectionTitle = getString(node, titleKeys) || (type !== 'punto' ? getString(node, descriptionKeys) : '');
      const nextPath = sectionTitle ? [...path, sectionTitle] : path;
      children.forEach((child, childIndex) => walkWithIndex(child, nextPath, output, childIndex));
      return;
    }

    const type = getString(node, ['tipo']);
    if (type && type !== 'punto') return;

    const point = inferPoint(node, path, index);
    if (point) output.push(point);
  } else {
    walk(node, path, output);
  }
}

export function parseStandardJson(input: unknown): StandardPoint[] {
  const root =
    isRecord(input) && isRecord(input.chapter)
      ? input.chapter
      : isRecord(input) && Array.isArray(input.chapters)
        ? input.chapters
      : isRecord(input) && Array.isArray(input.estructura)
      ? input.estructura
      : isRecord(input) && Array.isArray(input.standard)
        ? input.standard
        : isRecord(input) && Array.isArray(input.puntos_flat)
          ? input.puntos_flat
          : input;
  const points = walk(root);
  const unique = new Map<string, StandardPoint>();

  points.forEach((point, index) => {
    const key = `${point.code}-${point.title}`;
    unique.set(key, { ...point, id: point.id || `std-${index}` });
  });

  return Array.from(unique.values());
}
