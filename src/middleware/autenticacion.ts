import type { NextFunction, Request, Response } from 'express';
import type { Usuario } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../domain/errores';
import { verificarToken } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    usuario?: Usuario;
  }
}

// Exige "Authorization: Bearer <token>" y carga al usuario desde la base en cada pedido: si
// la cuenta se borró después de emitir el token, el token deja de servir.
export async function autenticar(req: Request, _res: Response, next: NextFunction) {
  const [esquema, token] = (req.header('authorization') ?? '').split(' ');
  const usuarioId = esquema === 'Bearer' && token ? verificarToken(token) : null;
  if (!usuarioId) throw new AppError('UNAUTHENTICATED', 'Iniciá sesión para continuar');

  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  if (!usuario) throw new AppError('UNAUTHENTICATED', 'Iniciá sesión para continuar');

  req.usuario = usuario;
  next();
}

export function exigirRol(rol: 'vecino' | 'admin') {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.usuario?.rol !== rol) {
      throw new AppError('FORBIDDEN', rol === 'admin' ? 'Solo el municipio puede hacer esto' : 'Solo los vecinos pueden hacer esto');
    }
    next();
  };
}

// Se llama después de autenticar(): devuelve al usuario sin desempaquetar el opcional en
// cada ruta.
export function usuarioActual(req: Request): Usuario {
  if (!req.usuario) throw new AppError('UNAUTHENTICATED', 'Iniciá sesión para continuar');
  return req.usuario;
}
