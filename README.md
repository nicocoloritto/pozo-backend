# Pozo · API

Backend de Pozo (Sprint 2): Express + Prisma + SQLite, en TypeScript. Reemplaza al
almacenamiento local de la app, que vive en el repo [pozo](https://github.com/nicocoloritto/pozo)
(`mobile/services/`), con la misma forma de datos, para que conectarla no obligue a tocar las
pantallas.

## Cómo correrlo

Requiere Node 20.19 o más nuevo. Usa Prisma 7 con el adaptador `better-sqlite3`, que trae binarios
ya compilados para Windows, macOS y Linux.

```bash
git clone https://github.com/nicocoloritto/pozo-backend.git
cd pozo-backend
npm install
cp .env.example .env     # en Windows: copy .env.example .env
npm run setup            # genera el cliente de Prisma, crea la base y carga los datos de prueba
npm run dev              # http://localhost:3000
```

```bash
npm test                 # 66 tests, usan su propia base (test.db)
npm run typecheck
npm run build && npm start
```

`npm run db:reset` borra la base de desarrollo y vuelve a cargar los datos de prueba.

Después de traer cambios del repo (`git pull`), corré `npm run setup` otra vez: regenera el
cliente de Prisma y actualiza la base si el schema cambió. Sin eso, los tests pueden fallar con
errores como "Property 'barrio' does not exist".

Los datos de prueba están en `prisma/data/*.json` y los carga `npm run setup`: las cuentas
(`vecino1@pozo.com`, `vecino2@pozo.com`, `vecino3@pozo.com`, `admin@caba.gob.ar`, contraseña
`123456`) y los 17 reclamos de ejemplo. Los vecinos que figuran como confirmadores en esos
reclamos pero no tienen cuenta de prueba se crean como cuentas inactivas (`@seed.pozo.invalid`).

## Autenticación

`POST /auth/registro` y `POST /auth/login` devuelven `{ token, user }`. El resto de las rutas
piden `Authorization: Bearer <token>` (JWT de 7 días). El rol sale siempre de la base, nunca
del cuerpo del pedido: el autor de un reclamo y quien vota son el usuario del token.

## Rutas

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/registro` | público | Crea una cuenta de vecino con los datos del DNI. Un DNI, una cuenta. |
| `POST /auth/dni-registrado` | público | `{ documentNumber, sex, birthDate }` → `{ registrado }`. `true` solo si coinciden los tres. |
| `POST /auth/login` | público | Inicia sesión. Tras 5 fallos seguidos en una cuenta, o 20 desde una misma IP, responde `429 TOO_MANY_ATTEMPTS` (con `Retry-After`) durante 15 minutos. |
| `GET /auth/me` | autenticado | Usuario de la sesión. |
| `DELETE /auth/cuenta` | vecino | Elimina la cuenta propia: se borran los datos personales y el token deja de servir. Los reclamos quedan, sin nombre. El email y el DNI se pueden volver a registrar. |
| `GET /municipios`, `GET /areas` | autenticado | Catálogos. |
| `GET /municipios/:id/barrios` | autenticado | Barrios del municipio, por comuna y nombre. Un admin solo consulta el suyo. |
| `GET /barrios/:id/estadisticas` | autenticado | Totales, % resuelto, días promedio, por categoría, por estado y últimos 6 meses, calculados con los reclamos del barrio. |
| `GET /municipios/:id/ranking` | autenticado | Barrios ordenados por % de resolución (a igual %, antes los que tienen reclamos). |
| `GET /municipios/:id/evolucion` | autenticado | Reclamos por mes del municipio en los últimos 6 meses. |
| `GET /reclamos` | autenticado | Lista del más nuevo al más viejo. `?mios=1` deja solo los propios. El municipio ve solo los suyos. |
| `GET /reclamos/:id` | autenticado | Detalle con historial, votos y notas. |
| | | Todo reclamo trae además `prioridad`, `desglosePrioridad` (`[{ motivo, puntos }]`) y `vencido`, calculados en cada respuesta (`src/domain/prioridad.ts`). |
| `POST /reclamos` | vecino | Publica un reclamo (queda `Reportado`). Si hay uno abierto de la misma categoría a menos de 50 m responde `409 RECLAMO_CERCANO` con `reclamo` y `distanciaMetros`, salvo con `publicarIgual: true`. |
| `POST /reclamos/:id/confirmaciones` | vecino | "Sigue ahí". Con 3 pasa a `ConfirmadoPorVecinos`. |
| `POST /reclamos/:id/votos` | vecino | `{ "tipo": "sigue" \| "yaNoEsta" }`. Un voto por vecino; repetirlo lo saca. |
| `POST /reclamos/:id/tomar` | municipio | Pasa a `EnviadoAlMunicipio`. Las categorías peligrosas se toman sin confirmaciones. |
| `PUT /reclamos/:id/area` | municipio | `{ "areaId" }` |
| `PUT /reclamos/:id/fecha-estimada` | municipio | `{ "fechaEstimada": "2026-12-01" }` |
| `POST /reclamos/:id/notas` | municipio | `{ "texto" }` (hasta 280 caracteres). |
| `POST /reclamos/:id/reparacion` | municipio | Pasa a `EnReparacion` (necesita área). |
| `POST /reclamos/:id/resolver` | municipio | `{ "fotoResolucion" }` obligatoria. Pasa a `Resuelto`. |
| `POST /reclamos/:id/rechazar` | municipio | `{ "motivo" }` obligatorio. Pasa a `Rechazado`. |
| `POST /fotos` | autenticado | Sube una imagen (`multipart`, campo `foto`, JPG/PNG/WebP/HEIC, hasta 8 MB). Devuelve `{ url }` para usar como `photoUrl` o `fotoResolucion`. |

Los errores salen siempre como `{ "error": { "code", "message" } }`. Los códigos
(`OWN_RECLAMO`, `ALREADY_CONFIRMED`, `INVALID_TRANSITION`, `DNI_TAKEN`…) son los mismos que
ya usan `ReclamoError` y `AuthError` en la app.

## Estructura

```
prisma/schema.prisma   modelo de datos
prisma/seed.ts         carga prisma/data/*.json
src/domain/            reglas de negocio puras (máquina de estados, tipos, errores)
src/services/          casos de uso sobre la base (reclamos, auth) y conversión a JSON
src/routes/            rutas HTTP y validación de entradas con zod
src/middleware/        autenticación y manejo de errores
tests/                 reglas de negocio y API completa (supertest)
```

## Decisiones

- **Las reglas viven en el servidor.** `src/domain/maquinaEstados.ts` es la misma lógica que
  `mobile/lib/maquinaEstados.ts` del repo pozo. Mientras la app no use la API, hay dos copias: si una
  cambia, hay que cambiar la otra.
- **Transacciones.** Confirmar, votar y cada transición corren en una transacción, y la
  restricción única `(reclamo, vecino)` de los votos es la que impide votar dos veces aunque
  lleguen dos pedidos a la vez.
- **SQLite sin enums.** Estados y categorías son texto y se validan en el borde.
- **Aislamiento por municipio.** Un admin no ve ni gestiona reclamos de otro municipio.
- **Prioridad y vencido en el servidor.** La app solo los muestra. No se guardan porque cambian
  con los días.
- **Duplicados y DNI ya registrado.** Las reglas y el porqué están en
  [pozo/docs/decisiones.md](https://github.com/nicocoloritto/pozo/blob/dev/docs/decisiones.md).
  El chequeo de duplicados corre en la misma transacción que el alta y depende de que SQLite
  ejecute las transacciones de a una: con Postgres hay que agregar un lock.

## Pendiente

- Desplegar: hoy corre solo en local. En producción `JWT_SECRET` es obligatorio.
- El límite de intentos vive en la memoria del servidor: se reinicia con él y no sirve si algún
  día corren varias instancias (habría que guardarlo en la base).
