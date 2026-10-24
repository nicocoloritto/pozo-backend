import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../domain/errores';

export function rutaInexistente(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta inexistente' } });
}

// Todos los errores salen como { error: { code, message } }. Lo inesperado se registra y
// devuelve un 500 genérico: nunca se filtra el detalle interno al cliente.
export function manejarErrores(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    const primero = err.issues[0];
    const campo = primero?.path.join('.');
    const mensaje = primero ? (campo ? `${campo}: ${primero.message}` : primero.message) : 'Datos inválidos';
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: mensaje } });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'La foto pesa demasiado' : 'No se pudo recibir la foto';
    res.status(400).json({ error: { code: 'INVALID_INPUT', message } });
    return;
  }
  // body-parser de Express: JSON mal formado o cuerpo demasiado grande.
  if (typeof err === 'object' && err !== null && 'status' in err && (err as { status: unknown }).status === 400) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'El cuerpo del pedido no es JSON válido' } });
    return;
  }
  console.error('[api] Error inesperado', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Algo salió mal de nuestro lado' } });
}
