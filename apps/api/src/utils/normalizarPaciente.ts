/**
 * Normalización de datos de paciente en el BORDE (antes de tocar la DB).
 * Evita mala transcripción: colapsa espacios, capitaliza nombres respetando
 * tildes/ñ, pasa email a minúsculas y limpia el documento. Es pura y testeable.
 */

export function tituloNombre(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('es-PE')
    .replace(/(^|[\s'-])([a-záéíóúñü])/g, (_m, sep, ch) => sep + ch.toLocaleUpperCase('es-PE'));
}

export interface CamposPaciente {
  nombres?: string;
  apellidoPaterno?: string;
  apellidoMaterno?: string;
  numeroDocumento?: string;
  telefono?: string;
  email?: string;
}

export function normalizarPaciente<T extends CamposPaciente>(d: T): T {
  return {
    ...d,
    ...(d.nombres !== undefined ? { nombres: tituloNombre(d.nombres) } : {}),
    ...(d.apellidoPaterno !== undefined ? { apellidoPaterno: tituloNombre(d.apellidoPaterno) } : {}),
    ...(d.apellidoMaterno !== undefined ? { apellidoMaterno: tituloNombre(d.apellidoMaterno) } : {}),
    ...(d.numeroDocumento !== undefined ? { numeroDocumento: d.numeroDocumento.trim().replace(/\s+/g, '') } : {}),
    ...(d.telefono !== undefined ? { telefono: d.telefono.trim().replace(/\s+/g, ' ') } : {}),
    ...(d.email !== undefined && d.email ? { email: d.email.trim().toLowerCase() } : {}),
  };
}
