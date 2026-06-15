import { describe, expect, it } from 'vitest';
import { parseStandardJson } from './standardParser';

describe('parseStandardJson', () => {
  it('normalizes nested standards with mandatory points', () => {
    const points = parseStandardJson({
      title: 'IFS-HPC',
      sections: [],
      requirements: [
        {
          code: '1',
          title: 'Gobierno',
          children: [
            {
              code: '1.1',
              title: 'Responsabilidad',
              description: 'Debe existir responsable.',
              mandatory: true,
            },
          ],
        },
      ],
    });

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      code: '1.1',
      title: 'Responsabilidad',
      mandatory: true,
      sectionPath: ['IFS-HPC', 'Gobierno'],
    });
  });

  it('accepts flat checklist arrays', () => {
    const points = parseStandardJson([
      { punto: '2.1', titulo: 'Riesgos', criterio: 'Evaluar riesgos', obligatorio: 'si' },
      { punto: '2.2', titulo: 'Registros', criterio: 'Mantener registros' },
    ]);

    expect(points).toHaveLength(2);
    expect(points[0].mandatory).toBe(true);
    expect(points[1].requirement).toBe('Mantener registros');
  });

  it('parses IFS-HPC style structures without section duplicates', () => {
    const points = parseStandardJson({
      estructura: [
        {
          numero: '1',
          tipo: 'capitulo',
          titulo: 'Gobernanza',
          children: [
            {
              numero: '1.1',
              tipo: 'seccion',
              titulo: 'Politica',
              children: [
                {
                  numero: '1.1.1',
                  tipo: 'punto',
                  titulo: 'KO NÂ° 1: DirecciÃ³n',
                  texto: 'La direcciÃ³n debe documentar responsabilidades.',
                  ko: 1,
                  requiere_info_adicional_informe: true,
                  pagina_inicio: 54,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      code: '1.1.1',
      title: 'KO N° 1: Dirección',
      requirement: 'La dirección debe documentar responsabilidades.',
      mandatory: true,
      ko: 1,
      page: 54,
      requiresReportInfo: true,
      sectionPath: ['Gobernanza', 'Politica'],
    });
  });

  it('uses texto as the single source for IFS-HPC requirement text', () => {
    const points = parseStandardJson({
      estructura: [
        {
          numero: '2',
          tipo: 'capitulo',
          titulo: 'Capitulo',
          children: [
            {
              numero: '2.1.1',
              tipo: 'punto',
              titulo: null,
              texto: 'La direccion debera asegurarse de que el sistema es revisado completamente.',
              children: [],
            },
          ],
        },
      ],
    });

    expect(points[0].title).toBe('2.1.1');
    expect(points[0].requirement).toBe('La direccion debera asegurarse de que el sistema es revisado completamente.');
  });

  it('uses the point number as title when IFS-HPC has no explicit title', () => {
    const points = parseStandardJson({
      estructura: [
        {
          numero: '1',
          tipo: 'capitulo',
          titulo: 'Gobernanza',
          children: [
            {
              numero: '1.1.2',
              tipo: 'punto',
              titulo: null,
              texto: 'Toda la informacion pertinente debera comunicarse de forma efectiva y a su debido tiempo.',
              children: [],
            },
          ],
        },
      ],
    });

    expect(points[0].title).toBe('1.1.2');
    expect(points[0].requirement).toBe('Toda la informacion pertinente debera comunicarse de forma efectiva y a su debido tiempo.');
  });

  it('keeps generated IFS-HPC point titles empty and reads the full text', () => {
    const points = parseStandardJson({
      estructura: [
        {
          numero: '2',
          tipo: 'capitulo',
          titulo: 'Sistema',
          children: [
            {
              numero: '2.2.3.1',
              tipo: 'punto',
              titulo: null,
              texto: 'Descripcion del producto Se documentara y mantendra una descripcion completa del producto.',
              children: [],
            },
          ],
        },
      ],
    });

    expect(points[0].title).toBe('2.2.3.1');
    expect(points[0].requirement).toBe('Descripcion del producto Se documentara y mantendra una descripcion completa del producto.');
  });
});
