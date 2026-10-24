// Solo los dígitos: el código de barras trae "30111222", pero el mismo DNI puede escribirse
// "30.111.222". Para comparar dos DNI hay que ignorar los puntos y espacios.
export function normalizarNumeroDni(valor: string): string {
  return valor.replace(/\D/g, '');
}
