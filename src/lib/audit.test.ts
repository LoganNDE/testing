import { describe, expect, it } from 'vitest';
import { summarize } from './audit';
import type { StandardPoint } from '../types';

const points: StandardPoint[] = [
  { id: '1', code: '1', title: 'A', description: '', requirement: '', sectionPath: [], mandatory: true, raw: null },
  { id: '2', code: '2', title: 'B', description: '', requirement: '', sectionPath: [], mandatory: false, raw: null },
  { id: '3', code: '3', title: 'C', description: '', requirement: '', sectionPath: [], mandatory: false, raw: null },
];

describe('summarize', () => {
  it('calculates progress and compliance excluding omitted points', () => {
    const summary = summarize(points, {
      '1': { status: 'fail', comment: '', extraData: '', evidence: '', correctiveAction: '', responsible: '', dueDate: '', updatedAt: '' },
      '2': { status: 'pass', comment: '', extraData: '', evidence: '', correctiveAction: '', responsible: '', dueDate: '', updatedAt: '' },
      '3': { status: 'omit', comment: '', extraData: '', evidence: '', correctiveAction: '', responsible: '', dueDate: '', updatedAt: '' },
    });

    expect(summary.progress).toBe(100);
    expect(summary.compliance).toBe(50);
    expect(summary.mandatoryFailed).toBe(1);
  });
});
