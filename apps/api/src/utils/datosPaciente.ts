// Regla ÚNICA de "datos completos" de un paciente (bandera requiereActualizacionDatos).
// La comparten el import Genexis (scripts/import-genexis.ts) y los endpoints de
// pacientes: la bandera SIEMPRE se calcula server-side con esta función — nunca
// se acepta del cliente.

// Teléfono "válido": celular de 9 dígitos empezando en 9, o fijo de 7 dígitos.
// Texto como "NO DESEA DAR" cuenta como faltante para la alerta, pero NO se
// borra del campo (el dato crudo se conserva).
export const RE_TELEFONO_VALIDO = /^(9\d{8}|\d{7})$/;

export interface DatosContactoPaciente {
  email: string | null;
  telefono: string;
  fechaNacimiento: Date | null;
}

/** Campos que faltan (para el tooltip "Falta: correo, fecha de nacimiento"). */
export function datosFaltantes(p: DatosContactoPaciente): string[] {
  const faltan: string[] = [];
  if (!p.email?.trim()) faltan.push('correo');
  if (!RE_TELEFONO_VALIDO.test(p.telefono.trim())) faltan.push('teléfono');
  if (!p.fechaNacimiento) faltan.push('fecha de nacimiento');
  return faltan;
}

/** true si falta cualquiera de: correo, teléfono válido, fecha de nacimiento. */
export function faltanDatosPaciente(p: DatosContactoPaciente): boolean {
  return datosFaltantes(p).length > 0;
}
