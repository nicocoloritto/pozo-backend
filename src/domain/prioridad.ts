// Prioridad de la bandeja del municipio y vencimiento del plazo del área. Funciones puras: el
// porqué de cada regla está en pozo/docs/decisiones.md. `ahora` es un parámetro para que sean
// testeables de forma determinística.
import { CATEGORIAS_PELIGROSAS } from './tipos';
import type { Categoria, Severidad } from './tipos';

const MS_POR_DIA = 1000 * 60 * 60 * 24;

// Los pesos de la fórmula, en un solo lugar: si cambian, cambia pozo/docs/decisiones.md.
// La severidad pesa poco a propósito: la elige el autor y nadie la verifica, así que
// "Alta" vale lo mismo que dos confirmaciones de otros vecinos.
export const PUNTOS_PRIORIDAD = {
  peligro: 50,
  severidad: { Low: 0, Medium: 10, High: 20 } satisfies Record<Severidad, number>,
  porConfirmacion: 10,
  porYaNoEsta: -10,
  porDia: 2,
};

const ETIQUETA_SEVERIDAD: Record<Severidad, string> = { Low: 'baja', Medium: 'media', High: 'alta' };

function diasDesde(fecha: Date, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / MS_POR_DIA));
}

function plural(n: number, singular: string, varios: string): string {
  return `${n} ${n === 1 ? singular : varios}`;
}

export type CamposPrioridad = {
  category: string;
  severity: string;
  createdAt: Date;
  confirmaciones: number;
  yaNoEsta: number;
};

export type ParteDePrioridad = { motivo: string; puntos: number };

// Cada término de la fórmula con su motivo, para que el municipio vea por qué un reclamo está
// arriba en la bandeja. Se omiten los que valen 0. La antigüedad se cuenta desde que se creó:
// mide cuánto lleva esperando el vecino, no cuánto lleva el municipio con él.
export function desglosarPrioridad(reclamo: CamposPrioridad, ahora: Date): ParteDePrioridad[] {
  const severidad = reclamo.severity as Severidad;
  const dias = diasDesde(reclamo.createdAt, ahora);

  const partes: ParteDePrioridad[] = [
    {
      motivo: 'Categoría peligrosa',
      puntos: CATEGORIAS_PELIGROSAS.includes(reclamo.category as Categoria) ? PUNTOS_PRIORIDAD.peligro : 0,
    },
    { motivo: `Severidad ${ETIQUETA_SEVERIDAD[severidad]}`, puntos: PUNTOS_PRIORIDAD.severidad[severidad] },
    {
      motivo: plural(reclamo.confirmaciones, 'confirmación', 'confirmaciones'),
      puntos: reclamo.confirmaciones * PUNTOS_PRIORIDAD.porConfirmacion,
    },
    { motivo: `${reclamo.yaNoEsta} "ya no está"`, puntos: reclamo.yaNoEsta * PUNTOS_PRIORIDAD.porYaNoEsta },
    { motivo: plural(dias, 'día abierto', 'días abierto'), puntos: dias * PUNTOS_PRIORIDAD.porDia },
  ];
  return partes.filter((parte) => parte.puntos !== 0);
}

// La suma del desglose, que nunca queda negativa: muchos "ya no está" bajan un reclamo al
// fondo de la bandeja, pero no por debajo de uno recién ingresado.
export function calcularPrioridad(reclamo: CamposPrioridad, ahora: Date): number {
  return Math.max(0, desglosarPrioridad(reclamo, ahora).reduce((total, parte) => total + parte.puntos, 0));
}

export type CamposVencido = {
  status: string;
  createdAt: Date;
  historial: { status: string; createdAt: Date }[];
  plazoAreaDias: number | null;
};

// El plazo es del área, así que solo corre una vez que el municipio tomó el reclamo
// (EnviadoAlMunicipio/EnReparacion), y se cuenta desde el primer "Enviado al municipio" del
// historial (o desde la creación si un reclamo viejo no lo tiene): el tiempo que esperó
// confirmaciones de vecinos no es responsabilidad del área. Sin área asignada se usa
// `plazoSinAreaDias`, el más corto de todas, para no dejarlo sin clasificar indefinidamente;
// es null si no hay áreas cargadas.
export function estaVencido(reclamo: CamposVencido, plazoSinAreaDias: number | null, ahora: Date): boolean {
  if (reclamo.status !== 'EnviadoAlMunicipio' && reclamo.status !== 'EnReparacion') return false;
  const plazo = reclamo.plazoAreaDias ?? plazoSinAreaDias;
  if (plazo === null) return false;

  const toma = reclamo.historial
    .filter((cambio) => cambio.status === 'EnviadoAlMunicipio')
    .reduce<Date | null>((primera, cambio) => (!primera || cambio.createdAt < primera ? cambio.createdAt : primera), null);
  return diasDesde(toma ?? reclamo.createdAt, ahora) > plazo;
}
