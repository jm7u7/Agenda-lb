// ESPEJO del backend `apps/api/src/utils/datosPaciente.ts` — se usa SOLO para
// armar el texto del tooltip cuando el server no mandó `datosFaltantes` (p. ej.
// en la lista de citas). El ESTADO del switch viene siempre de la columna
// `requiereActualizacionDatos`, calculada server-side; este espejo nunca decide.

export const RE_TELEFONO_VALIDO = /^(9\d{8}|\d{7})$/;

export interface ContactoPaciente {
  email?: string | null;
  telefono?: string | null;
  fechaNacimiento?: string | null;
}

export function datosFaltantesCliente(p: ContactoPaciente): string[] {
  const faltan: string[] = [];
  if (!p.email?.trim()) faltan.push('correo');
  if (!RE_TELEFONO_VALIDO.test((p.telefono ?? '').trim())) faltan.push('teléfono');
  if (!p.fechaNacimiento) faltan.push('fecha de nacimiento');
  return faltan;
}
