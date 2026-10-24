// La máquina de estados de un reclamo (misma lógica que pozo/mobile/lib/maquinaEstados.ts).
// Cada función es pura: recibe el reclamo, devuelve el próximo estado o tira AppError. Quien
// persiste es services/reclamos.ts.
import { AppError } from './errores';
import { CATEGORIAS_PELIGROSAS } from './tipos';
import type { Categoria, EstadoReclamo } from './tipos';

export type Decision = {
  status: EstadoReclamo;
  description: string;
  extra?: { fotoResolucion?: string; motivoRechazo?: string };
};

export type ReclamoParaTransicion = {
  status: string;
  category: string;
  areaAsignada: string | null;
};

export function esEstadoFinal(status: string): boolean {
  return status === 'Resuelto' || status === 'Rechazado';
}

// Confirmado por vecinos → Enviado al municipio, o directamente Reportado → Enviado si la
// categoría es peligrosa: ahí no se espera a que junte confirmaciones.
export function decidirTomar(reclamo: ReclamoParaTransicion): Decision {
  const esPeligrosoSinConfirmar =
    reclamo.status === 'Reportado' && CATEGORIAS_PELIGROSAS.includes(reclamo.category as Categoria);

  if (reclamo.status !== 'ConfirmadoPorVecinos' && !esPeligrosoSinConfirmar) {
    throw new AppError(
      'INVALID_TRANSITION',
      'Este reclamo todavía no se puede tomar: necesita confirmaciones de vecinos o ser una categoría peligrosa'
    );
  }

  return {
    status: 'EnviadoAlMunicipio',
    description: esPeligrosoSinConfirmar ? 'Tomado por el municipio (categoría peligrosa)' : 'Tomado por el municipio',
  };
}

export function decidirPasarAReparacion(reclamo: ReclamoParaTransicion): Decision {
  if (reclamo.status !== 'EnviadoAlMunicipio') {
    throw new AppError('INVALID_TRANSITION', 'El reclamo tiene que estar enviado al municipio para pasar a reparación');
  }
  if (!reclamo.areaAsignada) {
    throw new AppError('AREA_REQUIRED', 'Asigná un área antes de pasar a reparación');
  }
  return { status: 'EnReparacion', description: 'En reparación' };
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

export function decidirRechazar(reclamo: ReclamoParaTransicion, motivo: string): Decision {
  if (!motivo.trim()) {
    throw new AppError('MOTIVO_REQUIRED', 'El motivo de rechazo es obligatorio');
  }
  if (esEstadoFinal(reclamo.status)) {
    throw new AppError('INVALID_TRANSITION', 'Este reclamo ya está cerrado');
  }
  return {
    status: 'Rechazado',
    description: `Rechazado: ${motivo.trim()}`,
    extra: { motivoRechazo: motivo.trim() },
  };
}
