export type AuditStatus = 'pending' | 'pass' | 'fail' | 'omit' | 'not_applicable';

export interface StandardPoint {
  id: string;
  code: string;
  title: string;
  description: string;
  sectionPath: string[];
  requirement: string;
  mandatory: boolean;
  ko?: number | null;
  page?: number | null;
  requiresReportInfo?: boolean;
  raw: unknown;
}

export interface AuditEntry {
  status: AuditStatus;
  comment: string;
  extraData: string;
  evidence: string;
  correctiveAction: string;
  responsible: string;
  dueDate: string;
  updatedAt: string;
}

export interface AuditMetadata {
  company: string;
  site: string;
  scope: string;
  auditor: string;
  auditDate: string;
  standardName: string;
}

export interface AuditSummary {
  total: number;
  evaluated: number;
  passed: number;
  failed: number;
  omitted: number;
  notApplicable: number;
  pending: number;
  mandatoryFailed: number;
  progress: number;
  compliance: number;
}
