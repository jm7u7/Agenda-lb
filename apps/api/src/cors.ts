// Política de CORS compartida entre Express y Socket.io.
//
// En desarrollo el frontend de Vite puede arrancar en distintos puertos
// (5173/5176/5180…) por `strictPort: false`. Si el origin no coincide, el
// handshake de Socket.io se rechaza y el tiempo real deja de funcionar sin
// dar error visible. Para evitarlo, en dev aceptamos cualquier localhost;
// en producción se exige el origin exacto de CORS_ORIGIN.

const esProduccion = process.env.NODE_ENV === 'production';

// Orígenes explícitos permitidos (admite lista separada por comas en CORS_ORIGIN).
const permitidos = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const esLocalhost = (origin: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

// Firma compatible con `cors` y con socket.io.
export function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // Peticiones sin Origin (curl, same-origin, herramientas internas) → permitir.
  if (!origin) return callback(null, true);
  if (permitidos.includes(origin)) return callback(null, true);
  if (!esProduccion && esLocalhost(origin)) return callback(null, true);
  return callback(null, false);
}
