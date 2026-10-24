import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { prisma } from '../src/db';

const app = crearApp();

const reclamoValido = {
  municipioId: 'caba',
  category: 'Pothole',
  severity: 'High',
  notes: 'Pozo grande',
  photoUrl: 'http://localhost/uploads/foto.jpg',
  latitude: -34.6,
  longitude: -58.4,
  locationSource: 'Device',
};

async function limpiar() {
  await prisma.nota.deleteMany();
  await prisma.voto.deleteMany();
  await prisma.cambioEstado.deleteMany();
  await prisma.reclamo.deleteMany();
  await prisma.usuario.deleteMany();
}

async function crearBase() {
  await prisma.municipio.upsert({ where: { id: 'caba' }, create: { id: 'caba', nombre: 'CABA', sigla: 'CABA' }, update: {} });
  await prisma.municipio.upsert({ where: { id: 'otro' }, create: { id: 'otro', nombre: 'Otro', sigla: 'OTR' }, update: {} });
  await prisma.area.upsert({
    where: { id: 'bacheo' },
    create: { id: 'bacheo', nombre: 'Bacheo', categorias: '["Pothole"]', plazoMaximoDias: 10 },
    update: {},
  });
  const passwordHash = await bcrypt.hash('123456', 4);
  await prisma.usuario.createMany({
    data: [
      { id: 'admin', rol: 'admin', email: 'admin@caba.gob.ar', passwordHash, firstName: 'Admin', municipioId: 'caba' },
      { id: 'admin-otro', rol: 'admin', email: 'admin@otro.gob.ar', passwordHash, firstName: 'Otro', municipioId: 'otro' },
    ],
  });
}

async function registrarVecino(n: number) {
  const res = await request(app)
    .post('/auth/registro')
    .send({
      firstName: `Vecino${n}`,
      lastName: 'Prueba',
      sex: 'F',
      documentNumber: `3000000${n}`,
      birthDate: '01/01/1990',
      email: `vecino${n}@pozo.com`,
      password: '123456',
    });
  expect(res.status).toBe(201);
  return { token: res.body.token as string, id: res.body.user.id as string };
}

async function loginAdmin(email = 'admin@caba.gob.ar') {
  const res = await request(app).post('/auth/login').send({ email, password: '123456' });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

const con = (token: string) => ({ Authorization: `Bearer ${token}` });

async function publicar(token: string, cambios: Record<string, unknown> = {}) {
  const res = await request(app).post('/reclamos').set(con(token)).send({ ...reclamoValido, ...cambios });
  expect(res.status).toBe(201);
  return res.body as { id: string; status: string; confirmaciones: string[] };
}

beforeAll(limpiar);
beforeEach(async () => {
  await limpiar();
  await crearBase();
});
afterAll(() => prisma.$disconnect());

describe('auth', () => {
  it('registra un vecino, devuelve un token y no filtra datos internos', async () => {
    const res = await request(app)
      .post('/auth/registro')
      .send({
        firstName: 'Lucía',
        lastName: 'Fernández',
        sex: 'F',
        documentNumber: '30.111.222',
        birthDate: '14/03/1988',
        email: 'Lucia@Pozo.com',
        password: '123456',
      });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ rol: 'vecino', email: 'lucia@pozo.com', documentNumber: '30.111.222' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|dniNormalizado/);

    const me = await request(app).get('/auth/me').set(con(res.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('lucia@pozo.com');
  });

  it('rechaza un segundo registro con el mismo DNI aunque cambie el formato', async () => {
    await registrarVecino(1);
    const res = await request(app)
      .post('/auth/registro')
      .send({
        firstName: 'Otra',
        lastName: 'Persona',
        sex: 'F',
        documentNumber: '30.000.001',
        birthDate: '01/01/1990',
        email: 'otra@pozo.com',
        password: '123456',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DNI_TAKEN');
  });

  it('rechaza un email repetido sin distinguir mayúsculas', async () => {
    await registrarVecino(1);
    const res = await request(app)
      .post('/auth/registro')
      .send({
        firstName: 'Otra',
        lastName: 'Persona',
        sex: 'F',
        documentNumber: '40000000',
        birthDate: '01/01/1990',
        email: 'VECINO1@pozo.com',
        password: '123456',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('valida los datos del registro', async () => {
    const res = await request(app).post('/auth/registro').send({ email: 'no-es-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('inicia sesión y distingue email inexistente de contraseña incorrecta', async () => {
    expect((await request(app).post('/auth/login').send({ email: 'admin@caba.gob.ar', password: '123456' })).status).toBe(200);

    const mala = await request(app).post('/auth/login').send({ email: 'admin@caba.gob.ar', password: 'mala' });
    expect(mala.status).toBe(401);
    expect(mala.body.error.code).toBe('WRONG_PASSWORD');

    const noExiste = await request(app).post('/auth/login').send({ email: 'nadie@pozo.com', password: '123456' });
    expect(noExiste.status).toBe(401);
    expect(noExiste.body.error.code).toBe('EMAIL_NOT_FOUND');
  });

  it('exige un token válido', async () => {
    expect((await request(app).get('/reclamos')).status).toBe(401);
    expect((await request(app).get('/reclamos').set(con('basura'))).status).toBe(401);
  });
});

describe('publicar reclamos', () => {
  it('crea el reclamo como Reportado, con el autor del token y su historial', async () => {
    const vecino = await registrarVecino(1);
    const res = await request(app)
      .post('/reclamos')
      .set(con(vecino.token))
      .send({ ...reclamoValido, autorId: 'otro-vecino', status: 'Resuelto', id: 'EXP-00-00000' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'Reportado', autorId: vecino.id, confirmaciones: [] });
    expect(res.body.id).toMatch(/^EXP-\d{2}-\d{5}$/);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({ status: 'Reportado', autor: vecino.id });
  });

  it.each([
    ['sin foto', { photoUrl: '' }],
    ['sin ubicación real (0, 0)', { latitude: 0, longitude: 0 }],
    ['latitud fuera de rango', { latitude: 91 }],
    ['categoría inventada', { category: 'Dragon' }],
    ['notas demasiado largas', { notes: 'a'.repeat(281) }],
    ['municipio inexistente', { municipioId: 'atlantida' }],
  ])('rechaza un reclamo %s', async (_nombre, cambios) => {
    const vecino = await registrarVecino(1);
    const res = await request(app).post('/reclamos').set(con(vecino.token)).send({ ...reclamoValido, ...cambios });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('no deja publicar al municipio', async () => {
    const res = await request(app).post('/reclamos').set(con(await loginAdmin())).send(reclamoValido);
    expect(res.status).toBe(403);
  });
});

describe('confirmaciones y votos', () => {
  it('con 3 confirmaciones de otros vecinos pasa a ConfirmadoPorVecinos', async () => {
    const autor = await registrarVecino(1);
    const reclamo = await publicar(autor.token);

    for (const n of [2, 3]) {
      const vecino = await registrarVecino(n);
      const res = await request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con(vecino.token));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('Reportado');
    }
    const tercero = await registrarVecino(4);
    const res = await request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con(tercero.token));
    expect(res.body.status).toBe('ConfirmadoPorVecinos');
    expect(res.body.confirmaciones).toHaveLength(3);
    expect(res.body.history.at(-1).description).toBe('Confirmado por 3 vecinos');
  });

  it('no deja confirmar el propio reclamo ni confirmar dos veces', async () => {
    const autor = await registrarVecino(1);
    const otro = await registrarVecino(2);
    const reclamo = await publicar(autor.token);

    const propio = await request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con(autor.token));
    expect(propio.status).toBe(403);
    expect(propio.body.error.code).toBe('OWN_RECLAMO');

    await request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con(otro.token));
    const repetida = await request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con(otro.token));
    expect(repetida.status).toBe(409);
    expect(repetida.body.error.code).toBe('ALREADY_CONFIRMED');
  });

  it('un voto por vecino: cambiar de voto lo mueve y repetirlo lo saca', async () => {
    const autor = await registrarVecino(1);
    const otro = await registrarVecino(2);
    const reclamo = await publicar(autor.token);
    const votar = (tipo: string) =>
      request(app).post(`/reclamos/${reclamo.id}/votos`).set(con(otro.token)).send({ tipo });

    let res = await votar('sigue');
    expect(res.body.confirmaciones).toEqual([otro.id]);

    res = await votar('yaNoEsta');
    expect(res.body.confirmaciones).toEqual([]);
    expect(res.body.votosYaNoEsta).toEqual([otro.id]);
    expect(res.body.ultimoVoto.tipo).toBe('yaNoEsta');

    res = await votar('yaNoEsta');
    expect(res.body.votosYaNoEsta).toEqual([]);
  });

  it('el autor puede votar "ya no está" pero no "sigue"', async () => {
    const autor = await registrarVecino(1);
    const reclamo = await publicar(autor.token);
    const sigue = await request(app).post(`/reclamos/${reclamo.id}/votos`).set(con(autor.token)).send({ tipo: 'sigue' });
    expect(sigue.status).toBe(403);
    const yaNoEsta = await request(app).post(`/reclamos/${reclamo.id}/votos`).set(con(autor.token)).send({ tipo: 'yaNoEsta' });
    expect(yaNoEsta.status).toBe(200);
  });

  it('rechaza un tipo de voto inválido y reclamos inexistentes', async () => {
    const vecino = await registrarVecino(1);
    expect((await request(app).post('/reclamos/EXP-00-00000/votos').set(con(vecino.token)).send({ tipo: 'sigue' })).status).toBe(404);
    const reclamo = await publicar((await registrarVecino(2)).token);
    expect((await request(app).post(`/reclamos/${reclamo.id}/votos`).set(con(vecino.token)).send({ tipo: 'x' })).status).toBe(400);
  });

  it('dos confirmaciones simultáneas no se pisan', async () => {
    const autor = await registrarVecino(1);
    const reclamo = await publicar(autor.token);
    const vecinos = await Promise.all([2, 3, 4].map(registrarVecino));

    await Promise.all(vecinos.map((v) => request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con(v.token))));

    const res = await request(app).get(`/reclamos/${reclamo.id}`).set(con(autor.token));
    expect(res.body.confirmaciones).toHaveLength(3);
    expect(res.body.status).toBe('ConfirmadoPorVecinos');
  });
});

describe('gestión municipal', () => {
  async function reclamoConfirmado() {
    const autor = await registrarVecino(1);
    const reclamo = await publicar(autor.token);
    for (const n of [2, 3, 4]) {
      await request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con((await registrarVecino(n)).token));
    }
    return { reclamo, autor };
  }

  it('recorre el circuito completo hasta Resuelto', async () => {
    const { reclamo } = await reclamoConfirmado();
    const admin = await loginAdmin();
    const accion = (ruta: string, cuerpo: object = {}, metodo: 'post' | 'put' = 'post') =>
      request(app)[metodo](`/reclamos/${reclamo.id}/${ruta}`).set(con(admin)).send(cuerpo);

    expect((await accion('tomar')).body.status).toBe('EnviadoAlMunicipio');
    expect((await accion('area', { areaId: 'bacheo' }, 'put')).body.areaAsignada).toBe('bacheo');
    expect((await accion('fecha-estimada', { fechaEstimada: '2026-12-01' }, 'put')).body.fechaEstimada).toMatch(/^2026-12-01/);
    expect((await accion('notas', { texto: 'Cuadrilla en camino' })).body.notas).toHaveLength(1);
    expect((await accion('reparacion')).body.status).toBe('EnReparacion');

    const resuelto = await accion('resolver', { fotoResolucion: 'http://localhost/uploads/despues.jpg' });
    expect(resuelto.status).toBe(200);
    expect(resuelto.body).toMatchObject({ status: 'Resuelto', fotoResolucion: 'http://localhost/uploads/despues.jpg' });
    expect(resuelto.body.history.map((c: { status: string }) => c.status)).toEqual([
      'Reportado',
      'ConfirmadoPorVecinos',
      'EnviadoAlMunicipio',
      'EnReparacion',
      'Resuelto',
    ]);

    // Cerrado: ya no se puede editar ni votar.
    expect((await accion('area', { areaId: 'bacheo' }, 'put')).status).toBe(409);
    const vecino = await registrarVecino(5);
    expect((await request(app).post(`/reclamos/${reclamo.id}/votos`).set(con(vecino.token)).send({ tipo: 'yaNoEsta' })).status).toBe(409);
  });

  it('toma de inmediato una categoría peligrosa sin confirmaciones', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token, { category: 'FallenTree' });
    const res = await request(app).post(`/reclamos/${reclamo.id}/tomar`).set(con(await loginAdmin()));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EnviadoAlMunicipio');
  });

  it('no toma un reclamo común sin confirmar', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token);
    const res = await request(app).post(`/reclamos/${reclamo.id}/tomar`).set(con(await loginAdmin()));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('exige área para reparar, foto para resolver y motivo para rechazar', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token, { category: 'Outage' });
    const admin = await loginAdmin();
    await request(app).post(`/reclamos/${reclamo.id}/tomar`).set(con(admin));

    const sinArea = await request(app).post(`/reclamos/${reclamo.id}/reparacion`).set(con(admin));
    expect(sinArea.body.error.code).toBe('AREA_REQUIRED');

    const sinMotivo = await request(app).post(`/reclamos/${reclamo.id}/rechazar`).set(con(admin)).send({ motivo: ' ' });
    expect(sinMotivo.body.error.code).toBe('MOTIVO_REQUIRED');

    const rechazado = await request(app).post(`/reclamos/${reclamo.id}/rechazar`).set(con(admin)).send({ motivo: 'Duplicado' });
    expect(rechazado.body).toMatchObject({ status: 'Rechazado', motivoRechazo: 'Duplicado' });
  });

  it('valida nota vacía, área inexistente y fecha inválida', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token);
    const admin = await loginAdmin();
    const nota = await request(app).post(`/reclamos/${reclamo.id}/notas`).set(con(admin)).send({ texto: '   ' });
    expect(nota.body.error.code).toBe('NOTA_VACIA');
    const area = await request(app).put(`/reclamos/${reclamo.id}/area`).set(con(admin)).send({ areaId: 'nada' });
    expect(area.status).toBe(400);
    const fecha = await request(app).put(`/reclamos/${reclamo.id}/fecha-estimada`).set(con(admin)).send({ fechaEstimada: 'mañana' });
    expect(fecha.status).toBe(400);
  });

  it('un vecino no puede ejecutar acciones del municipio', async () => {
    const vecino = await registrarVecino(1);
    const reclamo = await publicar(vecino.token, { category: 'Outage' });
    for (const ruta of ['tomar', 'reparacion', 'resolver', 'rechazar', 'notas']) {
      const res = await request(app).post(`/reclamos/${reclamo.id}/${ruta}`).set(con(vecino.token)).send({});
      expect(res.status, ruta).toBe(403);
    }
  });

  it('un admin no toca ni ve reclamos de otro municipio', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token, { category: 'Outage' });
    const adminOtro = await loginAdmin('admin@otro.gob.ar');

    const tomar = await request(app).post(`/reclamos/${reclamo.id}/tomar`).set(con(adminOtro));
    expect(tomar.status).toBe(403);
    expect((await request(app).get(`/reclamos/${reclamo.id}`).set(con(adminOtro))).status).toBe(403);
    expect((await request(app).get('/reclamos').set(con(adminOtro))).body).toEqual([]);
  });
});

describe('consultas', () => {
  it('lista del más nuevo al más viejo y filtra "mis reclamos"', async () => {
    const uno = await registrarVecino(1);
    const dos = await registrarVecino(2);
    const primero = await publicar(uno.token);
    await new Promise((r) => setTimeout(r, 5));
    const segundo = await publicar(dos.token);

    const todos = await request(app).get('/reclamos').set(con(uno.token));
    expect(todos.body.map((r: { id: string }) => r.id)).toEqual([segundo.id, primero.id]);

    const mios = await request(app).get('/reclamos?mios=1').set(con(uno.token));
    expect(mios.body.map((r: { id: string }) => r.id)).toEqual([primero.id]);
  });

  it('expone municipios y áreas', async () => {
    const vecino = await registrarVecino(1);
    expect((await request(app).get('/municipios').set(con(vecino.token))).body).toHaveLength(2);
    expect((await request(app).get('/areas').set(con(vecino.token))).body[0]).toMatchObject({
      id: 'bacheo',
      categorias: ['Pothole'],
    });
  });

  it('responde 404 con el formato de error en rutas inexistentes y JSON roto', async () => {
    const res = await request(app).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const roto = await request(app).post('/auth/login').set('Content-Type', 'application/json').send('{no es json');
    expect(roto.status).toBe(400);
    expect(roto.body.error.code).toBe('INVALID_INPUT');
  });
});

describe('fotos', () => {
  it('sube una imagen y devuelve su URL; rechaza otros tipos', async () => {
    const vecino = await registrarVecino(1);
    const ok = await request(app)
      .post('/fotos')
      .set(con(vecino.token))
      .attach('foto', Buffer.from('imagen-falsa'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/\/uploads\/[0-9a-f-]+\.jpg$/);

    const descarga = await request(app).get(new URL(ok.body.url).pathname);
    expect(descarga.status).toBe(200);

    const mala = await request(app)
      .post('/fotos')
      .set(con(vecino.token))
      .attach('foto', Buffer.from('#!/bin/sh'), { filename: 'x.sh', contentType: 'text/x-sh' });
    expect(mala.status).toBe(400);
    expect(mala.body.error.code).toBe('INVALID_INPUT');

    expect((await request(app).post('/fotos').attach('foto', Buffer.from('x'), 'x.jpg')).status).toBe(401);
  });
});
