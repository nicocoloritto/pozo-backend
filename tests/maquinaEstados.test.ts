import { describe, expect, it } from 'vitest';
import { AppError } from '../src/domain/errores';
import {
  decidirPasarAReparacion,
  decidirRechazar,
  decidirResolver,
  decidirResolverPorVecinos,
  decidirTomar,
  esEstadoFinal,
  exigirEnReparacion,
  exigirFechaNoPasada,
} from '../src/domain/maquinaEstados';

const base = { status: 'Reportado', category: 'Pothole' };
const DIA = 24 * 60 * 60 * 1000;

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
    expect(decidirTomar({ ...base, status: 'ConfirmadoPorVecinos' }, 'bacheo').status).toBe('EnviadoAlMunicipio');
  });

  it('al tomar asigna el área de la categoría, y falla si no hay una', () => {
    const confirmado = { ...base, status: 'ConfirmadoPorVecinos' };
    expect(decidirTomar(confirmado, 'bacheo').extra?.areaAsignada).toBe('bacheo');
    expect(codigoDe(() => decidirTomar(confirmado, undefined))).toBe('AREA_REQUIRED');
  });

  it('no toma un reclamo común sin confirmar', () => {
    expect(codigoDe(() => decidirTomar(base, 'bacheo'))).toBe('INVALID_TRANSITION');
  });

  it.each(['FallenPole', 'FallenTree', 'Outage', 'TrafficLight'])('toma %s sin esperar confirmaciones', (category) => {
    expect(decidirTomar({ ...base, category }, 'x').description).toContain('peligrosa');
  });

  it('pasa a reparación solo desde enviado al municipio, y con la fecha estimada', () => {
    const fecha = new Date(Date.now() + 3 * DIA);
    expect(codigoDe(() => decidirPasarAReparacion(base, fecha))).toBe('INVALID_TRANSITION');
    const decision = decidirPasarAReparacion({ ...base, status: 'EnviadoAlMunicipio' }, fecha);
    expect(decision.status).toBe('EnReparacion');
    expect(decision.extra?.fechaEstimada).toBe(fecha);
  });

  it('la fecha estimada no puede ser anterior a hoy', () => {
    const enviado = { ...base, status: 'EnviadoAlMunicipio' };
    expect(codigoDe(() => decidirPasarAReparacion(enviado, new Date(Date.now() - 2 * DIA)))).toBe('INVALID_INPUT');
    expect(codigoDe(() => exigirFechaNoPasada(new Date(Date.now() - 2 * DIA)))).toBe('INVALID_INPUT');
    expect(codigoDe(() => exigirFechaNoPasada(new Date()))).toBeUndefined();
    expect(codigoDe(() => exigirFechaNoPasada(new Date(Date.now() + DIA)))).toBeUndefined();
  });

  it('resuelve solo desde reparación y con foto', () => {
    const enReparacion = { ...base, status: 'EnReparacion' };
    expect(codigoDe(() => decidirResolver(enReparacion, ''))).toBe('FOTO_REQUIRED');
    expect(codigoDe(() => decidirResolver(base, 'foto.jpg'))).toBe('INVALID_TRANSITION');
    expect(decidirResolver(enReparacion, 'foto.jpg').extra?.fotoResolucion).toBe('foto.jpg');
  });

  it('rechaza con un motivo de la lista y no un reclamo ya cerrado', () => {
    expect(codigoDe(() => decidirRechazar(base, '  '))).toBe('MOTIVO_REQUIRED');
    expect(codigoDe(() => decidirRechazar(base, 'Ya no está'))).toBe('MOTIVO_REQUIRED');
    expect(codigoDe(() => decidirRechazar({ ...base, status: 'Resuelto' }, 'Duplicado'))).toBe('INVALID_TRANSITION');
  });

  it('guarda el motivo y el detalle por separado', () => {
    const conDetalle = decidirRechazar(base, 'No requiere arreglo', ' ya lo arreglaron ');
    expect(conDetalle.extra).toEqual({ motivoRechazoTipo: 'No requiere arreglo', motivoRechazo: 'ya lo arreglaron' });
    expect(conDetalle.description).toBe('Rechazado: No requiere arreglo: ya lo arreglaron');
    const soloMotivo = decidirRechazar(base, 'Duplicado');
    expect(soloMotivo.extra?.motivoRechazo).toBeUndefined();
    expect(soloMotivo.description).toBe('Rechazado: Duplicado');
  });

  it.each(['Reportado', 'ConfirmadoPorVecinos', 'EnviadoAlMunicipio', 'EnReparacion'])(
    'con 10 "ya no está" un reclamo %s pasa solo a Resuelto',
    (status) => {
      expect(decidirResolverPorVecinos({ ...base, status }, 9)).toBeNull();
      const decision = decidirResolverPorVecinos({ ...base, status }, 10);
      expect(decision?.status).toBe('Resuelto');
      expect(decision?.description).toContain('Resuelto por los vecinos');
      expect(decision?.extra).toBeUndefined();
    }
  );

  it('"ya no está" no cambia un reclamo ya cerrado', () => {
    expect(decidirResolverPorVecinos({ ...base, status: 'Rechazado' }, 10)).toBeNull();
  });

  it('la fecha estimada solo se define en reparación', () => {
    for (const status of ['Reportado', 'ConfirmadoPorVecinos', 'EnviadoAlMunicipio', 'Resuelto', 'Rechazado']) {
      expect(codigoDe(() => exigirEnReparacion({ ...base, status })), status).toBe('INVALID_TRANSITION');
    }
    expect(codigoDe(() => exigirEnReparacion({ ...base, status: 'EnReparacion' }))).toBeUndefined();
  });

  it('reconoce los estados finales', () => {
    expect(esEstadoFinal('Resuelto')).toBe(true);
    expect(esEstadoFinal('Rechazado')).toBe(true);
    expect(esEstadoFinal('EnReparacion')).toBe(false);
  });
});
