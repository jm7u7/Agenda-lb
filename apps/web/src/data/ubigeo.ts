// Catálogo UBIGEO para el autocomplete de distrito. El JSON viene con claves
// COMPACTAS (i/d/p/e/l) para pesar ~115 KB en el bundle; aquí se expande UNA sola
// vez a nivel de módulo (no por render) a la forma tipada + texto de búsqueda
// pre-normalizado. La búsqueda es 100% local: nunca se consulta al backend por tecla.
import { normalizarBusqueda, UBIGEO_EXTRANJERO, UBIGEO_NO_PRECISA } from '@limablue/shared';
import raw from './ubigeo-peru.json';

export interface DistritoUbigeo {
  id: string;           // código INEI 6 dígitos
  distrito: string;
  provincia: string;
  departamento: string;
  esLimaMetro: boolean;
  /** distrito + provincia normalizados (sin tildes, minúsculas) para buscar. */
  busqueda: string;
}

interface FilaCompacta { i: string; d: string; p: string; e: string; l?: number }

export const DISTRITOS: DistritoUbigeo[] = (raw as FilaCompacta[]).map((r) => ({
  id: r.i,
  distrito: r.d,
  provincia: r.p,
  departamento: r.e,
  esLimaMetro: r.l === 1,
  busqueda: normalizarBusqueda(`${r.d} ${r.p}`),
}));

/** Opciones especiales FIJAS: siempre al final del dropdown y como últimos chips. */
export const OPCIONES_ESPECIALES: DistritoUbigeo[] = [
  { id: UBIGEO_EXTRANJERO, distrito: 'Extranjero (reside fuera del Perú)', provincia: '—', departamento: '—', esLimaMetro: false, busqueda: 'extranjero reside fuera del peru' },
  { id: UBIGEO_NO_PRECISA, distrito: 'No precisa', provincia: '—', departamento: '—', esLimaMetro: false, busqueda: 'no precisa' },
];

export const DISTRITOS_POR_ID: Map<string, DistritoUbigeo> = new Map(
  [...DISTRITOS, ...OPCIONES_ESPECIALES].map((d) => [d.id, d]),
);

/** Etiqueta de display: "San Isidro — Lima, Lima" (o el nombre especial). */
export function etiquetaDistrito(id: string | null | undefined): string | null {
  if (!id) return null;
  const d = DISTRITOS_POR_ID.get(id);
  if (!d) return id; // id desconocido: mostrar el código antes que crashear
  return d.provincia === '—' ? d.distrito : `${d.distrito} — ${d.provincia}, ${d.departamento}`;
}

/** Alias comunes (jerga limeña) → código UBIGEO. Match EXACTO sobre lo tipeado. */
export const ALIAS_DISTRITO: Record<string, string> = {
  'surco': '150140',        // Santiago de Surco
  'sjl': '150132',          // San Juan de Lurigancho
  'sjm': '150133',          // San Juan de Miraflores
  'smp': '150135',          // San Martín de Porres
  'vmt': '150143',          // Villa María del Triunfo
  'ves': '150142',          // Villa El Salvador
  'la molina': '150114',
  'chosica': '150118',      // Lurigancho (Chosica)
  'huachipa': '150144',     // Santa María de Huachipa
  'magdalena': '150120',    // Magdalena del Mar
  'agustino': '150111',     // El Agustino
  'callao': '070101',       // Callao (cercado)
};

/**
 * Búsqueda tipográfica local. Reglas:
 *  - < 2 caracteres → sin resultados (salvo alias exacto).
 *  - alias exacto primero; luego startsWith en distrito, includes en distrito,
 *    y por último match en provincia.
 *  - Lima Metropolitana + Callao primero; luego alfabético. Máx `limite`.
 */
export function buscarDistritos(consulta: string, limite = 10): DistritoUbigeo[] {
  const q = normalizarBusqueda(consulta);
  const resultado: DistritoUbigeo[] = [];
  const vistos = new Set<string>();
  const agregar = (d: DistritoUbigeo | undefined) => {
    if (d && !vistos.has(d.id)) { vistos.add(d.id); resultado.push(d); }
  };

  const alias = ALIAS_DISTRITO[q];
  if (alias) agregar(DISTRITOS_POR_ID.get(alias));
  if (q.length < 2) return resultado;

  const porPrioridad = (matches: DistritoUbigeo[]) =>
    matches.sort((a, b) =>
      a.esLimaMetro !== b.esLimaMetro ? (a.esLimaMetro ? -1 : 1) : a.distrito.localeCompare(b.distrito, 'es'));

  const distNorm = (d: DistritoUbigeo) => normalizarBusqueda(d.distrito);
  porPrioridad(DISTRITOS.filter((d) => distNorm(d).startsWith(q))).forEach(agregar);
  if (resultado.length < limite) porPrioridad(DISTRITOS.filter((d) => distNorm(d).includes(q))).forEach(agregar);
  if (resultado.length < limite) porPrioridad(DISTRITOS.filter((d) => d.busqueda.includes(q))).forEach(agregar);

  return resultado.slice(0, limite);
}

/** Fallback de chips frecuentes (si el endpoint falla o aún no hay data). */
export const CHIPS_FALLBACK: string[] = [
  '150131', // San Isidro
  '150117', // Los Olivos
  '150116', // Lince
  '150136', // San Miguel
  '150122', // Miraflores
  '150113', // Jesús María
  '150120', // Magdalena del Mar
  '150121', // Pueblo Libre
];
