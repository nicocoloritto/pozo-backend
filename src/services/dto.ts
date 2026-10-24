// Convierte filas de Prisma a la misma forma JSON que usa la app (pozo/mobile/types/reclamo.ts y
// pozo/mobile/types/user.ts), para que reemplazar los services/ de la app no obligue a tocar
// las pantallas. Los campos vacíos se omiten en vez de viajar como null.
import type { Area, CambioEstado, Nota, Reclamo, Usuario, Voto } from '@prisma/client';

export type ReclamoConRelaciones = Reclamo & { historial: CambioEstado[]; votos: Voto[]; notas: Nota[] };

function opcional<T>(valor: T | null): T | undefined {
  return valor === null ? undefined : valor;
}

export function aReclamoDto(r: ReclamoConRelaciones) {
  return {
    id: r.id,
    caseNumber: r.caseNumber,
    autorId: r.autorId,
    municipioId: r.municipioId,
    category: r.category,
    severity: r.severity,
    status: r.status,
    notes: opcional(r.notes),
    photoUrl: r.photoUrl,
    photoKey: opcional(r.photoKey),
    latitude: r.latitude,
    longitude: r.longitude,
    accuracyMeters: opcional(r.accuracyMeters),
    locationSource: r.locationSource,
    address: opcional(r.address),
    neighborhood: opcional(r.neighborhood),
    comuna: opcional(r.comuna),
    confirmaciones: r.votos.filter((v) => v.tipo === 'sigue').map((v) => v.vecinoId),
    votosYaNoEsta: r.votos.filter((v) => v.tipo === 'yaNoEsta').map((v) => v.vecinoId),
    ultimoVoto:
      r.ultimoVotoTipo && r.ultimoVotoFecha
        ? { tipo: r.ultimoVotoTipo, fecha: r.ultimoVotoFecha.toISOString() }
        : undefined,
    createdAt: r.createdAt.toISOString(),
    history: [...r.historial]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
      .map((c) => ({
        status: c.status,
        description: c.description,
        createdAt: c.createdAt.toISOString(),
        autor: opcional(c.autorId),
      })),
    areaAsignada: opcional(r.areaAsignada),
    fechaEstimada: r.fechaEstimada?.toISOString(),
    notas: r.notas.length
      ? [...r.notas]
          .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.id - b.id)
          .map((n) => ({ fecha: n.fecha.toISOString(), texto: n.texto, autor: n.autorId }))
      : undefined,
    fotoResolucion: opcional(r.fotoResolucion),
    fotoResolucionKey: opcional(r.fotoResolucionKey),
    motivoRechazo: opcional(r.motivoRechazo),
  };
}

// Nunca incluye el hash de la contraseña ni el DNI normalizado.
export function aUsuarioDto(u: Usuario) {
  if (u.rol === 'admin') {
    return { id: u.id, rol: 'admin' as const, firstName: u.firstName, email: u.email, municipioId: u.municipioId ?? '' };
  }
  return {
    id: u.id,
    rol: 'vecino' as const,
    firstName: u.firstName,
    lastName: u.lastName ?? '',
    sex: u.sex ?? '',
    documentNumber: u.documentNumber ?? '',
    birthDate: u.birthDate ?? '',
    email: u.email,
    neighborhood: opcional(u.neighborhood),
  };
}

export function aAreaDto(a: Area) {
  return {
    id: a.id,
    nombre: a.nombre,
    categorias: JSON.parse(a.categorias) as string[],
    plazoMaximoDias: a.plazoMaximoDias,
  };
}
