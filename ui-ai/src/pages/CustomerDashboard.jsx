import { useEffect, useMemo, useState } from 'react';
import { FunctionCard, StatGrid, CustomerToTokenTransfer } from '../components';
import AvailableCurrenciesDisplay from '../components/AvailableCurrenciesDisplay';
import CustomerTransactionHistoryDisplay from '../components/CustomerTransactionHistoryDisplay';
import client, { safeGet } from '../services/apiClient';

const getStoredRegistrationSnapshot = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('latestRegistrationCredentials');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const getIdentityFromStorage = () => {
  if (typeof window === 'undefined') {
    return { userId: '', networkAddress: '', role: '' };
  }
  const latest = getStoredRegistrationSnapshot();
  return {
    userId: latest?.username || window.localStorage.getItem('userName') || '',
    networkAddress: latest?.network_address || window.localStorage.getItem('userNetworkAddress') || '',
    role: window.localStorage.getItem('userRole') || latest?.role || ''
  };
};

const normalizeTokenList = response => {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.tokens)) return response.tokens;
  if (Array.isArray(response.data)) return response.data;
  return [];
};

const buildHistoryPayload = raw => {
  const transactions = Array.isArray(raw?.transactions)
    ? raw.transactions
    : Array.isArray(raw?.completed_transfers)
      ? raw.completed_transfers
      : [];

  const summary = raw?.summary || {
    total_transactions: transactions.length,
    transfers: transactions.length,
    total_debits: transactions.filter(tx => tx.transaction_type === 'DEBIT').length,
    total_credits: transactions.filter(tx => tx.transaction_type === 'CREDIT').length
  };

  return { transactions, summary };
};

const formatBalance = wallet => {
  if (!wallet) return '—';
  return (
    wallet.walletBalanceDisplay ||
    wallet.wallet_balance_display ||
    wallet.walletBalance ||
    wallet.wallet_balance ||
    wallet.balance ||
    '—'
  );
};

const formatCurrency = wallet => {
  if (!wallet) return '';
  return wallet.currency || wallet.currency_symbol || wallet.currencySymbol || '';
};

const CustomerDashboard = () => {
  const [activeSection, setActiveSection] = useState('currencies');
  const [identity, setIdentity] = useState(() => getIdentityFromStorage());
  const [wallet, setWallet] = useState({ loading: false, data: null, error: '' });
  const [tokens, setTokens] = useState({ loading: false, data: [], error: '' });
  const [history, setHistory] = useState({ loading: false, data: { transactions: [], summary: null }, error: '' });
  const [registrationStatus, setRegistrationStatus] = useState({ state: 'idle', message: '' });

  useEffect(() => {
    const handler = event => {
      if (event?.detail) {
        setIdentity(getIdentityFromStorage());
      }
    };
    window.addEventListener('latest-registration-credentials', handler);
    return () => window.removeEventListener('latest-registration-credentials', handler);
  }, []);

  const fetchWallet = async currentIdentity => {
    if (!currentIdentity?.userId) {
      setWallet({ loading: false, data: null, error: 'Sign in to view wallet details.' });
      return;
    }
    setWallet(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const { data } = await client.get('/customer/wallet', {
        params: {
          userId: currentIdentity.userId,
          networkAddress: currentIdentity.networkAddress || undefined
        }
      });
      setWallet({ loading: false, data, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unable to load wallet';
      setWallet({ loading: false, data: null, error: detail });
    }
  };

  const fetchTokens = async () => {
    setTokens(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await safeGet('/customer/view-all-tokens', { throwError: true }, {});
      setTokens({ loading: false, data: normalizeTokenList(response), error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load tokens';
      setTokens({ loading: false, data: [], error: detail });
    }
  };

  const fetchHistory = async () => {
    setHistory(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await safeGet('/customer/transfer-history', { throwError: true }, {});
      setHistory({ loading: false, data: buildHistoryPayload(response), error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load transaction history';
      setHistory({ loading: false, data: { transactions: [], summary: null }, error: detail });
    }
  };

  const handleRegisterToken = async currency => {
    setRegistrationStatus({ state: 'loading', message: 'Starting registration...' });
    try {
      if (!identity.networkAddress) {
        throw new Error('Network address missing. Please enroll or sign in again.');
      }
      if (!currency?.token_id) {
        throw new Error('Token ID is missing.');
      }
      const { data } = await client.post(
        `/token/${encodeURIComponent(currency.token_id)}/start-register`,
        { networkAddress: identity.networkAddress }
      );
      const loginURL = data?.login_url;
      if (loginURL) {
        window.open(loginURL, '_blank', 'noopener');
        setRegistrationStatus({ state: 'success', message: 'Bank registration opened in a new tab.' });
      } else {
        setRegistrationStatus({ state: 'success', message: 'Registration request submitted.' });
      }
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Registration failed';
      setRegistrationStatus({ state: 'error', message: detail });
    }
  };

  useEffect(() => {
    fetchWallet(identity);
    fetchTokens();
    fetchHistory();
  }, [identity.userId, identity.networkAddress]);

  const tokenOptions = useMemo(() =>
    tokens.data.map(token => ({
      value: token.token_id,
      label: token.currency ? `${token.currency} • ${token.token_id}` : token.token_id
    })), [tokens.data]
  );

  const actionCards = useMemo(() => ([
    {
      key: 'requestMint',
      icon: '💵',
      title: 'Request Mint',
      description: 'Ask the token owner to mint new funds into your wallet.',
      method: 'POST',
      endpoint: '/bank/request-mint',
      fields: [
        { name: 'amount', label: 'Amount', type: 'number', required: true, placeholder: 'e.g., 5000' }
      ],
      buildRequest: values => {
        if (!identity.userId) throw new Error('User ID is required. Please sign in again.');
        const autoTokenId = tokens.data?.[0]?.token_id;
        if (!autoTokenId) throw new Error('No token available for mint request.');
        return {
          data: {
            amount: values.amount,
            tokenID: autoTokenId,
            userId: identity.userId,
            networkAddress: identity.networkAddress || undefined
          }
        };
      }
    }
  ]), [identity.userId, identity.networkAddress, tokens.data]);

  const stats = useMemo(() => {
    const balanceValue = formatBalance(wallet.data);
    const currencyLabel = formatCurrency(wallet.data);
    return [
      {
        label: 'Wallet Balance',
        value: balanceValue,
        subtext: currencyLabel ? `Balance in ${currencyLabel}` : 'Customer wallet snapshot'
      },
      {
        label: 'Available Currencies',
        value: tokens.data.length.toString(),
        subtext: 'Tokens open for registration'
      },
      {
        label: 'Transfers Recorded',
        value: history.data.transactions.length.toString(),
        subtext: 'Customer transfer history'
      },
      {
        label: 'Network Address',
        value: identity.networkAddress ? 'Linked' : 'Missing',
        subtext: identity.networkAddress ? 'Ready for token registration' : 'Complete enrollment to link'
      }
    ];
  }, [wallet.data, tokens.data.length, history.data.transactions.length, identity.networkAddress]);

  return (
    <div className="space-y-8">
      <div className="glass-panel p-6 border border-white/5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/40">Customer Workspace</p>
            <h2 className="text-3xl font-bold mt-1">Your Global Wallet</h2>
            <p className="text-sm text-white/60 mt-2">
              Track balances, register currencies, and send cross-border transfers in one place.
            </p>
          </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  fetchWallet(identity);
                  fetchTokens();
                  fetchHistory();
                }}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold transition"
              >
                Refresh Data
              </button>
            {identity.userId && (
              <span className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70">
                Signed in as {identity.userId}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="glass-panel p-4 border border-white/5">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActiveSection('currencies')}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
              activeSection === 'currencies'
                ? 'bg-accent text-slate-950'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            🌍 Available Currencies
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('dashboard')}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
              activeSection === 'dashboard'
                ? 'bg-accent text-slate-950'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            📊 Main Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('settings')}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
              activeSection === 'settings'
                ? 'bg-accent text-slate-950'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
          >
            ⚙️ Settings
          </button>
        </div>
      </div>

      {activeSection === 'currencies' && (
        <div className="glass-panel p-6 border border-white/5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/40">Step 1</p>
              <h3 className="text-2xl font-semibold">Choose a Currency to Register</h3>
              <p className="text-sm text-white/60 mt-2">
                Register your wallet with a bank-issued currency to enable minting and transfers.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveSection('dashboard')}
              className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold transition"
            >
              Go to Dashboard →
            </button>
          </div>

          {registrationStatus.state !== 'idle' && (
            <div
              className={`rounded-lg border p-4 text-sm ${
                registrationStatus.state === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                  : 'border-green-500/40 bg-green-500/10 text-green-200'
              }`}
            >
              {registrationStatus.message}
            </div>
          )}

          {tokens.loading && <p className="text-sm text-white/60">Loading available currencies...</p>}
          {tokens.error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              {tokens.error}
            </div>
          )}
          {!tokens.loading && !tokens.error && (
            <AvailableCurrenciesDisplay data={tokens.data} onRegister={handleRegisterToken} registerLabel="Register for token" />
          )}
        </div>
      )}

      {activeSection === 'dashboard' && (
        <>
          <StatGrid stats={stats} />

          <div className="glass-panel p-6 border border-white/5">
            <p className="text-xs uppercase tracking-wide text-white/40">Quick Access</p>
            <h3 className="text-2xl font-semibold mt-1">Customer Actions</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <button
                type="button"
                onClick={() => document.getElementById('customer-wallet-balance')?.scrollIntoView({ behavior: 'smooth' })}
                className="glass-panel p-4 border border-white/10 text-left hover:border-accent/40 transition"
              >
                <p className="text-lg">👛</p>
                <p className="text-sm font-semibold mt-3">Wallet Balance</p>
                <p className="text-xs text-white/50 mt-1">Check account balance</p>
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('customer-request-funds')?.scrollIntoView({ behavior: 'smooth' })}
                className="glass-panel p-4 border border-white/10 text-left hover:border-accent/40 transition"
              >
                <p className="text-lg">💵</p>
                <p className="text-sm font-semibold mt-3">Request Funds</p>
                <p className="text-xs text-white/50 mt-1">Submit mint request</p>
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('customer-send-money')?.scrollIntoView({ behavior: 'smooth' })}
                className="glass-panel p-4 border border-white/10 text-left hover:border-accent/40 transition"
              >
                <p className="text-lg">💸</p>
                <p className="text-sm font-semibold mt-3">Send Money</p>
                <p className="text-xs text-white/50 mt-1">Customer-to-token transfer</p>
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('customer-history')?.scrollIntoView({ behavior: 'smooth' })}
                className="glass-panel p-4 border border-white/10 text-left hover:border-accent/40 transition"
              >
                <p className="text-lg">🧾</p>
                <p className="text-sm font-semibold mt-3">View History</p>
                <p className="text-xs text-white/50 mt-1">Transaction history</p>
              </button>
            </div>
          </div>

          <div id="customer-wallet-balance" className="glass-panel p-6 border border-white/5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/40">Wallet Balance</p>
                <h3 className="text-2xl font-semibold">Current Balance</h3>
              </div>
              {wallet.loading && <span className="text-xs text-white/50">Loading...</span>}
            </div>

            {wallet.error && (
              <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                {wallet.error}
              </div>
            )}

            {wallet.data && !wallet.loading && (
              <div className="mt-4 glass-panel p-4 border border-white/10">
                <p className="text-3xl font-semibold">{formatBalance(wallet.data)}</p>
                <p className="text-xs text-white/40 mt-2">
                  {formatCurrency(wallet.data) || 'Currency assigned by token owner'}
                </p>
              </div>
            )}

            {!wallet.data && !wallet.loading && !wallet.error && (
              <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                No wallet data yet. Complete enrollment or refresh to load your wallet.
              </div>
            )}
          </div>

          <div id="customer-request-funds" className="grid gap-6 lg:grid-cols-2">
            {actionCards.map(card => (
              <FunctionCard key={card.key} {...card} />
            ))}
          </div>

          <div id="customer-send-money" className="glass-panel p-6 border border-white/5">
            <CustomerToTokenTransfer
              userRole="customer"
              userNetworkAddress={identity.networkAddress}
              tokenId=""
            />
          </div>

          <div id="customer-history" className="glass-panel p-6 border border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/40">Transfer History</p>
                <h3 className="text-2xl font-semibold">Recent Activity</h3>
              </div>
              <button
                type="button"
                onClick={fetchHistory}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold transition"
              >
                Refresh History
              </button>
            </div>

            {history.loading && <p className="text-sm text-white/60">Loading transfer history...</p>}
            {history.error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                {history.error}
              </div>
            )}
            {!history.loading && !history.error && (
              <CustomerTransactionHistoryDisplay data={history.data} />
            )}
          </div>
        </>
      )}

      {activeSection === 'settings' && (
        <div className="glass-panel p-6 border border-white/5 space-y-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/40">Settings</p>
            <h3 className="text-2xl font-semibold">Manage Currency Access</h3>
            <p className="text-sm text-white/60 mt-2">
              Register for new currencies or manage your available options.
            </p>
          </div>

          {registrationStatus.state !== 'idle' && (
            <div
              className={`rounded-lg border p-4 text-sm ${
                registrationStatus.state === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                  : 'border-green-500/40 bg-green-500/10 text-green-200'
              }`}
            >
              {registrationStatus.message}
            </div>
          )}

          {tokens.loading && <p className="text-sm text-white/60">Loading available currencies...</p>}
          {tokens.error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
              {tokens.error}
            </div>
          )}
          {!tokens.loading && !tokens.error && (
            <AvailableCurrenciesDisplay data={tokens.data} onRegister={handleRegisterToken} registerLabel="Register for token" />
          )}
        </div>
      )}
    </div>
  );
};

export default CustomerDashboard;
