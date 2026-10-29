// Prioridad de la bandeja del municipio y atraso de la fecha estimada. Funciones puras: el
// porqué de cada regla está en pozo/docs/decisiones.md. `ahora` es un parámetro para que sean
// testeables de forma determinística.
import { esEstadoFinal } from './maquinaEstados';

const MS_POR_DIA = 1000 * 60 * 60 * 24;

// Los pesos de la fórmula, en un solo lugar: si cambian, cambia pozo/docs/decisiones.md.
// La severidad que eligió el vecino no suma: ordena aparte (semáforo de la app) y acá solo
// se desempata dentro de cada nivel, por votos y antigüedad. La categoría tampoco suma.
export const PUNTOS_PRIORIDAD = {
  porConfirmacion: 10,
  porYaNoEsta: -10,
  porDia: 2,
};

function diasDesde(fecha: Date, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / MS_POR_DIA));
}

function plural(n: number, singular: string, varios: string): string {
  return `${n} ${n === 1 ? singular : varios}`;
}

export type CamposPrioridad = {
  createdAt: Date;
  confirmaciones: number;
  yaNoEsta: number;
};

export type ParteDePrioridad = { motivo: string; puntos: number };

// Cada término de la fórmula con su motivo; la suma es la prioridad. Se omiten los que valen 0.
// La antigüedad se cuenta desde que se creó: mide cuánto lleva esperando el vecino, no cuánto
// lleva el municipio con él.
export function desglosarPrioridad(reclamo: CamposPrioridad, ahora: Date): ParteDePrioridad[] {
  const dias = diasDesde(reclamo.createdAt, ahora);

  const partes: ParteDePrioridad[] = [
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

export type CamposAtrasado = { status: string; fechaEstimada: Date | null };

// Atrasado: tiene fecha estimada, ya pasó (un día completo después de esa fecha) y el reclamo
// no está cerrado. La fecha solo se define en reparación, así que en la práctica es EnReparacion.
export function estaAtrasado(reclamo: CamposAtrasado, ahora: Date): boolean {
  if (esEstadoFinal(reclamo.status) || !reclamo.fechaEstimada) return false;
  return diasDesde(reclamo.fechaEstimada, ahora) > 0;
}
