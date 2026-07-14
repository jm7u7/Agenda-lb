// 3.6 — Mide la propagación de Socket.io: conecta un cliente, se suscribe a una sede,
// crea una cita desde la API y cronometra hasta recibir el evento agenda:actualizada.
import { io } from 'socket.io-client';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const estado = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'estado-sim.json')));
const admin = estado.adminToken;
const psql = (q) => execSync(`docker exec limablue_postgres psql -U limablue -d limablue_agenda_simulacion -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

const sedeId = psql("SELECT id FROM sedes WHERE nombre='Lince'");
const [svcId, uniId] = psql("SELECT s.id||'|'||s.\"unidadNegocioId\" FROM servicios s WHERE s.\"duracionMinutos\"=30 AND s.activo LIMIT 1").split('|');

const socket = io('http://localhost:3003', { path: '/socket.io', transports: ['websocket'] });
let conectado = false, recibido = null, tEmit = 0;
socket.on('connect', () => { conectado = true; socket.emit('suscribir:sede', sedeId); });
socket.on('agenda:actualizada', () => { if (recibido === null && tEmit) recibido = Date.now() - tEmit; });

await new Promise(r => setTimeout(r, 1500));
const disp = await (await fetch(`http://localhost:3003/api/v1/disponibilidad?sede=${sedeId}&unidadNegocio=${uniId}&servicio=${svcId}&fecha=2026-08-06`, { headers: { Authorization: `Bearer ${admin}` } })).json();
const slot = (disp.slots || []).find(s => s.disponible);
tEmit = Date.now();
const r = await fetch('http://localhost:3003/api/v1/citas', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin}`, 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({ pacienteId: estado.pacientes[5].id, profesionalId: slot?.profesionalId ?? null, sedeId, unidadNegocioId: uniId, servicioId: svcId, fecha: '2026-08-06', horaInicio: slot?.horaInicio ?? '10:00', canal: 'recepcion' }),
});
await new Promise(res => setTimeout(res, 2500));
const salida = { socketConectado: conectado, citaCreada: r.status, eventoRecibidoEnMs: recibido, propagaEn2s: recibido !== null && recibido < 2000 };
console.log(JSON.stringify(salida));
fs.writeFileSync(path.join(DIR, 'out', 'socket36.json'), JSON.stringify(salida, null, 1));
socket.close();
process.exit(0);
