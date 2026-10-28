import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../domain/errores';
import { CATEGORIAS, NOTAS_MAX_CARACTERES, ORIGENES_UBICACION, SEVERIDADES } from '../domain/tipos';
import { autenticar, exigirRol, usuarioActual } from '../middleware/autenticacion';
import { aReclamoDto } from '../services/dto';
import * as reclamos from '../services/reclamos';

// Reglas de un reclamo nuevo (equivalentes a pozo/mobile/lib/validarReclamo.ts). La pantalla
// deshabilita "Publicar", pero esa es una comodidad de la interfaz: la garantía está acá.
// El autor nunca viene en el cuerpo: es el usuario del token.
const nuevoReclamoSchema = z
  .object({
    municipioId: z.string({ error: 'Falta el municipio del reclamo.' }).min(1, 'Falta el municipio del reclamo.'),
    category: z.enum(CATEGORIAS, { error: 'Elegí una categoría válida.' }),
    severity: z.enum(SEVERIDADES, { error: 'Elegí una severidad válida.' }),
    notes: z
      .string()
      .max(NOTAS_MAX_CARACTERES * 2)
      .optional(),
    photoUrl: z
      .string({ error: 'La foto es obligatoria para publicar un reclamo.' })
      .trim()
      .min(1, 'La foto es obligatoria para publicar un reclamo.'),
    latitude: z
      .number({ error: 'El reclamo necesita una ubicación válida.' })
      .finite('El reclamo necesita una ubicación válida.')
      .min(-90, 'Las coordenadas del reclamo están fuera de rango.')
      .max(90, 'Las coordenadas del reclamo están fuera de rango.'),
    longitude: z
      .number({ error: 'El reclamo necesita una ubicación válida.' })
      .finite('El reclamo necesita una ubicación válida.')
      .min(-180, 'Las coordenadas del reclamo están fuera de rango.')
      .max(180, 'Las coordenadas del reclamo están fuera de rango.'),
    accuracyMeters: z.number().finite().min(0, 'La precisión de la ubicación no es válida.').optional(),
    locationSource: z.enum(ORIGENES_UBICACION, { error: 'El origen de la ubicación no es válido.' }),
    address: z.string().max(300).optional(),
    neighborhood: z.string().max(100).optional(),
    comuna: z.number().int().min(1).max(99).optional(),
    publicarIgual: z.boolean().optional(),
  })
  // (0, 0) es lo que devuelven muchos sistemas cuando no pudieron obtener un GPS: en el
  // golfo de Guinea, nunca un reclamo real.
  .refine((r) => !(r.latitude === 0 && r.longitude === 0), {
    path: ['latitude'],
    message: 'No pudimos determinar la ubicación del reclamo.',
  })
  .refine((r) => (r.notes ?? '').trim().length <= NOTAS_MAX_CARACTERES, {
    path: ['notes'],
    message: `Las notas pueden tener hasta ${NOTAS_MAX_CARACTERES} caracteres.`,
  });

const votoSchema = z.object({ tipo: z.enum(['sigue', 'yaNoEsta'], { error: 'El voto no es válido.' }) });
const areaSchema = z.object({ areaId: z.string({ error: 'Falta el área.' }).min(1, 'Falta el área.') });
const fechaSchema = z.object({
  fechaEstimada: z.iso.datetime({ offset: true, error: 'La fecha estimada no es válida.' }).or(
    z.iso.date({ error: 'La fecha estimada no es válida.' })
  ),
});
const resolverSchema = z.object({ fotoResolucion: z.string().optional() });
const rechazarSchema = z.object({ motivo: z.string().optional() });
const notaSchema = z.object({
  texto: z.string({ error: 'La nota no puede estar vacía' }).max(NOTAS_MAX_CARACTERES, `La nota puede tener hasta ${NOTAS_MAX_CARACTERES} caracteres.`),
});

function idDe(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || !id) throw new AppError('NOT_FOUND', 'Este reclamo no existe o fue eliminado');
  return id;
}

export const rutasReclamos = Router();
rutasReclamos.use(autenticar);

rutasReclamos.get('/', async (req, res) => {
  const lista = await reclamos.listar(usuarioActual(req), req.query.mios === '1');
  res.json(lista.map(aReclamoDto));
});

rutasReclamos.get('/:id', async (req, res) => {
  res.json(aReclamoDto(await reclamos.obtener(usuarioActual(req), idDe(req))));
});

// --- Vecinos ---

rutasReclamos.post('/', exigirRol('vecino'), async (req, res) => {
  const reclamo = await reclamos.publicar(usuarioActual(req), nuevoReclamoSchema.parse(req.body));
  res.status(201).json(aReclamoDto(reclamo));
});

rutasReclamos.post('/:id/confirmaciones', exigirRol('vecino'), async (req, res) => {
  res.json(aReclamoDto(await reclamos.confirmar(usuarioActual(req), idDe(req))));
});

rutasReclamos.post('/:id/votos', exigirRol('vecino'), async (req, res) => {
  const { tipo } = votoSchema.parse(req.body);
  res.json(aReclamoDto(await reclamos.votar(usuarioActual(req), idDe(req), tipo)));
});

// --- Municipio ---

rutasReclamos.post('/:id/tomar', exigirRol('admin'), async (req, res) => {
  res.json(aReclamoDto(await reclamos.tomar(usuarioActual(req), idDe(req))));
});

rutasReclamos.post('/:id/reparacion', exigirRol('admin'), async (req, res) => {
  res.json(aReclamoDto(await reclamos.pasarAReparacion(usuarioActual(req), idDe(req))));
});

rutasReclamos.post('/:id/resolver', exigirRol('admin'), async (req, res) => {
  const { fotoResolucion } = resolverSchema.parse(req.body);
  res.json(aReclamoDto(await reclamos.resolver(usuarioActual(req), idDe(req), fotoResolucion?.trim() ?? '')));
});

rutasReclamos.post('/:id/rechazar', exigirRol('admin'), async (req, res) => {
  const { motivo } = rechazarSchema.parse(req.body);
  res.json(aReclamoDto(await reclamos.rechazar(usuarioActual(req), idDe(req), motivo ?? '')));
});

rutasReclamos.put('/:id/area', exigirRol('admin'), async (req, res) => {
  const { areaId } = areaSchema.parse(req.body);
  res.json(aReclamoDto(await reclamos.asignarArea(usuarioActual(req), idDe(req), areaId)));
});

rutasReclamos.put('/:id/fecha-estimada', exigirRol('admin'), async (req, res) => {
  const { fechaEstimada } = fechaSchema.parse(req.body);
  res.json(aReclamoDto(await reclamos.definirFechaEstimada(usuarioActual(req), idDe(req), new Date(fechaEstimada))));
});

rutasReclamos.post('/:id/notas', exigirRol('admin'), async (req, res) => {
  const { texto } = notaSchema.parse(req.body);
  res.status(201).json(aReclamoDto(await reclamos.agregarNota(usuarioActual(req), idDe(req), texto)));
});
