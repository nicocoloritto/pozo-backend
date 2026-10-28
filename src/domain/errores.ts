export type CodigoError =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'OWN_RECLAMO'
  | 'ALREADY_CONFIRMED'
  | 'INVALID_TRANSITION'
  | 'AREA_REQUIRED'
  | 'FOTO_REQUIRED'
  | 'MOTIVO_REQUIRED'
  | 'NOTA_VACIA'
  | 'RECLAMO_CERCANO'
  | 'EMAIL_TAKEN'
  | 'DNI_TAKEN'
  | 'EMAIL_NOT_FOUND'
  | 'WRONG_PASSWORD';

// Código HTTP de cada error. Los códigos (no los mensajes) son el contrato con la app: son
// los mismos que ya usan ReclamoError y AuthError en pozo/mobile/.
const STATUS: Record<CodigoError, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  EMAIL_NOT_FOUND: 401,
  WRONG_PASSWORD: 401,
  FORBIDDEN: 403,
  OWN_RECLAMO: 403,
  NOT_FOUND: 404,
  ALREADY_CONFIRMED: 409,
  EMAIL_TAKEN: 409,
  DNI_TAKEN: 409,
  INVALID_TRANSITION: 409,
  RECLAMO_CERCANO: 409,
  AREA_REQUIRED: 422,
  FOTO_REQUIRED: 422,
  MOTIVO_REQUIRED: 422,
  NOTA_VACIA: 422,
};

export class AppError extends Error {
  code: CodigoError;
  status: number;
  // Datos extra que viajan junto al código y el mensaje (por ejemplo, el reclamo cercano).
  datos?: Record<string, unknown>;

  constructor(code: CodigoError, message: string, datos?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.datos = datos;
  }
}
