import { prisma } from '../db';
import { WebhookEvent } from '@limablue/shared';
import crypto from 'crypto';

export async function dispararWebhooks(
  evento: WebhookEvent,
  sedeId: string,
  payload: unknown
): Promise<void> {
  const suscripciones = await prisma.webhookSubscription.findMany({
    where: {
      activa: true,
      deletedAt: null,
      eventos: { has: evento },
      OR: [{ sedeId: null }, { sedeId }],
    },
  });

  for (const sub of suscripciones) {
    const body = JSON.stringify({
      event: evento,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    const firma = crypto
      .createHmac('sha256', sub.secret)
      .update(body)
      .digest('hex');

    const log = await prisma.webhookLog.create({
      data: {
        subscriptionId: sub.id,
        evento,
        payload: payload as never,
        intentos: 1,
        exitoso: false,
      },
    });

    // Disparar en background (no bloquear respuesta)
    enviarWebhookConReintentos(sub.url, body, firma, log.id).catch(console.error);
  }
}

async function enviarWebhookConReintentos(
  url: string,
  body: string,
  firma: string,
  logId: string,
  intento: number = 1
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Limablue-Signature': `sha256=${firma}`,
        'X-Limablue-Retry': String(intento),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    await prisma.webhookLog.update({
      where: { id: logId },
      data: {
        statusCode: res.status,
        exitoso: res.ok,
        intentos: intento,
        proximoIntento: null,
      },
    });

    if (!res.ok && intento < 3) {
      const delay = Math.pow(2, intento) * 5000; // 10s, 20s
      const proximoIntento = new Date(Date.now() + delay);
      await prisma.webhookLog.update({
        where: { id: logId },
        data: { proximoIntento },
      });
      setTimeout(() => {
        enviarWebhookConReintentos(url, body, firma, logId, intento + 1);
      }, delay);
    }
  } catch {
    if (intento < 3) {
      const delay = Math.pow(2, intento) * 5000;
      setTimeout(() => {
        enviarWebhookConReintentos(url, body, firma, logId, intento + 1);
      }, delay);
    }
  }
}
