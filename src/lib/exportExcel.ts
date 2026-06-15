import * as XLSX from 'xlsx';
import type { AuditEntry, AuditMetadata, StandardPoint } from '../types';
import { statusLabels } from './audit';

export function exportAuditWorkbook(
  points: StandardPoint[],
  entries: Record<string, AuditEntry>,
  metadata: AuditMetadata,
): void {
  const rows = points.map((point) => {
    const entry = entries[point.id];
    return {
      Empresa: metadata.company,
      Centro: metadata.site,
      Auditor: metadata.auditor,
      Fecha: metadata.auditDate,
      Norma: metadata.standardName,
      Apartado: point.sectionPath.join(' > '),
      Punto: point.code,
      Titulo: point.title,
      Requisito: point.requirement || point.description,
      Obligatorio: point.mandatory ? 'Si' : 'No',
      KO: point.ko ?? '',
      Pagina: point.page ?? '',
      'Requiere info adicional informe': point.requiresReportInfo ? 'Si' : 'No',
      Resultado: statusLabels[entry?.status ?? 'pending'],
      Comentario: entry?.comment ?? '',
      'Datos adicionales': entry?.extraData ?? '',
      Evidencia: entry?.evidence ?? '',
      'Accion correctiva': entry?.correctiveAction ?? '',
      Responsable: entry?.responsible ?? '',
      'Fecha limite': entry?.dueDate ?? '',
      'Actualizado en': entry?.updatedAt ?? '',
    };
  });

  const workbook = XLSX.utils.book_new();
  const auditSheet = XLSX.utils.json_to_sheet(rows);
  const metadataSheet = XLSX.utils.json_to_sheet([metadata]);
  XLSX.utils.book_append_sheet(workbook, auditSheet, 'Auditoria');
  XLSX.utils.book_append_sheet(workbook, metadataSheet, 'Datos');
  XLSX.writeFile(workbook, `auditoria-${metadata.company || 'empresa'}-${metadata.auditDate}.xlsx`);
}
