import { Router } from 'express';
import { z } from 'zod';
import { normalizarNumeroDni } from '../domain/dni';
import { autenticar, usuarioActual } from '../middleware/autenticacion';
import * as auth from '../services/auth';
import { aUsuarioDto } from '../services/dto';

const texto = (campo: string) => z.string({ error: `Falta ${campo}.` }).trim().min(1, `Falta ${campo}.`);

const registroSchema = z.object({
  firstName: texto('el nombre'),
  lastName: texto('el apellido'),
  sex: texto('el sexo'),
  documentNumber: texto('el DNI').refine((dni) => normalizarNumeroDni(dni).length >= 6, 'El DNI no es válido.'),
  birthDate: texto('la fecha de nacimiento'),
  email: z.email('El email no es válido.'),
  password: z.string({ error: 'Falta la contraseña.' }).min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

const loginSchema = z.object({
  email: z.string({ error: 'Falta el email.' }).min(1, 'Falta el email.'),
  password: z.string({ error: 'Falta la contraseña.' }).min(1, 'Falta la contraseña.'),
});

export const rutasAuth = Router();

rutasAuth.post('/registro', async (req, res) => {
  const usuario = await auth.registrar(registroSchema.parse(req.body));
  res.status(201).json({ token: auth.firmarToken(usuario.id), user: aUsuarioDto(usuario) });
});

rutasAuth.post('/login', async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const usuario = await auth.login(email, password);
  res.json({ token: auth.firmarToken(usuario.id), user: aUsuarioDto(usuario) });
});

rutasAuth.get('/me', autenticar, (req, res) => {
  res.json({ user: aUsuarioDto(usuarioActual(req)) });
});
