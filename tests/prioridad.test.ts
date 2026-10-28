import { describe, expect, it } from 'vitest';
import { calcularPrioridad, desglosarPrioridad, estaVencido } from '../src/domain/prioridad';

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date('2026-10-28T12:00:00Z');
const haceDias = (d: number) => new Date(AHORA.getTime() - d * DIA);

type ReclamoParaVencido = Parameters<typeof estaVencido>[0];

function gestionado(cambios: Partial<ReclamoParaVencido>): ReclamoParaVencido {
  return { status: 'EnviadoAlMunicipio', createdAt: haceDias(0), historial: [], plazoAreaDias: null, ...cambios };
}

describe('estaVencido', () => {
  it('cuenta el plazo desde que el municipio lo tomó, no desde que se creó', () => {
    const reclamo = gestionado({
      plazoAreaDias: 15,
      createdAt: haceDias(20),
      historial: [
        { status: 'Reportado', createdAt: haceDias(20) },
        { status: 'ConfirmadoPorVecinos', createdAt: haceDias(5) },
        { status: 'EnviadoAlMunicipio', createdAt: haceDias(2) },
      ],
    });
    expect(estaVencido(reclamo, 7, AHORA)).toBe(false);
  });

  it('vence cuando pasan más días que el plazo del área desde la toma', () => {
    const reclamo = gestionado({
      status: 'EnReparacion',
      plazoAreaDias: 15,
      createdAt: haceDias(30),
      historial: [
        { status: 'EnviadoAlMunicipio', createdAt: haceDias(16) },
        { status: 'EnReparacion', createdAt: haceDias(3) },
      ],
    });
    expect(estaVencido(reclamo, 7, AHORA)).toBe(true);
  });

  it('sin área usa el plazo más corto; sin la toma en el historial usa la creación', () => {
    expect(estaVencido(gestionado({ createdAt: haceDias(8) }), 7, AHORA)).toBe(true);
    expect(estaVencido(gestionado({ createdAt: haceDias(6) }), 7, AHORA)).toBe(false);
  });

  it('no corre plazo antes de la toma, después de cerrado ni si no hay áreas', () => {
    expect(estaVencido(gestionado({ status: 'ConfirmadoPorVecinos', createdAt: haceDias(90) }), 7, AHORA)).toBe(false);
    expect(estaVencido(gestionado({ status: 'Resuelto', createdAt: haceDias(90) }), 7, AHORA)).toBe(false);
    expect(estaVencido(gestionado({ createdAt: haceDias(90) }), null, AHORA)).toBe(false);
  });
});

describe('prioridad', () => {
  const base = { category: 'Pothole', severity: 'Low', createdAt: AHORA, confirmaciones: 0, yaNoEsta: 0 };

  it('suma peligro, severidad, confirmaciones y antigüedad, y explica cada parte', () => {
    const reclamo = { category: 'FallenTree', severity: 'High', createdAt: haceDias(3), confirmaciones: 2, yaNoEsta: 1 };
    expect(desglosarPrioridad(reclamo, AHORA)).toEqual([
      { motivo: 'Categoría peligrosa', puntos: 50 },
      { motivo: 'Severidad alta', puntos: 20 },
      { motivo: '2 confirmaciones', puntos: 20 },
      { motivo: '1 "ya no está"', puntos: -10 },
      { motivo: '3 días abierto', puntos: 6 },
    ]);
    expect(calcularPrioridad(reclamo, AHORA)).toBe(86);
  });

  it('omite lo que no suma y nunca queda negativa', () => {
    const reclamo = { ...base, yaNoEsta: 2 };
    expect(desglosarPrioridad(reclamo, AHORA)).toEqual([{ motivo: '2 "ya no está"', puntos: -20 }]);
    expect(calcularPrioridad(reclamo, AHORA)).toBe(0);
  });

  it('la severidad media suma 10 y un día se escribe en singular', () => {
    expect(desglosarPrioridad({ ...base, severity: 'Medium', createdAt: haceDias(1), confirmaciones: 1 }, AHORA)).toEqual([
      { motivo: 'Severidad media', puntos: 10 },
      { motivo: '1 confirmación', puntos: 10 },
      { motivo: '1 día abierto', puntos: 2 },
    ]);
  });
});
