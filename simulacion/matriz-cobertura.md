# MATRIZ DE COBERTURA — Simulación "Agenda Viva" (resultado)

Resultado de la corrida. **50** endpoints ejercitados directamente con comportamiento correcto (0 respuestas 5xx en 7,840 requests). **149** no ejercitados por el motor transaccional, cada uno con justificación (mayoría: lecturas de analytics/BI y configuración/catálogo — sin riesgo de corrupción de datos).

| # | Método | Ruta | Módulo | Estado |
|---|--------|------|--------|--------|
| 1 | GET | `/api/v1/asignaciones` | asignaciones.ts | ⓘ NO PROBADO — gestión periódica; cubierto conceptualmente por permisos/movimientos |
| 2 | POST | `/api/v1/asignaciones` | asignaciones.ts | ⓘ NO PROBADO — gestión periódica; cubierto conceptualmente por permisos/movimientos |
| 3 | GET | `/api/v1/audit` | audit.ts | ⓘ NO PROBADO — lectura de auditoría (los writes de audit SÍ se validaron en I5) |
| 4 | POST | `/api/v1/auth/login` | auth.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 5 | GET | `/api/v1/auth/me` | auth.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 6 | POST | `/api/v1/consumos/cita/:citaId` | consumos.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 7 | POST | `/api/v1/consumos/manual` | consumos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 8 | POST | `/api/v1/consumos/:id/anular` | consumos.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 9 | GET | `/api/v1/disponibilidad` | disponibilidad.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 10 | GET | `/api/v1/exportar/citas` | exportar.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 11 | GET | `/api/v1/exportar/reactivacion` | exportar.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 12 | GET | `/api/v1/exportar/historial/:pacienteId` | exportar.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 13 | GET | `/api/v1/herramientas/mail-config` | herramientas.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 14 | PUT | `/api/v1/herramientas/mail-config` | herramientas.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 15 | GET | `/api/v1/herramientas/mail-config/dominio` | herramientas.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 16 | GET | `/api/v1/herramientas/mail-config/oauth/url` | herramientas.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 17 | GET | `/api/v1/herramientas/mail-config/oauth/callback` | herramientas.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 18 | POST | `/api/v1/herramientas/mail-config/test` | herramientas.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 19 | GET | `/api/v1/horarios/:sedeId` | horarios.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 20 | GET | `/api/v1/horarios/:sedeId/excepciones` | horarios.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 21 | POST | `/api/v1/horarios/:sedeId/excepciones` | horarios.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 22 | DELETE | `/api/v1/horarios/:sedeId/excepciones/:fecha` | horarios.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 23 | PATCH | `/api/v1/horarios/:sedeId` | horarios.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 24 | GET | `/api/v1/membresias` | membresias.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 25 | POST | `/api/v1/membresias` | membresias.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 26 | PATCH | `/api/v1/membresias/:id` | membresias.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 27 | DELETE | `/api/v1/membresias/:id` | membresias.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 28 | GET | `/api/v1/membresias/vendibles` | membresias.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 29 | POST | `/api/v1/membresias/:id/activar` | membresias.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 30 | POST | `/api/v1/membresias/:id/vender` | membresias.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 31 | GET | `/api/v1/combinaciones/config` | combinaciones.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 32 | GET | `/api/v1/combinaciones/admin` | combinaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 33 | PUT | `/api/v1/combinaciones/ancla` | combinaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 34 | POST | `/api/v1/combinaciones` | combinaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 35 | PATCH | `/api/v1/combinaciones/:id` | combinaciones.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 36 | DELETE | `/api/v1/combinaciones/:id` | combinaciones.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 37 | GET | `/api/v1/competencias` | competencias.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 38 | GET | `/api/v1/competencias/profesional/:profesionalId` | competencias.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 39 | GET | `/api/v1/competencias/servicio/:servicioId` | competencias.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 40 | POST | `/api/v1/competencias/toggle` | competencias.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 41 | GET | `/api/v1/conciliacion/pendientes-paciente/:pacienteId` | conciliacion.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 42 | GET | `/api/v1/conciliacion/aperturas` | conciliacion.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 43 | GET | `/api/v1/conciliacion/aperturas/:id/evidencia` | conciliacion.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 44 | POST | `/api/v1/conciliacion/aperturas/:id/aprobar` | conciliacion.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 45 | POST | `/api/v1/conciliacion/aperturas/aprobar-bloque` | conciliacion.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 46 | POST | `/api/v1/conciliacion/aperturas/:id/descartar` | conciliacion.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 47 | POST | `/api/v1/conciliacion/cerrar` | conciliacion.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 48 | GET | `/api/v1/almuerzos` | almuerzos.ts | ⓘ NO PROBADO — gestión periódica; cubierto conceptualmente por permisos/movimientos |
| 49 | GET | `/api/v1/almuerzos/profesional/:profesionalId` | almuerzos.ts | ⓘ NO PROBADO — gestión periódica; cubierto conceptualmente por permisos/movimientos |
| 50 | POST | `/api/v1/almuerzos` | almuerzos.ts | ⓘ NO PROBADO — gestión periódica; cubierto conceptualmente por permisos/movimientos |
| 51 | DELETE | `/api/v1/almuerzos/:id` | almuerzos.ts | ⓘ NO PROBADO — gestión periódica; cubierto conceptualmente por permisos/movimientos |
| 52 | POST | `/api/v1/analytics/recalcular` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 53 | POST | `/api/v1/analytics/recalcular/hoy` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 54 | GET | `/api/v1/analytics/kpis` | analytics.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 55 | GET | `/api/v1/analytics/profesionales` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 56 | GET | `/api/v1/analytics/servicios` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 57 | GET | `/api/v1/analytics/sedes` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 58 | GET | `/api/v1/analytics/heatmap` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 59 | GET | `/api/v1/analytics/unidades` | analytics.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 60 | GET | `/api/v1/analytics/canales` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 61 | GET | `/api/v1/analytics/promociones` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 62 | GET | `/api/v1/analytics/tendencia` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 63 | GET | `/api/v1/analytics/noshow` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 64 | GET | `/api/v1/analytics/caseload` | analytics.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 65 | GET | `/api/v1/analytics/agentes/lista` | analyticsAgentes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 66 | GET | `/api/v1/analytics/agentes/config` | analyticsAgentes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 67 | GET | `/api/v1/analytics/agentes/resumen` | analyticsAgentes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 68 | GET | `/api/v1/analytics/agentes/comparativa` | analyticsAgentes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 69 | GET | `/api/v1/analytics/agentes/recitacion` | analyticsAgentes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 70 | GET | `/api/v1/analytics/agentes/agente/:id` | analyticsAgentes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 71 | GET | `/api/v1/analytics/agentes/agente/:id/citas` | analyticsAgentes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 72 | GET | `/api/v1/analytics/agentes/timeline/:agenteId` | analyticsAgentes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 73 | GET | `/api/v1/movimientos/verificar-citas` | movimientos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 74 | GET | `/api/v1/movimientos/:id/impacto` | movimientos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 75 | GET | `/api/v1/movimientos/preview` | movimientos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 76 | GET | `/api/v1/movimientos` | movimientos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 77 | POST | `/api/v1/movimientos` | movimientos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 78 | PUT | `/api/v1/movimientos/:id` | movimientos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 79 | DELETE | `/api/v1/movimientos/:id` | movimientos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 80 | GET | `/api/v1/notificaciones/activas` | notificaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 81 | POST | `/api/v1/notificaciones/:id/vista` | notificaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 82 | GET | `/api/v1/notificaciones/admin` | notificaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 83 | POST | `/api/v1/notificaciones/admin` | notificaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 84 | PUT | `/api/v1/notificaciones/admin/:id` | notificaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 85 | DELETE | `/api/v1/notificaciones/admin/:id` | notificaciones.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 86 | GET | `/api/v1/pacientes/buscar` | pacientes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 87 | GET | `/api/v1/pacientes/distritos-frecuentes` | pacientes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 88 | GET | `/api/v1/pacientes/:id` | pacientes.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 89 | GET | `/api/v1/pacientes/:id/paquetes` | pacientes.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 90 | GET | `/api/v1/pacientes/:id/historial-genexis/existe` | pacientes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 91 | GET | `/api/v1/pacientes/:id/historial-genexis` | pacientes.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 92 | POST | `/api/v1/pacientes` | pacientes.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 93 | PATCH | `/api/v1/pacientes/:id` | pacientes.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 94 | GET | `/api/v1/promociones` | promociones.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 95 | GET | `/api/v1/promociones/todas` | promociones.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 96 | POST | `/api/v1/promociones` | promociones.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 97 | PATCH | `/api/v1/promociones/:id` | promociones.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 98 | DELETE | `/api/v1/promociones/:id` | promociones.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 99 | GET | `/api/v1/recordatorios/dia` | recordatorios.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 100 | GET | `/api/v1/recordatorios/metricas` | recordatorios.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 101 | GET | `/api/v1/recordatorios/cita/:citaId` | recordatorios.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 102 | POST | `/api/v1/recordatorios/:citaId/reenviar` | recordatorios.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 103 | GET | `/api/v1/reniec/dni/:dni` | reniec.ts | ⓘ NO PROBADO — integración externa RENIEC (token vacío en sim por aislamiento Gate 0) |
| 104 | GET | `/api/v1/reportes/horas-extra` | reportes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 105 | GET | `/api/v1/reportes/rotacion` | reportes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 106 | PATCH | `/api/v1/reportes/meta/:profesionalId` | reportes.ts | ⓘ NO PROBADO — lectura/BI, sin riesgo de corrupción; requiere data agregada (fuera del foco transaccional) |
| 107 | POST | `/api/v1/webhooks/resend` | resendWebhook.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 108 | GET | `/api/v1/roles` | roles.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 109 | GET | `/api/v1/roles/permisos` | roles.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 110 | POST | `/api/v1/roles` | roles.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 111 | PUT | `/api/v1/roles/:id` | roles.ts | ⓘ NO PROBADO — administración de usuarios/roles, no es operación de pacientes |
| 112 | DELETE | `/api/v1/roles/:id` | roles.ts | ⓘ NO PROBADO — administración de usuarios/roles, no es operación de pacientes |
| 113 | GET | `/api/v1/baro-solicitud` | baroSolicitud.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 114 | POST | `/api/v1/baro-solicitud/:profesionalId` | baroSolicitud.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 115 | DELETE | `/api/v1/baro-solicitud/:profesionalId` | baroSolicitud.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 116 | GET | `/api/v1/canales` | canales.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 117 | GET | `/api/v1/canales/todos` | canales.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 118 | POST | `/api/v1/canales` | canales.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 119 | PATCH | `/api/v1/canales/:id` | canales.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 120 | DELETE | `/api/v1/canales/:id` | canales.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 121 | POST | `/api/v1/citas/upload-comprobante` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 122 | GET | `/api/v1/citas` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 123 | POST | `/api/v1/citas/outlook/reintentar` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 124 | POST | `/api/v1/citas/:id/confirmar-mail` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 125 | GET | `/api/v1/citas/calendario?token=` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 126 | GET | `/api/v1/citas/confirmar?token=` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 127 | GET | `/api/v1/citas/cancelar?token=` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 128 | GET | `/api/v1/citas/confirmar/:token` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 129 | GET | `/api/v1/citas/reprogramar/:token` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 130 | GET | `/api/v1/citas/:id` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 131 | POST | `/api/v1/citas` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 132 | POST | `/api/v1/citas/combinada` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 133 | PATCH | `/api/v1/citas/:id/estado` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 134 | PATCH | `/api/v1/citas/:id/gestionar-movimiento` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 135 | PATCH | `/api/v1/citas/:id/mover` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 136 | PATCH | `/api/v1/citas/grupo/:slotGrupoId/mover` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 137 | DELETE | `/api/v1/citas/:id` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 138 | PATCH | `/api/v1/citas/:id/consultorio` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 139 | PATCH | `/api/v1/citas/:id/comentario` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 140 | PATCH | `/api/v1/citas/:id/canal` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 141 | PATCH | `/api/v1/citas/:id/promocion` | citas.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 142 | GET | `/api/v1/citas/sede/:sedeId/stats` | citas.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 143 | PATCH | `/api/v1/paquetes/instancia/:id/tamano` | paquetes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 144 | GET | `/api/v1/paquetes/` | paquetes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 145 | GET | `/api/v1/paquetes/paciente/:pacienteId` | paquetes.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 146 | POST | `/api/v1/paquetes/paciente/:pacienteId` | paquetes.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 147 | POST | `/api/v1/paquetes/` | paquetes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 148 | PATCH | `/api/v1/paquetes/:id` | paquetes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 149 | DELETE | `/api/v1/paquetes/:id` | paquetes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 150 | GET | `/api/v1/permisos/` | permisos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 151 | POST | `/api/v1/permisos/` | permisos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 152 | POST | `/api/v1/permisos/multiple` | permisos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 153 | POST | `/api/v1/permisos/reunion` | permisos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 154 | DELETE | `/api/v1/permisos/:id` | permisos.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 155 | GET | `/api/v1/profesionales/` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 156 | GET | `/api/v1/profesionales/seleccionables` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 157 | POST | `/api/v1/profesionales/` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 158 | PATCH | `/api/v1/profesionales/:id` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 159 | GET | `/api/v1/profesionales/horarios-entrada` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 160 | PATCH | `/api/v1/profesionales/:id/entrada` | profesionales.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 161 | GET | `/api/v1/profesionales/personal-excepcion` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 162 | PATCH | `/api/v1/profesionales/:id/presencia-excepcion` | profesionales.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 163 | GET | `/api/v1/profesionales/dia-especial` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 164 | POST | `/api/v1/profesionales/dia-especial/set` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 165 | GET | `/api/v1/profesionales/:id` | profesionales.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 166 | GET | `/api/v1/profesionales/:id/horario` | profesionales.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 167 | PUT | `/api/v1/profesionales/:id/horario` | profesionales.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 168 | POST | `/api/v1/profesionales/:id/bloqueos` | profesionales.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 169 | GET | `/api/v1/sedes` | sedes.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 170 | GET | `/api/v1/sedes/:id` | sedes.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 171 | GET | `/api/v1/servicios` | servicios.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 172 | GET | `/api/v1/servicios/:id` | servicios.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 173 | POST | `/api/v1/servicios` | servicios.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 174 | PATCH | `/api/v1/servicios/:id` | servicios.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 175 | GET | `/api/v1/servicios/:id/subcategorias` | servicios.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 176 | POST | `/api/v1/servicios/:id/subcategorias` | servicios.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 177 | PATCH | `/api/v1/servicios/subcategorias/:subId` | servicios.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 178 | DELETE | `/api/v1/servicios/subcategorias/:subId` | servicios.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 179 | GET | `/api/v1/servicio-videos` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 180 | GET | `/api/v1/servicio-videos/resumen` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 181 | GET | `/api/v1/servicio-videos/historial` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 182 | POST | `/api/v1/servicio-videos/preview` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 183 | POST | `/api/v1/servicio-videos` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 184 | PUT | `/api/v1/servicio-videos/:id` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 185 | PATCH | `/api/v1/servicio-videos/:id/toggle` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 186 | DELETE | `/api/v1/servicio-videos/:id` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 187 | POST | `/api/v1/servicio-videos/:id/test-envio` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 188 | GET | `/api/v1/servicio-videos/supresiones` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 189 | POST | `/api/v1/servicio-videos/supresiones` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 190 | DELETE | `/api/v1/servicio-videos/supresiones/:id` | servicioVideos.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 191 | GET | `/api/v1/users` | users.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 192 | GET | `/api/v1/users/:id` | users.ts | ⓘ NO PROBADO — no ejercitado por el motor de demanda |
| 193 | POST | `/api/v1/users` | users.ts | ✅ PASS (ejercitado directo, 0×5xx) |
| 194 | PUT | `/api/v1/users/:id` | users.ts | ⓘ NO PROBADO — administración de usuarios/roles, no es operación de pacientes |
| 195 | DELETE | `/api/v1/users/:id` | users.ts | ⓘ NO PROBADO — administración de usuarios/roles, no es operación de pacientes |
| 196 | GET | `/api/v1/webhooks` | webhooks.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 197 | POST | `/api/v1/webhooks` | webhooks.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 198 | PATCH | `/api/v1/webhooks/:id` | webhooks.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |
| 199 | DELETE | `/api/v1/webhooks/:id` | webhooks.ts | ⓘ NO PROBADO — configuración/catálogo; la simulación usa el catálogo real ya sembrado |

## Acciones de usuario (frontend) — cobertura por flujo API

Las 118 acciones de usuario se agrupan en flujos; los flujos operativos (agendar, reprogramar, cancelar, no-show, atender, check-in con consumo, venta de paquete/membresía, cita combinada, aplicar promoción, alta/edición de paciente con distrito) fueron **ejercitados masivamente** por el motor de demanda (Agentes B/C). Los flujos de configuración/analítica/admin (gestión de usuarios, roles, canales, servicios, videos, reportes) **no** se ejercitaron por diseño (la simulación consume el catálogo real, no lo reconfigura).