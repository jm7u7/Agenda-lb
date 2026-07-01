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
import { HerramientasPage } from './pages/HerramientasPage';
import { MovimientosPage } from './pages/MovimientosPage';
import { UsersPage } from './pages/admin/UsersPage';
import { RolesPage } from './pages/admin/RolesPage';
import { NotificacionesAdminPage } from './pages/NotificacionesAdminPage';
import { AlmuerzosPage } from './pages/herramientas/AlmuerzosPage';
import { ConfirmacionMailPage } from './pages/herramientas/ConfirmacionMailPage';
import { HorariosEntradaPage } from './pages/herramientas/HorariosEntradaPage';
import { PermisosPage } from './pages/herramientas/PermisosPage';
import { CanalesPage } from './pages/herramientas/CanalesPage';
import { PromocionesPage } from './pages/herramientas/PromocionesPage';
import { RecordatoriosPanel } from './pages/herramientas/RecordatoriosPanel';
import { BaroSolicitudPage } from './pages/herramientas/BaroSolicitudPage';
import { CombinacionesPage } from './pages/herramientas/CombinacionesPage';

export default function App() {
  const token = useAuthStore(s => s.token);
  const checkAuth = useAuthStore(s => s.checkAuth);

  // Al cargar la app, refrescar el usuario y sus PERMISOS desde el servidor (no usar los
  // guardados de un login anterior). Así un cambio de permisos de rol aplica al recargar.
  useEffect(() => { if (token) void checkAuth(); }, [token, checkAuth]);

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<AgendaPage />} />
        <Route path="/pacientes" element={<PacientesPage />} />
        <Route path="/pacientes/:id" element={<FichaPacientePage />} />
        <Route path="/herramientas" element={<HerramientasPage />} />
        <Route path="/herramientas/almuerzos" element={<AlmuerzosPage />} />
        <Route path="/herramientas/confirmacion-mail" element={<ConfirmacionMailPage />} />
        <Route path="/herramientas/horarios-entrada" element={<HorariosEntradaPage />} />
        <Route path="/herramientas/permisos" element={<PermisosPage />} />
        <Route path="/herramientas/canales" element={<CanalesPage />} />
        <Route path="/herramientas/promociones" element={<PromocionesPage />} />
        <Route path="/herramientas/recordatorios" element={<RecordatoriosPanel />} />
        <Route path="/herramientas/baro-solicitud" element={<BaroSolicitudPage />} />
        <Route path="/herramientas/combinaciones" element={<CombinacionesPage />} />
        <Route path="/movimientos" element={<MovimientosPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/usuarios" element={<UsersPage />} />
        <Route path="/admin/roles" element={<RolesPage />} />
        <Route path="/admin/notificaciones" element={<NotificacionesAdminPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/analytics/:kpi" element={<AnalyticsDetallePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
