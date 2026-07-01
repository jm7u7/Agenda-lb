import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// Teléfono → formato internacional. Si tiene 9 dígitos (caso típico Perú) se le
// antepone +51. Si ya trae código de país (+1, +51, cualquier +) se respeta tal cual.
// Otros formatos se dejan intactos.
function formatearNumero(tel: string | null | undefined): string {
  const t = (tel ?? '').trim();
  if (!t) return '';
  if (t.startsWith('+')) return t.replace(/\s+/g, ''); // respeta cualquier código de país
  const digitos = t.replace(/\D/g, '');
  if (digitos.length === 9) return `+51${digitos}`;
  return t; // respeta el valor original (ya tiene código de país u otro formato)
}

// Delimitador: punto y coma (Excel en español/es-PE usa ";" como separador de
// listas; con coma lo metía todo en una sola columna).
const SEP = ';';

// Escapa un campo CSV (comillas si tiene el separador, comilla o salto de línea).
function csvCampo(v: string): string {
  const s = v ?? '';
  return new RegExp(`["${SEP}\\n\\r]`).test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── GET /exportar/citas?fecha=YYYY-MM-DD[&sedeId=xxx] ───── (CSV, solo texto) ─
router.get('/citas', requireAuth, async (req, res) => {
  const { fecha, sedeId } = req.query as { fecha?: string; sedeId?: string };
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new AppError('Parámetro fecha requerido (YYYY-MM-DD)', 400, 'FECHA_REQUERIDA');
  }

  const fechaDate = new Date(fecha + 'T12:00:00');

  const citas = await prisma.cita.findMany({
    where: {
      fecha: fechaDate,
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show'] },
      ...(sedeId ? { sedeId } : {}),
    },
    include: {
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true } },
      sede: { select: { nombre: true, direccion: true } },
    },
    orderBy: [{ sede: { nombre: 'asc' } }, { horaInicio: 'asc' }],
  });

  // DIA en formato DD/MM/YYYY (fecha es @db.Date → getters UTC para no desfasar).
  const dd = String(fechaDate.getUTCDate()).padStart(2, '0');
  const mm = String(fechaDate.getUTCMonth() + 1).padStart(2, '0');
  const diaStr = `${dd}/${mm}/${fechaDate.getUTCFullYear()}`;

  // Fuerza que Excel muestre el valor como TEXTO literal al abrir el CSV directo
  // (sin importar). Usa el marcador ="…" que Excel respeta; así el +51 / +1 no se
  // convierte a número ni a notación científica.
  const textoExcel = (v: string) => (v ? `="${v.replace(/"/g, '""')}"` : '');

  // Columnas: Numero, NOMBRE, DIA, HORA, SEDE, DIRECCION
  const lineas = [['Numero', 'NOMBRE', 'DIA', 'HORA', 'SEDE', 'DIRECCION'].join(SEP)];
  for (const c of citas) {
    const nombre = `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.replace(/\s+/g, ' ').trim();
    lineas.push([
      textoExcel(formatearNumero(c.paciente.telefono)),
      nombre,
      diaStr,
      c.horaInicio,
      c.sede.nombre,
      c.sede.direccion,
    ].map(csvCampo).join(SEP));
  }

  // 1ª línea "sep=;" → indica a Excel el separador (robusto en cualquier equipo).
  // BOM UTF-8 para las tildes. CRLF como fin de línea.
  const csv = '﻿' + `sep=${SEP}\r\n` + lineas.join('\r\n') + '\r\n';
  const nombreArchivo = `citas-limablue-${fecha}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(csv);
});

// ─── GET /exportar/reactivacion ──────────────────────────────────────────────
// Filtro por período de última visita (3 modos, prioridad de arriba hacia abajo):
//   1) fechaDesde + fechaHasta (YYYY-MM-DD) → última visita DENTRO del rango
//   2) fechaCorte (YYYY-MM-DD)              → última visita ANTES del corte
//   3) diasSinVisitar (default 90)          → última visita hace más de N días
// Otros params: sedeId?, servicioId?, minVisitas (default 1)
router.get('/reactivacion', requireAuth, async (req, res) => {
  const {
    diasSinVisitar = '90',
    fechaCorte,
    fechaDesde,
    fechaHasta,
    sedeId,
    servicioId,
    minVisitas = '1',
  } = req.query as {
    diasSinVisitar?: string; fechaCorte?: string; fechaDesde?: string; fechaHasta?: string;
    sedeId?: string; servicioId?: string; minVisitas?: string;
  };

  const minV = Math.max(1, parseInt(minVisitas, 10) || 1);
  const esFecha = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const ddmmaaaa = (v: string) => v.split('-').reverse().join('/');

  // Predicado de período sobre la fecha de la última visita del paciente.
  let pasaPeriodo: (fechaUltima: Date) => boolean;
  let etiquetaPeriodo: string;

  if (esFecha(fechaDesde) && esFecha(fechaHasta)) {
    const desde = new Date(fechaDesde + 'T00:00:00');
    const hasta = new Date(fechaHasta + 'T23:59:59');
    pasaPeriodo = (f) => f >= desde && f <= hasta;
    etiquetaPeriodo = `última visita entre ${ddmmaaaa(fechaDesde!)} y ${ddmmaaaa(fechaHasta!)}`;
  } else if (esFecha(fechaCorte)) {
    const corte = new Date(fechaCorte + 'T23:59:59');
    pasaPeriodo = (f) => f <= corte;
    etiquetaPeriodo = `última visita antes del ${ddmmaaaa(fechaCorte!)}`;
  } else {
    const dias = Math.max(1, parseInt(diasSinVisitar, 10) || 90);
    const corte = new Date();
    corte.setDate(corte.getDate() - dias);
    corte.setHours(23, 59, 59, 999);
    pasaPeriodo = (f) => f <= corte;
    etiquetaPeriodo = `sin visitar en +${dias} días`;
  }

  const citaWhere = {
    deletedAt: null as null,
    estado: 'completada' as const,
    ...(sedeId ? { sedeId } : {}),
    ...(servicioId ? { servicioId } : {}),
  };

  const rawPacientes = await prisma.paciente.findMany({
    where: {
      deletedAt: null,
      citas: { some: citaWhere },
    },
    include: {
      citas: {
        where: citaWhere,
        include: {
          servicio: { select: { nombre: true } },
          sede: { select: { nombre: true } },
        },
        orderBy: { fecha: 'desc' },
      },
    },
  });

  // Total de visitas completadas por paciente (sin filtro de sede/servicio)
  const totalMap = await prisma.cita.groupBy({
    by: ['pacienteId'],
    where: { deletedAt: null, estado: 'completada', pacienteId: { in: rawPacientes.map(p => p.id) } },
    _count: { id: true },
  });
  const totalPorPaciente = new Map(totalMap.map(r => [r.pacienteId, r._count.id]));

  const hoy = new Date();
  const ahora = hoy.getTime();

  const conUltima = rawPacientes
    .filter(p => p.citas.length >= minV)
    .map(p => {
      const ultima = p.citas[0]!;
      const fechaUltima = new Date(ultima.fecha);
      const diasSinVenir = Math.floor((ahora - fechaUltima.getTime()) / (1000 * 60 * 60 * 24));
      return { paciente: p, ultima, fechaUltima, diasSinVenir, totalVisitas: totalPorPaciente.get(p.id) ?? p.citas.length };
    })
    .filter(r => pasaPeriodo(r.fechaUltima))
    .sort((a, b) => b.diasSinVenir - a.diasSinVenir);

  // ── Excel ─────────────────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Limablue Agenda';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Reactivación', {
    pageSetup: { paperSize: 9, orientation: 'landscape' },
  });

  const hoyStr = hoy.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });

  sheet.mergeCells('A1:I1');
  const t = sheet.getCell('A1');
  t.value = `Pacientes para Reactivación — Generado ${hoyStr} · ${etiquetaPeriodo}`;
  t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:I2');
  const sub = sheet.getCell('A2');
  sub.value = `Limablue Corp. — Total: ${conUltima.length} pacientes`;
  sub.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  sub.alignment = { horizontal: 'center' };
  sheet.getRow(2).height = 16;

  const headers = [
    { label: 'Nombres',             key: 'nombres',        width: 20 },
    { label: 'Apellidos',           key: 'apellidos',      width: 24 },
    { label: 'Teléfono',            key: 'telefono',       width: 14 },
    { label: 'Email',               key: 'email',          width: 28 },
    { label: 'Último servicio',     key: 'servicio',       width: 28 },
    { label: 'Última visita',       key: 'ultimaVisita',   width: 14 },
    { label: 'Días sin visitar',    key: 'dias',           width: 14 },
    { label: 'Sede última visita',  key: 'sede',           width: 16 },
    { label: 'Total visitas',       key: 'totalVisitas',   width: 12 },
  ];

  sheet.columns = headers.map(h => ({ key: h.key, width: h.width }));

  const hr = sheet.getRow(3);
  headers.forEach((h, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = h.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCAADFA' } },
      right: { style: 'hair', color: { argb: 'FFCAADFA' } },
    };
  });
  hr.height = 20;

  conUltima.forEach(({ paciente: p, ultima, fechaUltima, diasSinVenir, totalVisitas }, idx) => {
    const row = sheet.addRow({
      nombres: p.nombres,
      apellidos: `${p.apellidoPaterno} ${p.apellidoMaterno}`,
      telefono: p.telefono,
      email: p.email ?? '',
      servicio: ultima.servicio.nombre,
      ultimaVisita: fechaUltima.toLocaleDateString('es-PE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }),
      dias: diasSinVenir,
      sede: ultima.sede.nombre,
      totalVisitas,
    });

    const bg = idx % 2 === 0 ? 'FFF5F3FF' : 'FFFFFFFF';
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2D9F8' } }, right: { style: 'hair', color: { argb: 'FFE2D9F8' } } };
    });

    // Colorear "Días sin visitar" según urgencia
    const diasCell = row.getCell('dias');
    if (diasSinVenir >= 365) {
      diasCell.font = { bold: true, color: { argb: 'FFDC2626' } };
    } else if (diasSinVenir >= 180) {
      diasCell.font = { bold: true, color: { argb: 'FFD97706' } };
    } else {
      diasCell.font = { color: { argb: 'FF059669' } };
    }
    diasCell.alignment = { horizontal: 'center', vertical: 'middle' };
    row.height = 18;
  });

  sheet.autoFilter = { from: 'A3', to: 'I3' };
  sheet.views = [{ state: 'frozen', ySplit: 3 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const sufijArchivo = fechaCorte ? `hasta-${fechaCorte}` : `${diasSinVisitar}dias`;
  res.setHeader('Content-Disposition', `attachment; filename="reactivacion-limablue-${sufijArchivo}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// ─── GET /exportar/historial/:pacienteId ─────────────────────────────────────
router.get('/historial/:pacienteId', requireAuth, async (req, res) => {
  const paciente = await prisma.paciente.findUnique({
    where: { id: req.params.pacienteId, deletedAt: null },
    include: {
      paquetes: {
        where: { deletedAt: null, activo: true },
        include: { paquete: { select: { nombre: true } } },
      },
    },
  });
  if (!paciente) throw new AppError('Paciente no encontrado', 404);

  const citas = await prisma.cita.findMany({
    where: { pacienteId: req.params.pacienteId, deletedAt: null },
    include: {
      profesional: { select: { nombres: true, apellidos: true } },
      servicio: { select: { nombre: true } },
      sede: { select: { nombre: true } },
      unidadNegocio: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'desc' }, { horaInicio: 'asc' }],
  });

  // ── Métricas ──────────────────────────────────────────────────────────────
  const total = citas.length;
  const completadas = citas.filter(c => c.estado === 'completada').length;
  const noShows = citas.filter(c => c.estado === 'no_show').length;
  const canceladas = citas.filter(c => c.estado === 'cancelada').length;
  const pendientes = citas.filter(c => ['agendada', 'confirmada', 'llego', 'en_atencion'].includes(c.estado)).length;
  const asistencia = total > 0 ? Math.round((completadas / (completadas + noShows || 1)) * 100) : 0;

  // ── PDF con pdfkit ────────────────────────────────────────────────────────
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="historial-${paciente.apellidoPaterno}-${paciente.nombres}.pdf"`);
  doc.pipe(res);

  const W = 595.28;  // A4 width in points
  const AZUL = '#003366';
  const AZUL_CLARO = '#0A4B8C';
  const VERDE = '#059669';
  const ROJO = '#DC2626';
  const GRIS = '#6B7280';
  const NARANJA = '#D97706';
  const AZUL_MED = '#2563EB';
  const BG_GRIS = '#F8FAFC';
  const BORDE = '#E2E8F0';

  // ── BANDA SUPERIOR ────────────────────────────────────────────────────────
  doc.rect(0, 0, W, 90).fill(AZUL);

  // Logo área
  doc.roundedRect(28, 14, 52, 52, 8).fill('#FFFFFF').fillOpacity(1);
  doc.fontSize(9).fillColor(AZUL).font('Helvetica-Bold')
    .text('LIMA', 30, 30).text('BLUE', 30, 42);

  // Título en la banda
  doc.fontSize(22).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text('Historia de Atenciones', 95, 18, { width: 380 });
  doc.fontSize(10).fillColor('#93C5FD').font('Helvetica')
    .text('Limablue Corp. — Sistema de Gestión de Citas', 95, 46);

  // Fecha de generación
  const ahora = new Date();
  const fechaGen = ahora.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'long', year: 'numeric' });
  doc.fontSize(8).fillColor('#93C5FD').font('Helvetica')
    .text(`Generado: ${fechaGen}`, W - 160, 68, { width: 135, align: 'right' });

  // ── DATOS DEL PACIENTE ─────────────────────────────────────────────────────
  const nombreCompleto = `${paciente.nombres} ${paciente.apellidoPaterno} ${paciente.apellidoMaterno}`;

  doc.rect(0, 90, W, 130).fill(BG_GRIS);
  doc.rect(0, 90, W, 1).fill(BORDE);
  doc.rect(0, 219, W, 1).fill(BORDE);

  // Nombre destacado
  doc.rect(28, 103, 4, 36).fill(AZUL_CLARO);
  doc.fontSize(17).fillColor('#1E293B').font('Helvetica-Bold')
    .text(nombreCompleto, 40, 103, { width: 380 });

  // Datos en dos columnas
  const col1X = 40, col2X = 310;
  const datosY = 132;
  const lineH = 16;

  const campo = (label: string, valor: string | null | undefined, x: number, y: number) => {
    doc.fontSize(7.5).fillColor(GRIS).font('Helvetica').text(label.toUpperCase(), x, y);
    doc.fontSize(9.5).fillColor('#1E293B').font('Helvetica-Bold').text(valor || '—', x, y + 9, { width: 240 });
  };

  campo('Tipo y N° Documento', `${paciente.tipoDocumento} ${paciente.numeroDocumento}`, col1X, datosY);
  campo('Teléfono / Celular', paciente.telefono, col1X, datosY + lineH * 2);

  campo('Correo electrónico', paciente.email || 'No registrado', col2X, datosY);
  const fnac = paciente.fechaNacimiento
    ? new Date(paciente.fechaNacimiento).toLocaleDateString('es-PE', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' })
    : 'No registrado';
  campo('Fecha de Nacimiento', fnac, col2X, datosY + lineH * 2);

  // ── TARJETAS DE ESTADÍSTICAS ────────────────────────────────────────────
  const statsY = 228;
  doc.rect(0, 220, W, 82).fill('#FFFFFF');
  doc.rect(0, 301, W, 1).fill(BORDE);

  const statCards = [
    { label: 'Total Citas', valor: String(total), color: AZUL_CLARO, bg: '#EFF6FF' },
    { label: 'Completadas', valor: String(completadas), color: VERDE, bg: '#F0FDF4' },
    { label: 'No Asistió', valor: String(noShows), color: ROJO, bg: '#FEF2F2' },
    { label: 'Canceladas', valor: String(canceladas), color: GRIS, bg: '#F8FAFC' },
    { label: 'Pendientes', valor: String(pendientes), color: NARANJA, bg: '#FFFBEB' },
    { label: '% Asistencia', valor: `${asistencia}%`, color: AZUL_MED, bg: '#EFF6FF' },
  ];

  const cardW = (W - 56) / 6;
  statCards.forEach((s, i) => {
    const cx = 28 + i * cardW;
    doc.roundedRect(cx, statsY, cardW - 6, 60, 6).fill(s.bg);
    doc.rect(cx, statsY, 3, 60).fill(s.color);
    doc.fontSize(22).fillColor(s.color).font('Helvetica-Bold')
      .text(s.valor, cx + 8, statsY + 10, { width: cardW - 18, align: 'center' });
    doc.fontSize(7).fillColor(GRIS).font('Helvetica')
      .text(s.label, cx + 4, statsY + 40, { width: cardW - 12, align: 'center' });
  });

  // ── MAPA DE ESTADOS ─────────────────────────────────────────────────────
  // asistencia: 'si' | 'no' | 'cancelada' | 'pendiente'
  type AsistenciaKey = 'si' | 'no' | 'cancelada' | 'pendiente';
  const asistenciaMap: Record<string, AsistenciaKey> = {
    completada:  'si',
    llego:       'si',
    en_atencion: 'si',
    no_show:     'no',
    cancelada:   'cancelada',
    agendada:    'pendiente',
    confirmada:  'pendiente',
  };

  const asistenciaCfg: Record<AsistenciaKey, { simbolo: string; label: string; sublabel: string; color: string; bg: string }> = {
    si:        { simbolo: '✓', label: 'SÍ ASISTIÓ',  sublabel: '',           color: VERDE,    bg: '#F0FDF4' },
    no:        { simbolo: '✗', label: 'NO ASISTIÓ',  sublabel: '',           color: ROJO,     bg: '#FEF2F2' },
    cancelada: { simbolo: '○', label: 'CANCELADA',   sublabel: '',           color: GRIS,     bg: '#F8FAFC' },
    pendiente: { simbolo: '→', label: 'PENDIENTE',   sublabel: '',           color: AZUL_MED, bg: '#EFF6FF' },
  };

  const estadoLabel: Record<string, string> = {
    completada:  'Atención completada',
    llego:       'Paciente llegó',
    en_atencion: 'En atención',
    no_show:     'No se presentó',
    cancelada:   'Cancelada',
    agendada:    'Por confirmar',
    confirmada:  'Confirmada',
  };

  // ── COLUMNAS ──────────────────────────────────────────────────────────────
  const cols = [
    { label: 'ASISTENCIA',      x: 6,   w: 82  },
    { label: 'FECHA',           x: 92,  w: 58  },
    { label: 'HORA',            x: 154, w: 34  },
    { label: 'SERVICIO',        x: 192, w: 148 },
    { label: 'PROFESIONAL',     x: 344, w: 118 },
    { label: 'SEDE / UNIDAD',   x: 466, w: 102 },
  ];

  // ── ENCABEZADO DE TABLA ─────────────────────────────────────────────────
  const tableHeaderY = 312;
  doc.rect(0, 302, W, 26).fill(AZUL);
  doc.fontSize(7.5).fillColor('#FFFFFF').font('Helvetica-Bold');
  cols.forEach(c => doc.text(c.label, c.x, tableHeaderY, { width: c.w }));

  let rowY = 330;
  const rowH = 34;
  const PAGE_H = 841.89;
  const MARGIN_BOTTOM = 60;

  const drawTableHeader = (y: number) => {
    doc.rect(0, y, W, 24).fill(AZUL_CLARO);
    doc.fontSize(7.5).fillColor('#FFFFFF').font('Helvetica-Bold');
    cols.forEach(c => doc.text(c.label, c.x, y + 6, { width: c.w }));
  };

  const addPage = () => {
    doc.addPage({ size: 'A4', margin: 0 });
    doc.rect(0, 0, W, 36).fill(AZUL);
    doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(`Historial de Atenciones — ${nombreCompleto}`, 28, 12, { width: W - 56 });
    drawTableHeader(36);
    rowY = 66;
  };

  // ── FILAS ────────────────────────────────────────────────────────────────
  citas.forEach((cita, idx) => {
    if (rowY + rowH > PAGE_H - MARGIN_BOTTOM) addPage();

    const asistKey: AsistenciaKey = asistenciaMap[cita.estado] ?? 'pendiente';
    const asist = asistenciaCfg[asistKey];
    const isEven = idx % 2 === 0;
    const bgRow = isEven ? '#FFFFFF' : '#F9FAFB';

    // Fondo de fila
    doc.rect(0, rowY, W, rowH).fill(bgRow);

    // Barra lateral del color de asistencia
    doc.rect(0, rowY, 5, rowH).fill(asist.color);

    // ── Columna ASISTENCIA (grande y clara) ──────────────────────────────
    // Fondo del badge
    doc.roundedRect(8, rowY + 4, 76, rowH - 8, 5).fill(asist.bg);
    // Símbolo grande
    doc.fontSize(13).fillColor(asist.color).font('Helvetica-Bold')
      .text(asist.simbolo, 8, rowY + 6, { width: 28, align: 'center' });
    // Label principal
    doc.fontSize(7).fillColor(asist.color).font('Helvetica-Bold')
      .text(asist.label, 36, rowY + 7, { width: 46 });
    // Sub-label: estado exacto del sistema
    doc.fontSize(6.5).fillColor(asist.color).font('Helvetica')
      .text(estadoLabel[cita.estado] ?? cita.estado, 36, rowY + 17, { width: 46 });

    // ── Fecha ────────────────────────────────────────────────────────────
    const fechaStr = cita.fecha instanceof Date
      ? cita.fecha.toLocaleDateString('es-PE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
      : String(cita.fecha).slice(0, 10).split('-').reverse().join('/');
    doc.fontSize(8.5).fillColor('#1E293B').font('Helvetica-Bold')
      .text(fechaStr, 92, rowY + 8, { width: 58 });

    // ── Hora ─────────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor(GRIS).font('Helvetica')
      .text(cita.horaInicio, 154, rowY + 8, { width: 34 });

    // ── Servicio + Unidad ─────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#1E293B').font('Helvetica-Bold')
      .text(cita.servicio.nombre, 192, rowY + 5, { width: 146 });
    doc.fontSize(6.5).fillColor(GRIS).font('Helvetica')
      .text(cita.unidadNegocio.nombre, 192, rowY + 17, { width: 146 });

    // ── Profesional ───────────────────────────────────────────────────────
    const profNombre = cita.profesional
      ? `${cita.profesional.nombres} ${cita.profesional.apellidos}`
      : 'Sin asignar';
    doc.fontSize(8).fillColor('#1E293B').font('Helvetica')
      .text(profNombre, 344, rowY + 10, { width: 116 });

    // ── Sede ──────────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#1E293B').font('Helvetica-Bold')
      .text(cita.sede.nombre, 466, rowY + 10, { width: 100 });

    // Línea separadora
    doc.rect(0, rowY + rowH - 0.5, W, 0.5).fill(BORDE);

    rowY += rowH;
  });

  // ── FOOTER ──────────────────────────────────────────────────────────────
  const totalPages = (doc.bufferedPageRange().count);
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    const footerY = PAGE_H - 40;
    doc.rect(0, footerY - 2, W, 42).fill(AZUL);
    doc.fontSize(7.5).fillColor('#93C5FD').font('Helvetica')
      .text(
        `Documento confidencial · Limablue Corp. · Sistema desarrollado por Daniel Doy`,
        28, footerY + 6, { width: W - 160 }
      );
    doc.fontSize(7.5).fillColor('#93C5FD').font('Helvetica')
      .text(`Página ${i + 1} de ${totalPages}`, W - 100, footerY + 6, { width: 72, align: 'right' });
  }

  doc.end();
});

export default router;
