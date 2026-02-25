import { useEffect, useState } from 'react';
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
    return { userId: '', networkAddress: '' };
  }
  const latest = getStoredRegistrationSnapshot();
  return {
    userId: latest?.username || window.localStorage.getItem('userName') || '',
    networkAddress: latest?.network_address || window.localStorage.getItem('userNetworkAddress') || ''
  };
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

const normalizeBalance = balance => {
  if (balance === null || balance === undefined) return '—';
  const text = String(balance);
  return text.replace(/^[^\d-]+/, '').trim() || '—';
};

const formatCurrency = wallet => {
  if (!wallet) return '';
  return wallet.currency || wallet.currencyCode || wallet.currency_code || '';
};

const resolveWalletPayload = walletData => {
  if (!walletData) return null;
  return walletData.wallet || walletData;
};

const formatDate = isoString => {
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

const truncateId = (id, length = 30) => {
  if (!id) return '';
  return id.length > length ? id.substring(0, length) + '...' : id;
};

const looksLikeNetworkAddress = value => {
  if (!value || typeof value !== 'string') return false;
  const text = value.trim();
  return text.includes('::') || text.startsWith('eDU') || text.length > 60;
};

const resolveCustomerDisplayId = (payload, fallback = '—') => {
  if (!payload) return fallback;
  const candidates = [
    payload?.customer_id,
    payload?.customerID,
    payload?.customer_ref,
    payload?.customerRef,
    payload?.display_customer_id
  ].filter(Boolean);

  const nonNetwork = candidates.find(item => !looksLikeNetworkAddress(item));
  return nonNetwork || candidates[0] || fallback;
};

const resolveTokenDisplayId = payload => {
  if (!payload) return '—';
  return payload?.display_token_id || payload?.token_id || payload?.tokenID || payload?.token || '—';
};

const normalizeBackendToken = token => {
  const tokenID = token?.token_id || token?.tokenID || token?.TokenID || '';
  const owner = token?.owner || token?.Owner || '';
  const status = String(token?.status || token?.Status || '').trim().toUpperCase();
  const availableForRegistration = Boolean(
    token?.available_for_registration === true ||
    token?.available === true ||
    token?.Available === true ||
    status === 'AVAILABLE' ||
    !String(owner).trim()
  );
  return {
    ...token,
    token_id: tokenID,
    owner,
    status,
    available_for_registration: availableForRegistration,
    approved_for_customer: Boolean(
      token?.approved_for_customer === true ||
      String(owner).trim() ||
      status === 'APPROVED' ||
      status === 'ACTIVE' ||
      token?.available === false ||
      token?.Available === false
    )
  };
};

const resolveCustomerNetworkAddressDisplay = (payload, fallback = '—') => {
  if (!payload) return fallback;
  return payload?.network_address || payload?.networkAddress || payload?.customer_network_address || payload?.customerNetworkAddress || fallback;
};

const resolveCustomerAccessPayload = payload => {
  if (!payload) return null;
  return (
    payload.access ||
    payload.data?.access ||
    payload.data ||
    payload.customer_access ||
    payload.result ||
    payload
  );
};

const resolveCustomerNetworkAddress = (identity, walletData) => {
  const walletPayload = resolveWalletPayload(walletData);
  return (
    identity?.networkAddress ||
    walletPayload?.networkAddress ||
    walletPayload?.network_address ||
    (typeof window !== 'undefined' ? window.localStorage.getItem('userNetworkAddress') : '') ||
    ''
  );
};

const getCurrencySymbol = currencyCode => {
  const symbols = {
    USD: '$',
    INR: '₹',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    CAD: 'C$',
    AUD: 'A$',
    CHF: 'CHF '
  };
  if (!currencyCode) return '';
  const normalized = String(currencyCode).trim().toUpperCase();
  return symbols[normalized] || `${normalized} `;
};

const CustomerDashboard = () => {
  const [activeLane, setActiveLane] = useState('wallet');
  const [identity, setIdentity] = useState(() => getIdentityFromStorage());
  const [accounts, setAccounts] = useState({ loading: false, data: [], error: '' });
  const [selectedAccount, setSelectedAccount] = useState({ customerRef: '', tokenID: '' });
  const [wallet, setWallet] = useState({ loading: false, data: null, error: '' });
  const [tokens, setTokens] = useState({ loading: false, data: [], error: '' });
  const [tokensMeta, setTokensMeta] = useState({ source: '', total: 0, available: 0 });
  const [assignedTokens, setAssignedTokens] = useState({ loading: false, data: [], error: '' });
  const [history, setHistory] = useState({ loading: false, data: { transactions: [], summary: null }, error: '' });
  const [mintHistory, setMintHistory] = useState({ loading: false, data: [], error: '' });
  const [historyTab, setHistoryTab] = useState('all');
  const [selectedHistoryTx, setSelectedHistoryTx] = useState(null);
  const [sendAmount, setSendAmount] = useState('');
  const [receiverCustomerID, setReceiverCustomerID] = useState('');
  const [senderBankBIC, setSenderBankBIC] = useState('');
  const [receiverBankBIC, setReceiverBankBIC] = useState('');
  const [sendStatus, setSendStatus] = useState({ state: 'idle', message: '' });
  const [addFundsAmount, setAddFundsAmount] = useState('');
  const [addFundsTokenID, setAddFundsTokenID] = useState('');
  const [addFundsStatus, setAddFundsStatus] = useState({ state: 'idle', message: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [showRegisterTokens, setShowRegisterTokens] = useState(false);
  const [registerStatus, setRegisterStatus] = useState({ state: 'idle', message: '', tokenId: '' });
  const [tokenApproval, setTokenApproval] = useState({ loading: false, data: null, error: '' });
  const [showWalletView, setShowWalletView] = useState(false);
  const [viewTokenId, setViewTokenId] = useState('');
  const [showCustomerIdAccess, setShowCustomerIdAccess] = useState(false);
  const [customerIdTokenID, setCustomerIdTokenID] = useState('');
  const [customerIdAccess, setCustomerIdAccess] = useState({ loading: false, data: null, error: '' });

  useEffect(() => {
    const handler = event => {
      if (event?.detail) {
        setIdentity(getIdentityFromStorage());
      }
    };
    window.addEventListener('latest-registration-credentials', handler);
    return () => window.removeEventListener('latest-registration-credentials', handler);
  }, []);

  const fetchAccounts = async currentIdentity => {
    if (!currentIdentity?.userId) {
      setAccounts({ loading: false, data: [], error: 'Sign in to view customer accounts.' });
      return;
    }
    setAccounts(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const { data } = await client.get('/customer/accounts', {
        params: {
          userId: currentIdentity.userId,
          networkAddress: currentIdentity.networkAddress || undefined
        }
      });
      const list = Array.isArray(data?.accounts) ? data.accounts : [];
      setAccounts({ loading: false, data: list, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unable to load customer accounts';
      setAccounts({ loading: false, data: [], error: detail });
    }
  };

  const fetchWallet = async (currentIdentity, accountSelection = null) => {
    if (!currentIdentity?.userId) {
      setWallet({ loading: false, data: null, error: 'Sign in to view wallet details.' });
      return;
    }
    setWallet(prev => ({ ...prev, loading: true, error: '' }));
    try {
      let data;
      if (accountSelection?.customerRef && accountSelection?.tokenID) {
        const response = await client.get(
          `/customer/accounts/${encodeURIComponent(accountSelection.customerRef)}/${encodeURIComponent(accountSelection.tokenID)}`,
          {
            params: {
              userId: currentIdentity.userId,
              networkAddress: currentIdentity.networkAddress || undefined
            }
          }
        );
        data = response.data;
      } else {
        const response = await client.get('/customer/wallet', {
          params: {
            userId: currentIdentity.userId,
            networkAddress: currentIdentity.networkAddress || undefined
          }
        });
        data = response.data;
      }
      const normalized = data?.wallet || data;
      setWallet({ loading: false, data: normalized, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unable to load wallet';
      setWallet({ loading: false, data: null, error: detail });
    }
  };

  const fetchTokenApprovalStatus = async (currentIdentity, hintedTokenID = '') => {
    if (!currentIdentity?.userId) {
      setTokenApproval({ loading: false, data: null, error: '' });
      return;
    }
    setTokenApproval(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const { data } = await client.get('/customer/token-approval-status', {
        params: {
          userId: currentIdentity.userId,
          networkAddress: currentIdentity.networkAddress || undefined,
          tokenID: hintedTokenID || undefined
        }
      });
      const normalized = data?.approval || data;
      setTokenApproval({ loading: false, data: normalized, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unable to load approval status';
      setTokenApproval({ loading: false, data: null, error: detail });
    }
  };

  const fetchTokens = async () => {
    setTokens(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await safeGet('/customer/view-all-tokens', { throwError: true }, {});
      const data = Array.isArray(response)
        ? response
        : Array.isArray(response?.tokens)
          ? response.tokens
          : Array.isArray(response?.data)
            ? response.data
            : [];
      const normalized = data.map(normalizeBackendToken).filter(token => token.token_id);
      setTokensMeta({
        source: response?.source || 'backend',
        total: normalized.length,
        available: normalized.filter(token => token.available_for_registration).length
      });
      setTokens({ loading: false, data: normalized, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load tokens';
      setTokensMeta({ source: '', total: 0, available: 0 });
      setTokens({ loading: false, data: [], error: detail });
    }
  };

  const fetchAssignedTokens = async () => {
    setAssignedTokens(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await safeGet('/customer/view-all-tokens', { throwError: true }, {});
      const list = Array.isArray(response)
        ? response
        : Array.isArray(response?.tokens)
          ? response.tokens
          : Array.isArray(response?.approved_tokens)
            ? response.approved_tokens
            : Array.isArray(response?.data)
              ? response.data
              : [];

      const assigned = list
        .map(normalizeBackendToken)
        .filter(token => {
          const owner = String(token?.owner || token?.Owner || '').trim();
          if (!owner) return false;
          if (!token?.token_id) return false;
          const status = String(token.status || '').trim().toUpperCase();
          return !['REJECTED', 'FROZEN', 'EXPIRED'].includes(status);
        });

      setAssignedTokens({ loading: false, data: assigned, error: '' });
    } catch (error) {
      const detail =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        'Unable to load assigned tokens';
      setAssignedTokens({ loading: false, data: [], error: detail });
    }
  };

  const fetchHistory = async () => {
    setHistory(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await safeGet('/customer/transfer-history', { throwError: true }, {});
      const transactions = Array.isArray(response?.transactions)
        ? response.transactions
        : Array.isArray(response?.completed_transfers)
          ? response.completed_transfers
          : Array.isArray(response?.history)
            ? response.history
            : Array.isArray(response?.records)
              ? response.records
              : [];
      const cleaned = transactions.filter(Boolean);
      setHistory({ loading: false, data: { transactions: cleaned, summary: response?.summary || {} }, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load transaction history';
      setHistory({ loading: false, data: { transactions: [], summary: null }, error: detail });
    }
  };

  const fetchMintHistory = async () => {
    setMintHistory(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await safeGet('/customer/mint-history', { throwError: true }, {});
      const requests = Array.isArray(response?.mint_requests)
        ? response.mint_requests
        : Array.isArray(response?.requests)
          ? response.requests
          : [];
      setMintHistory({ loading: false, data: requests, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load mint history';
      setMintHistory({ loading: false, data: [], error: detail });
    }
  };

  useEffect(() => {
    fetchAccounts(identity);
    fetchTokenApprovalStatus(identity);
    fetchTokens();
    fetchHistory();
  }, [identity.userId, identity.networkAddress]);

  useEffect(() => {
    if (!Array.isArray(accounts.data) || accounts.data.length === 0) {
      setSelectedAccount({ customerRef: '', tokenID: '' });
      return;
    }
    const currentKey = `${selectedAccount.customerRef}|${selectedAccount.tokenID}`;
    const exists = accounts.data.some(
      entry => `${entry?.customer_ref || entry?.customer_id || ''}|${entry?.token_id || ''}` === currentKey
    );
    if (!exists) {
      const first = accounts.data[0];
      setSelectedAccount({
        customerRef: first?.customer_ref || first?.customer_id || '',
        tokenID: first?.token_id || ''
      });
    }
  }, [accounts.data, selectedAccount.customerRef, selectedAccount.tokenID]);

  useEffect(() => {
    if (!identity?.userId) {
      return;
    }
    if (selectedAccount?.customerRef && selectedAccount?.tokenID) {
      fetchWallet(identity, selectedAccount);
      return;
    }
    fetchWallet(identity);
  }, [identity.userId, identity.networkAddress, selectedAccount.customerRef, selectedAccount.tokenID]);

  useEffect(() => {
    const walletPayload = resolveWalletPayload(wallet.data);
    const tokenIdFromWallet = selectedAccount?.tokenID || walletPayload?.token_id || walletPayload?.tokenID || '';
    if (identity?.userId) {
      fetchTokenApprovalStatus(identity, tokenIdFromWallet);
    }
  }, [identity.userId, identity.networkAddress, wallet.data, selectedAccount.tokenID]);

  useEffect(() => {
    if (activeLane === 'history' && historyTab === 'mintrequest') {
      fetchMintHistory();
    }
  }, [activeLane, historyTab]);

  useEffect(() => {
    const walletPayload = resolveWalletPayload(wallet.data);
    const bicFromWallet = walletPayload?.bic || walletPayload?.bic_code || walletPayload?.BIC || '';
    if (!senderBankBIC && bicFromWallet) {
      setSenderBankBIC(bicFromWallet);
    }
    const tokenIdFromWallet = walletPayload?.token_id || walletPayload?.tokenID || '';
    if (!addFundsTokenID && tokenIdFromWallet) {
      setAddFundsTokenID(tokenIdFromWallet);
    }
  }, [wallet.data, senderBankBIC, addFundsTokenID]);

  useEffect(() => {
    if (showSettings) {
      fetchAssignedTokens();
    }
  }, [showSettings, accounts.data, wallet.data, selectedAccount.tokenID]);

  useEffect(() => {
    if (!customerIdTokenID) {
      const walletPayload = resolveWalletPayload(wallet.data);
      const tokenIdFromWallet = walletPayload?.token_id || walletPayload?.tokenID || '';
      if (tokenIdFromWallet) {
        setCustomerIdTokenID(tokenIdFromWallet);
      }
    }
  }, [wallet.data, customerIdTokenID]);

  useEffect(() => {
    const resolvedNetworkAddress = resolveCustomerNetworkAddress(identity, wallet.data);
    if (resolvedNetworkAddress && resolvedNetworkAddress !== identity.networkAddress) {
      setIdentity(prev => ({ ...prev, networkAddress: resolvedNetworkAddress }));
      try {
        window.localStorage.setItem('userNetworkAddress', resolvedNetworkAddress);
      } catch (e) {
        console.warn('Failed to persist user network address:', e);
      }
    }
  }, [wallet.data, identity.networkAddress]);

  const handleWalletRefresh = async () => {
    if (!identity?.userId) return;
    if (selectedAccount?.customerRef && selectedAccount?.tokenID) {
      await fetchWallet(identity, selectedAccount);
      return;
    }
    await fetchWallet(identity);
  };

  const handleSendMoney = async () => {
    try {
      setSendStatus({ state: 'loading', message: 'Submitting transfer request...' });

      const trimmedReceiverCustomerID = receiverCustomerID.trim();
      const trimmedReceiverBankBIC = receiverBankBIC.trim();

      if (!trimmedReceiverCustomerID) {
        throw new Error('Receiver Customer ID is required.');
      }
      if (!trimmedReceiverBankBIC) {
        throw new Error('Receiver Bank BIC is required.');
      }
      const parsedAmount = parseFloat(sendAmount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Amount must be a positive number.');
      }

      const { data } = await client.post('/customer-to-token-transfer', {
        customer_id: trimmedReceiverCustomerID,
        bic_code: trimmedReceiverBankBIC,
        amount: parsedAmount
      });

      const successMessage =
        data?.message ||
        data?.detail ||
        data?.error ||
        data?.transfer_details?.message ||
        (typeof data === 'string' ? data : '') ||
        'Transfer request submitted successfully.';
      setSendStatus({ state: 'success', message: successMessage });
      setSendAmount('');
      fetchWallet(identity);
      fetchHistory();
    } catch (error) {
      const detail =
        error?.response?.data?.message ||
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        (typeof error?.response?.data === 'string' ? error.response.data : '') ||
        error?.message ||
        'Failed to submit transfer request.';
      setSendStatus({ state: 'error', message: detail });
    }
  };

  const handleAddFunds = async () => {
    try {
      setAddFundsStatus({ state: 'loading', message: 'Submitting add funds request...' });

      const trimmedTokenID = addFundsTokenID.trim();
      if (!trimmedTokenID) {
        throw new Error('Token ID is missing. Please refresh wallet or sign in again.');
      }
      const parsedAmount = parseInt(addFundsAmount, 10);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Amount must be a positive number.');
      }
      if (!identity.userId) {
        throw new Error('User ID is missing. Please sign in again.');
      }

      const { data } = await client.post('/bank/request-mint', {
        amount: parsedAmount,
        tokenID: trimmedTokenID,
        userId: identity.userId,
        networkAddress: identity.networkAddress || undefined
      });

      const successMessage =
        data?.message ||
        data?.detail ||
        data?.error ||
        (typeof data === 'string' ? data : '') ||
        'Add funds request submitted successfully.';
      setAddFundsStatus({ state: 'success', message: successMessage });
      setAddFundsAmount('');
      fetchWallet(identity);
      fetchHistory();
    } catch (error) {
      const detail =
        error?.response?.data?.message ||
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        (typeof error?.response?.data === 'string' ? error.response.data : '') ||
        error?.message ||
        'Failed to submit add funds request.';
      setAddFundsStatus({ state: 'error', message: detail });
    }
  };

  const handleStartRegister = async tokenId => {
    setRegisterStatus({ state: 'loading', message: 'Automated registration started...', tokenId: tokenId || '' });
    try {
      const resolvedNetworkAddress = resolveCustomerNetworkAddress(identity, wallet.data);
      if (!resolvedNetworkAddress) {
        throw new Error('Network address missing. Please enroll or sign in again.');
      }
      if (!tokenId) {
        throw new Error('Token ID is required.');
      }
      const customerName = String(identity?.userId || '').trim();
      if (!customerName) {
        throw new Error('User ID missing. Please sign in again.');
      }

      // Correct token-registration API: request bank login redirect for selected token.
      const { data } = await client.post(`/token/${encodeURIComponent(tokenId)}/start-register`, {
        networkAddress: resolvedNetworkAddress
      });

      if (data?.login_url) {
        window.open(data.login_url, '_blank', 'noopener');
        setRegisterStatus({
          state: 'success',
          message: 'Registration flow started. Bank login opened automatically.',
          tokenId: tokenId || ''
        });
        return;
      }

      // Fallback: if token has no external login config, submit direct backend registration.
      const fallbackResponse = await client.post('/customer/register-with-bank', {
        customer_name: customerName,
        customer_address: resolvedNetworkAddress,
        token_id: tokenId
      });

      setRegisterStatus({
        state: 'success',
        message: fallbackResponse?.data?.message || data?.message || 'Automated registration request submitted.',
        tokenId: tokenId || ''
      });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Registration failed';
      setRegisterStatus({ state: 'error', message: detail, tokenId: tokenId || '' });
    }
  };

  const handleSignOut = () => {
    window.localStorage.clear();
    window.location.href = '/';
  };

  const handleFetchCustomerIdAccess = async () => {
    try {
      setCustomerIdAccess({ loading: true, data: null, error: '' });
      const trimmedTokenID = customerIdTokenID.trim();
      if (!trimmedTokenID) {
        throw new Error('tokenID is required.');
      }
      const { data } = await client.get('/customer/id-access', {
        params: { tokenID: trimmedTokenID }
      });
      setCustomerIdAccess({ loading: false, data, error: '' });
    } catch (error) {
      const detail =
        error?.response?.data?.detail ||
        error?.response?.data?.error ||
        error?.message ||
        'Failed to fetch customer ID access.';
      setCustomerIdAccess({ loading: false, data: null, error: detail });
    }
  };

  // Sidebar items
  const sidebarItems = [
    { key: 'wallet', label: 'Wallet', icon: '👤' },
    { key: 'send', label: 'Send Money', icon: '💸' },
    { key: 'add', label: 'Add Funds', icon: '➕' },
    { key: 'history', label: 'History', icon: '✓' }
  ];

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: '#F8FAFC',
        color: '#0F172A',
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      }}
    >
      {/* Left Sidebar */}
      <div
        style={{
          width: '220px',
          backgroundColor: '#0F172A',
          borderRight: '1px solid rgba(15,23,42,0.5)',
          padding: '20px 0',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          minWidth: '180px'
        }}
      >
        {/* Sidebar Menu */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}
        >
          {sidebarItems.map(item => (
            <button
              key={item.key}
              onClick={() => setActiveLane(item.key)}
              style={{
                width: '100%',
                padding: '12px 0 12px 28px',
                border: 'none',
                backgroundColor:
                  activeLane === item.key ? '#1E3A8A' : 'transparent',
                borderLeft:
                  activeLane === item.key
                    ? '4px solid #1E3A8A'
                    : '4px solid transparent',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.18s ease-out',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                borderRadius: '0 999px 999px 0',
                fontSize: '14px',
                color: activeLane === item.key ? '#FFFFFF' : '#94A3B8',
                fontWeight: activeLane === item.key ? 600 : 500
              }}
            >
              <span style={{ fontSize: '20px' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

      </div>

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0
        }}
      >
        {/* Header */}
        <div
          style={{
            backgroundColor: '#0F172A',
            borderBottom: '1px solid rgba(15,23,42,0.5)',
            padding: '0 40px',
            height: '82px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '20px',
            minWidth: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img
              src="/betweenetwork-logo.svg"
              alt="Between Network logo"
              style={{ width: '40px', height: '40px', objectFit: 'contain' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span
                style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  color: '#FFFFFF',
                  letterSpacing: '0.03em'
                }}
              >
                Between Network
              </span>
              <span
                style={{
                  fontSize: '11px',
                  color: '#94A3B8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em'
                }}
              >
                Cross‑border customer wallet
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                setShowCustomerIdAccess(!showCustomerIdAccess);
                if (showRegisterTokens) {
                  setShowRegisterTokens(false);
                }
              }}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontFamily: 'inherit',
                cursor: 'pointer',
                backgroundColor: '#1E3A8A',
                color: '#FFFFFF',
                fontWeight: 500
              }}
            >
              Customer ID Access
            </button>
            {showCustomerIdAccess && (
              <div style={{
                position: 'absolute',
                top: '44px',
                right: '0',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                minWidth: '360px',
                maxWidth: '460px',
                padding: '12px',
                boxShadow: '0px 4px 16px rgba(15,23,42,0.06)',
                zIndex: 1000
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>Customer ID Access</div>
                  <button
                    onClick={() => setShowCustomerIdAccess(false)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: '#64748B',
                      fontSize: '12px'
                    }}
                  >
                    Close
                  </button>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#0F172A', marginBottom: '6px' }}>
                    tokenID (exact parameter)
                  </label>
                  <input
                    type="text"
                    value={customerIdTokenID}
                    onChange={(e) => setCustomerIdTokenID(e.target.value)}
                    placeholder="e.g., HDFC-USD-8f2a3b4c-v1"
                    style={{
                      width: '100%',
                      padding: '9px 10px',
                      border: '1px solid #DDD',
                      borderRadius: '6px',
                      fontSize: '13px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <button
                  onClick={handleFetchCustomerIdAccess}
                  disabled={customerIdAccess.loading}
                  style={{
                    width: '100%',
                    padding: '9px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: customerIdAccess.loading ? '#64748B' : '#1E3A8A',
                    color: '#FFFFFF',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  {customerIdAccess.loading ? 'Fetching...' : 'Fetch From Backend'}
                </button>

                {customerIdAccess.error && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    backgroundColor: '#FEE2E2',
                    color: '#DC2626',
                    border: '1px solid #FECACA'
                  }}>
                    {customerIdAccess.error}
                  </div>
                )}

                {customerIdAccess.data && (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#0F172A',
                      marginBottom: '6px'
                    }}>
                      Customer Access Details
                    </div>
                    {(() => {
                      const payload = resolveCustomerAccessPayload(customerIdAccess.data);
                      const tokenId = payload?.token_id || payload?.tokenID || payload?.TokenID || '—';
                      const customerId = payload?.customer_id || payload?.customerID || payload?.CustomerID || '—';
                      const approvedRaw = payload?.approved ?? payload?.Approved;
                      const approved =
                        approvedRaw === true ||
                        approvedRaw === 'true' ||
                        approvedRaw === 'approved';
                      const statusValue = payload?.status || payload?.Status || (approved ? 'approved' : 'pending');
                      const normalizedStatus = String(statusValue || 'unknown').toLowerCase();
                      const isApprovedStatus = normalizedStatus === 'approved' || normalizedStatus === 'active';
                      const isRejectedStatus = normalizedStatus === 'rejected';
                      const isPendingStatus = normalizedStatus.includes('pending') || normalizedStatus === 'not_registered';
                      const statusLabel = isApprovedStatus
                        ? 'Approved'
                        : isRejectedStatus
                          ? 'Rejected'
                          : isPendingStatus
                            ? 'Not approved yet'
                            : String(statusValue || 'unknown');
                      const statusStyles = isApprovedStatus
                        ? { backgroundColor: '#E8F5E9', color: '#2E7D32', border: '1px solid #C8E6C9' }
                        : isRejectedStatus
                          ? { backgroundColor: '#FFEBEE', color: '#C62828', border: '1px solid #FFCDD2' }
                          : { backgroundColor: '#FFF8E1', color: '#8A6D1F', border: '1px solid #FFECB3' };
                      const backendMessage = payload?.message || payload?.detail || '';

                      return (
                        <div style={{
                          backgroundColor: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          padding: '10px'
                        }}>
                          <div style={{ display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                              <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>Token ID</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: '#0F172A', fontFamily: 'monospace', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tokenId}>
                                  {tokenId}
                                </span>
                                <button
                                  onClick={() => tokenId && tokenId !== '—' && navigator.clipboard.writeText(tokenId)}
                                  style={{
                                    padding: '3px 7px',
                                    borderRadius: '6px',
                                    border: '1px solid #E5E5E5',
                                    backgroundColor: '#fff',
                                    fontSize: '11px',
                                    color: '#64748B',
                                    cursor: 'pointer'
                                  }}
                                >
                                  [COPY]
                                </button>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                              <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>Customer ID</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: '#0F172A', fontFamily: 'monospace', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={customerId}>
                                  {customerId}
                                </span>
                                <button
                                  onClick={() => customerId && customerId !== '—' && navigator.clipboard.writeText(customerId)}
                                  style={{
                                    padding: '3px 7px',
                                    borderRadius: '6px',
                                    border: '1px solid #E5E5E5',
                                    backgroundColor: '#fff',
                                    fontSize: '11px',
                                    color: '#64748B',
                                    cursor: 'pointer'
                                  }}
                                >
                                  [COPY]
                                </button>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                              <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>Approved</span>
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  padding: '3px 8px',
                                  borderRadius: '999px',
                                  ...(approved
                                    ? { backgroundColor: '#E8F5E9', color: '#2E7D32', border: '1px solid #C8E6C9' }
                                    : { backgroundColor: '#FFF8E1', color: '#8A6D1F', border: '1px solid #FFECB3' })
                                }}
                              >
                                {approved ? 'TRUE' : 'FALSE'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                              <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 600 }}>Status</span>
                              <span
                                style={{
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  padding: '3px 8px',
                                  borderRadius: '999px',
                                  textTransform: 'capitalize',
                                  ...statusStyles
                                }}
                              >
                                {statusLabel}
                              </span>
                            </div>
                            {backendMessage ? (
                              <div style={{ fontSize: '11px', color: '#64748B' }}>
                                {backendMessage}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              const next = !showSettings;
              setShowSettings(next);
              if (next) {
                fetchAssignedTokens();
              }
              if (!next) {
                setShowRegisterTokens(false);
              }
            }}
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              color: '#94A3B8',
              position: 'relative'
            }}
          >
            ⚙️ Settings
            {showSettings && (
              <div style={{
                position: 'absolute',
                top: '40px',
                right: '0',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '6px',
                minWidth: '360px',
                boxShadow: '0px 4px 16px rgba(15,23,42,0.06)',
                zIndex: 1000
              }}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid #E2E8F0' }}>
                  <div
                    style={{
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      backgroundColor: '#F8FAFC',
                      padding: '8px',
                      marginBottom: '8px'
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                      My Accounts
                    </div>
                    {accounts.loading ? (
                      <div style={{ fontSize: '11px', color: '#64748B' }}>Loading…</div>
                    ) : accounts.error ? (
                      <div style={{ fontSize: '11px', color: '#DC2626' }}>{accounts.error}</div>
                    ) : accounts.data.length === 0 ? (
                      <div style={{ fontSize: '11px', color: '#64748B' }}>No accounts</div>
                    ) : (
                      <div style={{ display: 'grid', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                        {accounts.data.map(entry => {
                          const customerRef = entry?.customer_ref || entry?.customer_id || entry?.network_address || '—';
                          const tokenID = entry?.token_id || '—';
                          const selected = selectedAccount.customerRef === customerRef && selectedAccount.tokenID === tokenID;
                          return (
                            <div
                              key={`${customerRef}-${tokenID}`}
                              onClick={() => setSelectedAccount({ customerRef, tokenID })}
                              style={{
                                border: selected ? '1px solid #60A5FA' : '1px solid #E2E8F0',
                                backgroundColor: selected ? '#EFF6FF' : '#FFFFFF',
                                borderRadius: '8px',
                                padding: '8px',
                                cursor: 'pointer',
                                textAlign: 'left'
                              }}
                            >
                              <div style={{ fontSize: '10px', color: '#64748B', marginBottom: '3px' }}>Customer Ref</div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ fontSize: '11px', color: '#0F172A', fontFamily: 'monospace' }}>
                                  {truncateId(customerRef, 20)}
                                </div>
                                <button
                                  type="button"
                                  onClick={event => {
                                    event.stopPropagation();
                                    if (customerRef && customerRef !== '—') {
                                      navigator.clipboard.writeText(String(customerRef));
                                    }
                                  }}
                                  style={{
                                    border: '1px solid #CBD5E1',
                                    backgroundColor: '#FFFFFF',
                                    color: '#334155',
                                    borderRadius: '5px',
                                    fontSize: '10px',
                                    padding: '2px 6px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Copy
                                </button>
                              </div>
                              <div style={{ fontSize: '10px', color: '#64748B', marginBottom: '3px' }}>Token ID</div>
                              <div style={{ fontSize: '11px', color: '#0F172A', fontFamily: 'monospace' }}>
                                {truncateId(tokenID, 20)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      backgroundColor: '#F8FAFC',
                      padding: '8px',
                      marginBottom: '8px'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '8px'
                      }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Assigned Tokens
                      </div>
                    </div>

                    {assignedTokens.loading ? (
                      <div style={{ fontSize: '11px', color: '#64748B' }}>Loading assigned tokens…</div>
                    ) : assignedTokens.error ? (
                      <div style={{ fontSize: '11px', color: '#DC2626' }}>{assignedTokens.error}</div>
                    ) : assignedTokens.data.length === 0 ? (
                      <div style={{ fontSize: '11px', color: '#64748B' }}>No active approved tokens found.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
                        {assignedTokens.data.map((token, idx) => {
                          const tokenId = token?.token_id || token?.tokenID || token?.TokenID || `assigned_${idx}`;
                          const tokenDisplayId = resolveTokenDisplayId(token);
                          const bic = token?.bic || token?.BIC || '—';
                          const owner = token?.owner || token?.Owner || '—';
                          const minted = token?.minted ?? token?.Minted ?? token?.total_supply ?? token?.TotalSupply ?? 0;
                          const assignedAt = token?.assigned_at || token?.AssignedAt || '';
                          return (
                            <div
                              key={tokenId}
                              style={{
                                border: '1px solid #E2E8F0',
                                borderRadius: '8px',
                                padding: '8px',
                                backgroundColor: '#FFFFFF'
                              }}
                            >
                              <div style={{ fontSize: '12px', color: '#0F172A', fontWeight: 700 }}>
                                {token?.currency || 'Token'}
                              </div>
                              <div style={{ marginTop: '4px', fontSize: '11px', color: '#334155', fontFamily: 'monospace' }}>
                                {truncateId(tokenDisplayId, 24)}
                              </div>
                              <div style={{ marginTop: '6px', fontSize: '10px', color: '#64748B' }}>
                                Token ID: {truncateId(tokenId, 24)}
                              </div>
                              <div style={{ marginTop: '2px', fontSize: '10px', color: '#64748B' }}>
                                BIC: {truncateId(bic, 18)}
                              </div>
                              <div style={{ marginTop: '2px', fontSize: '10px', color: '#64748B' }}>
                                Minted: {minted}
                              </div>
                              <div style={{ marginTop: '2px', fontSize: '10px', color: '#64748B' }}>
                                Status: {token?.status || token?.Status || 'UNKNOWN'}
                              </div>
                              <div style={{ marginTop: '2px', fontSize: '10px', color: '#64748B' }}>
                                Owner: {truncateId(owner, 18)}
                              </div>
                              <div style={{ marginTop: '2px', fontSize: '10px', color: '#64748B' }}>
                                Assigned At: {assignedAt ? formatDate(assignedAt) : 'N/A'}
                              </div>
                              <div style={{ marginTop: '8px', display: 'grid', gap: '6px', gridTemplateColumns: '1fr 1fr' }}>
                                <button
                                  onClick={() => handleStartRegister(tokenId)}
                                  disabled={registerStatus.state === 'loading' && registerStatus.tokenId === tokenId}
                                  style={{
                                    width: '100%',
                                    padding: '7px 8px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    backgroundColor: '#1E3A8A',
                                    color: '#FFFFFF',
                                    fontSize: '11px',
                                    cursor:
                                      registerStatus.state === 'loading' && registerStatus.tokenId === tokenId
                                        ? 'not-allowed'
                                        : 'pointer',
                                    opacity:
                                      registerStatus.state === 'loading' && registerStatus.tokenId === tokenId ? 0.7 : 1,
                                    fontWeight: 700
                                  }}
                                >
                                  {registerStatus.state === 'loading' && registerStatus.tokenId === tokenId
                                    ? 'Registering...'
                                    : 'Register'}
                                </button>
                                <button
                                  onClick={() => setViewTokenId(prev => (prev === tokenId ? '' : tokenId))}
                                  style={{
                                    width: '100%',
                                    padding: '7px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid #CBD5E1',
                                    backgroundColor: '#FFFFFF',
                                    color: '#334155',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                    fontWeight: 700
                                  }}
                                >
                                  {viewTokenId === tokenId ? 'Hide' : 'View'}
                                </button>
                              </div>
                              {viewTokenId === tokenId ? (
                                <div
                                  style={{
                                    marginTop: '6px',
                                    border: '1px solid #E2E8F0',
                                    borderRadius: '6px',
                                    backgroundColor: '#F8FAFC',
                                    padding: '6px',
                                    maxHeight: '180px',
                                    overflowY: 'auto'
                                  }}
                                >
                                  <pre
                                    style={{
                                      margin: 0,
                                      fontSize: '10px',
                                      lineHeight: 1.4,
                                      color: '#0F172A',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word'
                                    }}
                                  >
                                    {JSON.stringify(token, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                              {registerStatus.tokenId === tokenId && registerStatus.state !== 'idle' ? (
                                <div
                                  style={{
                                    marginTop: '6px',
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    fontSize: '10px',
                                    backgroundColor: registerStatus.state === 'error' ? '#FEE2E2' : '#ECFDF3',
                                    color: registerStatus.state === 'error' ? '#DC2626' : '#15803D',
                                    border: `1px solid ${registerStatus.state === 'error' ? '#FECACA' : '#BBF7D0'}`
                                  }}
                                >
                                  {registerStatus.message}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setShowRegisterTokens(!showRegisterTokens);
                      if (!showRegisterTokens) {
                        fetchTokens();
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 10px',
                      border: 'none',
                      borderRadius: '6px',
                      backgroundColor: '#1E3A8A',
                      color: '#FFFFFF',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Register Token
                  </button>

                  {showRegisterTokens && (
                    <div style={{ marginTop: '8px' }}>
                      {registerStatus.state !== 'idle' && (
                        <div style={{
                          marginBottom: '8px',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          backgroundColor: registerStatus.state === 'error' ? '#FEE2E2' : '#ECFDF3',
                          color: registerStatus.state === 'error' ? '#DC2626' : '#15803D',
                          border: `1px solid ${registerStatus.state === 'error' ? '#FECACA' : '#BBF7D0'}`
                        }}>
                          {registerStatus.message}
                        </div>
                      )}

                      {tokens.loading && (
                        <div style={{ fontSize: '11px', color: '#64748B' }}>Loading tokens...</div>
                      )}
                      {tokens.error && (
                        <div style={{ fontSize: '11px', color: '#DC2626' }}>{tokens.error}</div>
                      )}
                      {!tokens.loading && !tokens.error && (
                        <div style={{ marginBottom: '8px', fontSize: '11px', color: '#475569' }}>
                          Backend sync: {tokensMeta.available}/{tokensMeta.total} available tokens
                          {tokensMeta.source ? ` • ${tokensMeta.source}` : ''}
                        </div>
                      )}
                      {!tokens.loading && !tokens.error && tokens.data.length === 0 && (
                        <div style={{ fontSize: '11px', color: '#64748B' }}>No tokens available.</div>
                      )}
                      {!tokens.loading && !tokens.error && tokens.data.length > 0 && (
                        <div style={{ display: 'grid', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                          {tokens.data
                            .filter(token => token.available_for_registration)
                            .map((token, idx) => {
                            const tokenId = token?.token_id || token?.tokenID || token?.TokenID || '';
                            const tokenKey = tokenId || `token_${idx}`;
                            return (
                              <div key={tokenKey} style={{
                                border: '1px solid #E2E8F0',
                                borderRadius: '8px',
                                padding: '8px',
                                backgroundColor: '#F8FAFC'
                              }}>
                                <div style={{ fontSize: '12px', color: '#0F172A', fontWeight: 600 }}>
                                  {token.currency || 'Token'}
                                </div>
                                <div style={{ marginTop: '4px', fontSize: '11px', color: '#334155', fontFamily: 'monospace' }}>
                                  {truncateId(resolveTokenDisplayId(token), 24)}
                                </div>
                                <div style={{ marginTop: '4px', fontSize: '10px', color: '#64748B' }}>
                                  Status: {token.status || 'UNKNOWN'}
                                </div>
                                <button
                                  onClick={() => handleStartRegister(tokenId)}
                                  disabled={!tokenId}
                                  style={{
                                    marginTop: '7px',
                                    width: '100%',
                                    padding: '7px 8px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    backgroundColor: '#1E3A8A',
                                    color: '#FFFFFF',
                                    fontSize: '11px',
                                    cursor: tokenId ? 'pointer' : 'not-allowed',
                                    opacity: tokenId ? 1 : 0.7,
                                    fontWeight: 700
                                  }}
                                >
                                  {tokenId ? 'Start Register' : 'Token ID Missing'}
                                </button>
                              </div>
                            );
                          })}
                          {tokens.data.filter(token => token.available_for_registration).length === 0 && (
                            <div style={{ fontSize: '11px', color: '#64748B' }}>
                              Tokens were fetched from backend, but none are currently available for registration.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSignOut}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#D32F2F',
                    fontWeight: '500',
                    borderRadius: '6px'
                  }}
                  onMouseOver={(e) => e.target.style.backgroundColor = '#FFE5E5'}
                  onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
                >
                  Sign Out
                </button>
              </div>
            )}
          </button>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, padding: '32px 0 40px 0', overflowY: 'auto', backgroundColor: '#F8FAFC', minWidth: 0 }}>
          {activeLane === 'wallet' && (
            <div style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0px 4px 16px rgba(15,23,42,0.06)',
              border: '1px solid #E2E8F0',
              margin: '0 32px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: '600', color: '#0F172A' }}>Customer Wallet</h2>
              </div>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748B' }}>View your Between Network balance and token details.</p>
              <div
                style={{
                  marginBottom: '16px',
                  padding: '10px',
                  border: '1px solid #BFDBFE',
                  borderRadius: '10px',
                  backgroundColor: '#EFF6FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div style={{ fontSize: '12px', color: '#1E3A8A', fontWeight: 600 }}>
                  Wallet controls
                </div>
                <button
                  onClick={handleWalletRefresh}
                  disabled={wallet.loading || tokenApproval.loading}
                  style={{
                    padding: '9px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    borderRadius: '8px',
                    border: '1px solid #1D4ED8',
                    backgroundColor: '#2563EB',
                    color: '#FFFFFF',
                    cursor: wallet.loading || tokenApproval.loading ? 'not-allowed' : 'pointer',
                    opacity: wallet.loading || tokenApproval.loading ? 0.7 : 1
                  }}
                >
                  Refresh Wallet
                </button>
              </div>

              {wallet.loading ? (
                <p style={{ margin: '16px 0', fontSize: '14px', color: '#64748B' }}>Loading wallet details…</p>
              ) : wallet.error ? (
                <div style={{ padding: '12px', backgroundColor: '#FEE2E2', borderRadius: '8px', color: '#DC2626', fontSize: '12px', marginTop: '12px', border: '1px solid #FECACA' }}>
                  {wallet.error}
                </div>
              ) : wallet.data ? (
                (() => {
                  const walletPayload = resolveWalletPayload(wallet.data);
                  const approvalPayload = tokenApproval.data || {};
                  const registrationStatus = walletPayload?.registration?.status || '';
                  const tokenId =
                    walletPayload?.tokenID ||
                    walletPayload?.token_id ||
                    walletPayload?.token ||
                    approvalPayload?.token_id ||
                    '—';
                  const hasAssignedToken = tokenId !== '—';
                  const hideCurrency =
                    !hasAssignedToken ||
                    registrationStatus === 'not_registered' ||
                    registrationStatus === 'no_token_assigned' ||
                    registrationStatus === 'pending_approval' ||
                    registrationStatus === 'pending';
                  const currencySymbol = hideCurrency ? '' : (walletPayload?.currencySymbol || walletPayload?.currency_symbol || '');
                  const currency = hideCurrency ? '' : formatCurrency(walletPayload);
                  const balanceValue = normalizeBalance(formatBalance(walletPayload));
                  const rawStatus =
                    approvalPayload?.status ||
                    walletPayload?.registration?.status ||
                    (approvalPayload?.approved ? 'APPROVED' : '');
                  const statusText = rawStatus
                    ? String(rawStatus).replace(/_/g, ' ')
                    : 'Unknown';
                  const normalizedStatus = String(rawStatus || '').trim().toUpperCase();
                  const statusColor = normalizedStatus.includes('APPROV') ? '#15803D' : normalizedStatus.includes('REJECT') ? '#B91C1C' : '#92400E';
                  const customerNetworkAddress =
                    resolveCustomerNetworkAddressDisplay(walletPayload, '') ||
                    resolveCustomerNetworkAddressDisplay(approvalPayload, '') ||
                    walletPayload?.network_address ||
                    walletPayload?.networkAddress ||
                    approvalPayload?.network_address ||
                    approvalPayload?.networkAddress ||
                    '—';
                  const customerRef =
                    resolveCustomerDisplayId(walletPayload, '') ||
                    resolveCustomerDisplayId(approvalPayload, '') ||
                    approvalPayload?.customer_ref ||
                    approvalPayload?.customer_id ||
                    '—';
                  const bankBIC =
                    walletPayload?.bic ||
                    walletPayload?.bic_code ||
                    walletPayload?.BIC ||
                    approvalPayload?.bic ||
                    '—';
                  const registeredOn = formatDate(
                    walletPayload?.registration?.approved_at ||
                    walletPayload?.registration?.activated_at ||
                    walletPayload?.registration?.created_at ||
                    walletPayload?.approved_at ||
                    walletPayload?.activated_at ||
                    walletPayload?.created_at
                  );

                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
                        <button
                          onClick={() => setShowWalletView(prev => !prev)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            border: '1px solid #CBD5E1',
                            backgroundColor: showWalletView ? '#1D4ED8' : '#FFFFFF',
                            color: showWalletView ? '#FFFFFF' : '#0F172A',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          {showWalletView ? 'HIDE VIEW' : 'VIEW FULL DATA'}
                        </button>
                      </div>

                      <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                        <div>
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Balance</p>
                          <p style={{ margin: '0', fontSize: '30px', fontWeight: '700', color: '#0F172A' }}>
                            {currencySymbol}{balanceValue}{currency ? ` ${currency}` : ''}
                          </p>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bank BIC</p>
                          <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: '#0F172A' }}>{bankBIC}</p>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</p>
                          <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: statusColor }}>● {statusText}</p>
                        </div>
                      </div>
                      {tokenApproval.error ? (
                        <div style={{ marginTop: '12px', fontSize: '12px', color: '#B45309' }}>
                          Approval status check: {tokenApproval.error}
                        </div>
                      ) : null}

                      {showWalletView ? (
                        <div
                          style={{
                            marginTop: '14px',
                            border: '1px solid #E2E8F0',
                            backgroundColor: '#0F172A',
                            borderRadius: '10px',
                            padding: '12px'
                          }}
                        >
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#E2E8F0', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Wallet Raw View
                          </div>
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '11px', color: '#C7D2FE' }}>
                            {JSON.stringify(walletPayload, null, 2)}
                          </pre>
                        </div>
                      ) : null}

                      <div style={{
                        marginTop: '24px',
                        backgroundColor: '#F9FAFB',
                        borderRadius: '12px',
                        padding: '16px 18px',
                        border: '1px solid #E5E7EB'
                      }}>
                        <p style={{ margin: '0 0 10px 0', fontSize: '11px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Account Details
                        </p>

                        <div style={{ display: 'grid', gap: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <div style={{ fontSize: '12px', color: '#64748B' }}>Bank BIC</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <p style={{ margin: 0, fontSize: '12px', fontFamily: 'monospace', color: '#0F172A' }}>
                                {truncateId(bankBIC, 24)}
                              </p>
                              <button
                                onClick={() => {
                                  if (bankBIC && bankBIC !== '—') {
                                    navigator.clipboard.writeText(bankBIC);
                                  }
                                }}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  border: '1px solid #E5E7EB',
                                  backgroundColor: '#FFFFFF',
                                  fontSize: '11px',
                                  color: '#374151',
                                  cursor: 'pointer'
                                }}
                              >
                                [COPY]
                              </button>
                            </div>
                          </div>

                          {customerRef && customerRef !== '—' ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                              <div style={{ fontSize: '12px', color: '#64748B' }}>Customer Ref</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <p style={{ margin: 0, fontSize: '12px', fontFamily: 'monospace', color: '#0F172A' }}>
                                  {truncateId(customerRef, 24)}
                                </p>
                                <button
                                  onClick={() => {
                                    if (customerRef && customerRef !== '—') {
                                      navigator.clipboard.writeText(String(customerRef));
                                    }
                                  }}
                                  style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid #E5E7EB',
                                    backgroundColor: '#FFFFFF',
                                    fontSize: '11px',
                                    color: '#374151',
                                    cursor: 'pointer'
                                  }}
                                >
                                  [COPY]
                                </button>
                              </div>
                            </div>
                          ) : null}

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <div style={{ fontSize: '12px', color: '#64748B' }}>Registered On</div>
                            <div style={{ fontSize: '12px', color: '#0F172A' }}>{registeredOn}</div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()
              ) : null}

            </div>
          )}

          {activeLane === 'send' && (
            <div style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0px 4px 16px rgba(15,23,42,0.06)',
              border: '1px solid #E2E8F0',
              margin: '0 32px'
            }}>
              <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: '600', color: '#0F172A' }}>Send money</h2>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748B' }}>Move value to another customer across borders.</p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                  Receiver Customer ID
                </label>
                <input
                  type="text"
                  value={receiverCustomerID}
                  onChange={(e) => setReceiverCustomerID(e.target.value)}
                  placeholder="e.g., CUST-100234"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '6px',
                    fontSize: '14px',
                    color: '#0F172A',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ 
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '16px'
              }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                    Sender Bank BIC
                  </label>
                  <input
                    type="text"
                    value={senderBankBIC}
                    onChange={(e) => setSenderBankBIC(e.target.value)}
                    placeholder="e.g., HDFCINBBXXX"
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '6px',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                    Receiver Bank BIC
                  </label>
                  <input
                    type="text"
                    value={receiverBankBIC}
                    onChange={(e) => setReceiverBankBIC(e.target.value)}
                    placeholder="e.g., SBININBBXXX"
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '6px',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                  Amount
                </label>
                <input
                  type="number"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  placeholder="100"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {sendStatus.state !== 'idle' && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  marginBottom: '16px',
                  backgroundColor: sendStatus.state === 'error' ? '#FEE2E2' : '#ECFDF3',
                  color: sendStatus.state === 'error' ? '#DC2626' : '#15803D',
                  border: `1px solid ${sendStatus.state === 'error' ? '#FECACA' : '#BBF7D0'}`
                }}>
                  {sendStatus.message}
                </div>
              )}

              <button
                onClick={handleSendMoney}
                disabled={sendStatus.state === 'loading'}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: sendStatus.state === 'loading' ? '#64748B' : '#1E3A8A',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: sendStatus.state === 'loading' ? 'default' : 'pointer',
                  transition: 'background-color 0.2s ease-out'
                }}
                onMouseOver={e => {
                  if (sendStatus.state !== 'loading') e.target.style.backgroundColor = '#1E40AF';
                }}
                onMouseOut={e => {
                  if (sendStatus.state !== 'loading') e.target.style.backgroundColor = '#1E3A8A';
                }}
              >
                {sendStatus.state === 'loading' ? 'Sending...' : 'Send'}
              </button>
            </div>
          )}

          {activeLane === 'add' && (
            <div style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0px 4px 16px rgba(15,23,42,0.06)',
              border: '1px solid #E2E8F0',
              maxWidth: '700px',
              margin: '0 32px'
            }}>
              <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: '600', color: '#0F172A' }}>Add funds</h2>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748B' }}>Request additional balance into your wallet token.</p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#0F172A', marginBottom: '8px' }}>
                  Amount
                </label>
                <input
                  type="number"
                  placeholder="250"
                  value={addFundsAmount}
                  onChange={(e) => setAddFundsAmount(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #D1D5DB',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {addFundsStatus.state !== 'idle' && (
                <div style={{
                  padding: '12px',
                  borderRadius: '6px',
                  marginBottom: '16px',
                  fontSize: '12px',
                  backgroundColor: addFundsStatus.state === 'error' ? '#FEE2E2' : '#ECFDF3',
                  color: addFundsStatus.state === 'error' ? '#DC2626' : '#15803D',
                  border: `1px solid ${addFundsStatus.state === 'error' ? '#FECACA' : '#BBF7D0'}`
                }}>
                  {addFundsStatus.message}
                </div>
              )}

              <button
                onClick={handleAddFunds}
                disabled={addFundsStatus.state === 'loading'}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: addFundsStatus.state === 'loading' ? '#64748B' : '#1E3A8A',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: addFundsStatus.state === 'loading' ? 'default' : 'pointer',
                  transition: 'background-color 0.2s ease-out'
                }}
                onMouseOver={e => {
                  if (addFundsStatus.state !== 'loading') e.target.style.backgroundColor = '#1E40AF';
                }}
                onMouseOut={e => {
                  if (addFundsStatus.state !== 'loading') e.target.style.backgroundColor = '#1E3A8A';
                }}
              >
                {addFundsStatus.state === 'loading' ? 'Submitting...' : 'Add Funds'}
              </button>
            </div>
          )}

          {activeLane === 'history' && (
            <div style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0px 4px 16px rgba(15,23,42,0.06)',
              border: '1px solid #E2E8F0',
              margin: '0 32px'
            }}>
              {(() => {
                const baseTransactions = Array.isArray(history?.data?.transactions) ? history.data.transactions : [];
                let displayedRows = [];

                if (historyTab === 'mintrequest') {
                  displayedRows = (Array.isArray(mintHistory.data) ? mintHistory.data : []).map(mintReq => ({
                    transaction_id: mintReq.request_id || mintReq.RequestID || '',
                    transaction_type: mintReq.transaction_type || 'CREDIT',
                    amount: mintReq.amount ?? mintReq.Amount ?? 0,
                    currency:
                      mintReq.currency ||
                      mintReq.Currency ||
                      mintReq.currency_code ||
                      mintReq.currencyCode ||
                      '',
                    status:
                      mintReq.status ||
                      mintReq.Status ||
                      (mintReq.approved || mintReq.Approved ? 'APPROVED' : 'PENDING'),
                    timestamp: mintReq.approved_at || mintReq.ApprovedAt || '',
                    details: mintReq
                  }));
                } else if (historyTab === 'transfers') {
                  displayedRows = baseTransactions.filter(tx =>
                    (tx.transaction_category || '').toUpperCase() === 'TRANSFER'
                  );
                } else if (historyTab === 'fundsAccepted') {
                  displayedRows = baseTransactions.filter(tx =>
                    (tx.transaction_category || '').toUpperCase() === 'MINT' ||
                    (tx.transaction_type || '').toUpperCase() === 'CREDIT'
                  );
                } else {
                  displayedRows = baseTransactions;
                }

                return (
                  <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ margin: 0, fontSize: '22px', fontWeight: '600', color: '#0F172A' }}>Activity history</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { key: 'all', label: 'All' },
                    { key: 'transfers', label: 'Transfers' },
                    { key: 'fundsAccepted', label: 'Funds Accepted' },
                    { key: 'mintrequest', label: 'MintRequest' }
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => {
                        setHistoryTab(tab.key);
                        setSelectedHistoryTx(null);
                      }}
                      style={{
                        padding: '6px 12px',
                        border: 'none',
                        backgroundColor: historyTab === tab.key ? '#1E3A8A' : '#E2E8F0',
                        color: historyTab === tab.key ? '#FFFFFF' : '#0F172A',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {historyTab === 'mintrequest' && mintHistory.error && (
                <div style={{
                  marginBottom: '12px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  backgroundColor: '#FEE2E2',
                  color: '#DC2626',
                  border: '1px solid #FECACA'
                }}>
                  {mintHistory.error}
                </div>
              )}
              {history.error && (
                <div style={{
                  marginBottom: '12px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  backgroundColor: '#FEE2E2',
                  color: '#DC2626',
                  border: '1px solid #FECACA'
                }}>
                  {history.error}
                </div>
              )}

              <div style={{
                overflowX: 'auto'
              }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '13px'
                }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E2E8F0', backgroundColor: '#F8FAFC' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', color: '#0F172A', fontSize: '12px' }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', color: '#0F172A', fontSize: '12px' }}>Type</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', color: '#0F172A', fontSize: '12px' }}>Amount</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', color: '#0F172A', fontSize: '12px' }}>Status</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '600', color: '#0F172A', fontSize: '12px' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.slice(0, 5).map((tx, idx) => {
                      const normalizedStatus = String(tx.status || '').trim().toUpperCase();
                      const isSuccessStatus = ['COMPLETED', 'APPROVED', 'SUCCESS', 'DONE'].includes(normalizedStatus);
                      const isDebitTx = (tx.transaction_type || '').toUpperCase() === 'DEBIT';
                      const isTransferTx = (tx.transaction_category || '').toUpperCase() === 'TRANSFER';
                      const displayAmount = isTransferTx && !isDebitTx
                        ? (tx.converted_amount ?? tx.receiver_amount ?? tx.net_amount ?? tx.amount)
                        : tx.amount;
                      const fallbackCurrency =
                        tx.currency ||
                        tx.Currency ||
                        tx.currency_code ||
                        tx.currencyCode ||
                        tx.details?.currency ||
                        tx.details?.Currency ||
                        tx.details?.currency_code ||
                        tx.details?.currencyCode ||
                        '';
                      const amountCurrency = isTransferTx && !isDebitTx
                        ? (tx.receiver_currency || tx.receiverCurrency || fallbackCurrency)
                        : (fallbackCurrency || tx.receiver_currency || tx.receiverCurrency || '');
                      const amountSymbol = getCurrencySymbol(amountCurrency);
                      return (
                      <tr key={idx} style={{ borderBottom: '1px solid #E5E7EB' }}>
                        <td style={{ padding: '10px 12px', color: '#0F172A' }}>
                          {tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : 'N/A'}
                        </td>
                        <td style={{ padding: '10px 12px', color: isDebitTx ? '#DC2626' : '#15803D', fontWeight: '600' }}>
                          {isDebitTx
                            ? 'Sent'
                            : (historyTab === 'mintrequest' ? 'Mint Request' : 'Received')}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#0F172A', fontWeight: '600' }}>
                          {amountSymbol}{Number(displayAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{
                            padding: '3px 8px',
                            backgroundColor: isSuccessStatus ? '#ECFDF3' : '#FEF3C7',
                            color: isSuccessStatus ? '#15803D' : '#92400E',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: '600',
                            border: `1px solid ${isSuccessStatus ? '#BBF7D0' : '#FDE68A'}`
                          }}>
                            {tx.status || 'Completed'}
                          </span>
                          {tx.transaction_category === 'TRANSFER' && (
                            <div style={{ marginTop: '6px', fontSize: '10px', color: '#666', lineHeight: 1.4 }}>
                              <div>
                                Sender Bank:{' '}
                                <span style={{ fontWeight: 700, color: tx.approved_by_sender_owner ? '#2E7D32' : '#C62828' }}>
                                  {tx.approved_by_sender_owner ? 'TRUE' : 'FALSE'}
                                </span>
                              </div>
                              <div>
                                Receiver Bank:{' '}
                                <span style={{ fontWeight: 700, color: tx.approved_by_receiver_owner ? '#2E7D32' : '#C62828' }}>
                                  {tx.approved_by_receiver_owner ? 'TRUE' : 'FALSE'}
                                </span>
                              </div>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button style={{
                            backgroundColor: 'transparent',
                            border: 'none',
                            color: '#1E3A8A',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}
                          onClick={() => setSelectedHistoryTx(tx)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {selectedHistoryTx && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  backgroundColor: '#F9FAFB'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: '600', color: '#0F172A' }}>
                      Transaction Details (Backend)
                    </p>
                    <button
                      onClick={() => setSelectedHistoryTx(null)}
                      style={{
                        backgroundColor: 'transparent',
                        border: 'none',
                        color: '#9CA3AF',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}
                    >
                      Close
                    </button>
                  </div>
                  <pre style={{
                    margin: 0,
                    padding: '12px',
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E5E7EB',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#374151',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}>
                    {JSON.stringify(selectedHistoryTx, null, 2)}
                  </pre>
                </div>
              )}

              {displayedRows.length === 0 && (
                <p style={{ textAlign: 'center', padding: '20px', color: '#64748B', fontSize: '12px' }}>
                  {historyTab === 'mintrequest' ? 'No mint requests yet' : 'No transactions yet'}
                </p>
              )}
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerDashboard;
