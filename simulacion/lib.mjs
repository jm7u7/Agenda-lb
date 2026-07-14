// ─── Librería base de la simulación "Agenda Viva" ─────────────────────────────
// Cliente HTTP contra la API REAL (:3003, BD limablue_agenda_simulacion), PRNG
// determinista (seed 2026 → corridas reproducibles), generador de pacientes
// peruanos ZZTEST con emails sandbox de Resend, y colector de métricas/eventos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.SIM_BASE ?? 'http://localhost:3003/api/v1';
export const DIR = path.dirname(fileURLToPath(import.meta.url));
const METRICS_FILE = path.join(DIR, 'out', 'metricas.jsonl');
const EVENTOS_FILE = path.join(DIR, 'out', 'eventos.jsonl');
fs.mkdirSync(path.join(DIR, 'out'), { recursive: true });

// ── PRNG determinista (mulberry32) ────────────────────────────────────────────
export function crearRng(seed = 2026) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const pickN = (rng, arr, n) => {
  const copia = [...arr]; const out = [];
  while (out.length < n && copia.length) out.push(copia.splice(Math.floor(rng() * copia.length), 1)[0]);
  return out;
};

// ── Cliente HTTP con métricas ─────────────────────────────────────────────────
let seqMetrica = 0;
export async function req(metodo, ruta, { token, body, headers = {}, plantilla, quien } = {}) {
  const t0 = Date.now();
  let status = 0, data = null, errorRed = null;
  try {
    const r = await fetch(BASE + ruta, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    status = r.status;
    const txt = await r.text();
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { _raw: txt.slice(0, 300) }; }
  } catch (e) {
    errorRed = String(e?.message ?? e);
  }
  const ms = Date.now() - t0;
  fs.appendFileSync(METRICS_FILE, JSON.stringify({
    i: seqMetrica++, t: t0, metodo, plantilla: plantilla ?? ruta, ms, status, quien: quien ?? null,
    ...(status >= 500 ? { resp500: JSON.stringify(data)?.slice(0, 400) } : {}),
    ...(errorRed ? { errorRed } : {}),
  }) + '\n');
  return { status, data, ms, errorRed };
}

export function evento(tipo, detalle) {
  fs.appendFileSync(EVENTOS_FILE, JSON.stringify({ t: Date.now(), tipo, ...detalle }) + '\n');
}

export async function login(email, password) {
  const { status, data } = await req('POST', '/auth/login', { body: { email, password }, plantilla: '/auth/login' });
  if (status !== 200) throw new Error(`login ${email} → ${status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.token;
}

// ── Datos peruanos deterministas ──────────────────────────────────────────────
export const NOMBRES_F = ['María', 'Rosa', 'Carmen', 'Julia', 'Ana', 'Luz', 'Patricia', 'Gladys', 'Teresa', 'Silvia', 'Norma', 'Elena', 'Juana', '梅Flor', 'Milagros', 'Vanessa', 'Katherine', 'Fiorella', 'Yesenia', 'Roxana', 'Pilar', 'Doris', 'Sonia', 'Maribel', 'Karina'].map(s => s.replace('梅', ''));
export const NOMBRES_M = ['José', 'Juan', 'Luis', 'Carlos', 'Jorge', 'Miguel', 'Pedro', 'Víctor', 'César', 'Manuel', 'Ricardo', 'Fernando', 'Eduardo', 'Roberto', 'Raúl', 'Javier', 'Marco', 'Óscar', 'Walter', 'Hugo', 'Álex', 'Iván', 'Percy', 'Néstor', 'Elmer'];
export const APELLIDOS = ['García', 'Rodríguez', 'Quispe', 'Flores', 'Sánchez', 'Huamán', 'Torres', 'Díaz', 'Vásquez', 'Ramos', 'Rojas', 'Mendoza', 'Castillo', 'Chávez', 'Vargas', 'Gutiérrez', 'Fernández', 'Espinoza', 'Cruz', 'Paredes', 'Aguilar', 'Salazar', 'Mamani', 'Condori', 'Cárdenas', 'León', 'Medina', 'Herrera', 'Campos', 'Vega', 'Palomino', 'Ríos', 'Bravo', 'Ponce', 'Ccahuana'];

// Distritos ponderados: 70% Lima Metro (los más poblados), 25% provincias, 3% No precisa, 2% Extranjero
const LIMA_METRO = ['150132', '150135', '150110', '150103', '150142', '150117', '150143', '150118', '150106', '150125', '150137', '150136', '150140', '150122', '150130', '150131', '150113', '150116', '150120', '150121', '070101', '070106', '150111', '150115', '150128'];
const PROVINCIAS = ['040101', '080101', '130101', '140101', '200101', '210101', '230101', '120114', '060101', '100101', '160101', '250101', '110101', '021801'];
export const PAISES_SIM = ['VE', 'CO', 'CL', 'EC', 'US', 'ES', 'AR', 'BO'];
export function distritoAleatorio(rng) {
  const r = rng();
  if (r < 0.70) return { ubigeoId: pick(rng, LIMA_METRO) };
  if (r < 0.95) return { ubigeoId: pick(rng, PROVINCIAS) };
  if (r < 0.98) return { ubigeoId: '999998' }; // No precisa
  return { ubigeoId: '999999', paisResidencia: pick(rng, PAISES_SIM) }; // Extranjero
}

export function generarPaciente(rng, n) {
  const esF = rng() < 0.62;
  const nombres = pick(rng, esF ? NOMBRES_F : NOMBRES_M) + (rng() < 0.4 ? ' ' + pick(rng, esF ? NOMBRES_F : NOMBRES_M) : '');
  const num = String(n).padStart(3, '0');
  // Emails sandbox Resend: delivered (85%), bounced (10%), complained (5%) — estados reales sin buzones humanos
  const r = rng();
  const email = r < 0.85 ? `delivered+paciente${num}@resend.dev` : r < 0.95 ? `bounced+paciente${num}@resend.dev` : `complained+paciente${num}@resend.dev`;
  const anio = 1950 + Math.floor(rng() * 58);
  return {
    nombres,
    apellidoPaterno: `ZZTEST ${pick(rng, APELLIDOS)}`,
    apellidoMaterno: pick(rng, APELLIDOS),
    tipoDocumento: 'DNI',
    numeroDocumento: String(90000000 + n), // DNI ficticio 8 dígitos, rango no real
    telefono: `+519${String(80000000 + n).slice(0, 8)}`,
    email,
    fechaNacimiento: `${anio}-${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rng() * 28)).padStart(2, '0')}`,
    sexo: esF ? 'femenino' : 'masculino',
    ...distritoAleatorio(rng),
  };
}

// ── Fechas de la simulación: 4 semanas desde el lunes 2026-07-13 ──────────────
export const SEMANAS = 4;
export const FECHA_INICIO = '2026-07-13';
export const FERIADO = '2026-07-28'; // Fiestas Patrias
export function fechasLaborables() {
  const out = [];
  const d = new Date(FECHA_INICIO + 'T12:00:00Z');
  for (let i = 0; i < SEMANAS * 7; i++) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && iso !== FERIADO) out.push(iso); // lun-sáb, sin feriado
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const uuid = () => crypto.randomUUID();
export const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// Pool de concurrencia simple
export async function pool(items, limite, fn) {
  const resultados = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { resultados[i] = await fn(items[i], i); }
      catch (e) { resultados[i] = { error: String(e?.message ?? e) }; }
    }
  });
  await Promise.all(workers);
  return resultados;
}
