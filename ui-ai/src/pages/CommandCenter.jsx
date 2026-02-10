import { useState } from 'react';
import { FunctionCard } from '../components';
import { safeGet } from '../services/apiClient';
import client from '../services/apiClient';

const cleanPayload = payload =>
  Object.entries(payload).reduce((acc, [key, value]) => {
    if (value !== '' && value !== undefined && value !== null) {
      acc[key] = value;
    }
    return acc;
  }, {});

const TOKEN_FUNCTIONS = [
  {
    key: 'getPendingTokenRequests',
    title: 'View Pending Access Requests',
    description: 'Review all pending requests for currency access permissions.',
    method: 'GET',
    endpoint: '/token-requests/pending',
    fields: []
  },
  {
    key: 'approveTokenRequest',
    title: 'Approve/Reject Access Request',
    description: 'Grant or deny currency access for a specific account.',
    method: 'POST',
    endpoint: '/token-requests/:requestId/approve',
    fields: [
      { name: 'requestId', label: 'Request ID', required: true, placeholder: 'Account identifier or request ID' },
      {
        name: 'status',
        label: 'Decision',
        options: [
          { value: 'approved', label: 'Approve' },
          { value: 'rejected', label: 'Reject' }
        ],
        defaultValue: 'approved'
      }
    ],
    buildRequest: values => {
      if (!values.requestId) throw new Error('Request ID is required');
      return {
        url: `/token-requests/${encodeURIComponent(values.requestId)}/approve`,
        data: cleanPayload({ status: values.status })
      };
    }
  }
];

const MINT_FUNCTIONS = [
  {
    key: 'getPendingMintRequests',
    title: 'View Pending Fund Requests',
    description: 'Review all pending requests to issue new funds.',
    method: 'GET',
    endpoint: '/mint-requests/pending',
    fields: []
  },
  {
    key: 'approveMintRequest',
    title: 'Approve/Reject Fund Request',
    description: 'Approve or deny a fund issuance request.',
    method: 'POST',
    endpoint: '/mint-requests/:requestId/approve',
    fields: [
      { name: 'requestId', label: 'Request ID', required: true, placeholder: 'Fund request identifier' },
      {
        name: 'status',
        label: 'Decision',
        options: [
          { value: 'approved', label: 'Approve' },
          { value: 'rejected', label: 'Reject' }
        ],
        defaultValue: 'approved'
      }
    ],
    buildRequest: values => {
      if (!values.requestId) throw new Error('Request ID is required');
      return {
        url: `/mint-requests/${encodeURIComponent(values.requestId)}/approve`,
        data: cleanPayload({ status: values.status })
      };
    }
  }
];

const LIST_FUNCTIONS = [
  {
    key: 'listAssignedTokens',
    title: 'View Assigned Currencies',
    description: 'List all currencies that have been assigned to institutions.',
    method: 'GET',
    endpoint: '/bank/assigned-tokens',
    fields: [],
    buildRequest: () => ({
      params: cleanPayload({})
    })
  },
  {
    key: 'getApprovedMintRequests',
    title: 'View Approved Fund Requests',
    description: 'View all fund requests that have been approved.',
    method: 'GET',
    endpoint: '/mint-requests/approved',
    fields: [],
    buildRequest: () => ({
      params: cleanPayload({})
    })
  }
];

const CUSTOMER_FUNCTIONS = [
  {
    key: 'getPendingCustomerRegistrations',
    title: '👥 View Pending Customer Registrations',
    description: 'Review all customers waiting for approval to join the bank.',
    method: 'GET',
    endpoint: '/bank/customer-registrations/pending',
    fields: []
  }
];

// Format KYC status
const formatKycStatus = (status) => {
  if (status === 'true' || status === true || status === 'verified' || status === 'Verified') {
    return '✅ Verified';
  }
  return '❌ Not Verified';
};

// Format timestamp to readable date
const formatDate = (isoString) => {
  if (!isoString) return 'N/A';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).replace(',', ' •');
  } catch (e) {
    return isoString;
  }
};

// Truncate request ID for display
const truncateId = (id, length = 30) => {
  if (!id) return '';
  return id.length > length ? id.substring(0, length) + '...' : id;
};

// Customer Registration Card Component
const CustomerRegistrationCard = ({ registration, onApprove, onReject, isLoading }) => {
  const {
    request_id,
    name,
    kyc_id,
    kyc_status,
    created_at,
    status,
    token_id
  } = registration;

  const statusBadge = status === 'PENDING' ? '🟡 Pending Approval' : status;
  const kycDisplay = formatKycStatus(kyc_status);
  const dateDisplay = formatDate(created_at);
  const requestIdDisplay = truncateId(request_id);

  return (
    <div className="glass-panel p-6 border border-white/5 space-y-5">
      <div className="flex items-start justify-between border-b border-white/10 pb-4">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-white/40 mb-2">📄 Bank Approval Request</p>
          <h4 className="text-xl font-semibold text-white">{name}</h4>
        </div>
        <div className="text-right">
          <span className="inline-block px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/40 text-xs font-medium text-yellow-300">
            {statusBadge}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Request ID</p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-mono text-white/80 break-all flex-1">{requestIdDisplay}</p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(request_id);
                alert('Request ID copied!');
              }}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-white/70 transition"
              title="Copy full request ID"
            >
              📋 Copy
            </button>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Token / Bank Product</p>
          <p className="text-sm font-semibold text-accent">{token_id}</p>
        </div>
      </div>

      <div className="bg-white/5 rounded-lg p-4 border border-white/10">
        <p className="text-xs uppercase tracking-wide text-white/40 mb-3 font-semibold">KYC Details</p>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/60">KYC ID:</span>
            <span className="text-sm font-mono text-white">{kyc_id}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-white/60">KYC Status:</span>
            <span className="text-sm font-semibold text-green-400">{kycDisplay}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Requested On</p>
        <p className="text-sm text-white/80">{dateDisplay}</p>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={() => onApprove(request_id)}
          disabled={isLoading}
          className="flex-1 px-4 py-3 rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition"
          title="Approve this registration"
        >
          {isLoading ? '⏳ Processing...' : '✅ APPROVE'}
        </button>
        <button
          onClick={() => onReject(request_id)}
          disabled={isLoading}
          className="flex-1 px-4 py-3 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition"
          title="Reject this registration"
        >
          {isLoading ? '⏳ Processing...' : '❌ REJECT'}
        </button>
      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value, subtext, color = 'white' }) => (
  <div className="glass-panel p-6 border border-white/5">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wide text-white/50 mb-1">{label}</p>
        <p className={`text-3xl font-bold text-${color} mb-1`}>{value}</p>
        {subtext && <p className="text-xs text-white/40">{subtext}</p>}
      </div>
      <div className="text-3xl opacity-20">{icon}</div>
    </div>
  </div>
);

const Section = ({ title, subtitle, helper, cards, icon }) => (
  <div className="glass-panel p-6 space-y-6 border border-white/5">
    <div className="flex items-start gap-4">
      <div className="text-4xl">{icon}</div>
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wide text-white/40">{title}</p>
        <h3 className="text-2xl font-semibold mb-1">{subtitle}</h3>
        {helper && <p className="text-sm text-white/60">{helper}</p>}
      </div>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      {cards.map(fn => (
        <FunctionCard key={fn.key} {...fn} />
      ))}
    </div>
  </div>
);

const AdminDashboard = () => {
  const [activeLane, setActiveLane] = useState('token');
  const [stats, setStats] = useState({
    pendingAccess: 0,
    pendingFunds: 0,
    pendingCustomers: 0,
    approved: 0
  });
  const [customerRegistrations, setCustomerRegistrations] = useState([]);
  const [customerRegLoading, setCustomerRegLoading] = useState(false);
  const [customerRegProcessing, setCustomerRegProcessing] = useState({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState('');

  const fetchStats = async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      const [
        tokenReqs, 
        mintReqs,
        approvedTokens,
        approvedMints,
        customerRegs
      ] = await Promise.all([
        safeGet('/token-requests/pending', []),
        safeGet('/mint-requests/pending', []),
        safeGet('/bank/assigned-tokens', []),
        safeGet('/mint-requests/approved', []),
        safeGet('/bank/customer-registrations/pending', [])
      ]);
      
      const today = new Date().toDateString();
      const allApproved = [
        ...(Array.isArray(approvedTokens) ? approvedTokens : []),
        ...(Array.isArray(approvedMints) ? approvedMints : [])
      ];
      
      const approvedToday = allApproved.filter(item => {
        if (!item.timestamp && !item.approvedAt && !item.approved_at) return false;
        const approvalDate = new Date(
          item.timestamp || item.approvedAt || item.approved_at
        ).toDateString();
        return approvalDate === today;
      }).length;
      
      setStats({
        pendingAccess: Array.isArray(tokenReqs) ? tokenReqs.length : 0,
        pendingFunds: Array.isArray(mintReqs) ? mintReqs.length : 0,
        pendingCustomers: Array.isArray(customerRegs) ? customerRegs.length : 0,
        approved: approvedToday
      });
      setCustomerRegistrations(Array.isArray(customerRegs) ? customerRegs : []);
    } catch (error) {
      console.warn('Failed to fetch admin stats:', error);
      setStatsError(error?.message || 'Failed to load stats');
    } finally {
      setStatsLoading(false);
    }
  };

  const handleApproveCustomer = async (requestId) => {
    setCustomerRegProcessing(prev => ({ ...prev, [requestId]: true }));
    try {
      const endpoint = `/bank/customer-registrations/${encodeURIComponent(requestId)}/approve`;
      const payload = { status: 'approved' };
      console.log('Approving customer with endpoint:', endpoint, 'payload:', payload);
      const response = await client.post(endpoint, payload);
      console.log('Approval response:', response);
      // Remove from list
      setCustomerRegistrations(prev => prev.filter(reg => reg.request_id !== requestId));
      setStats(prev => ({
        ...prev,
        pendingCustomers: Math.max(0, prev.pendingCustomers - 1)
      }));
      alert('✅ Customer registration approved successfully!');
    } catch (error) {
      console.error('Failed to approve customer:', error);
      const errorDetail = error?.response?.data?.detail || 
                         error?.response?.data?.error || 
                         error?.response?.data?.message ||
                         error?.message || 
                         'Failed to approve';
      const statusCode = error?.response?.status || 'Unknown';
      console.error(`Status Code: ${statusCode}`, errorDetail);
      alert(`❌ Error (${statusCode}): ${errorDetail}`);
    } finally {
      setCustomerRegProcessing(prev => ({ ...prev, [requestId]: false }));
    }
  };

  const handleRejectCustomer = async (requestId) => {
    setCustomerRegProcessing(prev => ({ ...prev, [requestId]: true }));
    try {
      const endpoint = `/bank/customer-registrations/${encodeURIComponent(requestId)}/reject`;
      const payload = { status: 'rejected' };
      console.log('Rejecting customer with endpoint:', endpoint, 'payload:', payload);
      const response = await client.post(endpoint, payload);
      console.log('Rejection response:', response);
      // Remove from list
      setCustomerRegistrations(prev => prev.filter(reg => reg.request_id !== requestId));
      setStats(prev => ({
        ...prev,
        pendingCustomers: Math.max(0, prev.pendingCustomers - 1)
      }));
      alert('✅ Customer registration rejected!');
    } catch (error) {
      console.error('Failed to reject customer:', error);
      const errorDetail = error?.response?.data?.detail || 
                         error?.response?.data?.error || 
                         error?.response?.data?.message ||
                         error?.message || 
                         'Failed to reject';
      const statusCode = error?.response?.status || 'Unknown';
      console.error(`Status Code: ${statusCode}`, errorDetail);
      alert(`❌ Error (${statusCode}): ${errorDetail}`);
    } finally {
      setCustomerRegProcessing(prev => ({ ...prev, [requestId]: false }));
    }
  };

  return (
    <div className="space-y-8">
      <div className="glass-panel p-6 space-y-4 border border-white/5">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">Administrative Dashboard</p>
          <h2 className="text-3xl font-bold mt-1">System Management</h2>
          <p className="text-sm text-white/60 mt-2">
            Review and approve currency access requests and fund issuance requests.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchStats}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold transition"
          >
            {statsLoading ? 'Refreshing...' : 'Refresh Stats'}
          </button>
          {statsError && <span className="text-xs text-red-300">{statsError}</span>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard 
          icon="⏳" 
          label="Pending Access Requests" 
          value={stats.pendingAccess.toLocaleString()} 
          subtext="Currency permissions" 
          color="amber-400"
        />
        <StatCard 
          icon="💵" 
          label="Pending Fund Requests" 
          value={stats.pendingFunds.toLocaleString()} 
          subtext="Awaiting approval" 
          color="amber-400"
        />
        <StatCard 
          icon="👥" 
          label="Pending Customer Registrations" 
          value={stats.pendingCustomers.toLocaleString()} 
          subtext="Awaiting approval" 
          color="blue-400"
        />
        <StatCard 
          icon="✅" 
          label="Approved Today" 
          value={stats.approved.toLocaleString()} 
          subtext="Total approvals" 
          color="green-400"
        />
      </div>

      <div className="glass-panel p-6 space-y-4 border border-white/5">
        <div>
          <h3 className="text-xl font-semibold mb-2">Select Management Category</h3>
          <p className="text-sm text-white/60">
            Choose a category to review pending requests and manage approvals.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActiveLane('token')}
            className={`px-6 py-3 rounded-xl text-sm font-semibold transition ${
              activeLane === 'token'
                ? 'bg-accent text-slate-950'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            💰 Token Access
          </button>
          <button
            type="button"
            onClick={() => setActiveLane('mint')}
            className={`px-6 py-3 rounded-xl text-sm font-semibold transition ${
              activeLane === 'mint'
                ? 'bg-accent text-slate-950'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            💵 Fund Requests
          </button>
          <button
            type="button"
            onClick={() => setActiveLane('list')}
            className={`px-6 py-3 rounded-xl text-sm font-semibold transition ${
              activeLane === 'list'
                ? 'bg-accent text-slate-950'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            📋 View Records
          </button>
          <button
            type="button"
            onClick={() => setActiveLane('customers')}
            className={`px-6 py-3 rounded-xl text-sm font-semibold transition ${
              activeLane === 'customers'
                ? 'bg-accent text-slate-950'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            👥 Customer Registrations
          </button>
        </div>
      </div>

      {activeLane === 'token' && (
        <Section
          icon="💰"
          title="Currency Access Management"
          subtitle="Review and Approve Access Requests"
          helper="Step 1: Review pending requests for currency access. Step 2: Approve or reject each request based on account verification."
          cards={TOKEN_FUNCTIONS}
        />
      )}

      {activeLane === 'mint' && (
        <Section
          icon="💵"
          title="Fund Issuance Management"
          subtitle="Review and Approve Fund Requests"
          helper="Step 1: Review the pending fund issuance queue. Step 2: Approve or reject fund requests based on verification and policies."
          cards={MINT_FUNCTIONS}
        />
      )}

      {activeLane === 'list' && (
        <Section
          icon="📋"
          title="Records and History"
          subtitle="View Approved Items"
          helper="View all currencies that have been assigned and fund requests that have been approved."
          cards={LIST_FUNCTIONS}
        />
      )}

      {activeLane === 'customers' && (
        <div className="glass-panel p-6 space-y-6 border border-white/5">
          <div className="flex items-start gap-4">
            <div className="text-4xl">👥</div>
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-white/40">Customer Management</p>
              <h3 className="text-2xl font-semibold mb-1">Review and Approve Customers</h3>
              <p className="text-sm text-white/60">Review pending customer registrations and approve or reject them based on KYC verification status.</p>
            </div>
          </div>

          {customerRegLoading ? (
            <div className="text-center py-8">
              <p className="text-white/60">Loading customer registrations...</p>
            </div>
          ) : customerRegistrations.length === 0 ? (
            <div className="text-center py-8 rounded-lg bg-white/5 border border-white/10">
              <p className="text-white/60">✅ No pending customer registrations</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-1">
              {customerRegistrations.map(reg => (
                <CustomerRegistrationCard
                  key={reg.request_id}
                  registration={reg}
                  onApprove={handleApproveCustomer}
                  onReject={handleRejectCustomer}
                  isLoading={customerRegProcessing[reg.request_id] || false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
