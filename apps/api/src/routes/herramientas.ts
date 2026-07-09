import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { enviarEmail, resendConfigurado, estadoDominio, DOMINIO_ENVIO } from '../services/emailService';
import { renderPlantillaPrueba } from '../services/emailTemplates';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Config pública del remitente. NUNCA expone la API key de Resend ni el refreshToken.
async function configPublica() {
  const cfg = await prisma.mailConfig.findFirst({ where: { isActive: true }, orderBy: { actualizadoEn: 'desc' } });
  return {
    fromEmail: cfg?.fromEmail ?? process.env.MAIL_FROM_ADDRESS ?? '',
    fromName: cfg?.fromName ?? process.env.MAIL_FROM_NAME ?? 'Limablue Podología',
    provider: cfg?.provider ?? 'resend',
    isActive: cfg?.isActive ?? false,
    // "Conectado" con Resend = hay API key en el entorno. El estado del dominio
    // verificado (Resend GET domains) lo expone el endpoint de la CAPA 4.
    connected: resendConfigurado(),
    actualizadoEn: cfg?.actualizadoEn ?? null,
  };
}

// ─── GET /herramientas/mail-config ────────────────────────────────────────────
router.get('/mail-config', requireAuth, requireRol('admin'), async (_req, res) => {
  res.json(await configPublica());
});

// ─── PUT /herramientas/mail-config ────────────────────────────────────────────
// Guarda correo y nombre del remitente (se usan como From en Resend).
router.put('/mail-config', requireAuth, requireRol('admin'), async (req, res) => {
  const { fromEmail, fromName } = z
    .object({
      fromEmail: z
        .string()
        .email('Correo inválido')
        .refine(
          (e) => e.trim().toLowerCase().endsWith(`@${DOMINIO_ENVIO}`),
          `El correo remitente debe ser del dominio @${DOMINIO_ENVIO} (el único verificado en Resend).`,
        ),
      fromName: z.string().min(1).max(120),
    })
    .parse(req.body);

  const existente = await prisma.mailConfig.findFirst({ where: { isActive: true } });
  if (existente) {
    await prisma.mailConfig.update({ where: { id: existente.id }, data: { fromEmail, fromName } });
  } else {
    await prisma.mailConfig.create({ data: { fromEmail, fromName, isActive: true } });
  }

  res.json(await configPublica());
});

// ─── GET /herramientas/mail-config/dominio ────────────────────────────────────
// Estado del dominio de envío en Resend (verified/pending/failed) + región.
// Consulta Resend desde el backend con la API key del entorno; NUNCA la expone.
// Respuesta cacheada 5 min en memoria (ver emailService.estadoDominio).
router.get('/mail-config/dominio', requireAuth, requireRol('admin'), async (_req, res) => {
  if (!resendConfigurado()) {
    return res.json({ configurado: false, dominio: DOMINIO_ENVIO, estado: null, region: null });
  }
  try {
    const info = await estadoDominio();
    res.json({ configurado: true, ...info });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error consultando Resend';
    throw new AppError(`No se pudo consultar el estado del dominio en Resend: ${msg}`, 502, 'DOMINIO_ESTADO_FALLIDO');
  }
});

// ─── GET /herramientas/mail-config/oauth/url ──────────────────────────────────
// DEPRECADO - migrado a Resend [2026-07-07]. El flujo OAuth de Gmail ya no se usa
// (Resend usa una API key estática del entorno). Se conserva la ruta para no romper
// clientes viejos: responde 410 con un mensaje claro.
router.get('/mail-config/oauth/url', requireAuth, requireRol('admin'), () => {
  throw new AppError(
    'La conexión con Google (Gmail) fue reemplazada por Resend; ya no se conecta ninguna cuenta.',
    410,
    'GMAIL_DEPRECADO',
  );
});

// ─── GET /herramientas/mail-config/oauth/callback ─────────────────────────────
// DEPRECADO - migrado a Resend [2026-07-07]. Página inerte por si Google aún redirige.
router.get('/mail-config/oauth/callback', (_req, res) => {
  res.status(410).send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><title>Limablue · Correo</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#eef2f7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="background:#fff;border-radius:16px;padding:40px;text-align:center;max-width:380px;box-shadow:0 1px 6px rgba(15,23,42,.1);">
    <div style="font-size:40px;margin-bottom:8px;">✉️</div>
    <h1 style="color:#0f172a;font-size:18px;margin:0 0 8px;">Ya no es necesario conectar Gmail</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0;">El envío de correos ahora usa Resend. Puedes cerrar esta ventana.</p>
  </div>
</body></html>`);
});

// ─── POST /herramientas/mail-config/test ──────────────────────────────────────
// Envía un correo de prueba vía Resend al destinatario indicado por el admin.
router.post('/mail-config/test', requireAuth, requireRol('admin'), async (req, res) => {
  const { to } = z.object({ to: z.string().email('Correo de destino inválido') }).parse(req.body);

  if (!resendConfigurado()) {
    throw new AppError(
      'RESEND_API_KEY ausente — envío omitido. Configura la API key de Resend en el entorno del servidor.',
      400,
      'RESEND_NO_CONFIGURADO',
    );
  }

  try {
    const enviado = await enviarEmail({
      to,
      subject: 'Correo de prueba · Limablue Agenda',
      html: renderPlantillaPrueba(),
    });
    res.json({ ok: true, to, id: enviado?.id ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al enviar';
    throw new AppError(`No se pudo enviar el correo de prueba: ${msg}`, 502, 'ENVIO_FALLIDO');
  }
});

export default router;
