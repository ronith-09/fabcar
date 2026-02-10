import { useEffect, useState } from 'react';
import { safeGet, safePost } from '../services/apiClient';

const roleOptions = [
  { value: 'admin', label: 'Administrator' },
  { value: 'bank', label: 'Bank Institution' },
  { value: 'customer', label: 'Customer Account' }
];

const defaultLoginForm = { name: '', password: '', role: 'admin' };
const defaultRegisterForm = { name: '', password: '', role: 'bank' };

const normalizeRole = (apiRole, fallbackRole) => {
  const allowed = ['admin', 'bank', 'customer'];
  if (allowed.includes(apiRole)) {
    return apiRole;
  }
  if (apiRole === 'user' && allowed.includes(fallbackRole)) {
    return fallbackRole;
  }
  return fallbackRole && allowed.includes(fallbackRole) ? fallbackRole : 'customer';
};

const RegistrationDashboard = ({ onAuthenticate }) => {
  const [walletUsers, setWalletUsers] = useState([]);
  const [health, setHealth] = useState(null);
  const [initMessage, setInitMessage] = useState('');
  const [loginForm, setLoginForm] = useState(defaultLoginForm);
  const [loginStatus, setLoginStatus] = useState(null);
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [registerStatus, setRegisterStatus] = useState(null);
  const [registerResult, setRegisterResult] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const refreshWalletUsers = async () => {
    try {
      const response = await safeGet('/users', []);
      setWalletUsers(response.users || response || []);
    } catch (err) {
      setWalletUsers([]);
    }
  };

  const handleStatusCheck = async () => {
    setStatusLoading(true);
    try {
      await refreshWalletUsers();
      const serverHealth = await safeGet('/health', null);
      setHealth(serverHealth);
    } catch (err) {
      setHealth(null);
    } finally {
      setStatusLoading(false);
    }
  };

  const initLedger = async () => {
    const response = await safePost('/admin/init-ledger', { userId: 'admin' }, { message: 'offline mode' });
    setInitMessage(response.message || 'System initialized');
  };

  const handleLogin = async event => {
    event.preventDefault();
    const username = loginForm.name.trim();
    if (!username || !loginForm.password) {
      setLoginStatus('Username and password are required');
      return;
    }

    try {
      setLoginStatus('Authenticating...');
      const loginResponse = await safePost(
        '/auth/login',
        { username, password: loginForm.password },
        { success: false, detail: 'Authentication service unavailable' }
      );

      if (!loginResponse?.success) {
        setLoginStatus(loginResponse?.detail || 'Login failed');
        return;
      }

      const resolvedRole = normalizeRole(loginResponse?.role, loginForm.role);
      try {
        if (loginResponse?.token) {
          window.localStorage.setItem('authToken', loginResponse.token);
        }
      } catch (e) {
        console.warn('Failed to persist auth token:', e);
      }
      setLoginStatus(`Access granted as ${resolvedRole}`);
      onAuthenticate?.(resolvedRole);
    } catch (error) {
      setLoginStatus('Unexpected error during authentication');
    }
  };

  const handleRegister = async event => {
    event.preventDefault();
    const name = registerForm.name.trim();
    if (!name || !registerForm.password) {
      setRegisterStatus('Name and password are required');
      return;
    }

    try {
      setRegisterStatus('Creating account...');
      setRegisterResult(null);

      let endpoint = '/auth/register';
      const payload = { name, password: registerForm.password };

      if (registerForm.role === 'admin') {
        // For admin enrollment, use CA bootstrap credential
        endpoint = '/auth/enroll';
        // Use Fabric CA bootstrap credential: admin:adminpw
        payload.enrollmentSecret = 'adminpw';
      } else {
        payload.role = registerForm.role;
        // For other roles, enrollmentSecret could be required depending on CA setup
      }

      const response = await safePost(endpoint, payload, { success: false, detail: 'Registration unavailable' });

      if (!response?.success && !response?.token) {
        setRegisterStatus(response?.detail || 'Registration failed');
        return;
      }

      const resultPayload = {
        network_address: response?.network_address,
        wallet_created: response?.wallet_created ?? true,
        username: response?.username || name,
        role: registerForm.role,
        timestamp: Date.now()
      };
      setRegisterStatus('Registration successful. Please save your credentials below.');
      setRegisterResult(resultPayload.network_address ? resultPayload : null);
      try {
        if (response?.token) {
          window.localStorage.setItem('authToken', response.token);
        }
      } catch (e) {
        console.warn('Failed to persist auth token after registration:', e);
      }
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('latestRegistrationCredentials', JSON.stringify(resultPayload));
          window.dispatchEvent(new CustomEvent('latest-registration-credentials', { detail: resultPayload }));
        } catch (storageError) {
          console.warn('Failed to persist registration snapshot:', storageError);
        }
      }
      setRegisterForm(prev => ({ ...prev, password: '' }));
      refreshWalletUsers();
    } catch (error) {
      setRegisterStatus('Unexpected error during registration');
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-panel p-8 border border-white/5">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold mb-3">International Banking Platform</h1>
          <p className="text-lg text-white/70">Secure access to global transaction services</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleStatusCheck}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold transition"
          >
            {statusLoading ? 'Checking...' : 'Refresh Status'}
          </button>
          {health && (
            <span className="text-xs text-green-300 bg-green-500/10 px-3 py-1 rounded-lg border border-green-500/30">
              API healthy
            </span>
          )}
          {walletUsers?.length ? (
            <span className="text-xs text-white/70 bg-white/5 px-3 py-1 rounded-lg border border-white/10">
              Wallet users: {walletUsers.length}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <form className="glass-panel p-6 space-y-5 border border-white/5" onSubmit={handleLogin}>
          <div>
            <h3 className="text-2xl font-semibold mb-2">Sign In</h3>
            <p className="text-sm text-white/60">
              Access your existing account to manage transactions and services.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-white/80">Username</label>
            <input
              className="w-full mt-2 rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition"
              value={loginForm.name}
              onChange={event => setLoginForm({ ...loginForm, name: event.target.value })}
              placeholder="Enter your username"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-white/80">Password</label>
            <input
              type="password"
              className="w-full mt-2 rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition"
              value={loginForm.password}
              onChange={event => setLoginForm({ ...loginForm, password: event.target.value })}
              placeholder="Enter your password"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-white/80">Account Type</label>
            <select
              className="w-full mt-2 rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 text-white cursor-pointer transition"
              value={loginForm.role}
              onChange={event => setLoginForm({ ...loginForm, role: event.target.value })}
            >
              {roleOptions.map(option => (
                <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-gradient-to-r from-accent to-accentSecondary py-3.5 text-sm font-semibold text-slate-950 hover:opacity-90 transition"
          >
            Sign In
          </button>
          {loginStatus && (
            <div className={`rounded-lg p-3 text-sm ${
              loginStatus.includes('granted') 
                ? 'bg-green-500/10 border border-green-500/40 text-green-300'
                : 'bg-white/5 border border-white/10 text-white/70'
            }`}>
              {loginStatus}
            </div>
          )}
        </form>

        <form className="glass-panel p-6 space-y-5 border border-white/5" onSubmit={handleRegister}>
          <div>
            <h3 className="text-2xl font-semibold mb-2">Create Account</h3>
            <p className="text-sm text-white/60">
              Register a new account to access international banking services.
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-white/80">Username</label>
            <input
              className="w-full mt-2 rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition"
              value={registerForm.name}
              onChange={event => setRegisterForm({ ...registerForm, name: event.target.value })}
              placeholder="Choose a username"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-white/80">Password</label>
            <input
              type="password"
              className="w-full mt-2 rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition"
              value={registerForm.password}
              onChange={event => setRegisterForm({ ...registerForm, password: event.target.value })}
              placeholder="Create a secure password"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium text-white/80">Account Type</label>
            <select
              className="w-full mt-2 rounded-xl bg-white/5 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 text-white cursor-pointer transition"
              value={registerForm.role}
              onChange={event => setRegisterForm({ ...registerForm, role: event.target.value })}
            >
              {roleOptions.map(option => (
                <option key={option.value} value={option.value} className="bg-slate-900 text-white">
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="w-full rounded-xl border-2 border-accent py-3.5 text-sm font-semibold hover:bg-accent/10 transition"
          >
            Create Account
          </button>
          {registerStatus && (
            <div className={`rounded-lg p-3 text-sm ${
              registerStatus.includes('successful') 
                ? 'bg-green-500/10 border border-green-500/40 text-green-300'
                : 'bg-white/5 border border-white/10 text-white/70'
            }`}>
              {registerStatus}
            </div>
          )}

          {registerResult && (
            <div className="rounded-xl border-2 border-accent/40 bg-accent/5 p-5 space-y-3 text-sm">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🔑</span>
                <p className="text-xs uppercase tracking-wide text-accent font-semibold">Account Credentials</p>
              </div>
              <p className="text-xs text-white/60">Please save these credentials securely. You will need them to access your account.</p>
              {registerResult?.username && (
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs text-white/50 mb-1">Username</p>
                  <p className="font-mono text-sm break-all text-white">{registerResult.username}</p>
                </div>
              )}
              {registerResult?.network_address && (
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs text-white/50 mb-1">Account ID</p>
                  <p className="font-mono text-sm break-all text-accent">{registerResult.network_address}</p>
                </div>
              )}
              <p className="text-xs text-white/40">
                Account created • {registerResult?.role === 'bank' ? 'Bank Institution' : registerResult?.role === 'customer' ? 'Customer Account' : registerResult?.role}
              </p>
            </div>
          )}
        </form>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="glass-panel p-6 border border-white/5">
          <p className="text-xs text-white/50 uppercase tracking-wide mb-2">System Status</p>
          <p className="text-4xl font-bold mb-2">{health?.status || 'Checking...'}</p>
          <p className="text-sm text-white/50">{health?.timestamp || 'Waiting for system response'}</p>
        </div>
        <div className="glass-panel p-6 flex flex-col gap-3 border border-white/5">
          <p className="text-xs uppercase text-white/50 tracking-wide">System Maintenance</p>
          <button 
            className="px-6 py-3 bg-accent/15 text-accent rounded-xl hover:bg-accent/25 transition font-semibold" 
            onClick={initLedger}
          >
            Initialize System
          </button>
          {initMessage && <p className="text-sm text-white/60">{initMessage}</p>}
        </div>
      </div>

      <div className="glass-panel p-6 border border-white/5">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-semibold">Registered Accounts</h3>
            <p className="text-sm text-white/50">Active user accounts in the system</p>
          </div>
          <span className="px-4 py-2 rounded-full bg-accent/10 text-accent text-sm font-semibold">
            {walletUsers.length} {walletUsers.length === 1 ? 'Account' : 'Accounts'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="pb-4 font-semibold text-left text-white/70">Username</th>
                <th className="pb-4 font-semibold text-left text-white/70">Institution ID</th>
                <th className="pb-4 font-semibold text-left text-white/70">Account ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {walletUsers.map((user, index) => (
                <tr key={`${user.label || 'user'}-${index}`} className="hover:bg-white/5 transition">
                  <td className="py-4 font-medium">{user.label}</td>
                  <td className="py-4 text-white/60">{user.mspId || 'Org1MSP'}</td>
                  <td className="py-4 font-mono text-xs text-accent">{user.network_address || user.label}</td>
                </tr>
              ))}
              {!walletUsers.length && (
                <tr>
                  <td colSpan="3" className="py-12 text-center text-white/40">
                    <div className="text-4xl mb-3">📋</div>
                    <p>No accounts registered yet</p>
                    <p className="text-xs mt-1">Create a new account to get started</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RegistrationDashboard;
