// Carga en la base los mismos datos de prueba que usa la app (copia de pozo/mobile/data en prisma/data): municipio,
// áreas, barrios, cuentas de prueba (contraseña 123456) y los 17 reclamos de ejemplo. Es seguro
// correrlo más de una vez: lo que ya existe no se pisa.
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/db';

const DATOS = join(__dirname, 'data');

function leer<T>(archivo: string): T {
  return JSON.parse(readFileSync(join(DATOS, archivo), 'utf8')) as T;
}

type MunicipioSeed = { id: string; nombre: string; sigla: string };
type BarrioSeed = { id: string; nombre: string; comuna: number; municipioId: string; latitude: number; longitude: number };
type AreaSeed = { id: string; nombre: string; categorias: string[]; plazoMaximoDias: number };
type VecinoSeed = {
  id: string;
  firstName: string;
  lastName: string;
  sex: string;
  documentNumber: string;
  birthDate: string;
  email: string;
  password: string;
  neighborhood?: string;
};
type AdminSeed = { id: string; firstName: string; email: string; password: string; municipioId: string };
type ReclamoSeed = {
  id: string;
  caseNumber: string;
  autorId: string;
  municipioId: string;
  category: string;
  severity: string;
  status: string;
  notes?: string;
  photoUrl: string;
  photoKey?: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  locationSource: string;
  address?: string;
  neighborhood?: string;
  comuna?: number;
  confirmaciones: string[];
  votosYaNoEsta?: string[];
  ultimoVoto?: { tipo: string; fecha: string };
  createdAt: string;
  history: { status: string; description: string; createdAt: string; autor?: string }[];
  areaAsignada?: string;
  fechaEstimada?: string;
  notas?: { fecha: string; texto: string; autor: string }[];
  fotoResolucion?: string;
  fotoResolucionKey?: string;
  motivoRechazo?: string;
};

async function main() {
  const municipios = leer<MunicipioSeed[]>('municipios.json');
  const areas = leer<AreaSeed[]>('areas.json');
  const barrios = leer<BarrioSeed[]>('barrios.json');
  const vecinos = leer<VecinoSeed[]>('usuarios-vecinos.json');
  const admins = leer<AdminSeed[]>('usuarios-admin.json');
  const reclamos = leer<ReclamoSeed[]>('reclamos.json');

  for (const m of municipios) {
    await prisma.municipio.upsert({ where: { id: m.id }, create: m, update: {} });
  }
  for (const a of areas) {
    const data = { nombre: a.nombre, categorias: JSON.stringify(a.categorias), plazoMaximoDias: a.plazoMaximoDias };
    await prisma.area.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: {} });
  }

  for (const b of barrios) {
    await prisma.barrio.upsert({ where: { id: b.id }, create: b, update: {} });
  }

  const idsReales = new Set<string>();
  for (const v of vecinos) {
    idsReales.add(v.id);
    const { password, ...resto } = v;
    await prisma.usuario.upsert({
      where: { id: v.id },
      create: {
        ...resto,
        rol: 'vecino',
        email: v.email.toLowerCase(),
        passwordHash: await bcrypt.hash(password, 10),
        dniNormalizado: v.documentNumber.replace(/\D/g, ''),
      },
      update: {},
    });
  }
  for (const a of admins) {
    idsReales.add(a.id);
    const { password, ...resto } = a;
    await prisma.usuario.upsert({
      where: { id: a.id },
      create: { ...resto, rol: 'admin', email: a.email.toLowerCase(), passwordHash: await bcrypt.hash(password, 10) },
      update: {},
    });
  }

  // Los reclamos de ejemplo mencionan vecinos que no tienen cuenta de prueba (los que
  // confirmaron, o autores como "vecino-201"). Para respetar las claves foráneas se crean
  // como cuentas inactivas: con una contraseña que nadie conoce no se puede iniciar sesión.
  const fantasmas = new Set<string>();
  for (const r of reclamos) {
    for (const id of [r.autorId, ...r.confirmaciones, ...(r.votosYaNoEsta ?? [])]) {
      if (!idsReales.has(id)) fantasmas.add(id);
    }
  }
  for (const id of fantasmas) {
    await prisma.usuario.upsert({
      where: { id },
      create: {
        id,
        rol: 'vecino',
        email: `${id}@seed.pozo.invalid`,
        passwordHash: await bcrypt.hash(randomUUID(), 10),
        firstName: 'Vecino',
        lastName: id,
      },
      update: {},
    });
  }

  let creados = 0;
  for (const r of reclamos) {
    if (await prisma.reclamo.findUnique({ where: { id: r.id }, select: { id: true } })) continue;
    await prisma.reclamo.create({
      data: {
        id: r.id,
        caseNumber: r.caseNumber,
        autorId: r.autorId,
        municipioId: r.municipioId,
        category: r.category,
        severity: r.severity,
        status: r.status,
        notes: r.notes,
        photoUrl: r.photoUrl,
        photoKey: r.photoKey,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracyMeters: r.accuracyMeters,
        locationSource: r.locationSource,
        address: r.address,
        neighborhood: r.neighborhood,
        comuna: r.comuna,
        ultimoVotoTipo: r.ultimoVoto?.tipo,
        ultimoVotoFecha: r.ultimoVoto ? new Date(r.ultimoVoto.fecha) : undefined,
        createdAt: new Date(r.createdAt),
        areaAsignada: r.areaAsignada,
        fechaEstimada: r.fechaEstimada ? new Date(r.fechaEstimada) : undefined,
        fotoResolucion: r.fotoResolucion,
        fotoResolucionKey: r.fotoResolucionKey,
        motivoRechazo: r.motivoRechazo,
        historial: {
          create: r.history.map((c) => ({
            status: c.status,
            description: c.description,
            autorId: c.autor,
            createdAt: new Date(c.createdAt),
          })),
        },
        votos: {
          create: [
            ...r.confirmaciones.map((vecinoId) => ({ vecinoId, tipo: 'sigue' })),
            ...(r.votosYaNoEsta ?? []).map((vecinoId) => ({ vecinoId, tipo: 'yaNoEsta' })),
          ],
        },
        notas: {
          create: (r.notas ?? []).map((n) => ({ texto: n.texto, autorId: n.autor, fecha: new Date(n.fecha) })),
        },
      },
    });
    creados++;
  }

  console.log(
    `[seed] ${municipios.length} municipio, ${areas.length} áreas, ${barrios.length} barrios, ${vecinos.length + admins.length} cuentas de prueba, ` +
      `${creados} reclamos nuevos (de ${reclamos.length}).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
