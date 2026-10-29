// La máquina de estados de un reclamo (misma lógica que pozo/mobile/lib/maquinaEstados.ts).
// Cada función es pura: recibe el reclamo, devuelve el próximo estado o tira AppError. Quien
// persiste es services/reclamos.ts.
import { AppError } from './errores';
import { CATEGORIAS_PELIGROSAS, MOTIVOS_RECHAZO, VOTOS_YA_NO_ESTA_NECESARIOS } from './tipos';
import type { Categoria, EstadoReclamo, MotivoRechazo } from './tipos';

export type Decision = {
  status: EstadoReclamo;
  description: string;
  extra?: {
    fotoResolucion?: string;
    motivoRechazoTipo?: string;
    motivoRechazo?: string;
    areaAsignada?: string;
    fechaEstimada?: Date;
  };
};

export type ReclamoParaTransicion = {
  status: string;
  category: string;
};

export function esEstadoFinal(status: string): boolean {
  return status === 'Resuelto' || status === 'Rechazado';
}

// Confirmado por vecinos → Enviado al municipio, o directamente Reportado → Enviado si la
// categoría es peligrosa: ahí no se espera a que junte confirmaciones. Al tomar se asigna el
// área de la categoría (solo se usa para el plazo).
export function decidirTomar(reclamo: ReclamoParaTransicion, areaId: string | undefined): Decision {
  const esPeligrosoSinConfirmar =
    reclamo.status === 'Reportado' && CATEGORIAS_PELIGROSAS.includes(reclamo.category as Categoria);

  if (reclamo.status !== 'ConfirmadoPorVecinos' && !esPeligrosoSinConfirmar) {
    throw new AppError(
      'INVALID_TRANSITION',
      'Este reclamo todavía no se puede tomar: necesita confirmaciones de vecinos o ser una categoría peligrosa'
    );
  }

  if (!areaId) throw new AppError('AREA_REQUIRED', 'No hay un área del municipio para esta categoría');

  return {
    status: 'EnviadoAlMunicipio',
    description: esPeligrosoSinConfirmar ? 'Tomado por el municipio (categoría peligrosa)' : 'Tomado por el municipio',
    extra: { areaAsignada: areaId },
  };
}

const MS_POR_DIA = 1000 * 60 * 60 * 24;

// La fecha estimada no puede ser anterior a hoy: mismo criterio que "atrasado" (hoy mismo vale).
export function exigirFechaNoPasada(fechaEstimada: Date, ahora = new Date()): void {
  if (ahora.getTime() - fechaEstimada.getTime() >= MS_POR_DIA) {
    throw new AppError('INVALID_INPUT', 'La fecha estimada no puede ser anterior a hoy');
  }
}

// Pasar a reparación pide la fecha estimada en el mismo paso.
export function decidirPasarAReparacion(reclamo: ReclamoParaTransicion, fechaEstimada: Date, ahora = new Date()): Decision {
  if (reclamo.status !== 'EnviadoAlMunicipio') {
    throw new AppError('INVALID_TRANSITION', 'El reclamo tiene que estar enviado al municipio para pasar a reparación');
  }
  exigirFechaNoPasada(fechaEstimada, ahora);
  return { status: 'EnReparacion', description: 'En reparación', extra: { fechaEstimada } };
}

// La fecha estimada solo se define mientras se repara.
export function exigirEnReparacion(reclamo: ReclamoParaTransicion): void {
  if (reclamo.status !== 'EnReparacion') {
    throw new AppError('INVALID_TRANSITION', 'La fecha estimada solo se define en un reclamo en reparación');
  }
}

export function decidirResolver(reclamo: ReclamoParaTransicion, fotoResolucion: string): Decision {
  if (!fotoResolucion) {
    throw new AppError('FOTO_REQUIRED', 'La foto del "después" es obligatoria para resolver');
  }
  if (reclamo.status !== 'EnReparacion') {
    throw new AppError('INVALID_TRANSITION', 'El reclamo tiene que estar en reparación para resolverse');
  }
  return { status: 'Resuelto', description: 'Resuelto', extra: { fotoResolucion } };
}

// Al llegar a VOTOS_YA_NO_ESTA_NECESARIOS votos "ya no está", un reclamo abierto pasa solo a
// Resuelto (sin foto). Devuelve null si todavía no corresponde.
export function decidirResolverPorVecinos(reclamo: ReclamoParaTransicion, votosYaNoEsta: number): Decision | null {
  if (esEstadoFinal(reclamo.status) || votosYaNoEsta < VOTOS_YA_NO_ESTA_NECESARIOS) return null;
  return {
    status: 'Resuelto',
    description: 'Resuelto por los vecinos: el problema ya no está (se resolvió y el municipio todavía no lo actualizó)',
  };
}

// El motivo es uno de MOTIVOS_RECHAZO; el detalle es texto libre y opcional.
export function decidirRechazar(reclamo: ReclamoParaTransicion, motivo: string, detalle = ''): Decision {
  if (!MOTIVOS_RECHAZO.includes(motivo as MotivoRechazo)) {
    throw new AppError('MOTIVO_REQUIRED', 'Elegí un motivo de rechazo de la lista');
  }
  if (esEstadoFinal(reclamo.status)) {
    throw new AppError('INVALID_TRANSITION', 'Este reclamo ya está cerrado');
  }
  const texto = detalle.trim();
  return {
    status: 'Rechazado',
    description: `Rechazado: ${motivo}${texto ? `: ${texto}` : ''}`,
    extra: { motivoRechazoTipo: motivo, motivoRechazo: texto || undefined },
  };
}
