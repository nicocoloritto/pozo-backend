# Pozo · API

Backend de Pozo: Express + Prisma + SQLite, en TypeScript. Guarda los reclamos, las cuentas y las
fotos, y aplica las reglas del circuito de estados. La app móvil vive en el repo
[pozo](https://github.com/nicocoloritto/pozo) y habla con esta API; qué hace cada pantalla y por qué
se decidió cada regla está explicado ahí
([diseño funcional](https://github.com/nicocoloritto/pozo/blob/dev/docs/diseno-funcional.md) y
[decisiones](https://github.com/nicocoloritto/pozo/blob/dev/docs/decisiones.md)).

## Cómo correrlo

Requiere Node 20.19 o más nuevo (lo pide Prisma 7). La base es SQLite con el adaptador
`better-sqlite3`, que trae binarios ya compilados para Windows, macOS y Linux.

```bash
git clone https://github.com/nicocoloritto/pozo-backend.git
cd pozo-backend
npm install
cp .env.example .env     # en Windows: copy .env.example .env
npm run setup            # genera el cliente de Prisma, crea la base y carga los datos de prueba
npm run dev              # http://localhost:3000
```


| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga automática. |
| `npm run db:reset` | Borra la base de desarrollo y vuelve a cargar los datos de prueba. |



### Datos de prueba

Salen de `prisma/data/*.json`: 1 municipio (CABA), sus barrios y áreas, cuatro cuentas y 17
reclamos de ejemplo. Todas las contraseñas son `123456`.

| Email | Rol |
|---|---|
| `vecino1@pozo.com`, `vecino2@pozo.com`, `vecino3@pozo.com` | Vecino |
| `admin@caba.gob.ar` | Municipio (CABA) |

Los vecinos que figuran en los reclamos de ejemplo pero no tienen cuenta de prueba se crean como
cuentas que no pueden iniciar sesión (`@seed.pozo.invalid`), para respetar las claves foráneas.

## Autenticación

`POST /auth/registro` y `POST /auth/login` devuelven `{ token, user }`. El resto de las rutas pide
`Authorization: Bearer <token>` (JWT de 7 días). El rol y el usuario salen siempre de la base, nunca
del cuerpo del pedido: el autor de un reclamo y quien vota son el usuario del token. Si la cuenta se
elimina, el token deja de servir. Los admin no se registran por la API: existen solo como dato de
prueba.

### Límite de intentos

Se cuenta en la memoria del servidor, en ventanas de 15 minutos. Al pasarse responde
`429 TOO_MANY_ATTEMPTS` con el encabezado `Retry-After`.

| Dónde | Límite | Qué cuenta |
|---|---|---|
| `POST /auth/login`, por cuenta | 5 | Fallos (email inexistente o contraseña incorrecta). Un login correcto borra el conteo de esa cuenta. |
| `POST /auth/login`, por IP | 20 | Fallos. |
| `POST /auth/dni-registrado`, por IP | 30 | Todos los pedidos. |

`POST /auth/registro` no tiene límite de intentos. Como el conteo vive en memoria, se reinicia con
el servidor y no sirve si hay varias instancias.

## Rutas

Los errores salen siempre como `{ "error": { "code", "message" } }`. Los códigos
(`OWN_RECLAMO`, `ALREADY_CONFIRMED`, `INVALID_TRANSITION`, `DNI_TAKEN`, `TOO_MANY_ATTEMPTS`…) están en
`src/domain/errores.ts`, junto con su código HTTP, y son los que usa la app. `GET /health` responde
`{ ok: true }` y no pide token.

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/registro` | público | Crea una cuenta de vecino con los datos del DNI. Un DNI, una cuenta (`DNI_TAKEN`); un email, una cuenta (`EMAIL_TAKEN`). |
| `POST /auth/dni-registrado` | público | `{ documentNumber, sex, birthDate }` → `{ registrado }`. `true` solo si coinciden los tres. |
| `POST /auth/login` | público | Inicia sesión. |
| `GET /auth/me` | autenticado | Usuario de la sesión. |
| `DELETE /auth/cuenta` | vecino | Elimina la cuenta propia: se borran los datos personales y el token deja de servir. Los reclamos quedan, sin nombre. El email y el DNI se pueden volver a registrar. |
| `GET /municipios`, `GET /areas` | autenticado | Catálogos. |
| `GET /municipios/:id/barrios` | autenticado | Barrios del municipio, por comuna y nombre. |
| `GET /barrios/:id/estadisticas` | autenticado | Totales, % resuelto, días promedio, por categoría, por estado y últimos 6 meses. |
| `GET /municipios/:id/ranking` | autenticado | Barrios ordenados por % de resolución (a igual %, antes los que tienen reclamos). |
| `GET /municipios/:id/evolucion` | autenticado | Reclamos por mes del municipio en los últimos 6 meses. |
| `GET /reclamos` | autenticado | Del más nuevo al más viejo. `?mios=1` deja solo los propios. `?mapa=1` omite los resueltos o rechazados hace más de 7 días. |
| `GET /reclamos/:id` | autenticado | Detalle con historial, votos y notas. |
| `POST /reclamos` | vecino | Publica un reclamo (queda `Reportado`). |
| `POST /reclamos/:id/confirmaciones` | vecino | "Sigue ahí". |
| `POST /reclamos/:id/votos` | vecino | `{ "tipo": "sigue" \| "yaNoEsta" }`. |
| `POST /reclamos/:id/tomar` | municipio | Pasa a `EnviadoAlMunicipio` y asigna el área de su categoría. |
| `POST /reclamos/:id/reparacion` | municipio | `{ "fechaEstimada" }` obligatoria. Pasa a `EnReparacion`. |
| `PUT /reclamos/:id/fecha-estimada` | municipio | `{ "fechaEstimada": "2026-12-01" }`. Cambia la fecha de un reclamo en reparación. |
| `POST /reclamos/:id/resolver` | municipio | `{ "fotoResolucion" }` obligatoria. Pasa a `Resuelto`. |
| `POST /reclamos/:id/rechazar` | municipio | `{ "motivo", "detalle"? }`. Pasa a `Rechazado`. |
| `POST /reclamos/:id/notas` | municipio | `{ "texto" }`, hasta 280 caracteres. |
| `POST /fotos` | autenticado | Sube una imagen (`multipart`, campo `foto`, JPG, PNG, WebP o HEIC, hasta 8 MB). Devuelve `{ url }` para usar como `photoUrl` o `fotoResolucion`. Las fotos se sirven desde `/uploads`. |

## Reglas de negocio

Las reglas puras están en `src/domain/` y los casos de uso en `src/services/reclamos.ts`.

**Límites de votos.** Están en `src/domain/tipos.ts`:

- `CONFIRMACIONES_NECESARIAS = 1`. Es el valor de la demo: con una sola confirmación de otro vecino
  el reclamo pasa de `Reportado` a `ConfirmadoPorVecinos`, y así el flujo se puede mostrar con pocas
  cuentas. El valor pensado para uso real es **10**. Para cambiarlo hay que editar la constante en
  este archivo y su copia en `pozo/mobile/types/reclamo.ts`; si los valores no coinciden, la app
  muestra un contador distinto del que aplica el servidor.
- `VOTOS_YA_NO_ESTA_NECESARIOS = 10`. Con 10 votos "ya no está" un reclamo abierto pasa solo a
  `Resuelto`, sin foto, y el historial lo deja como "Resuelto por los vecinos".

**Publicar.**

- Exige foto, categoría, severidad y coordenadas válidas (no `0, 0`). Las notas tienen hasta 280
  caracteres. El municipio tiene que existir.
- Si hay un reclamo abierto de la misma categoría a menos de 50 m, de cualquier autor, responde
  `409 RECLAMO_CERCANO` con ese `reclamo` y la `distanciaMetros`. Con `publicarIgual: true` publica
  igual. El chequeo y el alta corren en la misma transacción.
- Le asigna un número de expediente `EXP-AA-NNNNN`, que también es su id.

**Votos.**

- Un voto por vecino y por reclamo: o "sigue" o "yaNoEsta". Votar lo otro cambia el voto; repetir el
  mismo lo saca. Sacar un voto no vuelve el estado atrás. La restricción única `(reclamo, vecino)`
  impide votar dos veces aunque lleguen dos pedidos a la vez.
- El autor no puede votar "sigue" en su propio reclamo (`OWN_RECLAMO`); sí puede votar "yaNoEsta".
  Confirmar dos veces da `ALREADY_CONFIRMED`. Un reclamo cerrado no se vota.
- La confirmación solo cambia el estado si el reclamo sigue en `Reportado`. "Ya no está" resuelve
  desde cualquier estado abierto.

**Gestión del municipio** (`src/domain/maquinaEstados.ts`).

| Acción | Desde | Hacia | Requisitos |
|---|---|---|---|
| Tomar | `ConfirmadoPorVecinos`, o `Reportado` si la categoría es peligrosa | `EnviadoAlMunicipio` | Hay un área para la categoría, que se asigna sola. |
| Pasar a reparación | `EnviadoAlMunicipio` | `EnReparacion` | Fecha estimada, no anterior a hoy. |
| Cambiar fecha | `EnReparacion` | (igual) | La misma validación de fecha. |
| Resolver | `EnReparacion` | `Resuelto` | Foto del "después". |
| Rechazar | cualquier estado abierto | `Rechazado` | Motivo de la lista: "No corresponde al municipio", "No requiere arreglo" o "Duplicado". El motivo va en `motivoRechazoTipo` y el detalle opcional en `motivoRechazo`. |

Son categorías peligrosas poste caído, árbol caído, corte de luz o agua y semáforo. `Resuelto` y
`Rechazado` son finales. Un admin solo ve y gestiona los reclamos de su municipio (`FORBIDDEN` si es
de otro). Cada transición queda en el historial con fecha y autor.

**Prioridad y atrasado.** Todo reclamo trae `prioridad` y `atrasado`, calculados en cada respuesta
(`src/domain/prioridad.ts`) y no guardados. La prioridad suma 10 por cada "sigue ahí", resta 10 por
cada "ya no está" y suma 2 por cada día desde la creación; nunca baja de 0. Un reclamo está atrasado
si tiene fecha estimada, pasó un día completo desde esa fecha y no está cerrado.


