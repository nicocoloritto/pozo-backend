import { Router } from 'express';
import type { Request } from 'express';
import { AppError } from '../domain/errores';
import { autenticar, usuarioActual } from '../middleware/autenticacion';
import * as estadisticas from '../services/estadisticas';

export const rutasEstadisticas = Router();

function param(req: Request, nombre: string): string {
  const valor = req.params[nombre];
  if (typeof valor !== 'string' || !valor) throw new AppError('NOT_FOUND', 'No existe');
  return valor;
}

rutasEstadisticas.get('/municipios/:municipioId/barrios', autenticar, async (req, res) => {
  res.json(await estadisticas.barrios(usuarioActual(req), param(req, 'municipioId')));
});

rutasEstadisticas.get('/barrios/:barrioId/estadisticas', autenticar, async (req, res) => {
  res.json(await estadisticas.estadisticasBarrio(usuarioActual(req), param(req, 'barrioId')));
});

rutasEstadisticas.get('/municipios/:municipioId/ranking', autenticar, async (req, res) => {
  res.json(await estadisticas.ranking(usuarioActual(req), param(req, 'municipioId')));
});

rutasEstadisticas.get('/municipios/:municipioId/evolucion', autenticar, async (req, res) => {
  res.json(await estadisticas.evolucion(usuarioActual(req), param(req, 'municipioId')));
});
