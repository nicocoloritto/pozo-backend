import { crearApp } from './app';
import { config } from './config';

crearApp().listen(config.puerto, () => {
  console.log(`[pozo] API escuchando en http://localhost:${config.puerto}`);
});
