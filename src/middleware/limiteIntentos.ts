import { AppError } from '../domain/errores';

// Límite de intentos en memoria, sin dependencias. Sirve para una sola instancia del servidor:
// si algún día corren varias, el conteo tendría que vivir en la base o en un almacén
// compartido. Se reinicia cuando el servidor se reinicia.
export class LimiteDeIntentos {
  private readonly registros = new Map<string, { cantidad: number; desde: number }>();

  constructor(
    private readonly maximo: number,
    private readonly ventanaMs: number,
    private readonly ahora: () => number = Date.now
  ) {}

  // Segundos que faltan para poder volver a intentar; 0 si todavía no llegó al máximo.
  segundosRestantes(clave: string): number {
    const registro = this.vigente(clave);
    if (!registro || registro.cantidad < this.maximo) return 0;
    return Math.max(1, Math.ceil((registro.desde + this.ventanaMs - this.ahora()) / 1000));
  }

  sumar(clave: string): void {
    const registro = this.vigente(clave);
    if (registro) registro.cantidad++;
    else this.registros.set(clave, { cantidad: 1, desde: this.ahora() });
  }

  olvidar(clave: string): void {
    this.registros.delete(clave);
  }

  reiniciar(): void {
    this.registros.clear();
  }

  // Un registro cuya ventana ya pasó se descarta: así el mapa no crece sin límite.
  private vigente(clave: string) {
    const registro = this.registros.get(clave);
    if (registro && this.ahora() - registro.desde >= this.ventanaMs) {
      this.registros.delete(clave);
      return undefined;
    }
    return registro;
  }
}

const QUINCE_MINUTOS_MS = 15 * 60 * 1000;

// Fallos de login: 5 por cuenta (frena adivinar una contraseña) y 20 por IP (frena probar muchos
// emails desde un mismo lugar). Un login correcto borra el conteo de esa cuenta.
export const fallosLoginPorCuenta = new LimiteDeIntentos(5, QUINCE_MINUTOS_MS);
export const fallosLoginPorIp = new LimiteDeIntentos(20, QUINCE_MINUTOS_MS);
// Consultas de "¿este DNI ya tiene cuenta?": cualquier pedido cuenta, no solo los fallidos.
export const consultasDniPorIp = new LimiteDeIntentos(30, QUINCE_MINUTOS_MS);

export function reiniciarLimites(): void {
  fallosLoginPorCuenta.reiniciar();
  fallosLoginPorIp.reiniciar();
  consultasDniPorIp.reiniciar();
}

export function exigirSinBloqueo(limite: LimiteDeIntentos, clave: string): void {
  const segundos = limite.segundosRestantes(clave);
  if (segundos === 0) return;
  const minutos = Math.ceil(segundos / 60);
  const error = new AppError(
    'TOO_MANY_ATTEMPTS',
    `Demasiados intentos. Probá de nuevo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`
  );
  error.reintentarEnSegundos = segundos;
  throw error;
}
