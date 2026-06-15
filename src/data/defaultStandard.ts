import type { StandardPoint } from '../types';

export const defaultPoints: StandardPoint[] = [
  {
    id: 'ifs-hpc-1.1',
    code: '1.1',
    title: 'Sistema de gestión de calidad y seguridad del producto',
    description:
      'La organización mantiene un sistema documentado, revisado y aplicado para controlar la calidad y seguridad de los productos.',
    sectionPath: ['1. Gobierno y sistema de gestión'],
    requirement: 'Verificar documentación, revisión por dirección, responsabilidades y registros aplicables.',
    mandatory: true,
    raw: null,
  },
  {
    id: 'ifs-hpc-2.1',
    code: '2.1',
    title: 'Gestión de riesgos',
    description:
      'Los peligros y riesgos relevantes para productos HPC se identifican, evalúan y controlan con medidas proporcionales.',
    sectionPath: ['2. Evaluación de riesgos'],
    requirement: 'Revisar matriz de riesgos, criterios de severidad/probabilidad y seguimiento de controles.',
    mandatory: true,
    raw: null,
  },
  {
    id: 'ifs-hpc-3.1',
    code: '3.1',
    title: 'Control documental',
    description:
      'Los procedimientos, instrucciones y registros están actualizados, disponibles y protegidos frente a uso no autorizado.',
    sectionPath: ['3. Documentación y registros'],
    requirement: 'Comprobar versiones vigentes, trazabilidad de cambios, retención y accesibilidad.',
    mandatory: false,
    raw: null,
  },
  {
    id: 'ifs-hpc-4.1',
    code: '4.1',
    title: 'Acciones correctivas y mejora',
    description:
      'Las no conformidades generan análisis de causa, acciones correctivas, responsables, plazos y verificación de eficacia.',
    sectionPath: ['4. Mejora continua'],
    requirement: 'Evaluar registros de incidencias, CAPA, evidencias de cierre y reincidencias.',
    mandatory: false,
    raw: null,
  },
];
