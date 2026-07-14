// Cliente HTTP contra la API de e2e (:3003). Se usa para SEMBRAR datos por test
// (pacientes, citas) de forma rápida y determinista, sin pasar por la UI.
const BASE = process.env.E2E_API || 'http://localhost:3003/api/v1';
const uuid = () => (globalThis.crypto as Crypto).randomUUID();

export async function api<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; key?: string } = {}): Promise<{ status: number; data: T }> {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.key ? { 'Idempotency-Key': opts.key } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null;
  try { data = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, data };
}

export async function loginToken(email = 'admin@limablue.pe', password = 'Admin1234!'): Promise<string> {
  const r = await api<{ token: string }>('POST', '/auth/login', { body: { email, password } });
  if (!r.data?.token) throw new Error(`login e2e falló: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

export interface Catalogo {
  token: string;
  sede: { id: string; nombre: string };
  unidad: { id: string; nombre: string };
  servicio30: { id: string; duracionMinutos: number };
}

/** Catálogo determinista para los tests: sede + unidad Podología + un servicio de 30 min. */
export async function catalogo(): Promise<Catalogo> {
  const token = await loginToken();
  const sedes = (await api<any[]>('GET', '/sedes', { token })).data;
  const sede = sedes.find((s) => s.nombre === 'Lince') ?? sedes[0];
  const unidades = (await api<any[]>('GET', '/analytics/unidades', { token })).data;
  const unidad = unidades.find((u: any) => u.nombre.toLowerCase().includes('podolog')) ?? unidades[0];
  const servicios = (await api<any[]>('GET', '/servicios?activo=true', { token })).data;
  const servicio30 = servicios.find((s: any) => s.unidadNegocioId === unidad.id && s.duracionMinutos === 30 && !(s.subcategorias?.length));
  if (!servicio30) throw new Error('no hay servicio de 30 min sin subcategorías en la unidad de podología');
  return { token, sede: { id: sede.id, nombre: sede.nombre }, unidad: { id: unidad.id, nombre: unidad.nombre }, servicio30 };
}

/** Crea un paciente ZZTEST (con distrito válido) y devuelve su id + datos. */
export async function crearPaciente(token: string, over: Partial<{ nombres: string; apellidoPaterno: string; numeroDocumento: string }> = {}) {
  const doc = over.numeroDocumento ?? String(70000000 + Math.floor(Math.random() * 9000000));
  const body = {
    nombres: over.nombres ?? 'E2E',
    apellidoPaterno: over.apellidoPaterno ?? 'ZZTEST',
    apellidoMaterno: 'Prueba',
    tipoDocumento: 'DNI',
    numeroDocumento: doc,
    telefono: '+51900' + doc.slice(0, 6),
    ubigeoId: '150131', // distrito válido (Lince) del seed de ubigeo
  };
  const r = await api<any>('POST', '/pacientes', { token, key: uuid(), body });
  if (!r.data?.id) throw new Error(`crearPaciente falló: ${r.status} ${JSON.stringify(r.data)}`);
  return { id: r.data.id as string, ...body };
}

/** Primer slot libre (con profesional) para una fecha, en el catálogo dado. */
export async function primerSlotLibre(cat: Catalogo, fecha: string): Promise<{ profesionalId: string; horaInicio: string }> {
  const disp = await api<any>('GET', `/disponibilidad?sede=${cat.sede.id}&unidadNegocio=${cat.unidad.id}&servicio=${cat.servicio30.id}&fecha=${fecha}`, { token: cat.token });
  const slot = (disp.data?.slots ?? []).find((s: any) => s.disponible && s.profesionalId);
  if (!slot) throw new Error(`sin slot libre para ${fecha}`);
  return { profesionalId: slot.profesionalId, horaInicio: slot.horaInicio };
}

/**
 * Fecha (yyyy-MM-dd) RELATIVA a hoy con disponibilidad real: escanea hacia adelante desde
 * mañana hasta hallar un día con al menos un slot libre + su profesional/hora. Evita fechas
 * hardcodeadas que envejecen y días sin turnos (fines de semana, sedes cerradas).
 */
export async function fechaConSlot(cat: Catalogo, maxDias = 21): Promise<{ fecha: string; profesionalId: string; horaInicio: string }> {
  const base = new Date();
  for (let i = 1; i <= maxDias; i++) {
    const d = new Date(base.getTime() + i * 86_400_000);
    const fecha = d.toISOString().slice(0, 10);
    try {
      const s = await primerSlotLibre(cat, fecha);
      return { fecha, ...s };
    } catch { /* sin slot ese día, seguir */ }
  }
  throw new Error('no se halló fecha con disponibilidad en el rango');
}

/** Un profesional con ≥2 slots libres el mismo día (origen + destino para el drag). */
export async function dosSlotsMismoProf(cat: Catalogo, fecha: string): Promise<{ profesionalId: string; horaX: string; horaY: string }> {
  const disp = await api<any>('GET', `/disponibilidad?sede=${cat.sede.id}&unidadNegocio=${cat.unidad.id}&servicio=${cat.servicio30.id}&fecha=${fecha}`, { token: cat.token });
  const porProf = new Map<string, string[]>();
  for (const s of (disp.data?.slots ?? [])) {
    if (!s.disponible || !s.profesionalId) continue;
    const arr = porProf.get(s.profesionalId) ?? [];
    arr.push(s.horaInicio);
    porProf.set(s.profesionalId, arr);
  }
  for (const [profesionalId, horas] of porProf) {
    if (horas.length >= 2) {
      horas.sort();
      // Destino algo separado del origen (no el slot inmediatamente adyacente) para un drop nítido.
      return { profesionalId, horaX: horas[0], horaY: horas[Math.min(3, horas.length - 1)] };
    }
  }
  throw new Error(`ningún profesional con ≥2 slots libres el ${fecha}`);
}

/** Crea una cita vía API (para sembrar el estado que el test necesita). */
export async function crearCita(cat: Catalogo, pacienteId: string, profesionalId: string, fecha: string, horaInicio: string) {
  const body = {
    pacienteId, profesionalId, sedeId: cat.sede.id, unidadNegocioId: cat.unidad.id,
    servicioId: cat.servicio30.id, fecha, horaInicio, canal: 'recepcion',
  };
  const r = await api<any>('POST', '/citas', { token: cat.token, key: uuid(), body });
  if (!r.data?.id) throw new Error(`crearCita falló: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
