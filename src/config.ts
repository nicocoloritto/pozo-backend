try {
  process.loadEnvFile();
} catch {
  // Sin .env: se usan las variables del entorno y los valores por defecto de abajo.
}

const esProduccion = process.env.NODE_ENV === 'production';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (esProduccion) throw new Error('Falta JWT_SECRET: en producción es obligatorio.');
  return 'pozo-secreto-solo-para-desarrollo';
}

export const config = {
  esProduccion,
  databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
  puerto: Number(process.env.PORT ?? 3000),
  jwtSecret: jwtSecret(),
  jwtExpira: '7d' as const,
  // Carpeta de las fotos subidas por los vecinos y el municipio.
  carpetaUploads: process.env.UPLOADS_DIR ?? 'uploads',
  fotoMaxBytes: 8 * 1024 * 1024,
};
