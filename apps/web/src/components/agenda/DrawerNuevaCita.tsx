import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { pacientesApi, serviciosApi, profesionalesApi, paquetesApi, disponibilidadApi, horariosApi, historialGenexisApi, reniecApi } from '../../api';
import { citasApi } from '../../api/citas';
import { api } from '../../api/client';
import { combinacionesApi } from '../../api/combinaciones';
import { cn } from '../../utils/cn';
import { DistritoAutocomplete, PaisAutocomplete } from '../ui/DistritoAutocomplete';
import { usePaquetesPaciente, paquetesElegibles, paquetesOtraSede } from '../../api/paquetesSesiones';
import { format } from 'date-fns';
import { useAuthStore } from '../../stores/authStore';
import { horaInicioValidaParaDuracion, esCitaInactiva, UBIGEO_EXTRANJERO } from '@limablue/shared';
import { useCanales } from '../../hooks/useCanales';
import { usePromociones } from '../../hooks/usePromociones';
import { formatPromoValor } from '../../api/promociones';
import { RomboAlerta, type AlertaPaciente } from '../pacientes/RomboAlerta';
import { BadgeAsistencia } from '../pacientes/BadgeAsistencia';
import { VisorHistorialGenexis } from '../pacientes/HistorialGenexis';
import { CuadroFamiliares, type FamiliarPaciente } from '../pacientes/CuadroFamiliares';

const toTitleCase = (str: string) =>
  str.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

interface DrawerNuevaCitaProps {
  sedeId: string;
  unidadNegocioId: string;
  modoReserva: string;
  fecha: Date;
  horaInicio?: string;
  profesionalId?: string;
  onClose: () => void;
}

interface ComprobanteInfo {
  url: string;
  nombre: string;
  mimeType: string;
}

// Ítem de composición de una membresía (plantilla o instancia).
interface MembItem { servicioId: string; cantidad: number; etiqueta?: string; subcategoriaId?: string | null; subcategoriaEtiqueta?: string }
interface MembresiaTpl {
  id: string; nombre: string; activo: boolean; duracionMeses: number | null;
  sedesHabilitadas: string[] | null; composicion: MembItem[];
}

export function DrawerNuevaCita({
  sedeId, unidadNegocioId, modoReserva, fecha, horaInicio, profesionalId: profIdInicial, onClose,
}: DrawerNuevaCitaProps) {
  const qc = useQueryClient();
  const token = useAuthStore(s => s.token);
  // Flujo paciente: elegir → existente | nuevo → seleccionado
  const [fechaLocal, setFechaLocal] = useState<Date>(fecha);
  const [pasoPaciente, setPasoPaciente] = useState<'elegir' | 'existente' | 'nuevo'>('elegir');
  const [modoBusqueda, setModoBusqueda] = useState<'documento' | 'nombre'>('documento');
  const [pacienteQuery, setPacienteQuery] = useState('');
  const [pacienteSeleccionado, setPacienteSeleccionado] = useState<{ id: string; nombreCompleto: string; telefono: string; alerta?: AlertaPaciente | null; familiares?: FamiliarPaciente[] | null } | null>(null);
  const [servicioId, setServicioId] = useState('');
  // Subcategoría del servicio (ej. Profilaxis → Regular/Premium/…). Obligatoria si el
  // servicio tiene subcategorías activas. Se resetea al cambiar de servicio.
  const [subcategoriaId, setSubcategoriaId] = useState('');
  // Paquete: "" = cita normal · "inst:<id>" = sesión de un paquete activo · "tpl:<id>" = activar paquete nuevo
  const [paqueteSel, setPaqueteSel] = useState('');
  // ── Flujo "MEMBRESÍA PRIMERO" ──────────────────────────────────────────────
  // Recepción elige una membresía del paciente (activa) o ACTIVA una nueva en el
  // momento, y luego elige QUÉ SERVICIO de la membresía agendar (con su saldo).
  // membSel: '' | 'inst:<ppId>' (membresía ya activa) | 'tpl:<promoId>' (activar nueva).
  const [membSel, setMembSel] = useState('');
  const [membItem, setMembItem] = useState('');   // índice del ítem de composición elegido
  const [membInicio, setMembInicio] = useState(''); // vigencia al activar nueva (default hoy)
  const [membFin, setMembFin] = useState('');
  // MIGRACIÓN GENEXIS: número de sesión ADJUDICADO A MANO desde el desplegable
  // (mirando el visor Genexis). Solo aplica a paquetes origen GENEXIS_APERTURA;
  // los nacidos en la Agenda siguen con numeración automática.
  const [sesionManual, setSesionManual] = useState('');
  const [verVisorGenexis, setVerVisorGenexis] = useState(false);
  const [profesionalId, setProfesionalId] = useState(profIdInicial ?? '');
  const [hora, setHora] = useState(horaInicio ?? '08:00');
  const [canal, setCanal] = useState('recepcion'); // de dónde viene el cliente
  const { canales: canalesOpts } = useCanales();
  const [promocionId, setPromocionId] = useState(''); // '' = sin promoción
  const { promociones } = usePromociones();
  const [comentario, setComentario] = useState('');

  // ── Bloque combinado (profilaxis + servicio extra en el mismo turno) ──
  const [combinar, setCombinar] = useState(false);
  const [extraServicioId, setExtraServicioId] = useState('');
  const [extraProfesionalId, setExtraProfesionalId] = useState(''); // '' = misma profesional del ancla
  const [extraPaqueteSel, setExtraPaqueteSel] = useState('');

  // Comprobante de pago
  const [comprobante, setComprobante] = useState<ComprobanteInfo | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const inputFileRef = useRef<HTMLInputElement>(null);

  // Nuevo paciente — datos completos
  const [npNombres, setNpNombres] = useState('');
  const [npApellidoPat, setNpApellidoPat] = useState('');
  const [npApellidoMat, setNpApellidoMat] = useState('');
  const [npTipoDoc, setNpTipoDoc] = useState<'DNI' | 'CE' | 'PASAPORTE'>('DNI');
  const [npNumDoc, setNpNumDoc] = useState('');
  const [npTel, setNpTel] = useState('');
  const [npEmail, setNpEmail] = useState('');
  const [npFechaNac, setNpFechaNac] = useState('');
  const [npUbigeoId, setNpUbigeoId] = useState<string | null>(null); // distrito de residencia (REQUERIDO)
  const [npPais, setNpPais] = useState<string | null>(null);         // solo si npUbigeoId = Extranjero
  // Autollenado RENIEC: estado de la consulta y último DNI consultado (evita repetir).
  const [dniConsultando, setDniConsultando] = useState(false);
  const dniConsultadoRef = useRef('');

  // Idempotencia: UNA sola key por apertura del drawer (no por intento). Así un
  // doble-clic o un reintento NO crean dos citas — el backend devuelve la existente.
  // El drawer se desmonta al cerrar, por lo que la próxima reserva tendrá su key.
  const idempotencyKeyRef = useRef(uuidv4());

  const resetPaciente = () => {
    setPasoPaciente('elegir');
    setModoBusqueda('documento');
    setPacienteQuery('');
    setPacienteSeleccionado(null);
    setPaqueteSel('');
    dniConsultadoRef.current = '';
  };

  // Al escribir el documento en el formulario de paciente nuevo (con debounce):
  //   1) PRIMERO comprueba si ya existe en la base → si sí, lo CARGA de inmediato
  //      (evita duplicados y el choque contra el índice único al pulsar "Crear").
  //   2) Si NO existe y es DNI, autollena nombres/apellidos desde RENIEC.
  useEffect(() => {
    if (pasoPaciente !== 'nuevo') return;
    const doc = npNumDoc.trim();
    const esDni = npTipoDoc === 'DNI';
    // DNI: exactamente 8 dígitos. CE/Pasaporte: al menos 6 caracteres.
    const docValido = esDni ? /^\d{8}$/.test(doc) : doc.length >= 6;
    if (!docValido) return;
    const clave = `${npTipoDoc}:${doc}`;
    if (dniConsultadoRef.current === clave) return; // ya procesado / en curso

    dniConsultadoRef.current = clave;
    let cancelado = false;
    const t = setTimeout(async () => {
      setDniConsultando(true);
      try {
        // 1) ¿Ya está registrado? (match EXACTO de tipo + número, no el ILIKE difuso)
        const encontrados = await pacientesApi.buscar(doc);
        if (cancelado) return;
        const yaRegistrado = encontrados.find(
          (p) => p.numeroDocumento === doc && p.tipoDocumento === npTipoDoc,
        );
        if (yaRegistrado) {
          setPacienteSeleccionado(yaRegistrado);
          toast.success(`Ya registrado: ${yaRegistrado.nombreCompleto}. Se cargó automáticamente.`);
          return; // no seguimos a RENIEC ni dejamos crear un duplicado
        }

        // 2) No existe → autollenar desde RENIEC (solo DNI).
        if (!esDni) return;
        const d = await reniecApi.consultarDni(doc);
        if (cancelado) return;
        setNpNombres(toTitleCase(d.nombres));
        setNpApellidoPat(toTitleCase(d.apellidoPaterno));
        setNpApellidoMat(toTitleCase(d.apellidoMaterno));
        toast.success('Datos encontrados en RENIEC');
      } catch (e) {
        if (cancelado) return;
        // Permite reintentar el mismo documento (p.ej. tras un timeout puntual).
        dniConsultadoRef.current = '';
        const msg = e instanceof Error ? e.message : 'No se pudo consultar el documento';
        // "No encontrado" en RENIEC es informativo, no un error bloqueante.
        toast(msg, { icon: 'ℹ️' });
      } finally {
        if (!cancelado) setDniConsultando(false);
      }
    }, 500);
    return () => { cancelado = true; clearTimeout(t); };
  }, [npNumDoc, npTipoDoc, pasoPaciente]);

  const fechaStr = format(fechaLocal, 'yyyy-MM-dd');

  const subirComprobante = useCallback(async (file: File) => {
    setSubiendo(true);
    setErrorSubida(null);
    const form = new FormData();
    form.append('comprobante', file);
    try {
      const res = await fetch('/api/v1/citas/upload-comprobante', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error('Error al subir el archivo');
      const data = await res.json();
      setComprobante({ url: data.url, nombre: data.nombre, mimeType: data.mimeType });
    } catch {
      setErrorSubida('No se pudo subir el comprobante. Intenta de nuevo.');
    } finally {
      setSubiendo(false);
    }
  }, [token]);

  // Pegar desde portapapeles
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imagen = items.find(i => i.type.startsWith('image/'));
      if (imagen) {
        const file = imagen.getAsFile();
        if (file) subirComprobante(file);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [subirComprobante]);

  const { data: pacientesSugeridos } = useQuery({
    queryKey: ['buscar-pacientes', pacienteQuery],
    queryFn: () => pacientesApi.buscar(pacienteQuery),
    enabled: pacienteQuery.length >= 2,
  });

  const { data: servicios } = useQuery({
    queryKey: ['servicios', unidadNegocioId],
    queryFn: () => serviciosApi.listar({ unidadNegocioId, activo: true }),
  });

  // ── Config de bloques combinados: servicio ancla + extras permitidos (activos) ──
  const { data: configCombi } = useQuery({
    queryKey: ['combinaciones-config'],
    queryFn: () => combinacionesApi.config(),
  });
  // El toggle "Combinar" solo aparece si hay ancla configurada y el servicio elegido ES el ancla.
  const esServicioAncla = !!configCombi?.servicioAnclaId && servicioId === configCombi.servicioAnclaId;
  const combinablesActivos = configCombi?.combinables ?? [];
  // Al apagar el toggle o cambiar de servicio, limpiar la selección del extra.
  useEffect(() => {
    if (!esServicioAncla) { setCombinar(false); setExtraServicioId(''); setExtraProfesionalId(''); setExtraPaqueteSel(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esServicioAncla]);

  // ── Paquetes del paciente (de esta unidad) + plantillas activables ──
  const { data: paquetesPaciente } = useQuery({
    queryKey: ['paquetes-paciente', pacienteSeleccionado?.id],
    queryFn: () => paquetesApi.porPaciente(pacienteSeleccionado!.id),
    enabled: !!pacienteSeleccionado,
  });
  const { data: plantillasPaquete } = useQuery({
    queryKey: ['plantillas-paquete'],
    queryFn: () => paquetesApi.plantillas(),
    enabled: !!pacienteSeleccionado,
  });
  // Saldos por ítem (composición con `consumidas`) para el flujo "membresía primero".
  const { data: saldosPaciente } = usePaquetesPaciente(pacienteSeleccionado?.id, !!pacienteSeleccionado);
  // Plantillas de membresía activas (para ACTIVAR una nueva al agendar).
  const { data: membresiasTpl } = useQuery({
    queryKey: ['membresias-vendibles'],
    queryFn: () => api.get<MembresiaTpl[]>('/membresias/vendibles'),
    enabled: !!pacienteSeleccionado,
  });
  // ¿El paciente tiene historial Genexis? → habilita "continuación de Genexis"
  // (recepción crea el paquete ella misma para los casos no conciliados por admin).
  const { data: existeGenexis } = useQuery({
    queryKey: ['genexis-existe', pacienteSeleccionado?.id],
    queryFn: () => historialGenexisApi.existe(pacienteSeleccionado!.id),
    enabled: !!pacienteSeleccionado,
  });
  // Paquetes del paciente para el SERVICIO elegido (no toda la unidad).
  // "Comprometidas" = sesiones ya consumidas (sesionesUsadas) + citas activas ya agendadas (pendientes).
  // Un paquete está DISPONIBLE solo si quedan sesiones (comprometidas < total); si no, está AGOTADO.
  const comprometidas = (pp: { sesionesUsadas: number; citas: { estado: string }[] }) =>
    pp.sesionesUsadas + pp.citas.filter(c => ['agendada', 'confirmada', 'llego', 'en_atencion'].includes(c.estado)).length;
  // ¿El paquete/membresía del paciente aplica a (servicio, subcategoría) Y la fecha de la cita
  // cae dentro de su vigencia? MEMBRESÍA (con composición) → matchea por ítem, subcategoría-aware
  // (así aparece en CADA servicio de su composición). Paquete simple → por el servicio de la
  // plantilla. Gate de vigencia [inicio, fin] contra la fecha elegida (fechaStr). El backend
  // (consumirDeCita) revalida saldo por ítem y vigencia al llegar.
  const cubrePaquete = (pp: NonNullable<typeof paquetesPaciente>[number], srvId: string, subId: string | null) => {
    if (!pp.activo) return false;
    if (pp.vigenciaInicio && fechaStr < pp.vigenciaInicio) return false;
    if (pp.vigenciaFin && fechaStr > pp.vigenciaFin) return false;
    const comp = pp.composicion ?? [];
    if (comp.length > 0) return comp.some(i => i.servicioId === srvId && (!i.subcategoriaId || i.subcategoriaId === subId));
    return pp.paquete.servicio.id === srvId;
  };
  // Las MEMBRESÍAS se manejan SOLO en el bloque "Membresía" (arriba), nunca en este selector de
  // paquetes normal (evita duplicidad e inconsistencia de sede). Aquí solo paquetes/láser/unitarias.
  const instanciasServicioTodas = (paquetesPaciente ?? []).filter(pp => pp.tipo !== 'MEMBRESIA' && cubrePaquete(pp, servicioId, subcategoriaId || null));
  const instanciasDisponibles = instanciasServicioTodas.filter(pp => comprometidas(pp) < pp.sesionesTotal);
  const instanciasAgotadas = instanciasServicioTodas.filter(pp => comprometidas(pp) >= pp.sesionesTotal);
  const plantillasServicio = (plantillasPaquete ?? []).filter(t => t.activo && t.tipo !== 'MEMBRESIA' && !t.promocionId && t.servicio.id === servicioId);
  // Hay un paquete con CUPO disponible (se puede agendar otra sesión) → no se ofrece activar otro.
  // Si todos los paquetes del servicio están llenos, sí se permite activar uno nuevo (6 o 12 más).
  const tienePaqueteActivoServicio = instanciasDisponibles.length > 0;
  // Próxima sesión a agendar (nunca excede el total, porque solo se ofrecen disponibles).
  const proximaSesion = (pp: typeof instanciasDisponibles[number]) => comprometidas(pp) + 1;
  // Al cambiar de servicio (o al cargar los paquetes), proponer automáticamente el paquete
  // activo si el paciente tiene EXACTAMENTE uno disponible para ese servicio. Así no se agenda
  // por error "sin paquete" una sesión que sí debía descontar del paquete. Si hay varios o
  // ninguno disponible, queda en "Sin paquete" (la recepción elige).
  useEffect(() => {
    // En el flujo MEMBRESÍA-PRIMERO el servicio lo fijó la propia membresía: este efecto
    // no debe pisar la selección (`inst:<membresía>`) con su auto-propuesta de paquetes
    // normales — ese pisotón hacía que la cita no descontara la sesión de la membresía.
    if (membSel && membItem !== '') return;
    setPaqueteSel(instanciasDisponibles.length === 1 ? `inst:${instanciasDisponibles[0].id}` : '');
    setSesionManual('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicioId, subcategoriaId, paquetesPaciente]);

  // Al cambiar de servicio, limpiar el profesional elegido: la lista se filtra a quienes hacen
  // ese servicio, y un profesional previo podría no realizarlo. También se resetea la subcategoría.
  // Al cambiar de servicio se limpia el profesional. La subcategoría se resetea en el onChange
  // MANUAL del selector de servicio (no aquí), para que el flujo "membresía primero" pueda fijar
  // servicio + subcategoría juntos sin que este efecto pise la subcategoría.
  useEffect(() => { setProfesionalId(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [servicioId]);

  // ── Flujo "membresía primero": datos derivados ─────────────────────────────
  // Membresías ACTIVAS y VIGENTES del paciente en ESTA sede (candado de sede), de los saldos.
  const membresiasActivas = (saldosPaciente ?? []).filter(p =>
    p.tipo === 'MEMBRESIA' && p.estado === 'ACTIVO' && p.sede?.id === sedeId &&
    (!p.vigenciaInicio || fechaStr >= p.vigenciaInicio) && (!p.vigenciaFin || fechaStr <= p.vigenciaFin));
  // Plantillas de membresía activas y habilitadas en la sede (para ACTIVAR una nueva).
  const tplsActivas = (membresiasTpl ?? []).filter(t =>
    t.activo && (!t.sedesHabilitadas?.length || t.sedesHabilitadas.includes(sedeId)));
  // Composición (con saldo por ítem) de la membresía elegida, SOLO los servicios de la unidad de
  // la pestaña actual (`servicios`). Los servicios de la membresía de OTRAS unidades (baro, fisio,
  // dermato…) se agendan desde SU pestaña — ahí aparece la misma membresía ya activa. Así el drawer
  // nunca intenta agendar un servicio de otra unidad (profesionales/disponibilidad/unidad son de esta).
  const serviciosUnidadIds = new Set((servicios ?? []).map(s => s.id));
  const membComposicion: { servicioId: string; etiqueta: string; subcategoriaId: string | null; subcategoriaEtiqueta?: string; total: number; quedan: number }[] = (() => {
    let items: { servicioId: string; etiqueta: string; subcategoriaId: string | null; subcategoriaEtiqueta?: string; total: number; quedan: number }[] = [];
    if (membSel.startsWith('inst:')) {
      const pp = membresiasActivas.find(p => `inst:${p.id}` === membSel);
      items = (pp?.composicion ?? []).map(i => ({ servicioId: i.servicioId, etiqueta: i.etiqueta ?? 'Servicio', subcategoriaId: i.subcategoriaId ?? null, subcategoriaEtiqueta: i.subcategoriaEtiqueta, total: i.cantidad, quedan: Math.max(0, i.cantidad - i.consumidas) }));
    } else if (membSel.startsWith('tpl:')) {
      const t = tplsActivas.find(x => `tpl:${x.id}` === membSel);
      items = (t?.composicion ?? []).map(i => ({ servicioId: i.servicioId, etiqueta: i.etiqueta ?? 'Servicio', subcategoriaId: i.subcategoriaId ?? null, subcategoriaEtiqueta: i.subcategoriaEtiqueta, total: i.cantidad, quedan: i.cantidad }));
    }
    return items.filter(i => serviciosUnidadIds.has(i.servicioId)); // solo servicios de ESTA unidad
  })();

  // Al elegir un SERVICIO de la membresía → fija servicio + subcategoría de la cita, y el paquete
  // a consumir (instancia existente). Para una membresía NUEVA se activa en el submit.
  useEffect(() => {
    if (!membSel || membItem === '') return;
    const item = membComposicion[Number(membItem)];
    if (!item) return;
    setServicioId(item.servicioId);
    setSubcategoriaId(item.subcategoriaId ?? '');
    setPaqueteSel(membSel.startsWith('inst:') ? membSel : '');
    setCombinar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membSel, membItem]);

  // Reset al cambiar de paciente o de membresía: limpia el ítem elegido.
  useEffect(() => { setMembItem(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [membSel, pacienteSeleccionado]);

  // Al elegir ACTIVAR una nueva membresía: fechas por defecto (hoy → hoy + duración).
  useEffect(() => {
    if (!membSel.startsWith('tpl:')) return;
    const t = tplsActivas.find(x => `tpl:${x.id}` === membSel);
    const hoy = format(new Date(), 'yyyy-MM-dd');
    const d = new Date(hoy + 'T12:00:00'); d.setMonth(d.getMonth() + (t?.duracionMeses ?? 12));
    setMembInicio(hoy); setMembFin(format(d, 'yyyy-MM-dd'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membSel]);

  // Opciones que la recepción puede ELEGIR (incluye médicos de baro + Daniel "solo por solicitud").
  const { data: profesionales } = useQuery({
    queryKey: ['profesionales-seleccionables', sedeId, unidadNegocioId, fechaStr, servicioId],
    queryFn: () => profesionalesApi.seleccionables({ sedeId, unidadNegocioId, fecha: fechaStr, servicioId: servicioId || undefined }),
    enabled: modoReserva !== 'sin_eleccion' && !!servicioId,
  });

  // Profesionales que pueden atender el servicio EXTRA (default: la misma del ancla).
  const extraServicio = combinablesActivos.find(c => c.servicio.id === extraServicioId)?.servicio;
  const { data: profesionalesExtra } = useQuery({
    queryKey: ['profesionales-extra', sedeId, extraServicio?.unidadNegocioId, fechaStr, extraServicioId],
    queryFn: () => profesionalesApi.seleccionables({ sedeId, unidadNegocioId: extraServicio!.unidadNegocioId, fecha: fechaStr, servicioId: extraServicioId }),
    enabled: combinar && !!extraServicioId && !!extraServicio,
  });
  // Paquetes del paciente para el servicio EXTRA (mismo criterio de cupo que el principal).
  const instanciasExtraDisp = (paquetesPaciente ?? [])
    .filter(pp => cubrePaquete(pp, extraServicioId, null) && comprometidas(pp) < pp.sesionesTotal);
  const plantillasExtra = (plantillasPaquete ?? []).filter(t => t.activo && t.tipo !== 'MEMBRESIA' && !t.promocionId && t.servicio.id === extraServicioId);
  const extraPaqueteElegible = combinar && !!extraServicioId && (instanciasExtraDisp.length > 0 || plantillasExtra.length > 0);
  useEffect(() => {
    setExtraPaqueteSel(instanciasExtraDisp.length === 1 ? `inst:${instanciasExtraDisp[0].id}` : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraServicioId, paquetesPaciente]);

  // Horarios DISPONIBLES del servicio (y del profesional si se eligió uno): respeta su turno,
  // los ocupados, almuerzo/permiso y la regla de hora entera.
  const { data: dispo, isFetching: dispoCargando } = useQuery({
    queryKey: ['disponibilidad', sedeId, unidadNegocioId, servicioId, fechaStr, profesionalId],
    queryFn: () => disponibilidadApi.consultar({ sede: sedeId, unidadNegocio: unidadNegocioId, servicio: servicioId, fecha: fechaStr, profesional: profesionalId || undefined }),
    enabled: !!sedeId && !!unidadNegocioId && !!servicioId,
  });

  // Ocupación del profesional elegido ese día en CUALQUIER unidad (para avisar "Solo X"
  // que ya está ocupado, p.ej. Daniel en Podología bloquea su baro). Las horas ocupadas
  // ya se excluyen de la disponibilidad; este aviso explica por qué no están.
  const { data: citasDiaSede = [] } = useQuery({
    queryKey: ['ocupacion-prof', sedeId, fechaStr],
    queryFn: () => citasApi.listar({ sedeId, fecha: fechaStr }),
    enabled: !!sedeId && !!profesionalId,
  });
  const horasOcupadasProf = useMemo(() => {
    if (!profesionalId) return [] as { hora: string; unidad: string }[];
    return citasDiaSede
      .filter(c => (c.profesionalId === profesionalId || c.solicitadoProfesional?.id === profesionalId)
        && !esCitaInactiva(c.estado))
      .map(c => ({ hora: c.horaInicio, unidad: c.unidadNegocio.nombre }))
      .sort((a, b) => a.hora.localeCompare(b.hora));
  }, [citasDiaSede, profesionalId]);

  // ¿El profesional está BLOQUEADO (permiso/almuerzo) a la hora elegida? Devuelve el
  // bloqueo que solapa [hora, hora+duración) o null. El selector desactiva la opción —
  // el backend igual rechazaría (SLOT_BLOQUEADO), pero mejor no ofrecer lo imposible.
  const bloqueoEnHora = (
    p: { bloqueos?: { horaInicio: string; horaFin: string; motivo: string }[] },
    horaSel: string,
    duracionMin: number,
  ) => {
    if (!p.bloqueos?.length || !horaSel) return null;
    const [h, m] = horaSel.split(':').map(Number);
    const ini = (h || 0) * 60 + (m || 0);
    const fin = ini + duracionMin;
    return p.bloqueos.find(b => {
      const [bh, bm] = b.horaInicio.split(':').map(Number);
      const [fh, fm] = b.horaFin.split(':').map(Number);
      return ini < (fh || 0) * 60 + (fm || 0) && fin > (bh || 0) * 60 + (bm || 0);
    }) ?? null;
  };
  // Horario efectivo de la sede para esa fecha (para distinguir "sede cerrada ese día"
  // de "abierta pero sin cupos"). `abierto=false` → no se atiende; `esExcepcion` → día especial.
  const { data: horarioEf } = useQuery({
    queryKey: ['horario-efectivo', sedeId, fechaStr],
    queryFn: () => horariosApi.efectivo(sedeId, fechaStr),
    enabled: !!sedeId && !!fechaStr,
  });
  const sedeCerradaEseDia = horarioEf?.efectivo?.abierto === false;
  const diaHabilitadoExcepcion = horarioEf?.efectivo?.abierto === true && horarioEf?.efectivo?.esExcepcion === true;

  const horasDisponibles = [...new Set((dispo?.slots ?? []).map(s => s.horaInicio))].sort();
  // Si la hora elegida ya no está disponible (cambió servicio/profesional/fecha), limpiarla.
  useEffect(() => {
    if (servicioId && dispo && hora && !horasDisponibles.includes(hora)) setHora('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispo]);

  const crearPacienteMutation = useMutation({
    mutationFn: () => pacientesApi.crear({
      nombres: npNombres.trim(),
      apellidoPaterno: npApellidoPat.trim(),
      apellidoMaterno: npApellidoMat.trim(),
      tipoDocumento: npTipoDoc,
      numeroDocumento: npNumDoc.trim(),
      telefono: npTel.trim(),
      email: npEmail.trim() || undefined,
      fechaNacimiento: npFechaNac || undefined,
      ubigeoId: npUbigeoId ?? undefined,
      paisResidencia: npUbigeoId === UBIGEO_EXTRANJERO ? (npPais ?? undefined) : undefined,
    } as never),
    onSuccess: (p) => {
      setPacienteSeleccionado({ id: p.id, nombreCompleto: `${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`, telefono: p.telefono });
      setPasoPaciente('elegir');
      toast.success('Paciente creado');
    },
    onError: async (e: Error) => {
      // Red de seguridad: si el documento ya existía (carrera con el índice único),
      // en vez de mostrar solo el error, cargamos al paciente existente.
      const codigo = (e as { data?: { error?: string; code?: string } }).data;
      const esDuplicado = codigo?.error === 'PACIENTE_DUPLICADO' || codigo?.code === 'PACIENTE_DUPLICADO';
      if (esDuplicado) {
        try {
          const doc = npNumDoc.trim();
          const encontrados = await pacientesApi.buscar(doc);
          const ya = encontrados.find((p) => p.numeroDocumento === doc && p.tipoDocumento === npTipoDoc);
          if (ya) {
            setPacienteSeleccionado(ya);
            toast.success(`Ya registrado: ${ya.nombreCompleto}. Se cargó automáticamente.`);
            return;
          }
        } catch { /* cae al toast de error de abajo */ }
      }
      toast.error(e.message);
    },
  });

  // Resuelve una selección de paquete ("inst:<id>" | "tpl:<id>" | "") a un paquetePacienteId,
  // activando una plantilla al vuelo si hace falta. Reutilizado por el ancla y el extra.
  const resolverPaquete = async (sel: string): Promise<string | undefined> => {
    if (sel.startsWith('inst:')) return sel.slice(5);
    if (sel.startsWith('tpl:')) {
      const inst = await paquetesApi.asignar(pacienteSeleccionado!.id, {
        paqueteId: sel.slice(4),
        fechaCompra: format(new Date(), 'yyyy-MM-dd'),
        sedeId, // candado de sede: el paquete se atiende donde se compró
      }) as { id: string };
      return inst.id;
    }
    if (sel.startsWith('gxtpl:')) {
      // Continuación de Genexis creada por recepción: nace GENEXIS_APERTURA sin anclar;
      // el nº de sesión (sesionManual) se re-ancla al crear la cita.
      const inst = await paquetesApi.asignar(pacienteSeleccionado!.id, {
        paqueteId: sel.slice(6),
        fechaCompra: format(new Date(), 'yyyy-MM-dd'),
        sedeId,
        origenGenexis: true,
      }) as { id: string };
      return inst.id;
    }
    return undefined;
  };

  const crearCitaMutation = useMutation({
    mutationFn: async () => {
      // Flujo "membresía primero" con ACTIVAR NUEVA: se activa la membresía (vender) para el
      // paciente con la vigencia elegida ANTES de crear la cita, y se usa como paquete a consumir.
      let membPpId: string | undefined;
      if (membSel.startsWith('tpl:') && membItem !== '') {
        const promoId = membSel.slice(4);
        const item = membComposicion[Number(membItem)];
        const r = await api.post<{ id: string }>(`/membresias/${promoId}/vender`, {
          pacienteId: pacienteSeleccionado!.id, sedeId, fechaVenta: membInicio, fechaFin: membFin,
          ...(item?.subcategoriaId ? { subcategorias: [{ servicioId: item.servicioId, subcategoriaId: item.subcategoriaId }] } : {}),
        });
        membPpId = r.id;
      }
      // Membresía EXISTENTE elegida (flujo membresía-primero): el paquete a consumir es la
      // propia membresía, SIN depender de `paqueteSel` (un efecto de auto-propuesta podía
      // pisarlo y la cita se creaba desconectada de la membresía → no descontaba sesión).
      if (!membPpId && membSel.startsWith('inst:') && membItem !== '') {
        membPpId = membSel.slice('inst:'.length);
      }
      const paquetePacienteId = membPpId ?? await resolverPaquete(paqueteSel);

      // ── Bloque combinado: 2 citas atómicas (profilaxis ancla + extra). SIN optimistic
      // UI: esperamos la respuesta del server antes de refrescar (aparecen o fallan juntas).
      if (combinar && esServicioAncla && extraServicioId) {
        const extraPaquetePacienteId = await resolverPaquete(extraPaqueteSel);
        return citasApi.crearCombinada({
          pacienteId: pacienteSeleccionado!.id,
          profesionalId: profesionalId || undefined, // si no se eligió → auto-asignación
          sedeId,
          unidadNegocioId,
          servicioId,
          subcategoriaId: subcategoriaId || null,
          fecha: fechaStr,
          horaInicio: hora,
          canal,
          comentarioRecepcion: comentario || undefined,
          paquetePacienteId,
          promocionId: promocionId || null, // se guarda 1 vez (backend → PRINCIPAL)
          extra: {
            servicioId: extraServicioId,
            profesionalId: extraProfesionalId || undefined,
            paquetePacienteId: extraPaquetePacienteId,
          },
        });
      }

      return citasApi.crear({
        pacienteId: pacienteSeleccionado!.id,
        profesionalId: modoReserva === 'sin_eleccion' ? null : (profesionalId || null),
        sedeId,
        unidadNegocioId,
        servicioId,
        subcategoriaId: subcategoriaId || null,
        fecha: fechaStr,
        horaInicio: hora,
        canal,
        comentarioRecepcion: comentario || undefined,
        paquetePacienteId,
        // Genexis: la sesión elegida a mano del desplegable (adjudicación manual)
        ...(sesionManual ? { sesionNumeroManual: Number(sesionManual) } : {}),
        promocionId: promocionId || null,
        ...(comprobante ? {
          comprobanteUrl: comprobante.url,
          comprobanteNombre: comprobante.nombre,
          comprobanteMimeType: comprobante.mimeType,
        } : {}),
      }, idempotencyKeyRef.current);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['citas'] });
      qc.invalidateQueries({ queryKey: ['paquetes-paciente'] });
      qc.invalidateQueries({ queryKey: ['paquetes-sesiones'] }); // saldos (membresías)
      toast.success(combinar ? 'Bloque combinado agendado (2 servicios)' : ((paqueteSel.startsWith('inst:') || paqueteSel.startsWith('tpl:') || membSel) ? 'Sesión de membresía/paquete agendada' : 'Cita agendada'));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const servicioSeleccionado = servicios?.find(s => s.id === servicioId);
  // Subcategorías del servicio (ej. Profilaxis → Regular/Premium/…). Si tiene, elegir una
  // es obligatorio. La subcategoría define el precio referencial mostrado.
  const subcategorias = servicioSeleccionado?.subcategorias ?? [];
  const requiereSubcategoria = subcategorias.length > 0;
  const subcategoriaSel = subcategorias.find(s => s.id === subcategoriaId);
  // Instancia elegida en el selector (para saber si es Genexis y qué números quedan libres).
  const instanciaSel = paqueteSel.startsWith('inst:')
    ? (paquetesPaciente ?? []).find(pp => pp.id === paqueteSel.slice(5))
    : undefined;
  // "gxtpl:<id>" = recepción CREA un paquete continuación de Genexis (para los casos
  // que NO se concilian por admin — rojos): mira el visor y adjudica la sesión.
  const plantillaGxSel = paqueteSel.startsWith('gxtpl:')
    ? (plantillasPaquete ?? []).find(t => t.id === paqueteSel.slice(6))
    : undefined;
  // Genexis SIN ANCLAR (paquete existente conciliado) o continuación nueva creada por
  // recepción: la sesión la adjudica ella con el desplegable (TODAS las sesiones).
  const esGenexisInst = instanciaSel?.origen === 'GENEXIS_APERTURA' && !instanciaSel?.anclado;
  const esGenexis = esGenexisInst || !!plantillaGxSel;
  const totalSesionesGx = instanciaSel?.sesionesTotal ?? plantillaGxSel?.totalSesiones ?? 0;
  const numerosDisponibles = esGenexis
    ? Array.from({ length: totalSesionesGx }, (_, i) => i + 1)
        .filter(n => !(instanciaSel?.numerosOcupados ?? []).includes(n))
    : [];
  const sesionSugerida = esGenexisInst && instanciaSel ? Math.min((instanciaSel.aperturaConsumidas ?? 0) + 1, instanciaSel.sesionesTotal) : null;
  const slotInvalidoParaServicio = !!servicioSeleccionado && !horaInicioValidaParaDuracion(hora, servicioSeleccionado.duracionMinutos);
  // Si el servicio tiene paquetes elegibles, el campo "Paquete de sesiones" es OBLIGATORIO:
  // hay que elegir explícitamente una opción (un paquete o "Sin paquete"), no dejar el placeholder.
  const paqueteElegible = !!pacienteSeleccionado && !!servicioId && (instanciasDisponibles.length > 0 || plantillasServicio.length > 0);
  // En bloque combinado: la profesional del ancla ES obligatoria (acción deliberada sobre
  // una columna), debe elegirse el servicio extra, y su paquete si es elegible.
  // En combinado NO se exige profesional aparte: el chequeo general de arriba ya pide
  // profesional solo cuando el modo lo requiere (fisio). Profilaxis permite auto-asignación.
  const combinadoValido = !combinar || (!!extraServicioId && (!extraPaqueteElegible || extraPaqueteSel !== ''));
  // Flujo membresía: si eligió una membresía, debe elegir el servicio (ítem); si ACTIVA una nueva,
  // la vigencia debe ser válida (fin > inicio).
  const membValido = !membSel || (membItem !== '' && (!membSel.startsWith('tpl:') || (!!membInicio && !!membFin && membFin > membInicio)));
  // El profesional elegido NO puede estar bloqueado (permiso/almuerzo) a la hora elegida.
  // Las opciones ya salen desactivadas; esto cubre el caso de quedar elegido y luego
  // cambiar la hora a una bloqueada (el backend igual rechazaría con SLOT_BLOQUEADO).
  const bloqueoProfSel = profesionalId
    ? bloqueoEnHora(profesionales?.find(p => p.id === profesionalId) ?? {}, hora, servicioSeleccionado?.duracionMinutos ?? 30)
    : null;
  const valido = !!pacienteSeleccionado && !!servicioId && !!hora && !slotInvalidoParaServicio &&
    !bloqueoProfSel && // profesional bloqueado a esa hora → no se puede agendar
    (!requiereSubcategoria || !!subcategoriaId) && // subcategoría obligatoria si el servicio la tiene
    (modoReserva === 'sin_eleccion' || modoReserva === 'preferencia_opcional' || !!profesionalId) &&
    (!paqueteElegible || paqueteSel !== '' || !!membSel) && // la membresía cubre el consumo
    (!esGenexis || sesionManual !== '') && // Genexis: exige adjudicar la sesión
    membValido &&
    combinadoValido;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-limablue-600">
          <div>
            <h2 className="text-base font-semibold text-white">Nueva Cita</h2>
            <p className="text-xs text-limablue-200 mt-0.5">
              {format(fechaLocal, "d 'de' MMMM · yyyy")}
              {hora && ` · ${hora}`}
            </p>
          </div>
          <button onClick={onClose} className="text-limablue-200 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* ── Paciente ── */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Paciente <span className="text-red-500">*</span>
            </label>

            {/* Paciente ya seleccionado */}
            {pacienteSeleccionado ? (
              <div className="space-y-2">
              <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-green-200 flex items-center justify-center text-green-800 text-xs font-bold shrink-0">
                    {pacienteSeleccionado.nombreCompleto[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
                      <RomboAlerta alerta={pacienteSeleccionado.alerta} size={13} />
                      <span>{pacienteSeleccionado.nombreCompleto}</span>
                    </p>
                    <p className="text-xs text-green-600">{pacienteSeleccionado.telefono}</p>
                    {/* Asistencia histórica SOLO Limablue: para dar horarios con criterio */}
                    <div className="mt-1">
                      <BadgeAsistencia alerta={pacienteSeleccionado.alerta} />
                    </div>
                    {pacienteSeleccionado.alerta?.alerta && (
                      <p className="text-[11px] font-semibold text-amber-700 mt-0.5">
                        {pacienteSeleccionado.alerta.frecuenteInasistente && `No asiste con frecuencia (${pacienteSeleccionado.alerta.noShows}). `}
                        {pacienteSeleccionado.alerta.frecuenteReprogramador && `Reprograma con frecuencia (${pacienteSeleccionado.alerta.reprogramaciones}).`}
                      </p>
                    )}
                  </div>
                </div>
                <button onClick={resetPaciente} className="text-xs text-green-600 hover:text-red-500 transition-colors font-medium">
                  Cambiar
                </button>
              </div>
              <CuadroFamiliares familiares={pacienteSeleccionado.familiares} compacto />
              </div>

            ) : pasoPaciente === 'elegir' ? (
              /* PASO 0: ¿Nuevo o existente? */
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setPasoPaciente('existente')}
                  data-testid="drawer-paciente-existente"
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 hover:border-limablue-400 hover:bg-limablue-50 transition-all text-center group"
                >
                  <svg className="w-7 h-7 text-slate-400 group-hover:text-limablue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 group-hover:text-limablue-700">Paciente existente</p>
                    <p className="text-xs text-slate-400 mt-0.5">Ya está registrado</p>
                  </div>
                </button>
                <button
                  onClick={() => setPasoPaciente('nuevo')}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 transition-all text-center group"
                >
                  <svg className="w-7 h-7 text-slate-400 group-hover:text-emerald-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-slate-700 group-hover:text-emerald-700">Paciente nuevo</p>
                    <p className="text-xs text-slate-400 mt-0.5">Registrar por primera vez</p>
                  </div>
                </button>
              </div>

            ) : pasoPaciente === 'existente' ? (
              /* PASO 1A: Buscar paciente existente */
              <div className="space-y-3">
                {/* Selector modo búsqueda */}
                <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                  {([
                    { id: 'documento', label: '🪪 Por DNI / CE / Pasaporte' },
                    { id: 'nombre',    label: '🔤 Por nombre' },
                  ] as { id: 'documento' | 'nombre'; label: string }[]).map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => { setModoBusqueda(opt.id); setPacienteQuery(''); }}
                      className={cn(
                        'flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-all',
                        modoBusqueda === opt.id
                          ? 'bg-white text-limablue-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Input de búsqueda */}
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    className="input text-sm pl-9"
                    placeholder={modoBusqueda === 'documento' ? 'Ingresa el número de documento…' : 'Escribe el nombre del paciente…'}
                    value={pacienteQuery}
                    onChange={e => setPacienteQuery(e.target.value)}
                    autoFocus
                    data-testid="drawer-paciente-buscar"
                  />

                  {/* Resultados dropdown */}
                  {pacientesSugeridos && pacientesSugeridos.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-52 overflow-y-auto">
                      {pacientesSugeridos.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setPacienteSeleccionado(p); setPacienteQuery(''); }}
                          data-testid={`drawer-paciente-result-${p.id}`}
                          className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 flex items-center gap-2.5"
                        >
                          <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-xs font-bold shrink-0">
                            {p.nombres[0]}{p.apellidoPaterno[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5">
                              <RomboAlerta alerta={p.alerta} size={11} />
                              <span className="truncate">{p.nombreCompleto}</span>
                            </p>
                            <p className="text-xs text-slate-500">{p.tipoDocumento} {p.numeroDocumento} · {p.telefono}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {pacienteQuery.length >= 2 && pacientesSugeridos?.length === 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 p-4 text-center">
                      <p className="text-sm text-slate-500 mb-3">No se encontró ningún paciente</p>
                      <button
                        onClick={() => {
                          // Si buscó por documento con un DNI válido, lo arrastra al
                          // formulario nuevo → dispara el autollenado RENIEC al instante.
                          if (modoBusqueda === 'documento' && /^\d{8}$/.test(pacienteQuery.trim())) {
                            setNpTipoDoc('DNI');
                            setNpNumDoc(pacienteQuery.trim());
                          }
                          setPasoPaciente('nuevo');
                        }}
                        className="btn-primary btn-sm w-full"
                      >
                        + Registrar como paciente nuevo
                      </button>
                    </div>
                  )}
                </div>

                <button onClick={resetPaciente} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Volver
                </button>
              </div>

            ) : (
              /* PASO 1B: Registrar paciente nuevo */
              <div className="space-y-2.5 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-slate-700">Datos del nuevo paciente</p>
                  <button onClick={resetPaciente} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Volver
                  </button>
                </div>

                <input className="input text-sm" placeholder="Nombres *" value={npNombres} onChange={e => setNpNombres(toTitleCase(e.target.value))} />

                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-sm" placeholder="Apellido paterno *" value={npApellidoPat} onChange={e => setNpApellidoPat(toTitleCase(e.target.value))} />
                  <input className="input text-sm" placeholder="Apellido materno *" value={npApellidoMat} onChange={e => setNpApellidoMat(toTitleCase(e.target.value))} />
                </div>

                <div className="grid grid-cols-5 gap-2">
                  <select className="input text-sm col-span-2" value={npTipoDoc} onChange={e => setNpTipoDoc(e.target.value as 'DNI' | 'CE' | 'PASAPORTE')}>
                    <option value="DNI">DNI</option>
                    <option value="CE">CE</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </select>
                  <input
                    className="input text-sm col-span-3"
                    placeholder={npTipoDoc === 'DNI' ? 'Número (8 dígitos) *' : npTipoDoc === 'CE' ? 'Nº carnet extranjería *' : 'Nº pasaporte *'}
                    value={npNumDoc}
                    onChange={e => setNpNumDoc(npTipoDoc === 'DNI' ? e.target.value.replace(/\D/g, '') : e.target.value)}
                    maxLength={npTipoDoc === 'DNI' ? 8 : 20}
                    inputMode={npTipoDoc === 'DNI' ? 'numeric' : 'text'}
                    autoFocus
                  />
                </div>
                {npTipoDoc === 'DNI' && (
                  <p className="text-[10px] text-slate-400 -mt-1 flex items-center gap-1">
                    {dniConsultando ? (
                      <>
                        <svg className="w-3 h-3 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                        </svg>
                        Consultando RENIEC…
                      </>
                    ) : (
                      'Al ingresar los 8 dígitos se autollenan los nombres desde RENIEC.'
                    )}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Celular *</label>
                    <input className="input text-sm" placeholder="9XXXXXXXX" value={npTel} onChange={e => setNpTel(e.target.value)} maxLength={15} />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Fecha de nacimiento</label>
                    <input type="date" className="input text-sm" value={npFechaNac} onChange={e => setNpFechaNac(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">Correo electrónico</label>
                  <input type="email" className="input text-sm" placeholder="correo@ejemplo.com" value={npEmail} onChange={e => setNpEmail(e.target.value)} />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">Distrito de residencia <span className="text-red-500">*</span></label>
                  <DistritoAutocomplete
                    value={npUbigeoId}
                    onChange={(id) => { setNpUbigeoId(id); if (id !== UBIGEO_EXTRANJERO) setNpPais(null); }}
                  />
                </div>
                {npUbigeoId === UBIGEO_EXTRANJERO && (
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">País de residencia <span className="text-red-500">*</span></label>
                    <PaisAutocomplete value={npPais} onChange={setNpPais} />
                  </div>
                )}

                <button
                  onClick={() => crearPacienteMutation.mutate()}
                  disabled={!npNombres || !npApellidoPat || !npApellidoMat || !npNumDoc || !npTel || !npUbigeoId || (npUbigeoId === UBIGEO_EXTRANJERO && !npPais) || crearPacienteMutation.isPending}
                  className="btn-primary btn-sm w-full mt-1"
                >
                  {crearPacienteMutation.isPending ? 'Guardando...' : 'Crear paciente'}
                </button>
              </div>
            )}
          </div>

          {/* ── Membresía (opcional): elige una activa del paciente o activa una nueva, y luego
                 elige qué servicio agendar viendo el saldo de cada uno. Fija el servicio de la cita. ── */}
          {pacienteSeleccionado && (membresiasActivas.length > 0 || tplsActivas.length > 0) && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2">
              <label className="block text-xs font-semibold text-violet-800">Membresía (opcional)</label>
              <select className="input text-sm" value={membSel} onChange={e => setMembSel(e.target.value)}>
                <option value="">— No usar membresía —</option>
                {membresiasActivas.length > 0 && (
                  <optgroup label="Membresías activas del paciente">
                    {membresiasActivas.map(p => (
                      <option key={p.id} value={`inst:${p.id}`}>
                        {p.nombre} — {p.saldo} sesión(es) · vence {p.vigenciaFin ?? '—'}
                      </option>
                    ))}
                  </optgroup>
                )}
                {tplsActivas.length > 0 && (
                  <optgroup label="Activar nueva membresía">
                    {tplsActivas.map(t => <option key={t.id} value={`tpl:${t.id}`}>➕ {t.nombre}</option>)}
                  </optgroup>
                )}
              </select>

              {/* Vigencia al ACTIVAR una nueva */}
              {membSel.startsWith('tpl:') && (
                <div className="flex gap-2">
                  <label className="block text-xxs text-violet-700 flex-1">Inicio
                    <input type="date" className="input text-xs" value={membInicio} onChange={e => setMembInicio(e.target.value)} />
                  </label>
                  <label className="block text-xxs text-violet-700 flex-1">Fin de vigencia
                    <input type="date" className="input text-xs" min={membInicio} value={membFin} onChange={e => setMembFin(e.target.value)} />
                  </label>
                </div>
              )}

              {/* Servicio de la membresía a agendar (con saldo por servicio) — solo los de esta unidad */}
              {membSel && membComposicion.length > 0 && (
                <label className="block text-xs font-semibold text-violet-800">Servicio a agendar
                  <select className="input text-sm" value={membItem} onChange={e => setMembItem(e.target.value)}>
                    <option value="">— Elegir servicio de la membresía —</option>
                    {membComposicion.map((it, i) => (
                      <option key={i} value={String(i)} disabled={it.quedan <= 0}>
                        {it.etiqueta}{it.subcategoriaEtiqueta ? ` (${it.subcategoriaEtiqueta})` : ''} — {it.quedan <= 0 ? 'agotado' : `queda ${it.quedan} de ${it.total}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {membSel && membComposicion.length === 0 && (
                <p className="text-xxs text-amber-700">Esta membresía no incluye servicios de esta unidad. Agenda sus otros servicios desde su pestaña (Baropodometría, Fisioterapia, etc.).</p>
              )}
              {membSel.startsWith('tpl:') && <p className="text-xxs text-violet-600">La membresía se activará al confirmar la cita, con la vigencia indicada.</p>}
            </div>
          )}

          {/* Servicio */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Servicio <span className="text-red-500">*</span>
              {membItem !== '' && <span className="ml-1 text-xxs font-normal text-violet-600">· fijado por la membresía</span>}
            </label>
            <select
              className="input text-sm disabled:bg-slate-50 disabled:text-slate-500"
              value={servicioId}
              disabled={membItem !== ''}
              onChange={e => { setServicioId(e.target.value); setSubcategoriaId(''); }}
              data-testid="drawer-servicio"
            >
              <option value="">Seleccionar servicio...</option>
              {servicios?.map(s => (
                <option key={s.id} value={s.id}>
                  {s.nombre} ({s.duracionMinutos} min)
                </option>
              ))}
            </select>
          </div>

          {/* Subcategoría del servicio (ej. Profilaxis → Regular/Premium/…): obligatoria si existe */}
          {requiereSubcategoria && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Tipo de {servicioSeleccionado?.nombre?.toLowerCase()} <span className="text-red-500">*</span>
              </label>
              <select className="input text-sm" value={subcategoriaId} onChange={e => setSubcategoriaId(e.target.value)}>
                <option value="">Seleccionar tipo...</option>
                {subcategorias.map(sc => (
                  <option key={sc.id} value={sc.id}>
                    {sc.nombre}{sc.precioReferencial != null ? ` · S/ ${Number(sc.precioReferencial).toFixed(2)}` : ''}
                  </option>
                ))}
              </select>
              {!subcategoriaId && <p className="mt-1 text-xxs text-amber-600">Elige el tipo para saber a cuál te refieres.</p>}
            </div>
          )}

          {/* Canal de reserva — de dónde viene el cliente */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Canal de reserva</label>
            <select className="input text-sm" value={canal} onChange={e => setCanal(e.target.value)}>
              {canalesOpts.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* Promoción (opcional) — disponible en TODA cita de las 3 unidades */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Promoción (opcional)</label>
            <select className="input text-sm" value={promocionId} onChange={e => setPromocionId(e.target.value)}>
              <option value="">— Ninguna —</option>
              {promociones.map(p => (
                <option key={p.id} value={p.id}>
                  {p.nombre}{p.tipo !== 'OTRO' ? ` · ${formatPromoValor(p.tipo, p.valor)}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Banner de paquete/membresía (endpoint único de saldos + candado de sede) */}
          {pacienteSeleccionado && servicioId && (!requiereSubcategoria || subcategoriaId) && <BannerPaqueteDrawer pacienteId={pacienteSeleccionado.id} servicioId={servicioId} sedeId={sedeId} subcategoriaId={subcategoriaId || null} fecha={fechaStr} />}

          {/* Paquete (sesiones) — SOLO los del servicio elegido (no toda la lista del sistema) */}
          {pacienteSeleccionado && servicioId && (instanciasDisponibles.length > 0 || plantillasServicio.length > 0 || instanciasAgotadas.length > 0) && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Paquete de sesiones {paqueteElegible && <span className="text-red-500">*</span>}
              </label>
              <select className="input text-sm" value={paqueteSel} onChange={e => setPaqueteSel(e.target.value)}>
                <option value="" disabled>— Selecciona una opción —</option>
                <option value="sin">Sin paquete (cita normal)</option>
                {instanciasDisponibles.length > 0 && (
                  <optgroup label="Paquetes activos del paciente">
                    {instanciasDisponibles.map(pp => (
                      <option key={pp.id} value={`inst:${pp.id}`}>
                        📦 {pp.paquete.nombre} — {pp.origen === 'GENEXIS_APERTURA' && !pp.anclado ? `paquete Genexis (elegir sesión abajo)` : `agendar sesión ${proximaSesion(pp)} de ${pp.sesionesTotal}`}
                      </option>
                    ))}
                  </optgroup>
                )}
                {plantillasServicio.length > 0 && !tienePaqueteActivoServicio && (
                  <optgroup label="Activar paquete nuevo">
                    {plantillasServicio.map(t => (
                      <option key={t.id} value={`tpl:${t.id}`}>
                        ➕ {t.nombre} ({t.totalSesiones} sesiones) — empezar en sesión 1
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* Continuación de Genexis: recepción crea el paquete y adjudica la sesión
                    (para los casos que NO se concilian por admin). Solo si el paciente
                    tiene historial Genexis y no hay ya un paquete activo del servicio. */}
                {existeGenexis?.existe && plantillasServicio.length > 0 && !tienePaqueteActivoServicio && (
                  <optgroup label="Continuación de Genexis (adjudico la sesión)">
                    {plantillasServicio.map(t => (
                      <option key={t.id} value={`gxtpl:${t.id}`}>
                        🗄️ {t.nombre} — viene de Genexis (elegir sesión abajo)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {/* Botón para revisar el historial Genexis y decidir qué sesión adjudicar */}
              {existeGenexis?.existe && (
                <button
                  type="button"
                  onClick={() => setVerVisorGenexis(true)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-100"
                >
                  🗄️ Ver Historial Genexis ({existeGenexis.total}) para adjudicar la sesión
                </button>
              )}
              {tienePaqueteActivoServicio && plantillasServicio.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">El paciente ya tiene un paquete con sesiones disponibles; úsalo. Podrás activar otro cuando se llene.</p>
              )}
              {/* Aviso de paquete(s) agotado(s): SOLO si no hay otro paquete con cupo. Si el
                  paciente ya tiene uno disponible (arriba), avisar "active uno nuevo" se
                  contradice y confunde — en ese caso se omite. */}
              {!tienePaqueteActivoServicio && instanciasAgotadas.map(pp => (
                <p key={pp.id} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1.5">
                  ⚠️ El paquete «{pp.paquete.nombre}» está completo ({pp.sesionesTotal}/{pp.sesionesTotal} sesiones). Si el paciente necesita más, active un paquete nuevo.
                </p>
              ))}
              {(paqueteSel.startsWith('inst:') || paqueteSel.startsWith('tpl:')) && !esGenexis && (
                <p className="text-xs text-indigo-600 mt-1">La sesión se numera automáticamente.</p>
              )}
              {/* ── MIGRACIÓN GENEXIS: adjudicación MANUAL de la sesión ──
                  La sesión NO se cuenta en automático: recepción/contact revisa el
                  Historial Genexis del paciente y elige del desplegable qué sesión
                  corresponde. Solo para paquetes conciliados desde Genexis. */}
              {esGenexis && (instanciaSel || plantillaGxSel) && (
                <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    ¿Qué sesión corresponde? <span className="text-red-500">*</span>
                    <span className="ml-1 font-normal text-slate-400">(revisa el Historial Genexis del paciente)</span>
                  </label>
                  <select
                    className="input text-sm"
                    value={sesionManual}
                    onChange={e => setSesionManual(e.target.value)}
                  >
                    <option value="" disabled>— Elegir sesión —</option>
                    {numerosDisponibles.map(n => (
                      <option key={n} value={n}>Sesión {n} de {totalSesionesGx}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500">
                    🗄️ {plantillaGxSel
                      ? 'Continuación de Genexis: mira el Historial y elige qué sesión le toca.'
                      : 'Paquete migrado de Genexis: la numeración la adjudicas tú, no el sistema.'}
                    {(instanciaSel?.aperturaConsumidas ?? 0) > 0 && ` La conciliación registró ${instanciaSel!.aperturaConsumidas} tomadas en Genexis`}
                    {sesionSugerida && <> — <b>sugerida: Sesión {sesionSugerida}</b></>}.
                    {' '}El paquete se ancla a tu elección y <b>desde la siguiente sesión se cuenta en automático</b> en la Agenda.
                  </p>
                  {sesionManual === '' && <p className="text-xs text-red-500">Elige la sesión para continuar.</p>}
                </div>
              )}
              {paqueteElegible && paqueteSel === '' && (
                <p className="text-xs text-red-500 mt-1">Elige una opción para continuar.</p>
              )}
            </div>
          )}

          {/* Profesional (según modo) */}
          {modoReserva !== 'sin_eleccion' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Profesional {modoReserva === 'preferencia_obligatoria' && <span className="text-red-500">*</span>}
              </label>
              <select
                className="input text-sm"
                value={profesionalId}
                onChange={e => setProfesionalId(e.target.value)}
              >
                {modoReserva === 'preferencia_opcional' && (
                  <option value="" className="font-semibold">⭐ Sin preferencia (asignación automática)</option>
                )}
                {modoReserva === 'preferencia_obligatoria' && (
                  <option value="">Seleccionar fisioterapeuta...</option>
                )}
                {profesionales?.map(p => {
                  const bloq = bloqueoEnHora(p, hora, servicioSeleccionado?.duracionMinutos ?? 30);
                  return (
                    <option key={p.id} value={p.id} disabled={!!bloq}>
                      {p.tipo === 'medico' ? 'Dr(a). ' : ''}{p.nombres} {p.apellidos}
                      {p.porSolicitud ? ' — por solicitud' : ''}
                      {bloq ? ` — 🚫 bloqueado ${bloq.horaInicio}–${bloq.horaFin}` : ''}
                    </option>
                  );
                })}
              </select>
              {modoReserva === 'preferencia_opcional' && !profesionalId && (
                <p className="text-xs text-slate-500 mt-1">Por defecto se asigna automáticamente. Elige un médico o a Daniel solo si el paciente lo pidió.</p>
              )}
              {/* Aviso: el profesional elegido está BLOQUEADO (permiso/almuerzo) a la hora elegida. */}
              {bloqueoProfSel && (
                <div className="mt-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5">
                  <p className="text-xs text-red-700 font-medium leading-snug">
                    🚫 Está bloqueado de {bloqueoProfSel.horaInicio} a {bloqueoProfSel.horaFin} ({bloqueoProfSel.motivo}). Elige otra hora u otro profesional.
                  </p>
                </div>
              )}
              {/* Aviso: el profesional elegido ya está ocupado a ciertas horas (otra unidad incluida). */}
              {profesionalId && horasOcupadasProf.length > 0 && (
                <div className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5">
                  <p className="text-xs text-amber-800 font-medium leading-snug">
                    🔒 Ya tiene cita a las {horasOcupadasProf.map(h => `${h.hora} (${h.unidad})`).join(', ')}. Esas horas no están disponibles (no puede atender en dos lugares a la vez).
                  </p>
                </div>
              )}
            </div>
          )}

          {modoReserva === 'sin_eleccion' && (
            <div className="p-3 bg-violet-50 border border-violet-200 rounded-lg">
              <p className="text-xs text-violet-700">
                El médico de baropodometría se asigna automáticamente según disponibilidad.
              </p>
            </div>
          )}

          {/* Fecha */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Fecha <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              className="input text-sm"
              value={format(fechaLocal, 'yyyy-MM-dd')}
              onChange={e => {
                const d = new Date(e.target.value + 'T12:00:00');
                if (!isNaN(d.getTime())) setFechaLocal(d);
              }}
            />
          </div>

          {/* Hora */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Hora <span className="text-red-500">*</span>
              {servicioSeleccionado && (
                <span className="font-normal text-slate-500 ml-2">
                  · Duración: {servicioSeleccionado.duracionMinutos} min
                </span>
              )}
            </label>
            <select
              className="input text-sm"
              value={hora}
              onChange={e => setHora(e.target.value)}
              disabled={!servicioId || dispoCargando}
              data-testid="drawer-hora"
            >
              {!servicioId ? (
                <option value="">Elige primero un servicio…</option>
              ) : dispoCargando ? (
                <option value="">Cargando horarios…</option>
              ) : horasDisponibles.length === 0 ? (
                <option value="">Sin horarios disponibles</option>
              ) : (
                <>
                  <option value="">-- Seleccionar hora --</option>
                  {horasDisponibles.map(val => <option key={val} value={val}>{val}</option>)}
                </>
              )}
            </select>
            {servicioId && !dispoCargando && horasDisponibles.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-600 font-medium">
                {sedeCerradaEseDia
                  ? 'La sede no atiende este día. Elige otra fecha (o habilítalo en Horarios de entrada).'
                  : diaHabilitadoExcepcion
                    ? 'Este día está habilitado pero aún no hay podólogas asignadas. Márcalas en Horarios de entrada.'
                    : profesionalId
                      ? 'Este profesional no tiene horarios libres para este servicio en la fecha elegida.'
                      : 'No hay horarios libres para este servicio en la fecha elegida.'}
              </p>
            )}
          </div>

          {/* ── Bloque combinado: profilaxis + servicio extra en el mismo turno ── */}
          {esServicioAncla && combinablesActivos.length > 0 && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-violet-600"
                  checked={combinar}
                  onChange={e => setCombinar(e.target.checked)}
                />
                <span className="text-sm font-semibold text-violet-800">Combinar servicio en este turno</span>
              </label>
              <p className="text-xs text-violet-600 -mt-1">
                Agrega un segundo servicio en la misma hora (2 servicios en 1 turno de 1 h).
              </p>

              {combinar && (
                <div className="space-y-3 pt-1">
                  {/* Servicio extra */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Servicio extra <span className="text-red-500">*</span>
                    </label>
                    <select className="input text-sm" value={extraServicioId} onChange={e => { setExtraServicioId(e.target.value); setExtraProfesionalId(''); }}>
                      <option value="">-- Seleccionar servicio --</option>
                      {combinablesActivos.map(c => (
                        <option key={c.servicio.id} value={c.servicio.id}>{c.servicio.nombre}</option>
                      ))}
                    </select>
                  </div>

                  {/* Profesional del extra (opcional: misma del ancla por defecto) */}
                  {extraServicioId && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Profesional del extra</label>
                      <select className="input text-sm" value={extraProfesionalId} onChange={e => setExtraProfesionalId(e.target.value)}>
                        <option value="">Misma profesional del ancla</option>
                        {(profesionalesExtra ?? []).map(p => {
                          const bloq = bloqueoEnHora(p, hora, extraServicio?.duracionMinutos ?? 30);
                          return (
                            <option key={p.id} value={p.id} disabled={!!bloq}>
                              {p.nombres} {p.apellidos}{bloq ? ` — 🚫 bloqueado ${bloq.horaInicio}–${bloq.horaFin}` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {/* Paquete del extra (si el servicio extra tiene paquetes del paciente) */}
                  {extraServicioId && (instanciasExtraDisp.length > 0 || plantillasExtra.length > 0) && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Paquete del extra {extraPaqueteElegible && <span className="text-red-500">*</span>}
                      </label>
                      <select className="input text-sm" value={extraPaqueteSel} onChange={e => setExtraPaqueteSel(e.target.value)}>
                        <option value="">Sin paquete</option>
                        {instanciasExtraDisp.map(pp => (
                          <option key={pp.id} value={`inst:${pp.id}`}>
                            {pp.paquete.nombre} · sesión {comprometidas(pp) + 1}/{pp.sesionesTotal}
                          </option>
                        ))}
                        {plantillasExtra.map(t => (
                          <option key={t.id} value={`tpl:${t.id}`}>Activar nuevo: {t.nombre}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Comentario */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Comentario de recepción
            </label>
            <textarea
              className="input text-sm resize-none"
              rows={2}
              placeholder="Notas internas opcionales..."
              value={comentario}
              onChange={e => setComentario(e.target.value)}
            />
          </div>

          {/* ── Comprobante de pago anticipado (opcional) — al final del formulario ── */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                  💳 Pago anticipado <span className="font-normal">(opcional)</span>
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Si el paciente pagó por adelantado, adjunta el comprobante.
                </p>
              </div>

              {/* Área de carga */}
              {!comprobante && !subiendo && (
                <div
                  className={cn(
                    'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
                    errorSubida ? 'border-red-300 bg-red-50' : 'border-amber-300 hover:border-amber-400 hover:bg-amber-100/50',
                  )}
                  onClick={() => inputFileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) subirComprobante(file);
                  }}
                >
                  <p className="text-lg mb-1">📎</p>
                  <p className="text-xs font-medium text-amber-700">Arrastra, pega (Ctrl+V) o haz clic</p>
                  <p className="text-xs text-amber-600 mt-0.5">JPG · PNG · PDF · máx. 10MB</p>
                  {errorSubida && <p className="text-xs text-red-500 mt-1">{errorSubida}</p>}
                  <input
                    ref={inputFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) subirComprobante(file);
                    }}
                  />
                </div>
              )}

              {subiendo && (
                <div className="border-2 border-dashed border-amber-300 rounded-lg p-4 flex items-center justify-center gap-2 text-amber-700">
                  <span className="w-4 h-4 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
                  <span className="text-xs">Subiendo...</span>
                </div>
              )}

              {comprobante && (
                <div className="border-2 border-emerald-300 bg-emerald-50 rounded-lg p-3 flex items-center gap-3">
                  {comprobante.mimeType.startsWith('image/') ? (
                    <img
                      src={comprobante.url}
                      alt="comprobante"
                      className="w-14 h-14 object-cover rounded border border-emerald-200 shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 bg-red-100 rounded border border-red-200 flex items-center justify-center shrink-0 text-2xl">
                      📄
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-emerald-800 truncate">{comprobante.nombre}</p>
                    <p className="text-xs text-emerald-600 mt-0.5">✓ Comprobante listo</p>
                  </div>
                  <button
                    onClick={() => { setComprobante(null); setErrorSubida(null); }}
                    className="text-slate-400 hover:text-red-500 transition-colors text-lg shrink-0"
                    title="Quitar comprobante"
                  >
                    ✕
                  </button>
                </div>
              )}

              <p className="text-xs text-amber-600">Sin comprobante la cita igual se crea con normalidad.</p>
            </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-6 py-4 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => crearCitaMutation.mutate()}
            disabled={!valido || crearCitaMutation.isPending || dispoCargando}
            className="btn-primary flex-1"
            data-testid="drawer-submit"
          >
            {crearCitaMutation.isPending ? 'Agendando...' : dispoCargando ? 'Verificando horarios…' : 'Agendar cita'}
          </button>
        </div>
      </div>

      {/* Visor Historial Genexis — para que recepción vea y adjudique la sesión */}
      {verVisorGenexis && pacienteSeleccionado && (
        <VisorHistorialGenexis
          pacienteId={pacienteSeleccionado.id}
          nombrePaciente={pacienteSeleccionado.nombreCompleto}
          documento=""
          onClose={() => setVerVisorGenexis(false)}
        />
      )}
    </>
  );
}

// ─── Banner de paquete al agendar (módulo Sesiones: endpoint único de saldos) ──
// "Tiene {paquete}: {n} restantes" · última sesión → ofrecer renovación ·
// agotado/vencido → se cobra como venta normal · otra sede → candado visible.
function BannerPaqueteDrawer({ pacienteId, servicioId, sedeId, subcategoriaId, fecha }: { pacienteId: string; servicioId: string; sedeId: string; subcategoriaId?: string | null; fecha?: string | null }) {
  const { data: paquetes } = usePaquetesPaciente(pacienteId);
  const elegibles = paquetesElegibles(paquetes, servicioId, sedeId, subcategoriaId ?? null, fecha ?? null);
  const otras = paquetesOtraSede(paquetes, servicioId, sedeId, subcategoriaId ?? null, fecha ?? null);
  const agotados = (paquetes ?? []).filter(
    p => (p.estado === 'AGOTADO' || p.estado === 'VENCIDO') && p.sede?.id === sedeId &&
      (p.servicioNuevoId === servicioId || (p.composicion ?? []).some(i => i.servicioId === servicioId && (!i.subcategoriaId || i.subcategoriaId === subcategoriaId)))
  );

  if (elegibles.length > 0) {
    const p = elegibles[0];
    const ultima = p.saldo === 1;
    return (
      <div className={cn(
        'rounded-lg border px-3 py-2 text-xs font-medium',
        ultima ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
      )}>
        📦 Tiene <b>{p.nombre}</b>: <b>{p.saldo} restante{p.saldo === 1 ? '' : 's'}</b> — esta cita puede consumir una.
        {ultima && <span className="block mt-0.5 font-bold">⚠ Última sesión del paquete — ofrecer renovación.</span>}
      </div>
    );
  }
  if (otras.length > 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        ⚠ El paquete de este paciente pertenece a <b>{otras[0].sede?.nombre}</b> — en esta sede no consume.
      </div>
    );
  }
  if (agotados.length > 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        ⚠ Paquete {agotados[0].estado === 'VENCIDO' ? 'vencido' : 'agotado'} ({agotados[0].nombre}) — se cobra como venta normal.
      </div>
    );
  }
  return <AvisoGenexisSinConciliar pacienteId={pacienteId} />;
}

// Transición Genexis: si el paciente tiene saldos propuestos pero AÚN SIN FIRMAR en
// la pantalla de conciliación, recepción vería "sin paquete" sin explicación. Este
// aviso lo aclara (el paquete aparece cuando dirección aprueba la propuesta).
function AvisoGenexisSinConciliar({ pacienteId }: { pacienteId: string }) {
  const { data } = useQuery({
    queryKey: ['conciliacion-pendiente-paciente', pacienteId],
    queryFn: () => api.get<{ total: number; familias: { familia: string; tipo: string; confianza: string }[] }>(`/conciliacion/pendientes-paciente/${pacienteId}`),
    staleTime: 60_000,
  });
  if (!data || data.total === 0) return null;
  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
      🗄️ Este paciente tiene <b>{data.total} saldo(s) de Genexis pendiente(s) de conciliación</b> — no aparecen
      como paquete hasta que dirección los apruebe en Herramientas → Conciliación de saldos.
    </div>
  );
}
