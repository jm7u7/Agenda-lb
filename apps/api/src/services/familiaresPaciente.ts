import { prisma } from '../db';

/**
 * "Posibles familiares": pacientes distintos que comparten el mismo número de
 * teléfono. Es común que un paciente registre su teléfono para varios miembros
 * de la familia. Se muestra como cuadro informativo en todo punto de contacto
 * de recepción / contact center.
 */
export interface FamiliarPaciente {
  id: string;
  nombreCompleto: string;
}

const nombreCompleto = (p: { nombres: string; apellidoPaterno: string; apellidoMaterno: string }) =>
  `${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`.replace(/\s+/g, ' ').trim();

// Teléfonos vacíos o claramente "placeholder" no agrupan familia.
function telefonoValido(tel: string | null | undefined): tel is string {
  if (!tel) return false;
  const t = tel.trim();
  if (t.length < 6) return false;
  if (/^0+$/.test(t.replace(/\D/g, ''))) return false;
  return true;
}

/**
 * Para cada paciente pedido, devuelve los OTROS pacientes que comparten su
 * teléfono. 2 consultas, sin N+1. Pensado para listados (agenda, búsqueda).
 */
export async function familiaresDePacientes(
  pacienteIds: (string | null | undefined)[],
): Promise<Map<string, FamiliarPaciente[]>> {
  const map = new Map<string, FamiliarPaciente[]>();
  const ids = [...new Set(pacienteIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return map;

  const base = await prisma.paciente.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, telefono: true },
  });

  const telefonos = [...new Set(base.map((p) => p.telefono).filter(telefonoValido))];
  if (telefonos.length === 0) {
    for (const id of ids) map.set(id, []);
    return map;
  }

  // Todos los pacientes que comparten alguno de esos teléfonos.
  const compartidos = await prisma.paciente.findMany({
    where: { telefono: { in: telefonos }, deletedAt: null },
    select: { id: true, telefono: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true },
    orderBy: [{ apellidoPaterno: 'asc' }, { nombres: 'asc' }],
  });

  // Agrupar por teléfono.
  const porTelefono = new Map<string, { id: string; nombreCompleto: string }[]>();
  for (const c of compartidos) {
    const arr = porTelefono.get(c.telefono) ?? [];
    arr.push({ id: c.id, nombreCompleto: nombreCompleto(c) });
    porTelefono.set(c.telefono, arr);
  }

  for (const p of base) {
    const grupo = telefonoValido(p.telefono) ? porTelefono.get(p.telefono) ?? [] : [];
    // Familiares = los del mismo teléfono, excluyendo al propio paciente.
    map.set(p.id, grupo.filter((f) => f.id !== p.id));
  }
  return map;
}

/** Familiares de un solo paciente. */
export async function familiaresDePaciente(pacienteId: string): Promise<FamiliarPaciente[]> {
  return (await familiaresDePacientes([pacienteId])).get(pacienteId) ?? [];
}
