import { describe, expect, it } from 'vitest';
import { calcularPrioridad, desglosarPrioridad, estaAtrasado } from '../src/domain/prioridad';

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date('2026-10-28T12:00:00Z');
const haceDias = (d: number) => new Date(AHORA.getTime() - d * DIA);

describe('estaAtrasado', () => {
  const enReparacion = { status: 'EnReparacion', fechaEstimada: haceDias(2) };

  it('está atrasado si la fecha estimada ya pasó y el reclamo sigue abierto', () => {
    expect(estaAtrasado(enReparacion, AHORA)).toBe(true);
    expect(estaAtrasado({ ...enReparacion, fechaEstimada: haceDias(-3) }, AHORA)).toBe(false);
  });

  it('el mismo día de la fecha estimada todavía no está atrasado', () => {
    expect(estaAtrasado({ ...enReparacion, fechaEstimada: haceDias(0) }, AHORA)).toBe(false);
  });

  it('sin fecha estimada o ya cerrado no está atrasado', () => {
    expect(estaAtrasado({ ...enReparacion, fechaEstimada: null }, AHORA)).toBe(false);
    expect(estaAtrasado({ ...enReparacion, status: 'Resuelto' }, AHORA)).toBe(false);
    expect(estaAtrasado({ ...enReparacion, status: 'Rechazado' }, AHORA)).toBe(false);
  });
});

describe('prioridad', () => {
  const base = { createdAt: AHORA, confirmaciones: 0, yaNoEsta: 0 };

  it('suma confirmaciones, "ya no está" y antigüedad, y explica cada parte', () => {
    const reclamo = { createdAt: haceDias(3), confirmaciones: 2, yaNoEsta: 1 };
    expect(desglosarPrioridad(reclamo, AHORA)).toEqual([
      { motivo: '2 confirmaciones', puntos: 20 },
      { motivo: '1 "ya no está"', puntos: -10 },
      { motivo: '3 días abierto', puntos: 6 },
    ]);
    expect(calcularPrioridad(reclamo, AHORA)).toBe(16);
  });

  it('omite lo que no suma y nunca queda negativa', () => {
    const reclamo = { ...base, yaNoEsta: 2 };
    expect(desglosarPrioridad(reclamo, AHORA)).toEqual([{ motivo: '2 "ya no está"', puntos: -20 }]);
    expect(calcularPrioridad(reclamo, AHORA)).toBe(0);
  });

  it('un reclamo sin votos recién creado vale 0 y un día se escribe en singular', () => {
    expect(calcularPrioridad(base, AHORA)).toBe(0);
    expect(desglosarPrioridad({ ...base, createdAt: haceDias(1), confirmaciones: 1 }, AHORA)).toEqual([
      { motivo: '1 confirmación', puntos: 10 },
      { motivo: '1 día abierto', puntos: 2 },
    ]);
  });
});
