// A menos de esta distancia, un reclamo abierto de la misma categoría se considera "el mismo
// problema": ver pozo/docs/decisiones.md.
export const RADIO_RECLAMO_CERCANO_METROS = 50;

const RADIO_TIERRA_METROS = 6371000;
const METROS_POR_GRADO_LATITUD = 111320;

type Coordenada = { latitude: number; longitude: number };

function aRadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

// Distancia en metros entre dos coordenadas (fórmula de Haversine).
export function distanciaEnMetros(a: Coordenada, b: Coordenada): number {
  const dLat = aRadianes(b.latitude - a.latitude);
  const dLng = aRadianes(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aRadianes(a.latitude)) * Math.cos(aRadianes(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Rectángulo que contiene el círculo de `radioMetros` alrededor de `centro`. Sirve para que la
// base filtre por índice antes de calcular la distancia exacta reclamo por reclamo.
export function rectanguloAlrededor(centro: Coordenada, radioMetros: number) {
  const dLat = radioMetros / METROS_POR_GRADO_LATITUD;
  const dLng = radioMetros / (METROS_POR_GRADO_LATITUD * Math.cos(aRadianes(centro.latitude)));
  return {
    latitude: { gte: centro.latitude - dLat, lte: centro.latitude + dLat },
    longitude: { gte: centro.longitude - dLng, lte: centro.longitude + dLng },
  };
}
