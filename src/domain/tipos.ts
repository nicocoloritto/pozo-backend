// Reglas de negocio de Pozo. Mismas definiciones que pozo/mobile/types/reclamo.ts: el circuito
// de estados está explicado en pozo/docs/diseno-funcional.md. Si cambian acá, cambian allá.

export const ESTADOS = [
  'Reportado',
  'ConfirmadoPorVecinos',
  'EnviadoAlMunicipio',
  'EnReparacion',
  'Resuelto',
  'Rechazado',
] as const;
export type EstadoReclamo = (typeof ESTADOS)[number];

export const CATEGORIAS = [
  'Pothole',
  'BrokenSidewalk',
  'TrafficLight',
  'StreetLight',
  'FallenPole',
  'FallenTree',
  'Trench',
  'Outage',
  'OverflowingBin',
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const SEVERIDADES = ['Low', 'Medium', 'High'] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const ORIGENES_UBICACION = ['Device', 'Exif', 'Manual'] as const;
export type OrigenUbicacion = (typeof ORIGENES_UBICACION)[number];

export type TipoVoto = 'sigue' | 'yaNoEsta';

// Un poste o árbol caído, un corte de luz/agua o un semáforo roto son riesgos
// inmediatos: el municipio los puede tomar sin esperar confirmaciones de vecinos.
export const CATEGORIAS_PELIGROSAS: readonly Categoria[] = ['FallenPole', 'FallenTree', 'Outage', 'TrafficLight'];

// A cuántas confirmaciones de otros vecinos pasa de Reportado a ConfirmadoPorVecinos.
export const CONFIRMACIONES_NECESARIAS = 1;

// A cuántos "ya no está" el reclamo pasa solo a Resuelto, desde cualquier estado abierto.
export const VOTOS_YA_NO_ESTA_NECESARIOS = 10;

// Motivos de rechazo permitidos. "Ya no está" no es un rechazo: lo resuelven los vecinos.
export const MOTIVOS_RECHAZO = ['No corresponde al municipio', 'No requiere arreglo', 'Duplicado'] as const;
export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[number];

// Un reclamo Resuelto o Rechazado deja de devolverse para el mapa pasados estos días desde su cierre.
export const DIAS_CERRADO_EN_MAPA = 7;

export const NOTAS_MAX_CARACTERES = 280;
