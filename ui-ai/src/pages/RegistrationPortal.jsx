import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { safePost } from '../services/apiClient';

const roles = [
  {
    id: 'participant',
    label: 'Participant',
    description: 'Customer wallet with transfer + mint request capability',
    redirect: 'Customer Dashboard'
  },
  {
    id: 'token_owner',
    label: 'Token Owner',
    description: 'Bank-grade controls for minting, approvals, customer onboarding',
    redirect: 'Bank Dashboard'
  }
];

const RegistrationPortal = () => {
  const navigate = useNavigate();
  
  const [selectedRole, setSelectedRole] = useState(roles[0].id);
  const [form, setForm] = useState({ name: '', password: '', country: 'Global' });
  const [response, setResponse] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const handleSubmit = async event => {
    event.preventDefault();
    setIsRegistering(true);
    
    const payload = {
      name: form.name,
      password: form.password,
      role: selectedRole === 'token_owner' ? 'bank' : 'customer'
    };
    const result = await safePost('/auth/register', payload, {
      success: false,
      detail: 'fabric offline'
    });
    
    setResponse(result);
    setIsRegistering(false);
    
    // Auto-redirect after successful registration
    if (result.success || result.token) {
      // Store token in localStorage
      localStorage.setItem('authToken', result.token);
      localStorage.setItem('userName', result.name);
      localStorage.setItem('userRole', selectedRole === 'token_owner' ? 'bank' : 'customer');
      
      // Redirect to appropriate dashboard
      const redirectPath = selectedRole === 'token_owner' ? '/bank' : '/participant';
      setTimeout(() => {
        navigate(redirectPath);
      }, 1500);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-panel p-4">
        <p className="text-sm text-white/60 uppercase">Onboarding</p>
        <h3 className="text-2xl font-semibold mt-2">Assign a trust path</h3>
        <p className="text-sm text-white/50 mt-1">
          Choose whether this identity becomes a Participant (customer) or Token Owner (bank).
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {roles.map(role => (
          <button
            key={role.id}
            className={`glass-panel p-4 text-left transition ${
              selectedRole === role.id ? 'border border-accent/40 shadow-glow' : ''
            }`}
            onClick={() => setSelectedRole(role.id)}
          >
            <p className="text-xs uppercase text-white/60">{role.label}</p>
            <p className="text-sm mt-2 text-white/70">{role.description}</p>
            <p className="text-[11px] text-white/40 mt-3">Redirect → {role.redirect}</p>
          </button>
        ))}
      </div>

      <form className="glass-panel p-4 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="text-xs uppercase text-white/50">Name</label>
          <input
            className="w-full mt-1 rounded-xl bg-white/5 px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40"
            value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })}
            required
          />
        </div>
        <div>
          <label className="text-xs uppercase text-white/50">Password</label>
          <input
            type="password"
            className="w-full mt-1 rounded-xl bg-white/5 px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40"
            value={form.password}
            onChange={event => setForm({ ...form, password: event.target.value })}
            required
          />
        </div>

        <button
          type="submit"
          disabled={isRegistering}
          className="w-full bg-gradient-to-r from-accent to-accentSecondary rounded-xl py-3 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRegistering ? '⏳ Registering...' : 'Register identity'}
        </button>

        {response && (
          <div className="mt-4 text-sm text-white/70">
            {response.success || response.token ? (
              <>
                <p className="text-green-400 font-semibold">✓ Registration successful!</p>
                {response.network_address && (
                  <p className="text-xs text-white/40 mt-1">Network address: {response.network_address}</p>
                )}
                <p className="text-xs text-white/40 mt-2">
                  🔄 Redirecting to {selectedRole === 'token_owner' ? 'Bank Dashboard' : 'Participant Dashboard'}...
                </p>
              </>
            ) : (
              <>
                <p className="text-red-400 font-semibold">✗ Registration failed</p>
                <p className="text-xs text-white/40 mt-1">{response.detail || 'Unknown error'}</p>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
};

export default RegistrationPortal;

