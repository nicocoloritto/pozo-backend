import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { config } from '../config';
import { AppError } from '../domain/errores';
import { autenticar } from '../middleware/autenticacion';

// Solo imágenes, con la extensión que decide el servidor según el tipo declarado: nunca la
// que manda el cliente, así no se puede subir un archivo ejecutable con nombre de foto.
const EXTENSIONES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

export const carpetaUploads = resolve(config.carpetaUploads);
mkdirSync(carpetaUploads, { recursive: true });

const subida = multer({
  storage: multer.diskStorage({
    destination: carpetaUploads,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${EXTENSIONES[file.mimetype] ?? extname(file.originalname)}`),
  }),
  limits: { fileSize: config.fotoMaxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (EXTENSIONES[file.mimetype]) cb(null, true);
    else cb(new AppError('INVALID_INPUT', 'La foto tiene que ser JPG, PNG, WebP o HEIC.'));
  },
});

export const rutasFotos = Router();

// Devuelve la URL de la foto, que después se manda como photoUrl / fotoResolucion.
rutasFotos.post('/', autenticar, subida.single('foto'), (req, res) => {
  if (!req.file) throw new AppError('FOTO_REQUIRED', 'Falta la foto.');
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.status(201).json({ url });
});
