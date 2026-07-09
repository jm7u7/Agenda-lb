import { AppError } from '../middleware/errorHandler';

// ── Consulta de DNI vía apiperu.dev (basado en giansalex/peru-consult) ─────────
// El token vive SOLO en el servidor (env RENIEC_API_TOKEN) y nunca se expone al
// navegador. El endpoint público `/api/dni` de apiperu.dev devuelve únicamente
// nombres + apellidos (RENIEC básico); fecha de nacimiento / sexo NO vienen en
// ese plan, así que solo normalizamos lo que llega.

const API_URL = process.env.RENIEC_API_URL || 'https://apiperu.dev/api/dni';
const API_TOKEN = process.env.RENIEC_API_TOKEN || '';

export interface DatosReniec {
  numeroDocumento: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombreCompleto: string;
}

// Respuesta cruda de apiperu.dev
interface ApiPeruResp {
  success: boolean;
  message?: string;
  data?: {
    numero: string;
    nombre_completo: string;
    nombres: string;
    apellido_paterno: string;
    apellido_materno: string;
  };
}

export async function consultarDni(dni: string): Promise<DatosReniec> {
  if (!/^\d{8}$/.test(dni)) {
    throw new AppError('DNI inválido: debe tener 8 dígitos', 400, 'DNI_INVALIDO');
  }
  if (!API_TOKEN) {
    throw new AppError('Consulta de DNI no configurada (falta RENIEC_API_TOKEN)', 503, 'RENIEC_NO_CONFIG');
  }

  let resp: Awaited<ReturnType<typeof fetch>>;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12_000);
    resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ dni }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
  } catch {
    throw new AppError('No se pudo contactar el servicio de consulta de DNI', 502, 'RENIEC_UNREACHABLE');
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new AppError('Token de consulta de DNI inválido o sin saldo', 502, 'RENIEC_AUTH');
  }

  let json: ApiPeruResp;
  try {
    json = (await resp.json()) as ApiPeruResp;
  } catch {
    throw new AppError('Respuesta inválida del servicio de consulta de DNI', 502, 'RENIEC_BAD_RESPONSE');
  }

  if (!json.success || !json.data) {
    // DNI no encontrado en RENIEC (o mensaje del proveedor)
    throw new AppError(json.message || 'DNI no encontrado en RENIEC', 404, 'DNI_NO_ENCONTRADO');
  }

  const d = json.data;
  return {
    numeroDocumento: d.numero,
    nombres: d.nombres,
    apellidoPaterno: d.apellido_paterno,
    apellidoMaterno: d.apellido_materno,
    nombreCompleto: d.nombre_completo,
  };
}
