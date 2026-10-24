// Se ejecuta antes de cada archivo de tests, antes de importar la app: las variables tienen
// que estar puestas cuando config.ts y Prisma las leen.
process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_SECRET = 'secreto-de-tests';
process.env.UPLOADS_DIR = 'uploads-test';
