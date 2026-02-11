import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  RegistrationDashboard,
  BankDashboard,
  AdminDashboard,
  CustomerDashboard
} from './pages';

const ROLE_TO_PATH = {
  guest: '/',
  admin: '/admin',
  bank: '/bank',
  customer: '/participant'
};

const resolveRoleFromPath = pathname => {
  if (!pathname || pathname === '/' || pathname === '') return 'guest';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/bank')) return 'bank';
  if (pathname.startsWith('/participant') || pathname.startsWith('/customer')) {
    return 'customer';
  }
  return 'guest';
};

const normalizeRole = role => (ROLE_TO_PATH[role] ? role : 'guest');

const DashboardSurface = ({ title, subtitle, icon, onExit, children }) => (
  <div className="min-h-screen px-4 py-8 md:px-12 space-y-8">
    <header className="glass-panel p-6 border border-white/5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          {icon && <div className="text-5xl">{icon}</div>}
          <div>
            <p className="text-xs uppercase tracking-wide text-white/50 mb-1">{subtitle}</p>
            <h1 className="text-4xl font-bold">{title}</h1>
          </div>
        </div>
        {onExit && (
          <button
            className="px-6 py-3 rounded-xl bg-white/10 text-sm font-semibold text-white hover:bg-white/20 transition"
            onClick={onExit}
            data-testid="sign-out-button"
          >
            🚪 Sign Out
          </button>
        )}
      </div>
    </header>
    <div className="space-y-6">{children}</div>
  </div>
);

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeRole, setActiveRole] = useState(() => resolveRoleFromPath(location.pathname));

  useEffect(() => {
    const roleFromURL = resolveRoleFromPath(location.pathname);
    setActiveRole(roleFromURL);
  }, [location.pathname]);

  const syncRouteToRole = role => {
    const normalizedRole = normalizeRole(role);
    const targetPath = ROLE_TO_PATH[normalizedRole] || '/';
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: normalizedRole === 'guest' });
    }
    setActiveRole(normalizedRole);
  };

  const handleExit = () => syncRouteToRole('guest');

  return (
    <div className="min-h-screen text-white">
      {activeRole === 'guest' && (
        <div className="px-4 py-8 md:px-12">
          <RegistrationDashboard onAuthenticate={syncRouteToRole} />
        </div>
      )}

      {activeRole === 'admin' && (
        <DashboardSurface
          icon="🛡️"
          title="Administrative Dashboard"
          subtitle="System Management"
          onExit={handleExit}
        >
          <AdminDashboard />
        </DashboardSurface>
      )}

      {activeRole === 'bank' && (
        <DashboardSurface
          icon="🏦"
          title="Bank Operations Center"
          subtitle="Institutional Management"
          onExit={handleExit}
        >
          <BankDashboard />
        </DashboardSurface>
      )}

      {activeRole === 'customer' && (
        <div className="min-h-screen bg-white text-slate-900">
          <CustomerDashboard />
        </div>
      )}
    </div>
  );
}

export default App;
