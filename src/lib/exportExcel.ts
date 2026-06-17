import * as XLSX from 'xlsx';
import templateUrl from '../assets/ifs-hpc-template.xlsx?url';
import standardJson from '../data/ifs_hpc_parte_2_requisitos_completo.json';
import type { AuditEntry, AuditMetadata, StandardPoint } from '../types';

const TEMPLATE_SHEET = 'Informe Audit';
const FIRST_DATA_ROW = 8;
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NC_FILL_ID = '4';
const NC_RED_RGB = 'FFC00000';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

interface StandardJsonNode {
  numero: string;
  tipo: string;
  titulo: string | null;
  texto: string;
  requiere_info_adicional_informe?: boolean;
}

const standardNodes = ((standardJson as { puntos_flat?: StandardJsonNode[] }).puntos_flat ?? []);
const standardNodeByCode = new Map(standardNodes.map((node) => [node.numero, node]));

function value(ws: XLSX.WorkSheet, row: number, col: number): string {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
  return cell?.v == null ? '' : String(cell.v).trim();
}

function normalizeCode(code: string): string {
  return code.replace(/\*/g, '').trim();
}

function templateCodeForRow(ws: XLSX.WorkSheet, row: number): string {
  const primary = normalizeCode(value(ws, row, 4) || value(ws, row, 3));
  const requirement = value(ws, row, 5);
  const codesInText = Array.from(requirement.matchAll(/\b\d+(?:\.\d+){2,}\b/g), (match) => match[0]);
  const detailedCode = codesInText
    .filter((code) => primary && (code === primary || code.startsWith(`${primary}.`)))
    .sort((a, b) => b.split('.').length - a.split('.').length)[0];

  return detailedCode || primary;
}

function templateVal(entry?: AuditEntry): string {
  if (!entry) return '';
  if (entry.status === 'pass') return 'CO';
  if (entry.status === 'fail') return 'NC';
  if (entry.status === 'not_applicable' || entry.status === 'omit') return 'NA';
  return '';
}

function auditExplanation(entry?: AuditEntry): string {
  if (!entry) return '';
  return entry.comment ?? '';
}

function auditComments(entry?: AuditEntry): string {
  if (!entry) return '';
  return entry.extraData ?? '';
}

function filenamePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').toLowerCase() || 'empresa';
}

function codeParts(code: string): string[] {
  return normalizeCode(code).split('.').filter(Boolean);
}

function codeAtLevel(code: string, level: number): string {
  return codeParts(code).slice(0, level).join('.');
}

function displayCode(code: string, node?: StandardJsonNode): string {
  return `${code}${node?.requiere_info_adicional_informe ? '*' : ''}`;
}

function chapterText(code: string): string {
  const chapterCode = codeAtLevel(code, 1);
  const chapter = standardNodeByCode.get(chapterCode);
  return chapter ? `${chapter.numero}. ${chapter.titulo ?? ''}`.trim() : '';
}

function clauseText(code: string): string {
  return codeAtLevel(code, 2);
}

function sectionText(code: string): string {
  const section = standardNodeByCode.get(codeAtLevel(code, 2));
  return section?.titulo ?? '';
}

function cl1Text(code: string): string {
  const parts = codeParts(code);
  return parts.length > 4 ? codeAtLevel(code, 3) : displayCode(codeAtLevel(code, Math.min(parts.length, 3)), standardNodeByCode.get(code));
}

function cl2Text(code: string): string {
  const parts = codeParts(code);
  if (parts.length <= 3) return '';
  return parts.length > 4 ? codeAtLevel(code, parts.length - 1) : displayCode(code, standardNodeByCode.get(code));
}

function requirementText(code: string): string {
  const node = standardNodeByCode.get(code);
  if (!node) return '';

  const parts = codeParts(code);
  const parentCode = parts.length > 3 ? codeAtLevel(code, parts.length - 1) : '';
  const parent = parentCode ? standardNodeByCode.get(parentCode) : null;
  const parentLine = parent?.titulo ? `${parent.numero} ${parent.titulo}` : '';
  const pointPrefix = parts.length > 4 ? `${displayCode(code, node)} ` : '';
  const text = node.texto.replace(/\n/g, '\r\n');

  return [parentLine, `${pointPrefix}${text}`.trim()].filter(Boolean).join('\r\n');
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU16(output: number[], value: number): void {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32(output: number[], value: number): void {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no permite exportar la plantilla exacta. Usa Chrome, Edge o actualiza el navegador.');
  }
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (readU32(bytes, index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('La plantilla Excel no parece un XLSX válido.');

  const totalEntries = readU16(bytes, eocd + 10);
  let centralOffset = readU32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let entryIndex = 0; entryIndex < totalEntries; entryIndex += 1) {
    if (readU32(bytes, centralOffset) !== 0x02014b50) throw new Error('No se pudo leer la plantilla XLSX.');

    const method = readU16(bytes, centralOffset + 10);
    const compressedSize = readU32(bytes, centralOffset + 20);
    const fileNameLength = readU16(bytes, centralOffset + 28);
    const extraLength = readU16(bytes, centralOffset + 30);
    const commentLength = readU16(bytes, centralOffset + 32);
    const localOffset = readU32(bytes, centralOffset + 42);
    const name = textDecoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + fileNameLength));

    const localFileNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + localFileNameLength + localExtraLength;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);
    const data = method === 8 ? await inflateRaw(compressedData) : compressedData;
    entries.push({ name, data });

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function writeZip(entries: ZipEntry[]): Blob {
  const output: number[] = [];
  const centralDirectory: number[] = [];

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const offset = output.length;
    const crc = crc32(entry.data);

    writeU32(output, 0x04034b50);
    writeU16(output, 20);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU16(output, 0);
    writeU32(output, crc);
    writeU32(output, entry.data.length);
    writeU32(output, entry.data.length);
    writeU16(output, nameBytes.length);
    writeU16(output, 0);
    output.push(...nameBytes, ...entry.data);

    writeU32(centralDirectory, 0x02014b50);
    writeU16(centralDirectory, 20);
    writeU16(centralDirectory, 20);
    writeU16(centralDirectory, 0);
    writeU16(centralDirectory, 0);
    writeU16(centralDirectory, 0);
    writeU16(centralDirectory, 0);
    writeU32(centralDirectory, crc);
    writeU32(centralDirectory, entry.data.length);
    writeU32(centralDirectory, entry.data.length);
    writeU16(centralDirectory, nameBytes.length);
    writeU16(centralDirectory, 0);
    writeU16(centralDirectory, 0);
    writeU16(centralDirectory, 0);
    writeU16(centralDirectory, 0);
    writeU32(centralDirectory, 0);
    writeU32(centralDirectory, offset);
    centralDirectory.push(...nameBytes);
  }

  const centralOffset = output.length;
  output.push(...centralDirectory);
  writeU32(output, 0x06054b50);
  writeU16(output, 0);
  writeU16(output, 0);
  writeU16(output, entries.length);
  writeU16(output, entries.length);
  writeU32(output, centralDirectory.length);
  writeU32(output, centralOffset);
  writeU16(output, 0);

  const buffer = new Uint8Array(output).buffer as ArrayBuffer;
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function xmlDoc(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function serializeXml(doc: Document): Uint8Array {
  return textEncoder.encode(new XMLSerializer().serializeToString(doc));
}

function cellRefColumn(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? '';
  return Array.from(letters).reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

function ensureRow(doc: Document, sheetData: Element, rowNumber: number): Element {
  const existing = Array.from(sheetData.getElementsByTagName('row')).find((row) => row.getAttribute('r') === String(rowNumber));
  if (existing) return existing;

  const row = doc.createElementNS(SPREADSHEET_NS, 'row');
  row.setAttribute('r', String(rowNumber));
  sheetData.appendChild(row);
  return row;
}

function ensureCell(doc: Document, row: Element, address: string): Element {
  const existing = Array.from(row.getElementsByTagName('c')).find((cell) => cell.getAttribute('r') === address);
  if (existing) return existing;

  const cell = doc.createElementNS(SPREADSHEET_NS, 'c');
  cell.setAttribute('r', address);
  const targetColumn = cellRefColumn(address);
  const nextCell = Array.from(row.getElementsByTagName('c')).find((candidate) => cellRefColumn(candidate.getAttribute('r') ?? '') > targetColumn);
  row.insertBefore(cell, nextCell ?? null);
  return cell;
}

function setInlineCell(doc: Document, sheetData: Element, address: string, text: string): void {
  const rowNumber = Number(address.match(/\d+$/)?.[0]);
  const row = ensureRow(doc, sheetData, rowNumber);
  const cell = ensureCell(doc, row, address);
  while (cell.firstChild) cell.removeChild(cell.firstChild);

  cell.setAttribute('t', 'inlineStr');
  const inline = doc.createElementNS(SPREADSHEET_NS, 'is');
  const textNode = doc.createElementNS(SPREADSHEET_NS, 't');
  textNode.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  textNode.textContent = text;
  inline.appendChild(textNode);
  cell.appendChild(inline);
}

function getCell(sheetData: Element, address: string): Element | null {
  return Array.from(sheetData.getElementsByTagName('c')).find((cell) => cell.getAttribute('r') === address) ?? null;
}

function getCellStyleId(sheetData: Element, address: string): string {
  return getCell(sheetData, address)?.getAttribute('s') ?? '0';
}

function setCellStyle(sheetData: Element, address: string, styleId: string): void {
  getCell(sheetData, address)?.setAttribute('s', styleId);
}

function elementChildren(element: Element): Element[] {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === Node.ELEMENT_NODE);
}

function ensureNcFillStyle(stylesDoc: Document, baseStyleId: string, cache: Map<string, string>): string {
  const cacheKey = `fill:${baseStyleId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const cellXfs = stylesDoc.getElementsByTagName('cellXfs')[0];
  if (!cellXfs) return baseStyleId;

  const styles = elementChildren(cellXfs);
  const baseStyle = styles[Number(baseStyleId)] ?? styles[0];
  if (!baseStyle) return baseStyleId;

  // Excel guarda el formato de cada celda como un "xf". Clonamos el formato
  // original para conservar bordes, alineacion y espaciado, cambiando solo el fondo.
  const ncStyle = baseStyle.cloneNode(true) as Element;
  ncStyle.setAttribute('fillId', NC_FILL_ID);
  ncStyle.setAttribute('applyFill', '1');

  const ncStyleId = String(styles.length);
  cellXfs.appendChild(ncStyle);
  cellXfs.setAttribute('count', String(styles.length + 1));
  cache.set(cacheKey, ncStyleId);

  return ncStyleId;
}

function cloneFontWithColor(stylesDoc: Document, baseFontId: string): string | null {
  const fonts = stylesDoc.getElementsByTagName('fonts')[0];
  if (!fonts) return null;

  const baseFont = elementChildren(fonts)[Number(baseFontId)] ?? elementChildren(fonts)[0];
  if (!baseFont) return null;

  const font = baseFont.cloneNode(true) as Element;
  Array.from(font.getElementsByTagName('color')).forEach((color) => color.remove());

  const color = stylesDoc.createElementNS(SPREADSHEET_NS, 'color');
  color.setAttribute('rgb', NC_RED_RGB);
  font.appendChild(color);

  const fontId = String(elementChildren(fonts).length);
  fonts.appendChild(font);
  fonts.setAttribute('count', String(Number(fontId) + 1));

  return fontId;
}

function ensureNcTextStyle(stylesDoc: Document, baseStyleId: string, cache: Map<string, string>): string {
  const cacheKey = `text:${baseStyleId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const cellXfs = stylesDoc.getElementsByTagName('cellXfs')[0];
  if (!cellXfs) return baseStyleId;

  const styles = elementChildren(cellXfs);
  const baseStyle = styles[Number(baseStyleId)] ?? styles[0];
  if (!baseStyle) return baseStyleId;

  const fontId = cloneFontWithColor(stylesDoc, baseStyle.getAttribute('fontId') ?? '0');
  if (!fontId) return baseStyleId;

  // El comentario mantiene el fondo original de la plantilla; solo cambiamos el color del texto.
  const ncTextStyle = baseStyle.cloneNode(true) as Element;
  ncTextStyle.setAttribute('fontId', fontId);
  ncTextStyle.setAttribute('applyFont', '1');

  const ncStyleId = String(styles.length);
  cellXfs.appendChild(ncTextStyle);
  cellXfs.setAttribute('count', String(styles.length + 1));
  cache.set(cacheKey, ncStyleId);

  return ncStyleId;
}

function applyNcResultStyles(
  stylesDoc: Document,
  sheetData: Element,
  excelRow: number,
  styleCache: Map<string, string>,
  hasAdditionalComment: boolean,
): void {
  const valAddress = `G${excelRow}`;
  setCellStyle(sheetData, valAddress, ensureNcFillStyle(stylesDoc, getCellStyleId(sheetData, valAddress), styleCache));

  const commentAddresses: string[] = [];
  if (hasAdditionalComment) commentAddresses.push(`I${excelRow}`);

  for (const address of commentAddresses) {
    setCellStyle(sheetData, address, ensureNcTextStyle(stylesDoc, getCellStyleId(sheetData, address), styleCache));
  }
}

function workbookSheetPath(entries: ZipEntry[], sheetName: string): string {
  const workbookEntry = entries.find((entry) => entry.name === 'xl/workbook.xml');
  const relsEntry = entries.find((entry) => entry.name === 'xl/_rels/workbook.xml.rels');
  if (!workbookEntry || !relsEntry) return 'xl/worksheets/sheet1.xml';

  const workbook = xmlDoc(textDecoder.decode(workbookEntry.data));
  const rels = xmlDoc(textDecoder.decode(relsEntry.data));
  const sheet = Array.from(workbook.getElementsByTagName('sheet')).find((item) => item.getAttribute('name') === sheetName);
  const relId = sheet?.getAttribute('r:id');
  const rel = Array.from(rels.getElementsByTagName('Relationship')).find((item) => item.getAttribute('Id') === relId);
  const target = rel?.getAttribute('Target') ?? 'worksheets/sheet1.xml';
  return target.startsWith('xl/') ? target : `xl/${target.replace(/^\//, '')}`;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportAuditWorkbook(
  points: StandardPoint[],
  entries: Record<string, AuditEntry>,
  metadata: AuditMetadata,
): Promise<void> {
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error('No se pudo cargar la plantilla Excel.');

  const templateBuffer = await response.arrayBuffer();
  const workbook = XLSX.read(templateBuffer.slice(0), { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[TEMPLATE_SHEET];
  if (!sheet?.['!ref']) throw new Error(`La plantilla no contiene la hoja "${TEMPLATE_SHEET}".`);

  const entriesZip = await readZip(templateBuffer);
  const sheetPath = workbookSheetPath(entriesZip, TEMPLATE_SHEET);
  const sheetEntry = entriesZip.find((entry) => entry.name === sheetPath);
  const stylesEntry = entriesZip.find((entry) => entry.name === 'xl/styles.xml');
  if (!sheetEntry) throw new Error('No se pudo localizar la hoja principal dentro de la plantilla.');
  if (!stylesEntry) throw new Error('No se pudo localizar el archivo de estilos dentro de la plantilla.');

  const doc = xmlDoc(textDecoder.decode(sheetEntry.data));
  const stylesDoc = xmlDoc(textDecoder.decode(stylesEntry.data));
  const sheetData = doc.getElementsByTagName('sheetData')[0];
  if (!sheetData) throw new Error('La hoja principal de la plantilla no tiene datos editables.');

  const pointsByCode = new Map(points.map((point) => [point.code, point]));
  const ncStyleCache = new Map<string, string>();
  const range = XLSX.utils.decode_range(sheet['!ref']);

  setInlineCell(doc, sheetData, 'A4', `Empresa: ${metadata.company}`);
  setInlineCell(doc, sheetData, 'A5', `Fecha Auditoria: ${metadata.auditDate}`);
  setInlineCell(doc, sheetData, 'A6', `Equipo Auditor: ${metadata.auditor}`);
  setInlineCell(doc, sheetData, 'F4', `Alcance: ${metadata.scope || metadata.site || ''}`);
  setInlineCell(doc, sheetData, 'I1', `Documento\r\nFecha edición: ${metadata.auditDate}`);

  for (let row = FIRST_DATA_ROW; row <= range.e.r; row += 1) {
    const code = templateCodeForRow(sheet, row);
    if (!code) continue;

    const node = standardNodeByCode.get(code);
    if (node?.tipo === 'punto') {
      const excelRow = row + 1;
      setInlineCell(doc, sheetData, `A${excelRow}`, chapterText(code));
      setInlineCell(doc, sheetData, `B${excelRow}`, clauseText(code));
      setInlineCell(doc, sheetData, `C${excelRow}`, sectionText(code));
      setInlineCell(doc, sheetData, `D${excelRow}`, cl1Text(code));
      setInlineCell(doc, sheetData, `E${excelRow}`, cl2Text(code));
      setInlineCell(doc, sheetData, `F${excelRow}`, requirementText(code));
    }

    const point = pointsByCode.get(code);
    const entry = point ? entries[point.id] : undefined;
    const excelRow = row + 1;
    const val = templateVal(entry);
    const explanation = auditExplanation(entry);
    const comments = auditComments(entry);
    setInlineCell(doc, sheetData, `G${excelRow}`, val);
    setInlineCell(doc, sheetData, `H${excelRow}`, explanation);
    setInlineCell(doc, sheetData, `I${excelRow}`, comments);

    if (val === 'NC') {
      applyNcResultStyles(stylesDoc, sheetData, excelRow, ncStyleCache, Boolean(comments.trim()));
    }
  }

  sheetEntry.data = serializeXml(doc);
  stylesEntry.data = serializeXml(stylesDoc);
  const blob = writeZip(entriesZip);
  download(blob, `auditoria-ifs-hpc-${filenamePart(metadata.company)}-${metadata.auditDate}.xlsx`);
}
