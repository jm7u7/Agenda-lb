import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, requireRol } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import {
  generarUrlConsentimiento,
  intercambiarCodePorTokens,
  estaConectado,
  enviarCorreo,
  renderPlantillaPrueba,
} from '../services/mailService';

const router = Router();

// URL del frontend para redirigir tras el callback de OAuth (portátil vía .env).
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:5180').replace(/\/$/, '');

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Devuelve la config activa sin exponer NUNCA el refreshToken al cliente.
async function configPublica() {
  const cfg = await prisma.mailConfig.findFirst({ where: { isActive: true }, orderBy: { actualizadoEn: 'desc' } });
  return {
    fromEmail: cfg?.fromEmail ?? process.env.MAIL_FROM_ADDRESS ?? '',
    fromName: cfg?.fromName ?? process.env.MAIL_FROM_NAME ?? 'Limablue Podología',
    provider: cfg?.provider ?? 'gmail',
    isActive: cfg?.isActive ?? false,
    connected: await estaConectado(),
    actualizadoEn: cfg?.actualizadoEn ?? null,
  };
}

// ─── GET /herramientas/mail-config ────────────────────────────────────────────
router.get('/mail-config', requireAuth, requireRol('admin'), async (_req, res) => {
  res.json(await configPublica());
});

// ─── PUT /herramientas/mail-config ────────────────────────────────────────────
// Guarda correo y nombre del remitente. No toca el refreshToken.
router.put('/mail-config', requireAuth, requireRol('admin'), async (req, res) => {
  const { fromEmail, fromName } = z
    .object({
      fromEmail: z.string().email('Correo inválido'),
      fromName: z.string().min(1).max(120),
    })
    .parse(req.body);

  const existente = await prisma.mailConfig.findFirst({ where: { isActive: true } });
  if (existente) {
    await prisma.mailConfig.update({
      where: { id: existente.id },
      data: { fromEmail, fromName },
    });
  } else {
    await prisma.mailConfig.create({
      data: { fromEmail, fromName, isActive: true },
    });
  }

  res.json(await configPublica());
});

// ─── GET /herramientas/mail-config/oauth/url ──────────────────────────────────
// Devuelve la URL de consentimiento de Google. El frontend la abre en una pestaña.
router.get('/mail-config/oauth/url', requireAuth, requireRol('admin'), (_req, res) => {
  try {
    const url = generarUrlConsentimiento();
    res.json({ url });
  } catch (err) {
    // Caso típico: faltan GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI en el .env.
    const msg = err instanceof Error ? err.message : 'No se pudo generar la URL de Google';
    throw new AppError(msg, 400, 'OAUTH_NO_CONFIGURADO');
  }
});

// ─── GET /herramientas/mail-config/oauth/callback ─────────────────────────────
// Google redirige aquí tras el consentimiento. PÚBLICO (sin JWT) porque lo invoca
// el navegador desde Google. Intercambia el code por el refresh token y lo guarda.
router.get('/mail-config/oauth/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const error = req.query.error as string | undefined;

  // Página de cierre que avisa al frontend y se cierra (si es popup) o redirige.
  const paginaResultado = (ok: boolean, mensaje: string) => `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><title>Limablue · Conexión de correo</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#eef2f7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="background:#fff;border-radius:16px;padding:40px;text-align:center;max-width:380px;box-shadow:0 1px 6px rgba(15,23,42,.1);">
    <div style="font-size:48px;margin-bottom:12px;">${ok ? '✅' : '⚠️'}</div>
    <h1 style="color:#0f172a;font-size:20px;margin:0 0 8px;">${ok ? 'Cuenta conectada' : 'No se pudo conectar'}</h1>
    <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 20px;">${mensaje}</p>
    <a href="${APP_BASE_URL}/herramientas/confirmacion-mail?conectado=${ok ? '1' : '0'}"
       style="display:inline-block;background:#1e40af;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;">
       Volver a Limablue Agenda
    </a>
  </div>
  <script>
    // Si se abrió como popup, avisamos a la ventana principal y cerramos.
    try { if (window.opener) { window.opener.postMessage({ tipo: 'limablue-oauth', ok: ${ok} }, '*'); setTimeout(function(){ window.close(); }, 1200); } } catch (e) {}
  </script>
</body></html>`;

  if (error) {
    res.status(400).send(paginaResultado(false, 'Se canceló la autorización en Google.'));
    return;
  }
  if (!code) {
    res.status(400).send(paginaResultado(false, 'Google no devolvió un código de autorización.'));
    return;
  }

  try {
    const { refreshToken, email } = await intercambiarCodePorTokens(code);

    // Guardamos el refresh token en la config activa (o creamos una).
    const existente = await prisma.mailConfig.findFirst({ where: { isActive: true } });
    if (existente) {
      await prisma.mailConfig.update({
        where: { id: existente.id },
        data: { refreshToken, ...(email ? { fromEmail: existente.fromEmail || email } : {}) },
      });
    } else {
      await prisma.mailConfig.create({
        data: {
          fromEmail: email || process.env.MAIL_FROM_ADDRESS || '',
          fromName: process.env.MAIL_FROM_NAME || 'Limablue Podología',
          refreshToken,
          isActive: true,
        },
      });
    }

    res.send(paginaResultado(true, `La cuenta ${email ?? ''} quedó autorizada para enviar confirmaciones.`));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).send(paginaResultado(false, msg));
  }
});

// ─── POST /herramientas/mail-config/test ──────────────────────────────────────
// Envía un correo de prueba al destinatario indicado por el admin.
router.post('/mail-config/test', requireAuth, requireRol('admin'), async (req, res) => {
  const { to } = z.object({ to: z.string().email('Correo de destino inválido') }).parse(req.body);

  if (!(await estaConectado())) {
    throw new AppError('La cuenta de Google no está conectada. Conéctala antes de enviar la prueba.', 400, 'NO_CONECTADO');
  }

  try {
    await enviarCorreo({
      to,
      subject: 'Correo de prueba · Limablue Agenda',
      html: renderPlantillaPrueba(),
    });
    res.json({ ok: true, to });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al enviar';
    throw new AppError(`No se pudo enviar el correo de prueba: ${msg}`, 502, 'ENVIO_FALLIDO');
  }
});

export default router;
