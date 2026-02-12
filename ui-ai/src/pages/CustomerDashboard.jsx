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

const CustomerDashboard = () => {
  const [activeLane, setActiveLane] = useState('wallet');
  const [identity, setIdentity] = useState(() => getIdentityFromStorage());
  const [wallet, setWallet] = useState({ loading: false, data: null, error: '' });
  const [tokens, setTokens] = useState({ loading: false, data: [], error: '' });
  const [history, setHistory] = useState({ loading: false, data: { transactions: [], summary: null }, error: '' });
  const [mintHistory, setMintHistory] = useState({ loading: false, data: [], error: '' });
  const [historyTab, setHistoryTab] = useState('all');
  const [selectedHistoryTx, setSelectedHistoryTx] = useState(null);
  const [sendAmount, setSendAmount] = useState('');
  const [senderTokenID, setSenderTokenID] = useState('');
  const [receiverTokenID, setReceiverTokenID] = useState('');
  const [receiverCustomerNetworkAddress, setReceiverCustomerNetworkAddress] = useState('');
  const [sendStatus, setSendStatus] = useState({ state: 'idle', message: '' });
  const [addFundsAmount, setAddFundsAmount] = useState('');
  const [addFundsTokenID, setAddFundsTokenID] = useState('');
  const [addFundsStatus, setAddFundsStatus] = useState({ state: 'idle', message: '' });
  const [showSettings, setShowSettings] = useState(false);
  const [showRegisterTokens, setShowRegisterTokens] = useState(false);
  const [registerStatus, setRegisterStatus] = useState({ state: 'idle', message: '' });
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
      const normalized = data?.wallet || data;
      setWallet({ loading: false, data: normalized, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unable to load wallet';
      setWallet({ loading: false, data: null, error: detail });
    }
  };

  const fetchTokens = async () => {
    setTokens(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await safeGet('/customer/view-all-tokens', { throwError: true }, {});
      const data = Array.isArray(response) ? response : Array.isArray(response?.tokens) ? response.tokens : Array.isArray(response?.data) ? response.data : [];
      setTokens({ loading: false, data, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load tokens';
      setTokens({ loading: false, data: [], error: detail });
    }
  };

  const fetchHistory = async () => {
    setHistory(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await safeGet('/customer/transfer-history', { throwError: true }, {});
      const transactions = Array.isArray(response?.transactions) ? response.transactions : Array.isArray(response?.completed_transfers) ? response.completed_transfers : [];
      setHistory({ loading: false, data: { transactions, summary: response?.summary || {} }, error: '' });
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
    fetchWallet(identity);
    fetchTokens();
    fetchHistory();
  }, [identity.userId, identity.networkAddress]);

  useEffect(() => {
    if (activeLane === 'history' && historyTab === 'mintrequest') {
      fetchMintHistory();
    }
  }, [activeLane, historyTab]);

  useEffect(() => {
    const walletPayload = resolveWalletPayload(wallet.data);
    const tokenIdFromWallet = walletPayload?.token_id || walletPayload?.tokenID || '';
    if (!senderTokenID && tokenIdFromWallet) {
      setSenderTokenID(tokenIdFromWallet);
    }
    if (!addFundsTokenID && tokenIdFromWallet) {
      setAddFundsTokenID(tokenIdFromWallet);
    }
  }, [wallet.data, senderTokenID, addFundsTokenID]);

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

  const handleSendMoney = async () => {
    try {
      setSendStatus({ state: 'loading', message: 'Submitting transfer request...' });

      const trimmedSenderTokenID = senderTokenID.trim();
      const trimmedReceiverTokenID = receiverTokenID.trim();
      const trimmedReceiverAddress = receiverCustomerNetworkAddress.trim();

      if (!trimmedSenderTokenID) {
        throw new Error('Sender Token ID is required.');
      }
      if (!trimmedReceiverTokenID) {
        throw new Error('Receiver Token ID is required.');
      }
      if (!trimmedReceiverAddress) {
        throw new Error('Receiver customer network address is required.');
      }
      const parsedAmount = parseFloat(sendAmount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Amount must be a positive number.');
      }

      const { data } = await client.post('/customer-to-token-transfer', {
        senderTokenID: trimmedSenderTokenID,
        receiverTokenID: trimmedReceiverTokenID,
        receiverCustomerNetworkAddress: trimmedReceiverAddress,
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
    setRegisterStatus({ state: 'loading', message: 'Starting registration...' });
    try {
      const resolvedNetworkAddress = resolveCustomerNetworkAddress(identity, wallet.data);
      if (!resolvedNetworkAddress) {
        throw new Error('Network address missing. Please enroll or sign in again.');
      }
      if (!tokenId) {
        throw new Error('Token ID is required.');
      }
      const { data } = await client.post(
        `/token/${encodeURIComponent(tokenId)}/start-register`,
        { networkAddress: resolvedNetworkAddress }
      );
      const loginURL = data?.login_url;
      if (loginURL) {
        window.open(loginURL, '_blank', 'noopener');
        setRegisterStatus({ state: 'success', message: 'Bank registration opened in a new tab.' });
      } else {
        setRegisterStatus({ state: 'success', message: 'Registration request submitted.' });
      }
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Registration failed';
      setRegisterStatus({ state: 'error', message: detail });
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
                setShowRegisterTokens(!showRegisterTokens);
                if (showCustomerIdAccess) {
                  setShowCustomerIdAccess(false);
                }
                if (!showRegisterTokens) {
                  fetchTokens();
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
              Register Token
            </button>
            {showRegisterTokens && (
              <div style={{
                position: 'absolute',
                top: '44px',
                right: '0',
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '8px',
                minWidth: '320px',
                maxWidth: '420px',
                padding: '12px',
                boxShadow: '0px 4px 16px rgba(15,23,42,0.06)',
                zIndex: 1000
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>Available Tokens</div>
                  <button
                    onClick={() => setShowRegisterTokens(false)}
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

                {registerStatus.state !== 'idle' && (
                  <div style={{
                    marginBottom: '8px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    backgroundColor: registerStatus.state === 'error' ? '#FEE2E2' : '#ECFDF3',
                    color: registerStatus.state === 'error' ? '#DC2626' : '#15803D',
                    border: `1px solid ${registerStatus.state === 'error' ? '#FECACA' : '#BBF7D0'}`
                  }}>
                    {registerStatus.message}
                  </div>
                )}

                {tokens.loading && (
                  <div style={{ fontSize: '12px', color: '#64748B' }}>Loading tokens...</div>
                )}
                {tokens.error && (
                  <div style={{ fontSize: '12px', color: '#DC2626' }}>{tokens.error}</div>
                )}
                {!tokens.loading && !tokens.error && tokens.data.length === 0 && (
                  <div style={{ fontSize: '12px', color: '#64748B' }}>No tokens available.</div>
                )}
                {!tokens.loading && !tokens.error && tokens.data.length > 0 && (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {tokens.data
                      .filter(token => token?.available === false)
                      .map(token => (
                      <div key={token.token_id} style={{
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        padding: '10px',
                        backgroundColor: '#F8FAFC'
                      }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>
                          {token.currency || 'Token'}
                        </div>
                        <div style={{ marginTop: '6px', display: 'grid', gap: '4px' }}>
                          <div style={{ fontSize: '11px', color: '#555', display: 'flex', gap: '6px' }}>
                            <span style={{ fontWeight: 600, color: '#444' }}>token_id:</span>
                            <span style={{ wordBreak: 'break-all' }}>{token.token_id || '-'}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#555', display: 'flex', gap: '6px' }}>
                            <span style={{ fontWeight: 600, color: '#444' }}>currency:</span>
                            <span style={{ wordBreak: 'break-all' }}>{token.currency || '-'}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#555', display: 'flex', gap: '6px' }}>
                            <span style={{ fontWeight: 600, color: '#444' }}>display_token_id:</span>
                            <span style={{ wordBreak: 'break-all' }}>{token.display_token_id || '-'}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#555', display: 'flex', gap: '6px' }}>
                            <span style={{ fontWeight: 600, color: '#444' }}>assigned_at:</span>
                            <span style={{ wordBreak: 'break-all' }}>{token.assigned_at || '-'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleStartRegister(token.token_id)}
                          style={{
                            marginTop: '8px',
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: '6px',
                            border: 'none',
                            backgroundColor: '#1E3A8A',
                            color: '#FFFFFF',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontWeight: 600
                          }}
                        >
                          Start Register
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
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
                      const statusStyles = normalizedStatus === 'approved'
                        ? { backgroundColor: '#E8F5E9', color: '#2E7D32', border: '1px solid #C8E6C9' }
                        : normalizedStatus === 'rejected'
                          ? { backgroundColor: '#FFEBEE', color: '#C62828', border: '1px solid #FFCDD2' }
                          : { backgroundColor: '#FFF8E1', color: '#8A6D1F', border: '1px solid #FFECB3' };

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
                                {String(statusValue || 'unknown')}
                              </span>
                            </div>
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
            onClick={() => setShowSettings(!showSettings)}
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
                minWidth: '150px',
                boxShadow: '0px 4px 16px rgba(15,23,42,0.06)',
                zIndex: 1000
              }}>
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
              <h2 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: '600', color: '#0F172A' }}>Customer Wallet</h2>
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748B' }}>View your Between Network balance and token details.</p>

              {wallet.loading ? (
                <p style={{ margin: '16px 0', fontSize: '14px', color: '#64748B' }}>Loading wallet details…</p>
              ) : wallet.error ? (
                <div style={{ padding: '12px', backgroundColor: '#FEE2E2', borderRadius: '8px', color: '#DC2626', fontSize: '12px', marginTop: '12px', border: '1px solid #FECACA' }}>
                  {wallet.error}
                </div>
              ) : wallet.data ? (
                (() => {
                  const walletPayload = resolveWalletPayload(wallet.data);
                  const registrationStatus = walletPayload?.registration?.status || '';
                  const hasAssignedToken = Boolean(walletPayload?.tokenID || walletPayload?.token_id || walletPayload?.token);
                  const hideCurrency =
                    !hasAssignedToken ||
                    registrationStatus === 'not_registered' ||
                    registrationStatus === 'no_token_assigned' ||
                    registrationStatus === 'pending_approval' ||
                    registrationStatus === 'pending';
                  const currencySymbol = hideCurrency ? '' : (walletPayload?.currencySymbol || walletPayload?.currency_symbol || '');
                  const currency = hideCurrency ? '' : formatCurrency(walletPayload);
                  const balanceValue = normalizeBalance(formatBalance(walletPayload));
                  const tokenId = walletPayload?.tokenID || walletPayload?.token_id || walletPayload?.token || '—';
                  const statusText = walletPayload?.registration?.status
                    ? walletPayload.registration.status.replace(/_/g, ' ')
                    : 'Approved';
                  const networkAddress =
                    walletPayload?.networkAddress || walletPayload?.network_address || '—';
                  const tokenTransferId =
                    walletPayload?.tokenTransferID ||
                    walletPayload?.token_transfer_id ||
                    (Array.isArray(walletPayload?.token_transfer_ids)
                      ? walletPayload.token_transfer_ids[0]
                      : '') ||
                    '—';
                  const registeredOn = formatDate(
                    walletPayload?.registration?.created_at || walletPayload?.created_at
                  );

                  return (
                    <>
                      <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                        <div>
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Balance</p>
                          <p style={{ margin: '0', fontSize: '30px', fontWeight: '700', color: '#0F172A' }}>
                            {currencySymbol}{balanceValue}{currency ? ` ${currency}` : ''}
                          </p>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Token ID</p>
                          <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: '#0F172A' }}>{tokenId}</p>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#64748B', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</p>
                          <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#15803D' }}>● {statusText}</p>
                        </div>
                      </div>

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
                              <div style={{ fontSize: '12px', color: '#64748B' }}>Network Address</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <p style={{ margin: 0, fontSize: '12px', fontFamily: 'monospace', color: '#0F172A' }}>
                                {truncateId(networkAddress, 20)}
                              </p>
                              <button
                                onClick={() => {
                                  if (networkAddress && networkAddress !== '—') {
                                    navigator.clipboard.writeText(networkAddress);
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

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                            <div style={{ fontSize: '12px', color: '#64748B' }}>Token Transfer ID</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <p style={{ margin: 0, fontSize: '12px', fontFamily: 'monospace', color: '#0F172A' }}>
                                {truncateId(tokenTransferId, 24)}
                              </p>
                              <button
                                onClick={() => {
                                  if (tokenTransferId && tokenTransferId !== '—') {
                                    navigator.clipboard.writeText(tokenTransferId);
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
                  Receiver Customer Network Address
                </label>
                <input
                  type="text"
                  value={receiverCustomerNetworkAddress}
                  onChange={(e) => setReceiverCustomerNetworkAddress(e.target.value)}
                  placeholder="e.g., cust_2a4b8c9f-d3e2-4a5b-8c9f-2a4b8c9f"
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
                    Sender Token ID
                  </label>
                  <input
                    type="text"
                    value={senderTokenID}
                    onChange={(e) => setSenderTokenID(e.target.value)}
                    placeholder="e.g., HDFC-USD-8f2a3b4c-v1"
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
                    Receiver Token ID
                  </label>
                  <input
                    type="text"
                    list="customer-token-options"
                    value={receiverTokenID}
                    onChange={(e) => setReceiverTokenID(e.target.value)}
                    placeholder="e.g., SBI-INR-5a8c9f2d-v1"
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #DDD',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontFamily: 'inherit'
                    }}
                  />
                  <datalist id="customer-token-options">
                    {tokens.data.length > 0 && tokens.data.map(token => (
                      <option key={token.token_id} value={token.token_id}>
                        {token.currency || token.name || token.token_id}
                      </option>
                    ))}
                  </datalist>
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
                      return (
                      <tr key={idx} style={{ borderBottom: '1px solid #E5E7EB' }}>
                        <td style={{ padding: '10px 12px', color: '#0F172A' }}>
                          {tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : 'N/A'}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#0F172A' }}>
                          {(tx.transaction_type || '').toUpperCase() === 'DEBIT'
                            ? 'Sent'
                            : (historyTab === 'mintrequest' ? 'Mint Request' : 'Received')}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#0F172A', fontWeight: '600' }}>
                          ${tx.amount}
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
