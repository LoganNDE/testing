import type { AuditEntry, AuditStatus, AuditSummary, StandardPoint } from '../types';

export const statusLabels: Record<AuditStatus, string> = {
  pending: 'Pendiente',
  pass: 'Pasa',
  fail: 'No pasa',
  omit: 'Omitido',
  not_applicable: 'No aplica',
};

export function emptyEntry(): AuditEntry {
  return {
    status: 'pending',
    comment: '',
    extraData: '',
    evidence: '',
    correctiveAction: '',
    responsible: '',
    dueDate: '',
    updatedAt: new Date().toISOString(),
  };
}

export function summarize(points: StandardPoint[], entries: Record<string, AuditEntry>): AuditSummary {
  const summary = points.reduce(
    (acc, point) => {
      const status = entries[point.id]?.status ?? 'pending';
      if (status === 'pass') acc.passed += 1;
      if (status === 'fail') acc.failed += 1;
      if (status === 'omit') acc.omitted += 1;
      if (status === 'not_applicable') acc.notApplicable += 1;
      if (status === 'pending') acc.pending += 1;
      if (point.mandatory && status === 'fail') acc.mandatoryFailed += 1;
      return acc;
    },
    {
      total: points.length,
      evaluated: 0,
      passed: 0,
      failed: 0,
      omitted: 0,
      notApplicable: 0,
      pending: 0,
      mandatoryFailed: 0,
      progress: 0,
      compliance: 0,
    },
  );

  summary.evaluated = summary.total - summary.pending;
  const auditable = summary.total - summary.omitted - summary.notApplicable;
  summary.progress = summary.total ? Math.round((summary.evaluated / summary.total) * 100) : 0;
  summary.compliance = auditable ? Math.round((summary.passed / auditable) * 100) : 0;

  return summary;
}
