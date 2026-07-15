import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/LoginPage';
import { AgendaPage } from './pages/AgendaPage';
import { PacientesPage, FichaPacientePage } from './pages/PacientesPage';
import { AdminPage } from './pages/AdminPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AnalyticsDetallePage } from './pages/analytics/AnalyticsDetallePage';
import { AgentesResumenPage } from './pages/analytics/agentes/AgentesResumenPage';
import { AgentesComparativaPage } from './pages/analytics/agentes/AgentesComparativaPage';
import { AgenteDetallePage } from './pages/analytics/agentes/AgenteDetallePage';
import { HerramientasPage } from './pages/HerramientasPage';
import { MovimientosPage } from './pages/MovimientosPage';
import { UsersPage } from './pages/admin/UsersPage';
import { RolesPage } from './pages/admin/RolesPage';
import { NotificacionesAdminPage } from './pages/NotificacionesAdminPage';
import { AlmuerzosPage } from './pages/herramientas/AlmuerzosPage';
import { ConfirmacionMailPage } from './pages/herramientas/ConfirmacionMailPage';
import { HorariosPage } from './pages/herramientas/HorariosPage';
import { PermisosPage } from './pages/herramientas/PermisosPage';
import { CanalesPage } from './pages/herramientas/CanalesPage';
import { PromocionesPage } from './pages/herramientas/PromocionesPage';
import { MembresiasPage } from './pages/herramientas/MembresiasPage';
import { DiasEspecialesPage } from './pages/herramientas/DiasEspecialesPage';
import { ConciliacionPage } from './pages/herramientas/ConciliacionPage';
import { RecordatoriosPanel } from './pages/herramientas/RecordatoriosPanel';
import { BaroSolicitudPage } from './pages/herramientas/BaroSolicitudPage';
import { CombinacionesPage } from './pages/herramientas/CombinacionesPage';
import { ReportesRrhhPage } from './pages/herramientas/ReportesRrhhPage';
import { ComposicionSedePage } from './pages/herramientas/ComposicionSedePage';
import { ComposicionImprimirPage } from './pages/herramientas/ComposicionImprimirPage';
import { ComprobantesImprimirPage } from './pages/herramientas/ComprobantesImprimirPage';
import { VideosServicioPage } from './pages/herramientas/VideosServicioPage';

export default function App() {
  const token = useAuthStore(s => s.token);
  const checkAuth = useAuthStore(s => s.checkAuth);

  // Al cargar la app, refrescar el usuario y sus PERMISOS desde el servidor (no usar los
  // guardados de un login anterior). Así un cambio de permisos de rol aplica al recargar.
  useEffect(() => { if (token) void checkAuth(); }, [token, checkAuth]);

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
      {/* Vista de impresión (sin Layout/sidebar) — matriz A4 horizontal para PDF */}
      <Route path="/imprimir/composicion-sede" element={<ComposicionImprimirPage />} />
      {/* Comprobantes del día en una sola hoja (cierre) */}
      <Route path="/imprimir/comprobantes" element={<ComprobantesImprimirPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<AgendaPage />} />
        <Route path="/pacientes" element={<PacientesPage />} />
        <Route path="/pacientes/:id" element={<FichaPacientePage />} />
        <Route path="/herramientas" element={<HerramientasPage />} />
        <Route path="/herramientas/almuerzos" element={<AlmuerzosPage />} />
        <Route path="/herramientas/confirmacion-mail" element={<ConfirmacionMailPage />} />
        <Route path="/herramientas/horarios" element={<HorariosPage />} />
        {/* Rutas viejas → herramienta unificada (enlaces guardados siguen funcionando) */}
        <Route path="/herramientas/horarios-entrada" element={<Navigate to="/herramientas/horarios?tab=fechas" replace />} />
        <Route path="/herramientas/permisos" element={<PermisosPage />} />
        <Route path="/herramientas/canales" element={<CanalesPage />} />
        <Route path="/herramientas/promociones" element={<PromocionesPage />} />
        <Route path="/herramientas/membresias" element={<MembresiasPage />} />
        <Route path="/herramientas/dias-especiales" element={<DiasEspecialesPage />} />
        <Route path="/herramientas/conciliacion" element={<ConciliacionPage />} />
        <Route path="/herramientas/recordatorios" element={<RecordatoriosPanel />} />
        <Route path="/herramientas/baro-solicitud" element={<BaroSolicitudPage />} />
        <Route path="/herramientas/combinaciones" element={<CombinacionesPage />} />
        <Route path="/herramientas/videos-servicio" element={<VideosServicioPage />} />
        <Route path="/herramientas/reportes-rrhh" element={<ReportesRrhhPage />} />
        <Route path="/herramientas/composicion-sede" element={<ComposicionSedePage />} />
        <Route path="/herramientas/horarios-personal" element={<Navigate to="/herramientas/horarios?tab=semana" replace />} />
        <Route path="/movimientos" element={<MovimientosPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/usuarios" element={<UsersPage />} />
        <Route path="/admin/roles" element={<RolesPage />} />
        <Route path="/admin/notificaciones" element={<NotificacionesAdminPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        {/* Desempeño de Agentes: rutas estáticas ganan sobre /analytics/:kpi */}
        <Route path="/analytics/agentes" element={<AgentesResumenPage />} />
        <Route path="/analytics/agentes/comparativa" element={<AgentesComparativaPage />} />
        <Route path="/analytics/agentes/:agenteId" element={<AgenteDetallePage />} />
        <Route path="/analytics/:kpi" element={<AnalyticsDetallePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
