import cors from 'cors';
import express from 'express';
import { manejarErrores, rutaInexistente } from './middleware/errores';
import { rutasAuth } from './routes/auth';
import { rutasCatalogo } from './routes/catalogo';
import { carpetaUploads, rutasFotos } from './routes/fotos';
import { rutasReclamos } from './routes/reclamos';

// Separado de server.ts para poder levantar la app en los tests sin abrir un puerto.
export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/uploads', express.static(carpetaUploads));

  app.use('/auth', rutasAuth);
  app.use('/reclamos', rutasReclamos);
  app.use('/fotos', rutasFotos);
  app.use('/', rutasCatalogo);

  app.use(rutaInexistente);
  app.use(manejarErrores);
  return app;
}
