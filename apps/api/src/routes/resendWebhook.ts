/**
 * Webhook entrante de Resend (eventos de correo).
 *
 * Se monta en `POST /api/v1/webhooks/resend` ANTES del `express.json()` global,
 * con parser de RAW body, porque la firma svix se valida sobre el cuerpo crudo.
 *
 * Flujo: valida la firma → responde 200 RÁPIDO → procesa el evento en background
 * (fire-and-forget). Si la firma no valida (o falta el secreto) → 401 + log.
 */
import { Router, raw } from 'express';
import { Webhook } from 'svix';
import type { WebhookEventPayload } from 'resend';
import { prisma } from '../db';
import { registrarAudit } from '../services/audit';

const router = Router();

// Solo estos 3 eventos nos interesan; el resto se ignora silenciosamente.
type EventoRelevante = 'email.delivered' | 'email.bounced' | 'email.complained';
const ACCION_AUDIT: Record<EventoRelevante, string> = {
  'email.delivered': 'email_entregado',
  'email.bounced': 'email_rebotado',
  'email.complained': 'email_queja',
};

router.post('/', raw({ type: '*/*' }), async (req, res) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[webhook resend] RESEND_WEBHOOK_SECRET ausente — no se puede validar la firma. Evento rechazado (401).');
    return res.status(401).json({ error: 'WEBHOOK_SECRET_AUSENTE' });
  }

  const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  const headers = {
    'svix-id': req.header('svix-id') ?? '',
    'svix-timestamp': req.header('svix-timestamp') ?? '',
    'svix-signature': req.header('svix-signature') ?? '',
  };

  let evento: WebhookEventPayload;
  try {
    evento = new Webhook(secret).verify(payload, headers) as WebhookEventPayload;
  } catch (err) {
    console.warn('[webhook resend] Firma svix inválida — 401.', err instanceof Error ? err.message : err);
    return res.status(401).json({ error: 'FIRMA_INVALIDA' });
  }

  // Responder 200 de inmediato; procesar en background para no hacer esperar a Resend.
  res.status(200).json({ received: true });
  void procesarEventoResend(evento);
});

/** Marca emailInvalido=true (soft) en los pacientes con alguna de estas direcciones. */
async function marcarEmailInvalidoPorDireccion(emails: string[], evento: string): Promise<void> {
  const validos = emails.filter(Boolean);
  if (!validos.length) return;
  const r = await prisma.paciente.updateMany({
    where: { email: { in: validos }, emailInvalido: false, deletedAt: null },
    data: { emailInvalido: true },
  });
  if (r.count > 0) {
    console.warn(`[webhook resend] ${evento}: ${r.count} paciente(s) marcados emailInvalido por dirección (${validos.join(', ')}).`);
  }
}

/** Procesa un evento ya verificado. No lanza: cualquier error se loguea y se traga. */
async function procesarEventoResend(evento: WebhookEventPayload): Promise<void> {
  try {
    if (
      evento.type !== 'email.delivered' &&
      evento.type !== 'email.bounced' &&
      evento.type !== 'email.complained'
    ) {
      return; // opened/clicked/sent/etc. — no nos interesan
    }

    const data = evento.data;
    const resendEmailId = data.email_id;
    const destinatarios = data.to ?? [];
    const esRebote = evento.type === 'email.bounced' || evento.type === 'email.complained';

    // Buscar el correo que originó el evento por su id de Resend → cita → paciente.
    const rec = await prisma.recordatorioCita.findFirst({
      where: { resendEmailId },
      include: { cita: { select: { id: true, sedeId: true, pacienteId: true } } },
      orderBy: { creadoEn: 'desc' },
    });

    if (!rec) {
      // Punto 2: no matchea ningún resendEmailId conocido → log sin romper (posible prueba).
      console.warn(
        `[webhook resend] Evento ${evento.type} sin recordatorio con resendEmailId=${resendEmailId} ` +
        `(destinatario: ${destinatarios.join(', ') || '—'}). Posible envío de prueba — no se registra en historial.`,
      );
      // Aun así, si fue rebote/queja, excluir esa dirección de futuros envíos.
      if (esRebote) await marcarEmailInvalidoPorDireccion(destinatarios, evento.type);
      return;
    }

    // AuditLog inmutable del evento (destinatario, tipo, resendEmailId, timestamp automático).
    await registrarAudit({
      citaId: rec.cita.id,
      accion: ACCION_AUDIT[evento.type as EventoRelevante],
      entidad: 'cita',
      entidadId: rec.cita.id,
      sedeId: rec.cita.sedeId,
      despues: {
        evento: evento.type,
        destinatario: destinatarios.join(', '),
        resendEmailId,
        ...(evento.type === 'email.bounced' ? { bounce: evento.data.bounce } : {}),
      },
    });

    // Rebote/queja → marcar emailInvalido en el paciente (por id y por dirección), sin borrar el email.
    if (esRebote) {
      await prisma.paciente.update({ where: { id: rec.cita.pacienteId }, data: { emailInvalido: true } });
      await marcarEmailInvalidoPorDireccion(destinatarios, evento.type);
      console.warn(`[webhook resend] ${evento.type} para cita ${rec.cita.id} — paciente ${rec.cita.pacienteId} marcado emailInvalido.`);
    }
  } catch (err) {
    console.error('[webhook resend] Error procesando evento (se ignora, ya se respondió 200):', err instanceof Error ? err.message : err);
  }
}

export default router;
