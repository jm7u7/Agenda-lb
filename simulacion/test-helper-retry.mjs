// Prueba DIRECTA y determinista de withDeadlockRetry (compilado desde TS).
// Verifica: (1) reintenta P2034 y termina bien si un intento tardío tiene éxito;
// (2) NO reintenta un error de negocio (AppError) — falla al primer intento;
// (3) NO reintenta P2002 (unicidad) — falla al primer intento;
// (4) agota los 3 intentos ante P2034 persistente y relanza.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Compilar el helper a JS temporal y cargarlo
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execSync(`cd "${ROOT}/apps/api" && npx tsc src/utils/dbRetry.ts --outDir /tmp/m1-helper --module esnext --target es2020 --moduleResolution node --skipLibCheck 2>/dev/null || true`);
// dbRetry importa @prisma/client (Prisma.PrismaClientKnownRequestError). Stub para el test:
import fs from 'node:fs';
let js = fs.readFileSync('/tmp/m1-helper/dbRetry.js', 'utf8');
js = js.replace(/import \{ Prisma \} from '@prisma\/client';/, `
class PrismaClientKnownRequestError extends Error { constructor(msg, code){ super(msg); this.code = code; } }
const Prisma = { PrismaClientKnownRequestError };
export { Prisma as __Prisma };
`);
fs.writeFileSync('/tmp/m1-helper/dbRetry.mjs', js);
const { withDeadlockRetry, esDeadlockTransitorio, __Prisma } = await import('/tmp/m1-helper/dbRetry.mjs');
const { PrismaClientKnownRequestError } = __Prisma;

const P2034 = () => new PrismaClientKnownRequestError('write conflict/deadlock', 'P2034');
const P2002 = () => new PrismaClientKnownRequestError('unique constraint', 'P2002');
class AppError extends Error { constructor(m, s, c){ super(m); this.statusCode = s; this.code = c; } }

const resultados = [];
const check = (nombre, cond) => { resultados.push({ nombre, ok: !!cond }); };

// (1) reintenta P2034: falla 2 veces, éxito al 3ro → devuelve OK, 2 reintentos
let intentos = 0, reintentos = 0;
const r1 = await withDeadlockRetry(async () => { intentos++; if (intentos < 3) throw P2034(); return 'OK'; }, { basesMs: [1, 1, 1], onRetry: () => reintentos++ });
check('(1) reintenta P2034 y termina OK', r1 === 'OK' && intentos === 3 && reintentos === 2);

// (2) NO reintenta AppError de negocio → 1 solo intento
let iNeg = 0;
try { await withDeadlockRetry(async () => { iNeg++; throw new AppError('Slot ocupado', 409, 'SLOT_OCUPADO'); }, { basesMs: [1, 1, 1] }); }
catch (e) { check('(2) NO reintenta negocio (AppError) — 1 intento', iNeg === 1 && e.code === 'SLOT_OCUPADO'); }

// (3) NO reintenta P2002 (unicidad) → 1 solo intento
let iUniq = 0;
try { await withDeadlockRetry(async () => { iUniq++; throw P2002(); }, { basesMs: [1, 1, 1] }); }
catch (e) { check('(3) NO reintenta P2002 (unicidad) — 1 intento', iUniq === 1 && e.code === 'P2002'); }

// (4) P2034 persistente → agota 3 intentos y relanza P2034
let iPers = 0;
try { await withDeadlockRetry(async () => { iPers++; throw P2034(); }, { basesMs: [1, 1, 1] }); }
catch (e) { check('(4) P2034 persistente → 3 intentos y relanza', iPers === 3 && e.code === 'P2034'); }

// (5) esDeadlockTransitorio clasifica bien
check('(5a) P2034 es transitorio', esDeadlockTransitorio(P2034()) === true);
check('(5b) P2002 NO es transitorio', esDeadlockTransitorio(P2002()) === false);
check('(5c) 40P01 crudo es transitorio', esDeadlockTransitorio({ code: '40P01' }) === true);
check('(5d) AppError NO es transitorio', esDeadlockTransitorio(new AppError('x', 400)) === false);

const fallos = resultados.filter(r => !r.ok);
console.log(JSON.stringify({ total: resultados.length, ok: resultados.length - fallos.length, fallos, detalle: resultados }, null, 1));
process.exit(fallos.length ? 1 : 0);
