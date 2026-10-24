import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { AppError } from '../domain/errores';
import { normalizarNumeroDni } from '../domain/dni';

export type DatosRegistro = {
  firstName: string;
  lastName: string;
  sex: string;
  documentNumber: string;
  birthDate: string;
  email: string;
  password: string;
};

const RONDAS_BCRYPT = 10;
const MENSAJE_DNI_TOMADO = 'Ya hay una cuenta registrada con este DNI. Iniciá sesión con tu email.';

export function firmarToken(usuarioId: string): string {
  return jwt.sign({}, config.jwtSecret, { subject: usuarioId, expiresIn: config.jwtExpira as SignOptions['expiresIn'] });
}

// Devuelve el id del usuario o null si el token no sirve (firma mala, vencido, sin sujeto).
export function verificarToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// Siempre crea un usuario con rol "vecino": los admin no se registran desde la app.
export async function registrar(datos: DatosRegistro) {
  const email = datos.email.trim().toLowerCase();
  const dniNormalizado = normalizarNumeroDni(datos.documentNumber);

  if (await prisma.usuario.findUnique({ where: { email } })) {
    throw new AppError('EMAIL_TAKEN', 'Este email ya está registrado');
  }
  // Un DNI, una cuenta: escanear el DNI identifica a una persona real.
  if (await prisma.usuario.findUnique({ where: { dniNormalizado } })) {
    throw new AppError('DNI_TAKEN', MENSAJE_DNI_TOMADO);
  }

  try {
    return await prisma.usuario.create({
      data: {
        id: randomUUID(),
        rol: 'vecino',
        email,
        passwordHash: await bcrypt.hash(datos.password, RONDAS_BCRYPT),
        firstName: datos.firstName.trim(),
        lastName: datos.lastName.trim(),
        sex: datos.sex,
        documentNumber: datos.documentNumber.trim(),
        dniNormalizado,
        birthDate: datos.birthDate,
      },
    });
  } catch (err) {
    // Dos registros simultáneos con el mismo email o DNI: la restricción única de la base
    // es la que decide, no el chequeo de arriba.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const campo = String(err.meta?.target ?? '');
      if (campo.includes('dniNormalizado')) throw new AppError('DNI_TAKEN', MENSAJE_DNI_TOMADO);
      throw new AppError('EMAIL_TAKEN', 'Este email ya está registrado');
    }
    throw err;
  }
}

export async function login(emailCrudo: string, password: string) {
  const usuario = await prisma.usuario.findUnique({ where: { email: emailCrudo.trim().toLowerCase() } });
  if (!usuario) throw new AppError('EMAIL_NOT_FOUND', 'No hay una cuenta con este email');
  if (!(await bcrypt.compare(password, usuario.passwordHash))) {
    throw new AppError('WRONG_PASSWORD', 'Contraseña incorrecta');
  }
  return usuario;
}
