// Casos de uso de los reclamos. Mismas reglas que pozo/mobile/services/reclamos.ts, ahora sobre la
// base de datos. Las reglas de transición viven en domain/maquinaEstados.ts (puras); acá
// solo se lee, se decide y se persiste. Cada operación corre en una transacción para que dos
// pedidos simultáneos (dos vecinos confirmando a la vez) no pisen el conteo.
import { Prisma } from '@prisma/client';
import type { Usuario } from '@prisma/client';
import { prisma } from '../db';
import { distanciaEnMetros, RADIO_RECLAMO_CERCANO_METROS, rectanguloAlrededor } from '../domain/distancia';
import { AppError } from '../domain/errores';
import {
  decidirPasarAReparacion,
  decidirRechazar,
  decidirResolver,
  decidirResolverPorVecinos,
  decidirTomar,
  esEstadoFinal,
  exigirEnReparacion,
  exigirFechaNoPasada,
} from '../domain/maquinaEstados';
import type { Decision } from '../domain/maquinaEstados';
import { CONFIRMACIONES_NECESARIAS, DIAS_CERRADO_EN_MAPA } from '../domain/tipos';
import type { Categoria, OrigenUbicacion, Severidad, TipoVoto } from '../domain/tipos';
import { aReclamoDto } from './dto';
import type { ContextoReclamoDto } from './dto';

const INCLUIR = { historial: true, votos: true, notas: true } as const;

type Tx = Prisma.TransactionClient;

export type NuevoReclamo = {
  municipioId: string;
  category: Categoria;
  severity: Severidad;
  notes?: string;
  photoUrl: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  locationSource: OrigenUbicacion;
  address?: string;
  neighborhood?: string;
  comuna?: number;
  // El vecino vio el aviso de reclamo cercano y dice que es otro problema.
  publicarIgual?: boolean;
};

export function contextoReclamoDto(): ContextoReclamoDto {
  return { ahora: new Date() };
}

async function buscar(tx: Tx, id: string) {
  const reclamo = await tx.reclamo.findUnique({ where: { id }, include: INCLUIR });
  if (!reclamo) throw new AppError('NOT_FOUND', 'Este reclamo no existe o fue eliminado');
  return reclamo;
}

// Un admin solo gestiona los reclamos de su propio municipio.
function exigirMismoMunicipio(admin: Usuario, municipioId: string) {
  if (admin.municipioId !== municipioId) {
    throw new AppError('FORBIDDEN', 'Este reclamo es de otro municipio');
  }
}

// El número de expediente también es el id del reclamo, así que no puede repetirse.
async function generarCaseNumber(tx: Tx): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2);
  for (;;) {
    const caseNumber = `EXP-${year}-${Math.floor(10000 + Math.random() * 90000)}`;
    if (!(await tx.reclamo.findUnique({ where: { id: caseNumber }, select: { id: true } }))) return caseNumber;
  }
}

// --- Consultas ------------------------------------------------------------------------

// Del más nuevo al más viejo. Un admin ve solo los de su municipio; un vecino, todos los
// del mapa (o solo los suyos con `soloMios`). Con `paraMapa` se omiten los cerrados hace más
// de DIAS_CERRADO_EN_MAPA días (el cierre es la entrada del historial con ese estado).
export async function listar(usuario: Usuario, soloMios: boolean, paraMapa = false) {
  const cierres = { in: ['Resuelto', 'Rechazado'] };
  const corte = new Date(Date.now() - DIAS_CERRADO_EN_MAPA * 24 * 60 * 60 * 1000);
  return prisma.reclamo.findMany({
    where: {
      ...(usuario.rol === 'admin' ? { municipioId: usuario.municipioId ?? '' } : {}),
      ...(soloMios ? { autorId: usuario.id } : {}),
      ...(paraMapa
        ? { NOT: { status: cierres, historial: { none: { status: cierres, createdAt: { gte: corte } } } } }
        : {}),
    },
    include: INCLUIR,
    orderBy: { createdAt: 'desc' },
  });
}

export async function obtener(usuario: Usuario, id: string) {
  const reclamo = await buscar(prisma, id);
  if (usuario.rol === 'admin') exigirMismoMunicipio(usuario, reclamo.municipioId);
  return reclamo;
}

// --- Vecinos --------------------------------------------------------------------------

// Reclamo abierto de la misma categoría a menos de RADIO_RECLAMO_CERCANO_METROS, el más
// cercano. Incluye los del propio autor: también es un duplicado si lo carga dos veces.
async function buscarCercano(tx: Tx, input: NuevoReclamo) {
  const candidatos = await tx.reclamo.findMany({
    where: {
      category: input.category,
      status: { notIn: ['Resuelto', 'Rechazado'] },
      ...rectanguloAlrededor(input, RADIO_RECLAMO_CERCANO_METROS),
    },
    include: INCLUIR,
  });
  return candidatos
    .map((reclamo) => ({ reclamo, distanciaMetros: distanciaEnMetros(input, reclamo) }))
    .filter((c) => c.distanciaMetros < RADIO_RECLAMO_CERCANO_METROS)
    .sort((a, b) => a.distanciaMetros - b.distanciaMetros)[0];
}

export async function publicar(autor: Usuario, input: NuevoReclamo) {
  const municipio = await prisma.municipio.findUnique({ where: { id: input.municipioId } });
  if (!municipio) throw new AppError('INVALID_INPUT', 'El municipio del reclamo no existe.');

  // El chequeo de duplicados corre dentro de la misma transacción que el alta: así, si dos
  // vecinos publican a la vez en el mismo lugar, el segundo ya ve el reclamo del primero.
  return prisma.$transaction(async (tx) => {
    if (!input.publicarIgual) {
      const cercano = await buscarCercano(tx, input);
      if (cercano) {
        throw new AppError('RECLAMO_CERCANO', 'Ya hay un reclamo parecido a menos de 50 m.', {
          reclamo: aReclamoDto(cercano.reclamo, contextoReclamoDto()),
          distanciaMetros: Math.round(cercano.distanciaMetros),
        });
      }
    }
    const caseNumber = await generarCaseNumber(tx);
    const ahora = new Date();
    return tx.reclamo.create({
      data: {
        id: caseNumber,
        caseNumber,
        autorId: autor.id,
        municipioId: input.municipioId,
        category: input.category,
        severity: input.severity,
        status: 'Reportado',
        notes: input.notes?.trim() || null,
        photoUrl: input.photoUrl,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters ?? null,
        locationSource: input.locationSource,
        address: input.address ?? null,
        neighborhood: input.neighborhood ?? null,
        comuna: input.comuna ?? null,
        createdAt: ahora,
        historial: { create: { status: 'Reportado', description: 'Ingresado', autorId: autor.id, createdAt: ahora } },
      },
      include: INCLUIR,
    });
  });
}

// Deja el voto "sigue" del vecino (reemplazando un "yaNoEsta" previo) y, al llegar a
// CONFIRMACIONES_NECESARIAS, y solo si el reclamo sigue "Reportado", lo pasa a
// "ConfirmadoPorVecinos". Los estados siguientes los cambia el municipio.
async function registrarSigue(tx: Tx, reclamoId: string, vecinoId: string, ahora: Date) {
  await tx.voto.upsert({
    where: { reclamoId_vecinoId: { reclamoId, vecinoId } },
    create: { reclamoId, vecinoId, tipo: 'sigue' },
    update: { tipo: 'sigue' },
  });
  const confirmaciones = await tx.voto.count({ where: { reclamoId, tipo: 'sigue' } });
  const reclamo = await tx.reclamo.findUniqueOrThrow({ where: { id: reclamoId }, select: { status: true } });
  const confirma = reclamo.status === 'Reportado' && confirmaciones >= CONFIRMACIONES_NECESARIAS;

  await tx.reclamo.update({
    where: { id: reclamoId },
    data: {
      ultimoVotoTipo: 'sigue',
      ultimoVotoFecha: ahora,
      ...(confirma
        ? {
            status: 'ConfirmadoPorVecinos',
            historial: {
              create: {
                status: 'ConfirmadoPorVecinos',
                description: 'Confirmado por vecinos',
                createdAt: ahora,
              },
            },
          }
        : {}),
    },
  });
}

function exigirAbierto(status: string) {
  if (esEstadoFinal(status)) throw new AppError('INVALID_TRANSITION', 'Este reclamo ya está cerrado: no se puede votar');
}

// Un vecino confirma un reclamo ajeno una sola vez.
export async function confirmar(vecino: Usuario, id: string) {
  return prisma.$transaction(async (tx) => {
    const reclamo = await buscar(tx, id);
    if (reclamo.autorId === vecino.id) throw new AppError('OWN_RECLAMO', 'No podés confirmar tu propio reclamo');
    exigirAbierto(reclamo.status);
    if (reclamo.votos.some((v) => v.vecinoId === vecino.id && v.tipo === 'sigue')) {
      throw new AppError('ALREADY_CONFIRMED', 'Ya confirmaste este reclamo');
    }
    await registrarSigue(tx, id, vecino.id, new Date());
    return buscar(tx, id);
  });
}

// Voto "¿Sigue ahí?" estilo Waze. Un voto por vecino: "sigue" o "yaNoEsta", nunca los dos;
// votar lo otro cambia el voto y tocar el mismo otra vez lo saca. El autor no puede votar
// "sigue" (sí "yaNoEsta"). Al llegar a VOTOS_YA_NO_ESTA_NECESARIOS "yaNoEsta" el reclamo pasa
// solo a Resuelto. Sacar un voto no vuelve el estado atrás.
export async function votar(vecino: Usuario, id: string, tipo: TipoVoto) {
  return prisma.$transaction(async (tx) => {
    const reclamo = await buscar(tx, id);
    exigirAbierto(reclamo.status);
    if (tipo === 'sigue' && reclamo.autorId === vecino.id) {
      throw new AppError('OWN_RECLAMO', 'No podés confirmar tu propio reclamo');
    }

    const previo = reclamo.votos.find((v) => v.vecinoId === vecino.id);
    const clave = { reclamoId_vecinoId: { reclamoId: id, vecinoId: vecino.id } };

    if (previo?.tipo === tipo) {
      await tx.voto.delete({ where: clave });
    } else if (tipo === 'sigue') {
      await registrarSigue(tx, id, vecino.id, new Date());
    } else {
      await tx.voto.upsert({
        where: clave,
        create: { reclamoId: id, vecinoId: vecino.id, tipo },
        update: { tipo },
      });
      const ahora = new Date();
      const yaNoEsta = await tx.voto.count({ where: { reclamoId: id, tipo: 'yaNoEsta' } });
      const resuelto = decidirResolverPorVecinos(reclamo, yaNoEsta);
      await tx.reclamo.update({
        where: { id },
        data: {
          ultimoVotoTipo: 'yaNoEsta',
          ultimoVotoFecha: ahora,
          ...(resuelto
            ? { status: resuelto.status, historial: { create: { status: resuelto.status, description: resuelto.description, createdAt: ahora } } }
            : {}),
        },
      });
    }
    return buscar(tx, id);
  });
}

// --- Gestión municipal ----------------------------------------------------------------
//
// Toda transición de estado pasa por `transicionar`: busca el reclamo, le pide a `decidir`
// el próximo estado (o que tire AppError si no vale en el estado actual), aplica los campos
// extra y deja constancia en el historial con fecha y autor.

async function transicionar(admin: Usuario, id: string, decidir: (reclamo: { status: string; category: string }) => Decision) {
  return prisma.$transaction(async (tx) => {
    const reclamo = await buscar(tx, id);
    exigirMismoMunicipio(admin, reclamo.municipioId);

    const { status, description, extra } = decidir(reclamo);
    await tx.reclamo.update({
      where: { id },
      data: {
        status,
        ...extra,
        historial: { create: { status, description, autorId: admin.id } },
      },
    });
    return buscar(tx, id);
  });
}

// Cada categoría está en una sola área: esa es la que se asigna al tomar.
export async function tomar(admin: Usuario, id: string) {
  const areas = await prisma.area.findMany();
  const areaDe = (category: string) =>
    areas.find((a) => (JSON.parse(a.categorias) as string[]).includes(category))?.id;
  return transicionar(admin, id, (reclamo) => decidirTomar(reclamo, areaDe(reclamo.category)));
}
export const pasarAReparacion = (admin: Usuario, id: string, fechaEstimada: Date) =>
  transicionar(admin, id, (reclamo) => decidirPasarAReparacion(reclamo, fechaEstimada));
export const resolver = (admin: Usuario, id: string, fotoResolucion: string) =>
  transicionar(admin, id, (reclamo) => decidirResolver(reclamo, fotoResolucion));
export const rechazar = (admin: Usuario, id: string, motivo: string, detalle: string) =>
  transicionar(admin, id, (reclamo) => decidirRechazar(reclamo, motivo, detalle));

export async function definirFechaEstimada(admin: Usuario, id: string, fechaEstimada: Date) {
  return prisma.$transaction(async (tx) => {
    const reclamo = await buscar(tx, id);
    exigirMismoMunicipio(admin, reclamo.municipioId);
    exigirEnReparacion(reclamo);
    exigirFechaNoPasada(fechaEstimada);
    await tx.reclamo.update({ where: { id }, data: { fechaEstimada } });
    return buscar(tx, id);
  });
}

export async function agregarNota(admin: Usuario, id: string, texto: string) {
  const limpio = texto.trim();
  if (!limpio) throw new AppError('NOTA_VACIA', 'La nota no puede estar vacía');
  return prisma.$transaction(async (tx) => {
    const reclamo = await buscar(tx, id);
    exigirMismoMunicipio(admin, reclamo.municipioId);
    await tx.nota.create({ data: { reclamoId: id, texto: limpio, autorId: admin.id } });
    return buscar(tx, id);
  });
}
