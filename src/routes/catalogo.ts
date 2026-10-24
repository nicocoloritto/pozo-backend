import { Router } from 'express';
import { prisma } from '../db';
import { autenticar } from '../middleware/autenticacion';
import { aAreaDto } from '../services/dto';

export const rutasCatalogo = Router();

rutasCatalogo.get('/municipios', autenticar, async (_req, res) => {
  res.json(await prisma.municipio.findMany({ orderBy: { nombre: 'asc' } }));
});

rutasCatalogo.get('/areas', autenticar, async (_req, res) => {
  const areas = await prisma.area.findMany({ orderBy: { nombre: 'asc' } });
  res.json(areas.map(aAreaDto));
});
