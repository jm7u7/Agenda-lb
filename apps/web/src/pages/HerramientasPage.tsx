import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays, isWeekend, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { pacientesApi, sedesApi, serviciosApi, type Sede, type Servicio } from '../api';

// ── Helpers ─────────────────────────────────────────────────────────────────

function proximoDiaHabil(base: Date): Date {
  let d = addDays(base, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

function fechaLocal(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

// ── Tipos ────────────────────────────────────────────────────────────────────
interface Paciente {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  numeroDocumento: string;
  telefono: string;
}

type Vista = 'inicio' | 'excel' | 'pdf' | 'reactivacion';

// ── Componente principal ─────────────────────────────────────────────────────
export function HerramientasPage() {
  const [vista, setVista] = useState<Vista>('inicio');

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        {vista !== 'inicio' && (
          <button
            onClick={() => setVista('inicio')}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all mr-1"
            title="Volver a Herramientas"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900">
            {vista === 'inicio'
              ? 'Herramientas'
              : vista === 'excel'
              ? 'Lista de citas · Excel'
              : vista === 'reactivacion'
              ? 'Reactivación de Pacientes · Excel'
              : 'Historial de Atenciones · PDF'}
          </h1>
          <p className="text-xs text-slate-500">
            {vista === 'inicio'
              ? 'Exportaciones y reportes para la gestión de la clínica'
              : vista === 'excel'
              ? 'Exportar agenda del día para confirmaciones WhatsApp'
              : vista === 'reactivacion'
              ? 'Pacientes que no han visitado Limablue en un período de tiempo'
              : 'Resumen de atenciones del paciente'}
          </p>
        </div>
      </div>

      {/* Contenido según vista */}
      {vista === 'inicio' && <VistaInicio onSeleccionar={setVista} />}
      {vista === 'excel' && (
        <div className="p-6 max-w-2xl">
          <ExcelTool />
        </div>
      )}
      {vista === 'pdf' && (
        <div className="p-6 max-w-2xl">
          <PdfHistorialTool />
        </div>
      )}
      {vista === 'reactivacion' && (
        <div className="p-6 max-w-2xl">
          <ReactivacionTool />
        </div>
      )}
    </div>
  );
}

// ── Vista de inicio: grid de iconos ─────────────────────────────────────────
const HERRAMIENTAS = [
  {
    id: 'excel' as Vista,
    titulo: 'Lista de citas',
    subtitulo: 'Exportar Excel',
    descripcion: 'Genera el CSV (solo texto) con las citas del día para el envío masivo de confirmaciones por WhatsApp.',
    color: 'from-emerald-500 to-teal-600',
    colorHover: 'hover:shadow-emerald-200',
    iconoBg: 'bg-emerald-600',
    tag: 'XLSX',
    tagColor: 'bg-emerald-100 text-emerald-700',
    icon: (
      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'reactivacion' as Vista,
    titulo: 'Reactivación de Pacientes',
    subtitulo: 'Exportar Excel',
    descripcion: 'Identifica pacientes que llevan tiempo sin venir para llamarlos o escribirles y recuperar su agenda.',
    color: 'from-violet-500 to-purple-700',
    colorHover: 'hover:shadow-violet-200',
    iconoBg: 'bg-violet-600',
    tag: 'XLSX',
    tagColor: 'bg-violet-100 text-violet-700',
    icon: (
      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'pdf' as Vista,
    titulo: 'Historial de Atenciones',
    subtitulo: 'Exportar PDF',
    descripcion: 'Genera el historial completo de atenciones de un paciente en formato PDF.',
    color: 'from-indigo-500 to-violet-600',
    colorHover: 'hover:shadow-indigo-200',
    iconoBg: 'bg-indigo-600',
    tag: 'PDF',
    tagColor: 'bg-indigo-100 text-indigo-700',
    icon: (
      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

function VistaInicio({ onSeleccionar }: { onSeleccionar: (v: Vista) => void }) {
  const navigate = useNavigate();
  const tiene = useAuthStore(s => s.tiene);
  // Operativas: las 3 de export. Estratégicas: TODAS (incluye las operativas) → las de configuración.
  const verOperativas = tiene('herramientas.operativas') || tiene('herramientas.estrategicas');
  const verEstrategicas = tiene('herramientas.estrategicas');
  const esAdminConciliacion = useAuthStore.getState().usuario?.rol === 'admin';

  return (
    <div className="flex-1 p-8">
      {/* Intro */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-slate-900 mb-1">¿Qué necesitas hacer?</h2>
        <p className="text-sm text-slate-500">Selecciona una herramienta para continuar.</p>
      </div>

      {/* Grid de tarjetas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {verOperativas && HERRAMIENTAS.map(h => (
          <button
            key={h.id}
            onClick={() => onSeleccionar(h.id)}
            className={`group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${h.colorHover} hover:border-transparent`}
          >
            {/* Badge tipo */}
            <span className={`absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full ${h.tagColor}`}>
              {h.tag}
            </span>

            {/* Icono */}
            <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${h.color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200`}>
              {h.icon}
            </div>

            {/* Texto */}
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">{h.subtitulo}</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">{h.titulo}</h3>
            <p className="text-xs text-slate-500 leading-relaxed">{h.descripcion}</p>

            {/* Arrow */}
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}

        {/* Tarjeta Recordatorios por correo — operativa */}
        {verOperativas && (
        <button
          onClick={() => navigate('/herramientas/recordatorios')}
          className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-sky-200 hover:border-transparent"
        >
          <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">Panel</span>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
            <span className="text-3xl leading-none">🔔</span>
          </div>
          <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Confirmaciones</p>
          <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Recordatorios por Correo</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Estado de los recordatorios de cita: enviados, confirmados, fallidos y quién pidió reprogramar.
          </p>
          <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
            Abrir panel
            <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
        )}

        {/* Tarjeta Almuerzos — estratégica */}
        {verEstrategicas && (
        <button
          onClick={() => navigate('/herramientas/almuerzos')}
          className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-200 hover:border-transparent"
        >
          <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            Config
          </span>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
            <span className="text-3xl leading-none">🍽</span>
          </div>
          <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Gestión</p>
          <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Horarios de Almuerzo</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Asigna y gestiona el bloqueo de 1 hora diaria de almuerzo para cada profesional por sede.
          </p>
          <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
            Abrir herramienta
            <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </button>
        )}

        {/* Tarjeta Horarios de entrada — estratégica */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/horarios-entrada')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-sky-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
              Config
            </span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🕗</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Gestión</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Horarios de Entrada</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Define qué podólogas entran a las 8:00 o 9:00 cada día. Gestión de la Coordinadora de Sedes.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}

        {/* Tarjeta Permisos / Bloqueos — admin + coordinadora de sedes */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/permisos')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-rose-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
              Config
            </span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-400 to-red-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🚫</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Gestión</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Permisos / Bloqueos</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Bloquea manualmente a podólogas, fisioterapeutas o baropodometría en un rango horario (permisos, reuniones).
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}

        {/* Tarjeta Días especiales / Excepciones — admin + coordinadora de sedes */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/dias-especiales')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Gestión</span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">📅</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Sedes</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Días especiales</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Elige qué podólogas trabajan un domingo, feriado u horario extendido — y trae podólogas de otras sedes con un clic.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>
        )}

        {/* Tarjeta Horarios del personal — admin + coordinadora de sedes */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/horarios-personal')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-teal-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">Personal</span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🗓️</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Sedes</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Horarios del personal</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Define qué días y en qué horas trabaja cada persona, de forma permanente (hasta cambiarlo). Los bloqueos puntuales van en Permisos.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>
        )}

        {/* Tarjeta Reportes RRHH — admin + coordinadora de sedes */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/reportes-rrhh')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">RRHH</span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-700 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">📊</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Personal</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Reportes RRHH</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Horas extra fuera de horario (con recargo peruano) y rotación intersedes por mes para el pago de bonos.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>
        )}

        {/* Tarjeta Canales de Reserva — admin + coordinadora de sedes */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/canales')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              Config
            </span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">📣</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Marketing</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Canales de Reserva</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Agrega o quita los canales (de dónde viene el cliente). Alimenta el KPI de Analytics.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}

        {/* Tarjeta Membresías — constructor (admin + coordinadora) */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/membresias')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Config</span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🎫</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Marketing</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Membresías</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Crea y edita membresías (duración, sedes y composición de sesiones). Editar no altera las ya vendidas.
            </p>
          </button>
        )}

        {/* Tarjeta Conciliación Genexis — SOLO admin (firma de saldos de apertura) */}
        {esAdminConciliacion && (
          <button
            onClick={() => navigate('/herramientas/conciliacion')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-300 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">Migración</span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🗄️</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Genexis</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Conciliación de saldos</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Firma humana de las aperturas de paquetes y membresías del sistema anterior. El motor propone; dirección aprueba.
            </p>
          </button>
        )}

        {/* Tarjeta Promociones — admin + coordinadora de sedes */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/promociones')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-pink-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">
              Config
            </span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-400 to-rose-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🎁</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Marketing</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Promociones</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Agrega o quita promociones y define precio/descuento. Se eligen al agendar y alimentan Analytics.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}

        {/* Tarjeta Bloques combinados — admin */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/combinaciones')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-violet-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Config</span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🔗</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Agenda</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Bloques Combinados</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Define el servicio ancla (profilaxis) y qué servicios pueden combinarse en el mismo turno de 1 h.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}

        {/* Tarjeta Baropodometría por solicitud — admin + coordinadora */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/baro-solicitud')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-rose-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Config</span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-400 to-rose-600 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🦶</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Baropodometría</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Atención por solicitud</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Agrega o quita los médicos (y Daniel) que atienden baropodometría solo cuando el paciente los pide.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}

        {/* Tarjeta Confirmación por Mail — solo administradores */}
        {verEstrategicas && (
          <button
            onClick={() => navigate('/herramientas/confirmacion-mail')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-limablue-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-limablue-100 text-limablue-700">
              Config
            </span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-limablue-500 to-blue-700 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">✉️</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Comunicaciones</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Confirmación por Mail</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Configura desde qué correo se envían las confirmaciones de cita y prueba el envío.
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}

        {/* Tarjeta Videos por Servicio — solo administradores */}
        {esAdminConciliacion && (
          <button
            onClick={() => navigate('/herramientas/videos-servicio')}
            className="group relative bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-limablue-200 hover:border-transparent"
          >
            <span className="absolute top-4 right-4 text-xxs font-bold px-2 py-0.5 rounded-full bg-limablue-100 text-limablue-700">Config</span>
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-limablue-500 to-limablue-800 flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform duration-200">
              <span className="text-3xl leading-none">🎬</span>
            </div>
            <p className="text-xxs font-semibold text-slate-400 uppercase tracking-widest mb-1">Comunicaciones</p>
            <h3 className="text-base font-bold text-slate-900 mb-2 leading-snug">Videos por Servicio</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Envía videos educativos por correo a los pacientes, según el servicio y el momento de la cita (antes o después).
            </p>
            <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-slate-400 group-hover:text-slate-700 transition-colors">
              Abrir herramienta
              <svg className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Herramienta 1: Excel de citas ────────────────────────────────────────────
function ExcelTool() {
  const token = useAuthStore(s => s.token);
  const [fecha, setFecha] = useState<Date>(() => proximoDiaHabil(startOfDay(new Date())));
  const [sedeId, setSedeId] = useState<string>('');
  const [exportando, setExportando] = useState(false);

  const { data: sedes = [] } = useQuery<Sede[]>({
    queryKey: ['sedes-herramientas'],
    queryFn: () => sedesApi.listar(),
    staleTime: 5 * 60 * 1000,
  });

  const fechaStr = fechaLocal(fecha);
  const fechaDisplay = format(fecha, "EEEE d 'de' MMMM, yyyy", { locale: es });
  const sedeSeleccionada = sedes.find(s => s.id === sedeId);

  const descargar = async () => {
    setExportando(true);
    try {
      const params = new URLSearchParams({ fecha: fechaStr });
      if (sedeId) params.set('sedeId', sedeId);
      const res = await fetch(`/api/v1/exportar/citas?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al generar el archivo');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const sufijo = sedeSeleccionada ? `-${sedeSeleccionada.nombre.replace(/\s+/g, '-').toLowerCase()}` : '';
      a.download = `citas-limablue-${fechaStr}${sufijo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      const sedeLabel = sedeSeleccionada ? ` · ${sedeSeleccionada.nombre}` : ' · Todas las sedes';
      toast.success(`CSV descargado — ${fechaDisplay}${sedeLabel}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo descargar el CSV');
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="bg-gradient-to-br from-emerald-600 to-teal-700 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Lista de citas · CSV</h2>
            <p className="text-emerald-100 text-xs">Exportar agenda del día (CSV, solo texto) para confirmaciones WhatsApp</p>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-5 space-y-5">
        {/* Selector de fecha */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Fecha de la agenda a exportar
          </label>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={fechaStr}
              onChange={e => {
                const d = new Date(e.target.value + 'T12:00:00');
                if (!isNaN(d.getTime())) setFecha(d);
              }}
              className="input flex-1"
            />
            <div className="flex gap-1.5">
              {[
                { label: 'Hoy', days: 0 },
                { label: 'Mañana', days: 1 },
                { label: 'Próx. lunes', days: null },
              ].map(({ label, days }) => (
                <button
                  key={label}
                  onClick={() => {
                    if (days !== null) {
                      setFecha(addDays(startOfDay(new Date()), days));
                    } else {
                      setFecha(proximoDiaHabil(startOfDay(new Date())));
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors whitespace-nowrap"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500 capitalize">{fechaDisplay}</p>
        </div>

        {/* Filtro de sede */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Sede
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSedeId('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                sedeId === ''
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              Todas las sedes
            </button>
            {sedes.map(s => (
              <button
                key={s.id}
                onClick={() => setSedeId(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  sedeId === s.id
                    ? 'text-white border-transparent shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
                style={sedeId === s.id ? { backgroundColor: s.color, borderColor: s.color } : {}}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        </div>

        {/* Campos incluidos */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
          <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Columnas del CSV</p>
          <div className="grid grid-cols-2 gap-y-1 gap-x-4">
            {['Número (+51 si son 9 dígitos)', 'Nombre completo', 'Día', 'Hora', 'Sede', 'Dirección'].map(c => (
              <div key={c} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-xxs flex-shrink-0">✓</span>
                {c}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xxs text-slate-400">CSV de solo texto · Solo citas activas (excluye canceladas y no-shows) · Respeta otros códigos de país (+1, etc.)</p>
        </div>

        {/* Botón */}
        <button
          onClick={descargar}
          disabled={exportando}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-sm shadow-emerald-900/20"
        >
          {exportando ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generando CSV…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
              </svg>
              Descargar CSV
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Herramienta 2: PDF historial de paciente ─────────────────────────────────
function PdfHistorialTool() {
  const token = useAuthStore(s => s.token);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pacienteSeleccionado, setPacienteSeleccionado] = useState<Paciente | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data: resultados, isLoading: buscando } = useQuery({
    queryKey: ['pacientes-busqueda-herramientas', debouncedQuery],
    queryFn: async () => {
      if (debouncedQuery.trim().length < 2) return [];
      const res = await pacientesApi.buscar(debouncedQuery.trim());
      return res as unknown as Paciente[];
    },
    enabled: debouncedQuery.trim().length >= 2 && !pacienteSeleccionado,
  });

  const handleSelect = (p: Paciente) => {
    setPacienteSeleccionado(p);
    setQuery(`${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`);
    setShowDropdown(false);
  };

  const descargarPDF = async () => {
    if (!pacienteSeleccionado) return;
    setDescargando(true);
    try {
      const res = await fetch(`/api/v1/exportar/historial/${pacienteSeleccionado.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al generar el PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `historial-${pacienteSeleccionado.apellidoPaterno}-${pacienteSeleccionado.nombres}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`PDF descargado — ${pacienteSeleccionado.nombres} ${pacienteSeleccionado.apellidoPaterno}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo generar el PDF');
    } finally {
      setDescargando(false);
    }
  };

  const limpiar = () => {
    setPacienteSeleccionado(null);
    setQuery('');
    setDebouncedQuery('');
    setShowDropdown(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="bg-gradient-to-br from-indigo-600 to-violet-700 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Historial de Atenciones · PDF</h2>
            <p className="text-indigo-100 text-xs">Resumen de atenciones del paciente</p>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-5 space-y-5">
        {/* Buscador de paciente */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Buscar paciente
          </label>
          <div className="relative">
            <div className="relative flex items-center">
              <svg className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  if (pacienteSeleccionado) setPacienteSeleccionado(null);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Buscar por nombre, apellido o DNI…"
                className="input pl-9 pr-8 w-full"
              />
              {(buscando) && (
                <span className="absolute right-3 w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
              )}
              {pacienteSeleccionado && (
                <button onClick={limpiar} className="absolute right-3 text-slate-400 hover:text-slate-600 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Dropdown de resultados */}
            {showDropdown && !pacienteSeleccionado && resultados && resultados.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                {resultados.slice(0, 8).map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p)}
                    className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0"
                  >
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-indigo-700 font-bold text-xs">
                        {p.nombres[0]}{p.apellidoPaterno[0]}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {p.nombres} {p.apellidoPaterno} {p.apellidoMaterno}
                      </p>
                      <p className="text-xs text-slate-500">{p.numeroDocumento} · {p.telefono}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {debouncedQuery.length >= 2 && !buscando && resultados?.length === 0 && !pacienteSeleccionado && (
            <p className="mt-1.5 text-xs text-slate-400">No se encontraron pacientes con "{debouncedQuery}"</p>
          )}
        </div>

        {/* Card del paciente seleccionado */}
        {pacienteSeleccionado ? (
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">
                {pacienteSeleccionado.nombres[0]}{pacienteSeleccionado.apellidoPaterno[0]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-900 text-sm">
                {pacienteSeleccionado.nombres} {pacienteSeleccionado.apellidoPaterno} {pacienteSeleccionado.apellidoMaterno}
              </p>
              <p className="text-xs text-slate-500">{pacienteSeleccionado.numeroDocumento} · {pacienteSeleccionado.telefono}</p>
            </div>
            <svg className="w-5 h-5 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 border border-slate-100 border-dashed p-4 flex items-center gap-3 text-slate-400">
            <svg className="w-8 h-8 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p className="text-sm">Busca y selecciona un paciente para generar su historial en PDF</p>
          </div>
        )}

        {/* Contenido del PDF */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
          <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">El PDF incluye</p>
          <div className="space-y-1">
            {[
              'Datos del paciente en cabecera (nombre, DNI, teléfono, email, fecha de nacimiento)',
              'Estadísticas de asistencia (total, completadas, no-shows, canceladas)',
              'Lista completa de atenciones con estado visual (✓ asistió, ✗ no asistió, ○ cancelada)',
              'Profesional, servicio, sede y unidad por cada cita',
            ].map(item => (
              <div key={item} className="flex items-start gap-1.5 text-xs text-slate-600">
                <span className="w-3.5 h-3.5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xxs flex-shrink-0 mt-0.5">✓</span>
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Botón */}
        <button
          onClick={descargarPDF}
          disabled={!pacienteSeleccionado || descargando}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-indigo-900/20"
        >
          {descargando ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generando PDF…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
              </svg>
              Descargar PDF
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Herramienta 3: Reactivación de pacientes ─────────────────────────────────
const DIAS_OPCIONES = [
  { label: '+30 días', value: 30 },
  { label: '+60 días', value: 60 },
  { label: '+90 días', value: 90 },
  { label: '+6 meses', value: 180 },
  { label: '+1 año',   value: 365 },
];

const MIN_VISITAS_OPCIONES = [
  { label: '1+ visita',   value: 1 },
  { label: '2+ visitas',  value: 2 },
  { label: '3+ visitas',  value: 3 },
  { label: '5+ visitas',  value: 5 },
];

function ReactivacionTool() {
  const token = useAuthStore(s => s.token);
  const [dias, setDias] = useState(90);
  const [fechaCorte, setFechaCorte] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [servicioId, setServicioId] = useState('');
  const [minVisitas, setMinVisitas] = useState(1);
  const [exportando, setExportando] = useState(false);

  const rangoActivo = !!(fechaDesde && fechaHasta);

  const { data: sedes = [] } = useQuery<Sede[]>({
    queryKey: ['sedes-herramientas'],
    queryFn: () => sedesApi.listar(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: servicios = [] } = useQuery<Servicio[]>({
    queryKey: ['servicios-herramientas'],
    queryFn: () => serviciosApi.listar({ activo: true }),
    staleTime: 5 * 60 * 1000,
  });

  const descargar = async () => {
    setExportando(true);
    try {
      const params = new URLSearchParams({ minVisitas: String(minVisitas) });
      if (rangoActivo) {
        params.set('fechaDesde', fechaDesde);
        params.set('fechaHasta', fechaHasta);
      } else if (fechaCorte) {
        params.set('fechaCorte', fechaCorte);
      } else {
        params.set('diasSinVisitar', String(dias));
      }
      if (sedeId) params.set('sedeId', sedeId);
      if (servicioId) params.set('servicioId', servicioId);
      const res = await fetch(`/api/v1/exportar/reactivacion?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Error al generar el archivo');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reactivacion-limablue-${dias}dias.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      const etiqueta = rangoActivo
        ? `última visita entre ${fechaDesde.split('-').reverse().join('/')} y ${fechaHasta.split('-').reverse().join('/')}`
        : fechaCorte
          ? `última visita antes del ${fechaCorte.split('-').reverse().join('/')}`
          : `sin visitar en +${dias} días`;
      toast.success(`Excel descargado — ${etiqueta}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo generar el Excel');
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="bg-gradient-to-br from-violet-600 to-purple-700 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Reactivación de Pacientes</h2>
            <p className="text-violet-100 text-xs">Pacientes que llevan tiempo sin visitar Limablue</p>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-5 space-y-5">

        {/* Tiempo sin visitar */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Tiempo sin visitar
          </label>
          <div className="flex flex-wrap gap-2">
            {DIAS_OPCIONES.map(op => (
              <button
                key={op.value}
                onClick={() => { setDias(op.value); setFechaCorte(''); setFechaDesde(''); setFechaHasta(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  dias === op.value && !fechaCorte && !rangoActivo
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'
                }`}
              >
                {op.label}
              </button>
            ))}
          </div>

          {/* Última fecha de visita */}
          <div className="mt-3">
            <label className="block text-xxs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              O elige una última fecha de visita exacta
            </label>
            <div className="relative flex items-center">
              <input
                type="date"
                value={fechaCorte}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => { setFechaCorte(e.target.value); if (e.target.value) { setDias(0); setFechaDesde(''); setFechaHasta(''); } }}
                className={`input w-full pr-8 ${fechaCorte ? 'border-violet-400 ring-1 ring-violet-300' : ''}`}
              />
              {fechaCorte && (
                <button
                  onClick={() => { setFechaCorte(''); setDias(90); }}
                  className="absolute right-2.5 text-slate-400 hover:text-red-500 transition-colors"
                  title="Limpiar fecha"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {fechaCorte && (
              <p className="mt-1.5 text-xs text-violet-600 font-medium">
                Pacientes cuya última visita fue antes del {fechaCorte.split('-').reverse().join('/')}
              </p>
            )}
          </div>

          {/* Rango de fechas de última visita */}
          <div className="mt-3">
            <label className="block text-xxs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              O elige un rango de fechas de última visita
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={fechaDesde}
                max={fechaHasta || format(new Date(), 'yyyy-MM-dd')}
                onChange={e => { setFechaDesde(e.target.value); if (e.target.value && fechaHasta) { setDias(0); setFechaCorte(''); } }}
                className={`input w-full ${rangoActivo ? 'border-violet-400 ring-1 ring-violet-300' : ''}`}
                title="Desde"
              />
              <span className="text-slate-400 text-xs shrink-0">a</span>
              <input
                type="date"
                value={fechaHasta}
                min={fechaDesde || undefined}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => { setFechaHasta(e.target.value); if (e.target.value && fechaDesde) { setDias(0); setFechaCorte(''); } }}
                className={`input w-full ${rangoActivo ? 'border-violet-400 ring-1 ring-violet-300' : ''}`}
                title="Hasta"
              />
              {(fechaDesde || fechaHasta) && (
                <button
                  onClick={() => { setFechaDesde(''); setFechaHasta(''); setDias(90); }}
                  className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                  title="Limpiar rango"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {rangoActivo && (
              <p className="mt-1.5 text-xs text-violet-600 font-medium">
                Pacientes cuya última visita fue entre el {fechaDesde.split('-').reverse().join('/')} y el {fechaHasta.split('-').reverse().join('/')}
              </p>
            )}
            {(fechaDesde || fechaHasta) && !rangoActivo && (
              <p className="mt-1.5 text-xs text-amber-600 font-medium">Completa ambas fechas para aplicar el rango.</p>
            )}
          </div>
        </div>

        {/* Filtro sede */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Sede de última visita
          </label>
          <select
            value={sedeId}
            onChange={e => setSedeId(e.target.value)}
            className="input w-full"
          >
            <option value="">Todas las sedes</option>
            {sedes.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Filtro servicio */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Último servicio recibido
          </label>
          <select
            value={servicioId}
            onChange={e => setServicioId(e.target.value)}
            className="input w-full"
          >
            <option value="">Todos los servicios</option>
            {servicios.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Mínimo de visitas */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Mínimo de visitas completadas
          </label>
          <div className="flex flex-wrap gap-2">
            {MIN_VISITAS_OPCIONES.map(op => (
              <button
                key={op.value}
                onClick={() => setMinVisitas(op.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  minVisitas === op.value
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'
                }`}
              >
                {op.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xxs text-slate-400">Excluye pacientes con pocas visitas para enfocarte en clientes recurrentes</p>
        </div>

        {/* Campos del Excel */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
          <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Campos incluidos en el Excel</p>
          <div className="grid grid-cols-2 gap-y-1 gap-x-4">
            {['Nombres', 'Apellidos', 'Teléfono', 'Email', 'Último servicio', 'Fecha última visita', 'Días sin visitar', 'Sede última visita', 'Total visitas'].map(c => (
              <div key={c} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-3.5 h-3.5 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold text-xxs flex-shrink-0">✓</span>
                {c}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xxs text-slate-400">Ordenado por días sin visitar (mayor a menor) · Colores: rojo +1 año · naranja +6 meses · verde reciente</p>
        </div>

        {/* Botón */}
        <button
          onClick={descargar}
          disabled={exportando}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-all shadow-sm shadow-violet-900/20"
        >
          {exportando ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generando Excel…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
              </svg>
              Descargar Excel
            </>
          )}
        </button>
      </div>
    </div>
  );
}
