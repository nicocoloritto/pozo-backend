// Estadísticas de barrios y municipios, calculadas en cada pedido a partir de los reclamos
// (misma forma que pozo/mobile/types/estadisticas.ts). Un reclamo es de un barrio si coincide
// su municipio y su `neighborhood` con el nombre del barrio.
import type { Usuario } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../domain/errores';
import { CATEGORIAS, ESTADOS } from '../domain/tipos';
import type { Categoria, EstadoReclamo } from '../domain/tipos';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MS_POR_DIA = 1000 * 60 * 60 * 24;
// Los meses se cuentan en hora de Argentina (UTC-3) para que un reclamo de la noche del 31
// no caiga en el mes siguiente.
const OFFSET_ARGENTINA_MS = -3 * 60 * 60 * 1000;

function reclamosDe(municipioId: string, barrio?: string) {
  return prisma.reclamo.findMany({
    where: { municipioId, ...(barrio ? { neighborhood: barrio } : {}) },
    select: {
      status: true,
      category: true,
      neighborhood: true,
      createdAt: true,
      historial: { where: { status: 'Resuelto' }, select: { createdAt: true } },
    },
  });
}
type ReclamoParaStats = Awaited<ReturnType<typeof reclamosDe>>[number];

// Un admin solo consulta su propio municipio; un vecino, cualquiera.
async function exigirAcceso(usuario: Usuario, municipioId: string) {
  if (usuario.rol === 'admin' && usuario.municipioId !== municipioId) {
    throw new AppError('FORBIDDEN', 'Este municipio no es el tuyo');
  }
  if (!(await prisma.municipio.findUnique({ where: { id: municipioId }, select: { id: true } }))) {
    throw new AppError('NOT_FOUND', 'Este municipio no existe');
  }
}

const redondear = (valor: number) => Math.round(valor * 10) / 10;
const porcentaje = (parte: number, total: number) => (total ? redondear((parte / total) * 100) : 0);

function numeroDeMes(fecha: Date): number {
  const local = new Date(fecha.getTime() + OFFSET_ARGENTINA_MS);
  return local.getUTCFullYear() * 12 + local.getUTCMonth();
}

// Siempre 6 meses, del más viejo al actual, con 0 donde no hubo reclamos.
function evolucionUltimos6Meses(reclamos: { createdAt: Date }[]) {
  const primero = numeroDeMes(new Date()) - 5;
  const cantidades = [0, 0, 0, 0, 0, 0];
  for (const { createdAt } of reclamos) {
    const posicion = numeroDeMes(createdAt) - primero;
    if (posicion >= 0 && posicion < 6) cantidades[posicion]!++;
  }
  return cantidades.map((reclamos, i) => ({ mes: MESES[(primero + i) % 12]!, reclamos }));
}

export async function barrios(usuario: Usuario, municipioId: string) {
  await exigirAcceso(usuario, municipioId);
  return prisma.barrio.findMany({ where: { municipioId }, orderBy: [{ comuna: 'asc' }, { nombre: 'asc' }] });
}

export async function estadisticasBarrio(usuario: Usuario, barrioId: string) {
  const barrio = await prisma.barrio.findUnique({ where: { id: barrioId } });
  if (!barrio) throw new AppError('NOT_FOUND', 'Este barrio no existe');
  await exigirAcceso(usuario, barrio.municipioId);

  const reclamos = await reclamosDe(barrio.municipioId, barrio.nombre);
  const porCategoria = Object.fromEntries(CATEGORIAS.map((c) => [c, 0])) as Record<Categoria, number>;
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoReclamo, number>;
  let diasDeResolucion = 0;
  let conFechaDeResolucion = 0;
  for (const r of reclamos) {
    porCategoria[r.category as Categoria]++;
    porEstado[r.status as EstadoReclamo]++;
    const resuelto = r.historial[0];
    if (resuelto) {
      diasDeResolucion += (resuelto.createdAt.getTime() - r.createdAt.getTime()) / MS_POR_DIA;
      conFechaDeResolucion++;
    }
  }

  return {
    barrioId: barrio.id,
    totalReclamos: reclamos.length,
    resueltos: porEstado.Resuelto,
    porcentajeResolucion: porcentaje(porEstado.Resuelto, reclamos.length),
    tiempoPromedioResolucionDias: conFechaDeResolucion ? redondear(diasDeResolucion / conFechaDeResolucion) : 0,
    porCategoria,
    porEstado,
    evolucionUltimos6Meses: evolucionUltimos6Meses(reclamos),
  };
}

// A igual porcentaje, los barrios con reclamos van antes que los que no tienen ninguno.
export async function ranking(usuario: Usuario, municipioId: string) {
  await exigirAcceso(usuario, municipioId);
  const [lista, reclamos] = await Promise.all([
    prisma.barrio.findMany({ where: { municipioId } }),
    reclamosDe(municipioId),
  ]);

  const porBarrio = new Map<string, ReclamoParaStats[]>();
  for (const r of reclamos) {
    if (r.neighborhood) porBarrio.set(r.neighborhood, [...(porBarrio.get(r.neighborhood) ?? []), r]);
  }

  return lista
    .map((barrio) => {
      const propios = porBarrio.get(barrio.nombre) ?? [];
      const resueltos = propios.filter((r) => r.status === 'Resuelto').length;
      return {
        barrioId: barrio.id,
        nombre: barrio.nombre,
        porcentajeResolucion: porcentaje(resueltos, propios.length),
        conReclamos: propios.length > 0,
      };
    })
    .sort(
      (a, b) =>
        b.porcentajeResolucion - a.porcentajeResolucion ||
        Number(b.conReclamos) - Number(a.conReclamos) ||
        a.nombre.localeCompare(b.nombre, 'es')
    )
    .map(({ barrioId, nombre, porcentajeResolucion }, i) => ({ barrioId, nombre, porcentajeResolucion, puesto: i + 1 }));
}

// Cuenta todos los reclamos del municipio, también los que no tienen barrio o no está en el catálogo.
export async function evolucion(usuario: Usuario, municipioId: string) {
  await exigirAcceso(usuario, municipioId);
  return evolucionUltimos6Meses(await reclamosDe(municipioId));
}
