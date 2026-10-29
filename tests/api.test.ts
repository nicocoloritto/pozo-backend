import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { prisma } from '../src/db';
import { reiniciarLimites } from '../src/middleware/limiteIntentos';

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
  await prisma.barrio.deleteMany();
}

async function crearBase() {
  await prisma.municipio.upsert({ where: { id: 'caba' }, create: { id: 'caba', nombre: 'CABA', sigla: 'CABA' }, update: {} });
  await prisma.municipio.upsert({ where: { id: 'otro' }, create: { id: 'otro', nombre: 'Otro', sigla: 'OTR' }, update: {} });
  await prisma.area.upsert({
    where: { id: 'bacheo' },
    create: { id: 'bacheo', nombre: 'Bacheo', categorias: '["Pothole"]' },
    update: {},
  });
  await prisma.area.upsert({
    where: { id: 'otras' },
    create: { id: 'otras', nombre: 'Otras', categorias: '["FallenTree","Outage"]' },
    update: {},
  });
  await prisma.barrio.createMany({
    data: [
      { id: 'caballito', nombre: 'Caballito', comuna: 6, municipioId: 'caba', latitude: -34.62, longitude: -58.44 },
      { id: 'flores', nombre: 'Flores', comuna: 7, municipioId: 'caba', latitude: -34.63, longitude: -58.46 },
      { id: 'palermo', nombre: 'Palermo', comuna: 14, municipioId: 'caba', latitude: -34.58, longitude: -58.43 },
    ],
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

const DIA = 24 * 60 * 60 * 1000;
const enDias = (n: number) => new Date(Date.now() + n * DIA).toISOString();

async function publicar(token: string, cambios: Record<string, unknown> = {}) {
  const res = await request(app).post('/reclamos').set(con(token)).send({ ...reclamoValido, ...cambios });
  expect(res.status).toBe(201);
  return res.body as { id: string; status: string; confirmaciones: string[] };
}

beforeAll(limpiar);
beforeEach(async () => {
  reiniciarLimites();
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

  it('dice si un DNI ya tiene cuenta solo si coinciden DNI, sexo y fecha de nacimiento', async () => {
    await registrarVecino(1);
    const consultar = (cuerpo: Record<string, unknown>) => request(app).post('/auth/dni-registrado').send(cuerpo);

    const mismo = await consultar({ documentNumber: '30.000.001', sex: 'f', birthDate: '01/01/1990' });
    expect(mismo.status).toBe(200);
    expect(mismo.body).toEqual({ registrado: true });

    for (const cuerpo of [
      { documentNumber: '30000001', sex: 'M', birthDate: '01/01/1990' },
      { documentNumber: '30000001', sex: 'F', birthDate: '02/01/1990' },
      { documentNumber: '40000000', sex: 'F', birthDate: '01/01/1990' },
    ]) {
      const res = await consultar(cuerpo);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ registrado: false });
    }

    const incompleto = await consultar({ documentNumber: '30000001' });
    expect(incompleto.status).toBe(400);
    expect(incompleto.body.error.code).toBe('INVALID_INPUT');
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

describe('límite de intentos de login', () => {
  const intentar = (email: string, password: string) => request(app).post('/auth/login').send({ email, password });

  it('bloquea una cuenta después de 5 contraseñas incorrectas, aunque la sexta sea la correcta', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await intentar('admin@caba.gob.ar', 'mala')).status).toBe(401);
    }
    const bloqueado = await intentar('admin@caba.gob.ar', '123456');
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
    // Otra cuenta no se ve afectada.
    expect((await intentar('admin@otro.gob.ar', '123456')).status).toBe(200);
  });

  it('un login correcto borra los fallos de esa cuenta', async () => {
    for (let i = 0; i < 4; i++) await intentar('admin@caba.gob.ar', 'mala');
    expect((await intentar('admin@caba.gob.ar', '123456')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await intentar('admin@caba.gob.ar', 'mala')).status).toBe(401);
  });

  it('bloquea a una IP que prueba muchos emails distintos', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await intentar(`nadie${i}@pozo.com`, 'x')).status).toBe(401);
    }
    expect((await intentar('admin@caba.gob.ar', '123456')).status).toBe(429);
  });

  it('limita las consultas de "DNI ya registrado" por IP', async () => {
    const consulta = () =>
      request(app).post('/auth/dni-registrado').send({ documentNumber: '30111222', sex: 'F', birthDate: '01/01/1990' });
    for (let i = 0; i < 30; i++) expect((await consulta()).status).toBe(200);
    expect((await consulta()).status).toBe(429);
  });
});

describe('borrar la cuenta propia', () => {
  it('anonimiza la cuenta, invalida el token y libera el email y el DNI', async () => {
    const vecino = await registrarVecino(1);
    const reclamo = await publicar(vecino.token);

    const res = await request(app).delete('/auth/cuenta').set(con(vecino.token));
    expect(res.status).toBe(204);

    // El token viejo ya no sirve y el email ya no inicia sesión.
    expect((await request(app).get('/auth/me').set(con(vecino.token))).status).toBe(401);
    const login = await request(app).post('/auth/login').send({ email: 'vecino1@pozo.com', password: '123456' });
    expect(login.body.error.code).toBe('EMAIL_NOT_FOUND');

    // No queda ningún dato personal.
    const fila = await prisma.usuario.findUniqueOrThrow({ where: { id: vecino.id } });
    expect(fila).toMatchObject({
      firstName: 'Cuenta eliminada',
      lastName: null,
      documentNumber: null,
      dniNormalizado: null,
      birthDate: null,
    });
    expect(fila.email).not.toContain('vecino1');
    expect(fila.eliminadaEn).not.toBeNull();

    // El reclamo sigue, para el municipio y los demás vecinos.
    const admin = await loginAdmin();
    const visto = await request(app).get(`/reclamos/${reclamo.id}`).set(con(admin));
    expect(visto.status).toBe(200);
    expect(visto.body.autorId).toBe(vecino.id);

    // La misma persona se puede volver a registrar con el mismo email y DNI.
    const otraVez = await registrarVecino(1);
    expect(otraVez.id).not.toBe(vecino.id);
  });

  it('exige sesión y no deja borrar una cuenta del municipio', async () => {
    expect((await request(app).delete('/auth/cuenta')).status).toBe(401);
    const admin = await request(app).delete('/auth/cuenta').set(con(await loginAdmin()));
    expect(admin.status).toBe(403);
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

describe('reclamos duplicados', () => {
  const A_30_METROS = { latitude: reclamoValido.latitude + 0.00027 };
  const A_110_METROS = { latitude: reclamoValido.latitude + 0.001 };

  it('rechaza un reclamo de la misma categoría a menos de 50 m y devuelve el existente', async () => {
    const existente = await publicar((await registrarVecino(1)).token);
    const res = await request(app)
      .post('/reclamos')
      .set(con((await registrarVecino(2)).token))
      .send({ ...reclamoValido, ...A_30_METROS });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RECLAMO_CERCANO');
    expect(res.body.error.reclamo.id).toBe(existente.id);
    expect(res.body.error.distanciaMetros).toBeGreaterThan(25);
    expect(res.body.error.distanciaMetros).toBeLessThan(35);
    expect(await prisma.reclamo.count()).toBe(1);
  });

  it('también avisa si el reclamo cercano es del mismo autor', async () => {
    const vecino = await registrarVecino(1);
    await publicar(vecino.token);
    const res = await request(app).post('/reclamos').set(con(vecino.token)).send(reclamoValido);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RECLAMO_CERCANO');
  });

  it('publica si es otra categoría, si está a más de 50 m o si el cercano ya está cerrado', async () => {
    const vecino = await registrarVecino(1);
    const cerrado = await publicar(vecino.token, { category: 'StreetLight' });
    await prisma.reclamo.update({ where: { id: cerrado.id }, data: { status: 'Resuelto' } });
    await publicar(vecino.token);

    await publicar(vecino.token, { category: 'BrokenSidewalk' });
    await publicar(vecino.token, A_110_METROS);
    await publicar(vecino.token, { category: 'StreetLight' });
  });

  it('publica igual si el vecino indica que es otro problema', async () => {
    const vecino = await registrarVecino(1);
    await publicar(vecino.token);
    await publicar(vecino.token, { ...A_30_METROS, publicarIgual: true });
    expect(await prisma.reclamo.count()).toBe(2);
  });

  it('de dos publicaciones simultáneas en el mismo lugar, solo una entra', async () => {
    const uno = await registrarVecino(1);
    const dos = await registrarVecino(2);
    const respuestas = await Promise.all(
      [uno, dos].map((v) => request(app).post('/reclamos').set(con(v.token)).send(reclamoValido))
    );
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.reclamo.count()).toBe(1);
  });
});

describe('confirmaciones y votos', () => {
  it('con 1 confirmación de otro vecino pasa a ConfirmadoPorVecinos; el autor no cuenta', async () => {
    const autor = await registrarVecino(1);
    const reclamo = await publicar(autor.token);
    await request(app).post(`/reclamos/${reclamo.id}/votos`).set(con(autor.token)).send({ tipo: 'sigue' });
    expect((await request(app).get(`/reclamos/${reclamo.id}`).set(con(autor.token))).body.status).toBe('Reportado');

    const vecino = await registrarVecino(2);
    const res = await request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con(vecino.token));
    expect(res.body.status).toBe('ConfirmadoPorVecinos');
    expect(res.body.confirmaciones).toHaveLength(1);
    expect(res.body.history.at(-1).description).toBe('Confirmado por vecinos');
  });

  it('con 10 "ya no está" pasa solo a Resuelto, sin foto, y queda en el historial', async () => {
    const autor = await registrarVecino(1);
    const reclamo = await publicar(autor.token);
    // Nueve votos ya cargados; el décimo llega por la API.
    await prisma.usuario.createMany({
      data: Array.from({ length: 9 }, (_, i) => ({
        id: `votante-${i}`,
        rol: 'vecino',
        email: `votante${i}@pozo.com`,
        passwordHash: 'x',
        firstName: 'Votante',
      })),
    });
    await prisma.voto.createMany({
      data: Array.from({ length: 9 }, (_, i) => ({ reclamoId: reclamo.id, vecinoId: `votante-${i}`, tipo: 'yaNoEsta' })),
    });
    expect((await request(app).get(`/reclamos/${reclamo.id}`).set(con(autor.token))).body.status).toBe('Reportado');

    const res = await request(app).post(`/reclamos/${reclamo.id}/votos`).set(con(autor.token)).send({ tipo: 'yaNoEsta' });
    expect(res.body.status).toBe('Resuelto');
    expect(res.body.fotoResolucion).toBeUndefined();
    expect(res.body.history.at(-1)).toMatchObject({ status: 'Resuelto' });
    expect(res.body.history.at(-1).description).toContain('Resuelto por los vecinos');
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
    await request(app).post(`/reclamos/${reclamo.id}/confirmaciones`).set(con((await registrarVecino(2)).token));
    return { reclamo, autor };
  }

  it('recorre el circuito completo hasta Resuelto', async () => {
    const { reclamo } = await reclamoConfirmado();
    const admin = await loginAdmin();
    const accion = (ruta: string, cuerpo: object = {}, metodo: 'post' | 'put' = 'post') =>
      request(app)[metodo](`/reclamos/${reclamo.id}/${ruta}`).set(con(admin)).send(cuerpo);

    const tomado = await accion('tomar');
    expect(tomado.body).toMatchObject({ status: 'EnviadoAlMunicipio', areaAsignada: 'bacheo' });
    expect((await accion('notas', { texto: 'Cuadrilla en camino' })).body.notas).toHaveLength(1);
    // La fecha estimada solo se define en reparación.
    expect((await accion('fecha-estimada', { fechaEstimada: enDias(5) }, 'put')).status).toBe(409);
    const enReparacion = await accion('reparacion', { fechaEstimada: enDias(7) });
    expect(enReparacion.body).toMatchObject({ status: 'EnReparacion', fechaEstimada: expect.any(String) });
    const nueva = enDias(14);
    expect((await accion('fecha-estimada', { fechaEstimada: nueva }, 'put')).body.fechaEstimada).toBe(nueva);

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
    expect((await accion('fecha-estimada', { fechaEstimada: enDias(5) }, 'put')).status).toBe(409);
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

  it('al tomar asigna sola el área de la categoría', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token, { category: 'Outage' });
    const res = await request(app).post(`/reclamos/${reclamo.id}/tomar`).set(con(await loginAdmin()));
    expect(res.body.areaAsignada).toBe('otras');
  });

  it('pasar a reparación exige la fecha estimada y no una anterior a hoy', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token, { category: 'Outage' });
    const admin = await loginAdmin();
    await request(app).post(`/reclamos/${reclamo.id}/tomar`).set(con(admin));
    const reparar = (cuerpo: object) => request(app).post(`/reclamos/${reclamo.id}/reparacion`).set(con(admin)).send(cuerpo);

    expect((await reparar({})).body.error.code).toBe('INVALID_INPUT');
    expect((await reparar({ fechaEstimada: enDias(-3) })).body.error.code).toBe('INVALID_INPUT');
    const sigue = await request(app).get(`/reclamos/${reclamo.id}`).set(con(admin));
    expect(sigue.body.status).toBe('EnviadoAlMunicipio');

    expect((await reparar({ fechaEstimada: enDias(3) })).body.status).toBe('EnReparacion');
    const cambiar = (fechaEstimada: string) =>
      request(app).put(`/reclamos/${reclamo.id}/fecha-estimada`).set(con(admin)).send({ fechaEstimada });
    expect((await cambiar(enDias(-3))).body.error.code).toBe('INVALID_INPUT');
    expect((await cambiar(enDias(10))).status).toBe(200);
  });

  it('exige foto para resolver y un motivo de la lista para rechazar', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token, { category: 'Outage' });
    const admin = await loginAdmin();
    await request(app).post(`/reclamos/${reclamo.id}/tomar`).set(con(admin));
    await request(app).post(`/reclamos/${reclamo.id}/reparacion`).set(con(admin)).send({ fechaEstimada: enDias(3) });

    const sinFoto = await request(app).post(`/reclamos/${reclamo.id}/resolver`).set(con(admin)).send({});
    expect(sinFoto.body.error.code).toBe('FOTO_REQUIRED');

    const rechazar = (cuerpo: object) => request(app).post(`/reclamos/${reclamo.id}/rechazar`).set(con(admin)).send(cuerpo);
    expect((await rechazar({ motivo: ' ' })).body.error.code).toBe('MOTIVO_REQUIRED');
    expect((await rechazar({ motivo: 'Ya no está' })).body.error.code).toBe('MOTIVO_REQUIRED');

    const rechazado = await rechazar({ motivo: 'Duplicado', detalle: 'Es el EXP-26-00001' });
    expect(rechazado.body).toMatchObject({
      status: 'Rechazado',
      motivoRechazoTipo: 'Duplicado',
      motivoRechazo: 'Es el EXP-26-00001',
    });
  });

  it('valida nota vacía y fecha inválida', async () => {
    const reclamo = await publicar((await registrarVecino(1)).token);
    const admin = await loginAdmin();
    const nota = await request(app).post(`/reclamos/${reclamo.id}/notas`).set(con(admin)).send({ texto: '   ' });
    expect(nota.body.error.code).toBe('NOTA_VACIA');
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
    const segundo = await publicar(dos.token, { category: 'BrokenSidewalk' });

    const todos = await request(app).get('/reclamos').set(con(uno.token));
    expect(todos.body.map((r: { id: string }) => r.id)).toEqual([segundo.id, primero.id]);

    const mios = await request(app).get('/reclamos?mios=1').set(con(uno.token));
    expect(mios.body.map((r: { id: string }) => r.id)).toEqual([primero.id]);
  });

  it('con ?mapa=1 omite los cerrados hace más de 7 días; la lista normal los devuelve', async () => {
    const vecino = await registrarVecino(1);
    const dia = 24 * 60 * 60 * 1000;
    const cerrar = async (id: string, status: string, hace: number) => {
      await prisma.reclamo.update({ where: { id }, data: { status } });
      await prisma.cambioEstado.create({ data: { reclamoId: id, status, description: status, createdAt: new Date(Date.now() - hace * dia) } });
    };
    const abierto = await publicar(vecino.token, { category: 'StreetLight' });
    const resueltoViejo = await publicar(vecino.token, { category: 'Trench' });
    const rechazadoViejo = await publicar(vecino.token, { category: 'Outage' });
    const resueltoReciente = await publicar(vecino.token, { category: 'FallenPole' });
    await cerrar(resueltoViejo.id, 'Resuelto', 8);
    await cerrar(rechazadoViejo.id, 'Rechazado', 8);
    await cerrar(resueltoReciente.id, 'Resuelto', 6);

    const ids = async (ruta: string) =>
      ((await request(app).get(ruta).set(con(vecino.token))).body as { id: string }[]).map((r) => r.id).sort();
    expect(await ids('/reclamos?mapa=1')).toEqual([abierto.id, resueltoReciente.id].sort());
    expect(await ids('/reclamos')).toHaveLength(4);
  });

  it('cada reclamo trae su prioridad y si está atrasado', async () => {
    const vecino = await registrarVecino(1);
    const { id } = await publicar(vecino.token, { category: 'FallenTree', severity: 'High' });
    const admin = await loginAdmin();
    await request(app).post(`/reclamos/${id}/tomar`).set(con(admin));
    await request(app).post(`/reclamos/${id}/reparacion`).set(con(admin)).send({ fechaEstimada: enDias(3) });
    const dia = 24 * 60 * 60 * 1000;
    await prisma.reclamo.update({ where: { id }, data: { createdAt: new Date(Date.now() - 30 * dia) } });

    // 30 días abierto, sin votos: ni la severidad ni la categoría suman.
    const res = await request(app).get(`/reclamos/${id}`).set(con(admin));
    expect(res.body.prioridad).toBe(60);
    expect(res.body.desglosePrioridad).toBeUndefined();
    expect(res.body.atrasado).toBe(false);

    // Con la fecha estimada ya pasada y el reclamo abierto, está atrasado.
    await prisma.reclamo.update({ where: { id }, data: { fechaEstimada: new Date(Date.now() - 3 * dia) } });
    expect((await request(app).get('/reclamos').set(con(admin))).body[0].atrasado).toBe(true);

    await prisma.reclamo.update({ where: { id }, data: { fechaEstimada: new Date(Date.now() + 3 * dia) } });
    expect((await request(app).get(`/reclamos/${id}`).set(con(admin))).body.atrasado).toBe(false);
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

describe('estadísticas', () => {
  let contador = 0;
  // Inserta el reclamo directo en la base para controlar las fechas. Si `resueltoEnDias` viene,
  // el historial registra el cambio a Resuelto esa cantidad de días después del alta.
  async function crearReclamo(autorId: string, barrio: string, status: string, category = 'Pothole', resueltoEnDias?: number) {
    const createdAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    contador++;
    await prisma.reclamo.create({
      data: {
        id: `EXP-TEST-${contador}`,
        caseNumber: `EXP-TEST-${contador}`,
        autorId,
        municipioId: 'caba',
        category,
        severity: 'Low',
        status,
        photoUrl: 'http://localhost/uploads/foto.jpg',
        latitude: -34.6,
        longitude: -58.4,
        locationSource: 'Device',
        neighborhood: barrio,
        createdAt,
        historial:
          resueltoEnDias === undefined
            ? undefined
            : { create: { status: 'Resuelto', description: 'Resuelto', createdAt: new Date(createdAt.getTime() + resueltoEnDias * 24 * 60 * 60 * 1000) } },
      },
    });
  }

  it('lista los barrios del municipio y el admin solo consulta el suyo', async () => {
    const vecino = await registrarVecino(1);
    const barrios = await request(app).get('/municipios/caba/barrios').set(con(vecino.token));
    expect(barrios.body.map((b: { id: string }) => b.id)).toEqual(['caballito', 'flores', 'palermo']);
    expect(barrios.body[0]).toMatchObject({ nombre: 'Caballito', comuna: 6, municipioId: 'caba' });

    const otro = await loginAdmin('admin@otro.gob.ar');
    for (const ruta of ['/municipios/caba/barrios', '/barrios/caballito/estadisticas', '/municipios/caba/ranking', '/municipios/caba/evolucion']) {
      const res = await request(app).get(ruta).set(con(otro));
      expect(res.status).toBe(403);
    }
    expect((await request(app).get('/municipios/nada/barrios').set(con(vecino.token))).status).toBe(404);
    expect((await request(app).get('/barrios/nada/estadisticas').set(con(vecino.token))).status).toBe(404);
    expect((await request(app).get('/municipios/caba/ranking')).status).toBe(401);
  });

  it('calcula las estadísticas de un barrio a partir de sus reclamos', async () => {
    const vecino = await registrarVecino(1);
    await crearReclamo(vecino.id, 'Caballito', 'Resuelto', 'Pothole', 2);
    await crearReclamo(vecino.id, 'Caballito', 'Resuelto', 'Outage', 4);
    await crearReclamo(vecino.id, 'Caballito', 'Reportado', 'Outage');
    await crearReclamo(vecino.id, 'Caballito', 'Rechazado');
    await crearReclamo(vecino.id, 'Palermo', 'Reportado');

    const res = await request(app).get('/barrios/caballito/estadisticas').set(con(await loginAdmin()));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      barrioId: 'caballito',
      totalReclamos: 4,
      resueltos: 2,
      porcentajeResolucion: 50,
      tiempoPromedioResolucionDias: 3,
      porCategoria: { Pothole: 2, Outage: 2, Trench: 0 },
      porEstado: { Resuelto: 2, Reportado: 1, Rechazado: 1, EnReparacion: 0 },
    });
    expect(res.body.evolucionUltimos6Meses).toHaveLength(6);
    expect(res.body.evolucionUltimos6Meses.reduce((suma: number, m: { reclamos: number }) => suma + m.reclamos, 0)).toBe(4);
  });

  it('los resueltos por los vecinos cuentan como resueltos', async () => {
    const vecino = await registrarVecino(1);
    await prisma.reclamo.create({
      data: {
        id: 'EXP-TEST-V',
        caseNumber: 'EXP-TEST-V',
        autorId: vecino.id,
        municipioId: 'caba',
        category: 'Pothole',
        severity: 'Low',
        status: 'Resuelto',
        photoUrl: 'http://localhost/uploads/foto.jpg',
        latitude: -34.6,
        longitude: -58.4,
        locationSource: 'Device',
        neighborhood: 'Caballito',
        historial: { create: { status: 'Resuelto', description: 'Resuelto por los vecinos: el problema ya no está' } },
      },
    });
    const res = await request(app).get('/barrios/caballito/estadisticas').set(con(await loginAdmin()));
    expect(res.body).toMatchObject({ totalReclamos: 1, resueltos: 1, porcentajeResolucion: 100 });
  });

  it('un barrio sin reclamos devuelve todo en 0', async () => {
    const vecino = await registrarVecino(1);
    const res = await request(app).get('/barrios/flores/estadisticas').set(con(vecino.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalReclamos: 0, resueltos: 0, porcentajeResolucion: 0, tiempoPromedioResolucionDias: 0 });
    expect(Object.values(res.body.porCategoria).every((n) => n === 0)).toBe(true);
    expect(Object.values(res.body.porEstado).every((n) => n === 0)).toBe(true);
    expect(res.body.evolucionUltimos6Meses.map((m: { reclamos: number }) => m.reclamos)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('ordena el ranking por % de resolución y deja al final a los barrios sin reclamos', async () => {
    const vecino = await registrarVecino(1);
    await crearReclamo(vecino.id, 'Caballito', 'Resuelto', 'Pothole', 1);
    await crearReclamo(vecino.id, 'Palermo', 'Reportado');

    const res = await request(app).get('/municipios/caba/ranking').set(con(await loginAdmin()));
    // Flores empata con Palermo en 0% y va antes por nombre, pero no tiene reclamos.
    expect(res.body).toEqual([
      { barrioId: 'caballito', nombre: 'Caballito', porcentajeResolucion: 100, puesto: 1 },
      { barrioId: 'palermo', nombre: 'Palermo', porcentajeResolucion: 0, puesto: 2 },
      { barrioId: 'flores', nombre: 'Flores', porcentajeResolucion: 0, puesto: 3 },
    ]);
  });

  it('suma la evolución de todos los reclamos del municipio', async () => {
    const vecino = await registrarVecino(1);
    await crearReclamo(vecino.id, 'Caballito', 'Reportado');
    await crearReclamo(vecino.id, 'Fuera del catálogo', 'Reportado');

    const res = await request(app).get('/municipios/caba/evolucion').set(con(await loginAdmin()));
    expect(res.body).toHaveLength(6);
    expect(res.body.reduce((suma: number, m: { reclamos: number }) => suma + m.reclamos, 0)).toBe(2);
    expect(Object.keys(res.body[0]).sort()).toEqual(['mes', 'reclamos']);
  });
});
