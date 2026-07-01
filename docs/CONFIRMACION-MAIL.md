# Sistema de Confirmación de Citas por Correo

Envía correos de confirmación de citas desde una cuenta de Google (Gmail API + OAuth 2.0).
El paciente puede **confirmar** o **cancelar** su cita desde botones en el correo.

- Disparo **automático** al crear una cita + botón **manual** "Confirmar / Reenviar" por cita.
- La cuenta remitente se configura desde la UI (Herramientas → **Confirmación por Mail**) y se
  guarda en la base de datos (`MailConfig`). Se puede empezar con un **Gmail de prueba** y cambiar
  a **@limablue** después, sin tocar código ni hacer redeploy.

---

## 1. Requisitos e instalación

```bash
# En la raíz del monorepo
npm install                      # instala dependencias (incluye googleapis)

# Aplicar el modelo de datos (MailConfig + campos de confirmación en Cita)
cd apps/api
npx prisma db push               # entorno local / desarrollo
#   — o, para un historial de migraciones versionado (producción):
#   npx prisma migrate dev --name confirmacion_mail      # crea la migración
#   npx prisma migrate deploy                             # la aplica en el servidor
```

Variables de entorno: copia `apps/api/.env.example` → `apps/api/.env` y complétalo (ver §3).

Arranque:

```bash
npm run dev            # levanta API (3002) y web (5180)
```

---

## 2. Crear el proyecto OAuth en Google Cloud (una sola vez)

1. Entra a <https://console.cloud.google.com/> y crea (o elige) un proyecto.
2. **APIs y servicios → Biblioteca** → busca **Gmail API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Externo**.
   - Completa nombre de la app, correo de soporte y datos de contacto.
   - En **Usuarios de prueba**, agrega el Gmail de prueba que vas a autorizar (mientras la app
     esté en modo "Testing", solo esos correos pueden conectarse).
   - Ámbito (scope) necesario: `https://www.googleapis.com/auth/gmail.send`.
4. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - **URI de redireccionamiento autorizados** → agrega EXACTAMENTE el valor de
     `GOOGLE_REDIRECT_URI` (ver §3). En local:
     `http://localhost:3002/api/v1/herramientas/mail-config/oauth/callback`
   - Guarda y copia el **Client ID** y el **Client Secret**.

---

## 3. Variables de entorno (`apps/api/.env`)

| Variable                | Local (desarrollo)                                                            | Producción                                                                 |
|-------------------------|------------------------------------------------------------------------------|----------------------------------------------------------------------------|
| `API_BASE_URL`          | `http://localhost:3002`                                                       | `https://api.limablue.pe` (tu dominio)                                     |
| `APP_BASE_URL`          | `http://localhost:5180`                                                       | `https://agenda.limablue.pe`                                              |
| `GOOGLE_CLIENT_ID`      | _(del paso 2)_                                                                | igual                                                                      |
| `GOOGLE_CLIENT_SECRET`  | _(del paso 2)_                                                                | igual                                                                      |
| `GOOGLE_REDIRECT_URI`   | `http://localhost:3002/api/v1/herramientas/mail-config/oauth/callback`       | `https://api.limablue.pe/api/v1/herramientas/mail-config/oauth/callback`  |
| `CONFIRM_TOKEN_SECRET`  | cualquier cadena larga                                                        | **obligatorio**: secreto largo y aleatorio                                 |
| `MAIL_FROM_ADDRESS`     | tu Gmail de prueba (opcional, se puede setear desde la UI)                    | `citas@limablue.pe`                                                        |
| `MAIL_FROM_NAME`        | `Limablue Podología`                                                          | `Limablue Podología`                                                       |

> **Todos los enlaces del correo** (`Confirmar` / `Cancelar`) se construyen con `API_BASE_URL`, y
> el retorno del OAuth con `APP_BASE_URL`. Nunca hay URLs `localhost` hardcodeadas: al mover el
> proyecto al servidor solo cambias estas variables.

Tras cambiar `GOOGLE_REDIRECT_URI`, **acuérdate de añadir esa misma URL** en las credenciales de
Google Cloud (paso 2.4), o el consentimiento fallará con `redirect_uri_mismatch`.

---

## 4. Autorizar la cuenta (Gmail de prueba)

1. Inicia sesión en la app como **administrador**.
2. Ve a **Herramientas → Confirmación por Mail**.
3. Escribe el **correo remitente** (el mismo Gmail de prueba) y el **nombre a mostrar** → **Guardar**.
4. Pulsa **Conectar cuenta de Google** → se abre el consentimiento → elige la cuenta y acepta.
5. Al volver, el estado cambia a **Cuenta de Google conectada ✓**. El `refresh_token` queda
   guardado en `MailConfig` (base de datos).
6. Escribe un destinatario y pulsa **Enviar prueba** para verificar.

---

## 5. Cambiar a la cuenta `@limablue` (después)

1. Asegúrate de que la cuenta `@limablue` pueda usar la Gmail API (Google Workspace).
2. En **Herramientas → Confirmación por Mail**: cambia el **correo remitente** a la dirección
   `@limablue` y **Guarda**.
3. Pulsa **Reconectar / cambiar cuenta** y autoriza con la cuenta `@limablue`.
4. Listo: el nuevo `refresh_token` reemplaza al anterior. No se pierde ninguna configuración ni
   historial de citas.

> Si la app OAuth sigue en modo "Testing", agrega la cuenta `@limablue` como usuario de prueba,
> o publica la app (modo "In production") en la pantalla de consentimiento.

---

## 6. Migración local → producción (checklist)

1. Copia el proyecto al servidor (todas las rutas de archivo son relativas — no se rompe nada).
2. Crea `apps/api/.env` con los valores de **producción** de la tabla §3.
3. En Google Cloud, añade el `GOOGLE_REDIRECT_URI` de producción a las credenciales OAuth.
4. Aplica el esquema: `npx prisma migrate deploy` (o `npx prisma db push`).
5. Levanta API y web. Entra como admin → **Confirmación por Mail** → **Conectar cuenta de Google**
   con la cuenta definitiva → **Enviar prueba**.

---

## 7. Cómo funciona (resumen técnico)

- **Modelo `MailConfig`**: `fromEmail`, `fromName`, `provider`, `refreshToken` (no se expone por la
  API), `isActive`. Solo una fila activa.
- **Campos en `Cita`**: `estadoConfirmacion` (`pendiente|confirmada|cancelada`), `confirmacionToken`,
  `confirmacionEnviadaEn`, `confirmadaEn`.
- **Tokens** firmados con `CONFIRM_TOKEN_SECRET` (JWT con expiración). El mismo token sirve para
  confirmar y cancelar; la acción la decide el endpoint. Son idempotentes.
- **Endpoints** (prefijo `/api/v1`):
  - `GET/PUT /herramientas/mail-config` — leer/guardar config (admin).
  - `GET /herramientas/mail-config/oauth/url` — URL de consentimiento (admin).
  - `GET /herramientas/mail-config/oauth/callback` — intercambia el code por el refresh token (público).
  - `POST /herramientas/mail-config/test` — envía correo de prueba (admin).
  - `POST /citas/:id/confirmar-mail` — envío/reenvío manual (login).
  - `GET /citas/confirmar?token=` y `GET /citas/cancelar?token=` — públicos, desde el correo.
- **Robustez**: si Gmail falla al crear una cita, el error solo se loguea — la cita se crea igual y
  el correo puede reenviarse manualmente desde el detalle de la cita.
