import { describe, expect, it } from 'vitest';
import { AppError } from '../src/domain/errores';
import {
  decidirPasarAReparacion,
  decidirRechazar,
  decidirResolver,
  decidirTomar,
  esEstadoFinal,
} from '../src/domain/maquinaEstados';

const base = { status: 'Reportado', category: 'Pothole', areaAsignada: null };

function codigoDe(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.code : 'otro error';
  }
  return undefined;
}

describe('máquina de estados', () => {
  it('toma un reclamo confirmado por vecinos', () => {
    expect(decidirTomar({ ...base, status: 'ConfirmadoPorVecinos' }).status).toBe('EnviadoAlMunicipio');
  });

  it('no toma un reclamo común sin confirmar', () => {
    expect(codigoDe(() => decidirTomar(base))).toBe('INVALID_TRANSITION');
  });

  it.each(['FallenPole', 'FallenTree', 'Outage', 'TrafficLight'])('toma %s sin esperar confirmaciones', (category) => {
    expect(decidirTomar({ ...base, category }).description).toContain('peligrosa');
  });

  it('pasa a reparación solo con área asignada', () => {
    const enviado = { ...base, status: 'EnviadoAlMunicipio' };
    expect(codigoDe(() => decidirPasarAReparacion(enviado))).toBe('AREA_REQUIRED');
    expect(decidirPasarAReparacion({ ...enviado, areaAsignada: 'alumbrado' }).status).toBe('EnReparacion');
  });

  it('resuelve solo desde reparación y con foto', () => {
    const enReparacion = { ...base, status: 'EnReparacion' };
    expect(codigoDe(() => decidirResolver(enReparacion, ''))).toBe('FOTO_REQUIRED');
    expect(codigoDe(() => decidirResolver(base, 'foto.jpg'))).toBe('INVALID_TRANSITION');
    expect(decidirResolver(enReparacion, 'foto.jpg').extra?.fotoResolucion).toBe('foto.jpg');
  });

  it('rechaza con motivo y no un reclamo ya cerrado', () => {
    expect(codigoDe(() => decidirRechazar(base, '  '))).toBe('MOTIVO_REQUIRED');
    expect(codigoDe(() => decidirRechazar({ ...base, status: 'Resuelto' }, 'x'))).toBe('INVALID_TRANSITION');
    expect(decidirRechazar(base, ' duplicado ').extra?.motivoRechazo).toBe('duplicado');
  });

  it('reconoce los estados finales', () => {
    expect(esEstadoFinal('Resuelto')).toBe(true);
    expect(esEstadoFinal('Rechazado')).toBe(true);
    expect(esEstadoFinal('EnReparacion')).toBe(false);
  });
});
