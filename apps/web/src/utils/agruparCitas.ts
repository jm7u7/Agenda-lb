import type { CitaResumen } from '../api/citas';

// Resultado del agrupamiento de citas de UNA columna (un profesional) por bloque.
// `individual` = cita suelta, o una mitad de bloque cuya otra mitad la atiende OTRA
// profesional (vive en otra columna). `grupo` = las dos mitades del bloque combinado
// están en esta misma columna (misma profesional) → se pinta una tarjeta partida.
export type ItemAgenda =
  | { tipo: 'individual'; cita: CitaResumen }
  | { tipo: 'grupo'; slotGrupoId: string; principal: CitaResumen; secundario: CitaResumen };

/**
 * FUENTE ÚNICA DE VERDAD del agrupamiento de la agenda. Recibe el array PLANO de
 * citas de una columna (ya filtrado por quien llame) y devuelve los ítems a renderizar:
 * cada bloque combinado presente completo en la columna se colapsa en UN ítem `grupo`
 * (una sola unidad de altura/posición), evitando que el cálculo de layout cuente 2.
 *
 * Tanto el render como cualquier cálculo de altura/ocupación de slot deben consumir
 * ESTA función (no reimplementar el agrupamiento).
 */
export function agruparCitasPorSlot(citas: CitaResumen[]): ItemAgenda[] {
  // Bucket por slotGrupoId para saber cuántas mitades del bloque hay en esta columna.
  const porGrupo = new Map<string, CitaResumen[]>();
  for (const c of citas) {
    if (!c.slotGrupoId) continue;
    const arr = porGrupo.get(c.slotGrupoId) ?? [];
    arr.push(c);
    porGrupo.set(c.slotGrupoId, arr);
  }

  const items: ItemAgenda[] = [];
  for (const c of citas) {
    if (!c.slotGrupoId) {
      items.push({ tipo: 'individual', cita: c });
      continue;
    }
    const mitades = porGrupo.get(c.slotGrupoId)!;
    if (mitades.length >= 2) {
      // Las 2 mitades están en esta columna → emitir el grupo UNA vez (en el PRINCIPAL)
      // y omitir el SECUNDARIO para no duplicar.
      if (c.slotRol === 'PRINCIPAL') {
        const principal = mitades.find((m) => m.slotRol === 'PRINCIPAL') ?? c;
        const secundario = mitades.find((m) => m.slotRol === 'SECUNDARIO') ?? mitades.find((m) => m.id !== principal.id)!;
        items.push({ tipo: 'grupo', slotGrupoId: c.slotGrupoId, principal, secundario });
      }
    } else {
      // Solo una mitad en esta columna (la otra la atiende otra profesional) → individual.
      items.push({ tipo: 'individual', cita: c });
    }
  }
  return items;
}
