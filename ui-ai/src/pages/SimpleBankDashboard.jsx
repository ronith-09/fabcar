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

const truncateId = (id, length = 20) => {
  if (!id) return '';
  return id.length > length ? id.substring(0, length) + '...' : id;
};

const resolveRequestId = item =>
  item?.msg_id ||
  item?.MsgID ||
  item?.request_id ||
  item?.requestId ||
  item?.requestID ||
  item?.RequestID ||
  item?.transfer_request_id ||
  item?.transferRequestId ||
  item?.transferRequestID ||
  item?.TransferRequestID ||
  item?.transfer_id ||
  item?.transferId ||
  item?.id ||
  '';

const resolveCustomerRegistrationRequestId = item =>
  item?.msg_id ||
  item?.MsgID ||
  item?.request_id ||
  item?.requestId ||
  item?.requestID ||
  item?.RequestID ||
  '';

const dedupeByBusinessKey = (items, keyBuilder) => {
  const list = Array.isArray(items) ? items : [];
  const map = new Map();
  for (const item of list) {
    const key = String(keyBuilder(item) || '').trim();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
};

const resolveCustomerDetailsInputs = approval => {
  const tokenIDCandidates = [
    approval?.token_id,
    approval?.tokenID,
    approval?.tokenId,
    approval?.token,
    approval?.sender_token_id,
    approval?.senderTokenID,
    approval?.SenderTokenID,
    approval?.receiver_token_id,
    approval?.receiverTokenID,
    approval?.ReceiverTokenID
  ]
    .map(value => (value ? String(value).trim() : ''))
    .filter(Boolean);
  const tokenID = tokenIDCandidates[0] || '';
  const customerIDCandidates = [
    approval?.kyc_id,
    approval?.kycId,
    approval?.KycId,
    approval?.kyc_ref,
    approval?.kycRef,
    approval?.KycRef,
    approval?.network_address,
    approval?.networkAddress,
    approval?.NetworkAddress,
    approval?.customer_network_address,
    approval?.customerNetworkAddress,
    approval?.sender_network_address,
    approval?.senderNetworkAddress,
    approval?.receiver_network_address,
    approval?.receiverNetworkAddress,
    approval?.customer_ref,
    approval?.customerRef,
    approval?.CustomerRef,
    approval?.customer_id,
    approval?.customerID,
    approval?.customerId,
    approval?.sender_customer_id,
    approval?.senderCustomerID,
    approval?.SenderCustomerID,
    approval?.receiver_customer_id,
    approval?.receiverCustomerID,
    approval?.ReceiverCustomerID,
    approval?.requested_by_name,
    approval?.requested_by,
    approval?.user_id,
    approval?.userID,
    approval?.userId,
    approval?.username,
    approval?.customer_name,
    approval?.name
  ]
    .map(value => (value ? String(value).trim() : ''))
    .filter(Boolean)
    .filter((value, idx, arr) => arr.indexOf(value) === idx);
  const customerID = customerIDCandidates[0] || '';
  return {
    tokenID: tokenID ? String(tokenID).trim() : '',
    customerID,
    customerIDCandidates
  };
};

const resolveWalletPayload = payload =>
  payload?.wallet ||
  payload?.data?.wallet ||
  payload?.data ||
  payload ||
  null;

const formatWalletBalanceDisplay = payload => {
  const wallet = resolveWalletPayload(payload) || {};
  const display =
    wallet.walletBalanceDisplay ||
    wallet.wallet_balance_display ||
    wallet.balance_display ||
    wallet.availableBalanceDisplay;
  if (display) return display;

  const numeric =
    wallet.walletBalance ??
    wallet.wallet_balance ??
    wallet.balance ??
    wallet.availableBalance;
  if (typeof numeric === 'number') return numeric.toFixed(2);
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '—';
};

const resolveWalletTokenId = payload => {
  const wallet = resolveWalletPayload(payload) || {};
  return wallet.tokenID || wallet.token_id || wallet.token || '—';
};

const resolveWalletBIC = payload => {
  const wallet = resolveWalletPayload(payload) || {};
  return wallet.bic || wallet.bic_code || wallet.BIC || '—';
};

const getCurrencySymbol = currencyCode => {
  const symbols = {
    USD: '$',
    EUR: 'EUR ',
    GBP: 'GBP ',
    JPY: 'JPY ',
    INR: 'INR ',
    NGN: 'NGN ',
    KES: 'KES ',
    CNY: 'CNY ',
    AUD: 'AUD ',
    CAD: 'CAD '
  };
  if (!currencyCode) return '';
  const normalized = String(currencyCode).trim().toUpperCase();
  return symbols[normalized] || `${normalized} `;
};

const formatAmountWithCurrency = (amountValue, currencyCode) => {
  const parsedAmount = Number(amountValue);
  if (!Number.isFinite(parsedAmount)) {
    return amountValue !== undefined && amountValue !== null && String(amountValue).trim()
      ? String(amountValue).trim()
      : 'Not present';
  }
  const symbol = getCurrencySymbol(currencyCode);
  return `${symbol}${parsedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim();
};

const formatBackendAmount = (record, amountValue) => {
  const source = record && typeof record === 'object' ? record : {};
  const displayValue =
    source.amount_display ||
    source.amountDisplay ||
    source.display_amount ||
    source.displayAmount ||
    source.formatted_amount ||
    source.formattedAmount ||
    source.value_display ||
    source.valueDisplay;

  if (displayValue !== undefined && displayValue !== null && String(displayValue).trim()) {
    const normalizedDisplay = String(displayValue).trim();
    const currencyAmountMatch = normalizedDisplay.match(/^([A-Za-z]{3})\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)$/);
    if (currencyAmountMatch) {
      const [, currencyCode, rawNumeric] = currencyAmountMatch;
      return formatAmountWithCurrency(rawNumeric.replace(/,/g, ''), currencyCode);
    }
    return normalizedDisplay;
  }

  const rawAmount = amountValue ?? source.amount ?? source.value ?? source.transfer_amount;
  const parsedAmount = Number(rawAmount);
  const formattedNumber = Number.isFinite(parsedAmount)
    ? parsedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : (rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() ? String(rawAmount).trim() : '—');

  const currency =
    source.currency ||
    source.currency_code ||
    source.currencyCode ||
    source.token_currency ||
    source.tokenCurrency ||
    '';

  if (currency && String(currency).trim()) {
    return formatAmountWithCurrency(rawAmount, currency);
  }
  return formattedNumber;
};

const resolveCustomerName = item =>
  item?.name ||
  item?.customer_name ||
  item?.customerName ||
  item?.username ||
  item?.requested_by_name ||
  item?.requested_by ||
  item?.sender_customer_name ||
  item?.SenderCustomerName ||
  item?.receiver_customer_name ||
  item?.ReceiverCustomerName ||
  'Not present';

const resolveCustomerNetworkAddress = item =>
  item?.network_address ||
  item?.networkAddress ||
  item?.NetworkAddress ||
  item?.customer_network_address ||
  item?.customerNetworkAddress ||
  item?.requested_by ||
  item?.RequestedBy ||
  'Not present';

const resolveDisplayBIC = item =>
  item?.bic ||
  item?.bic_code ||
  item?.bank_bic ||
  item?.bankBIC ||
  item?.BIC ||
  item?.sender_bic ||
  item?.senderBIC ||
  item?.receiver_bic ||
  item?.receiverBIC ||
  'Not present';

const resolveCustomerId = item =>
  resolveCustomerNetworkAddress(item);

const resolveCustomerKycId = item =>
  item?.kyc_ref ||
  item?.kycRef ||
  item?.KycRef ||
  item?.kyc_id ||
  item?.kycId ||
  item?.KycId ||
  'Not present';

const resolveCustomerKycStatus = item =>
  item?.kyc_status ||
  item?.kycStatus ||
  item?.KycStatus ||
  'Not present';

const isKycVerified = item => {
  const raw = resolveCustomerKycStatus(item);
  if (raw === true) return true;
  const normalized = String(raw || '').trim().toLowerCase();
  return normalized === 'verified' || normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'approved';
};

const resolveApprovalStatus = item => {
  const raw = item?.status || item?.Status || '';
  const normalized = String(raw || '').trim().toUpperCase();
  if (normalized) return normalized;
  return isKycVerified(item) ? 'VERIFIED' : 'PENDING_APPROVAL';
};

const resolveApprovalExpiresAt = item =>
  item?.expires_at ||
  item?.ExpiresAt ||
  item?.valid_until ||
  item?.ValidUntil ||
  item?.expiry ||
  item?.expiresOn ||
  '';

const sanitizeCustomerApprovalTitle = item => {
  const candidate = String(item?.name || item?.username || '').trim();
  if (!candidate) return 'Customer';
  const looksLikeNetworkAddress =
    candidate.includes('::') ||
    candidate.startsWith('eDUw') ||
    candidate.length > 80;
  return looksLikeNetworkAddress ? 'Customer' : candidate;
};

const redactNetworkAddressFields = value => {
  if (Array.isArray(value)) {
    return value.map(item => redactNetworkAddressFields(item));
  }
  if (value && typeof value === 'object') {
    const next = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
      const normalizedKey = String(key || '').toLowerCase();
      if (normalizedKey === 'networkaddress' || normalizedKey === 'network_address') {
        next[key] = '[REDACTED]';
      } else {
        next[key] = redactNetworkAddressFields(nestedValue);
      }
    });
    return next;
  }
  return value;
};

const SimpleBankDashboard = () => {
  const [activeLane, setActiveLane] = useState('customerApproval');
  const [latestRegistration, setLatestRegistration] = useState(() => getStoredRegistrationSnapshot());
  
  // Stats
  const [stats, setStats] = useState({
    totalCustomers: 0,
    kycVerified: 0,
    suspicious: 0,
    inactive: 0
  });
  
  // Customer approvals
  const [pendingApprovals, setPendingApprovals] = useState({ loading: false, data: [], error: '' });
  const [approvalActionRequestId, setApprovalActionRequestId] = useState('');
  const [customerDetailsByRequest, setCustomerDetailsByRequest] = useState({});

  // Customer mint approvals
  const [pendingMintApprovals, setPendingMintApprovals] = useState({ loading: false, data: [], error: '' });
  const [mintApprovalActionRequestId, setMintApprovalActionRequestId] = useState('');

  // Customer transfer dual approvals
  const [pendingSenderTransfers, setPendingSenderTransfers] = useState({ loading: false, data: [], error: '' });
  const [pendingReceiverTransfers, setPendingReceiverTransfers] = useState({ loading: false, data: [], error: '' });
  const [senderApprovalAction, setSenderApprovalAction] = useState({ requestId: '', status: '' });
  const [receiverApprovalAction, setReceiverApprovalAction] = useState({ requestId: '', status: '' });
  const [transferApprovalView, setTransferApprovalView] = useState('sender');

  // Customer records
  const [recordsView, setRecordsView] = useState('approvedParticipants');
  const [approvedParticipantsRecords, setApprovedParticipantsRecords] = useState({ loading: false, data: [], error: '' });
  const [approvedMintRequestsRecords, setApprovedMintRequestsRecords] = useState({ loading: false, data: [], error: '' });
  const [tokenTransferHistoryRecords, setTokenTransferHistoryRecords] = useState({ loading: false, data: [], error: '' });
  const [customerToTokenHistoryRecords, setCustomerToTokenHistoryRecords] = useState({ loading: false, data: [], error: '' });
  const [tokenTransferHistoryTokenId, setTokenTransferHistoryTokenId] = useState('');
  const [isCustomerMenuOpen, setIsCustomerMenuOpen] = useState(false);
  const [isTokenMenuOpen, setIsTokenMenuOpen] = useState(false);
  const [isBankSetupMenuOpen, setIsBankSetupMenuOpen] = useState(false);

  // Token access
  const [tokenAccessForm, setTokenAccessForm] = useState({
    institutionID: '',
    institutionName: '',
    countryCode: 'US',
    currencyCode: '',
    reference: ''
  });
  const [tokenAccessRequestState, setTokenAccessRequestState] = useState({ loading: false, message: '', error: '' });
  const [tokenAccessStatusState, setTokenAccessStatusState] = useState({ loading: false, data: null, error: '' });

  // Fund management
  const [mintRequestForm, setMintRequestForm] = useState({ amount: '', tokenID: '', purpose: 'WORKING_CAPITAL' });
  const [mintRequestState, setMintRequestState] = useState({ loading: false, message: '', error: '' });

  // Token transfer
  const [tokenTransferForm, setTokenTransferForm] = useState({ senderTokenID: '', receiverTokenID: '', amount: '' });
  const [tokenTransferRequestState, setTokenTransferRequestState] = useState({ loading: false, message: '', error: '' });
  const [pendingTokenTransferRequests, setPendingTokenTransferRequests] = useState({ loading: false, data: [], error: '' });
  const [tokenTransferApproveRequestId, setTokenTransferApproveRequestId] = useState('');
  const [tokenTransferLaneHistory, setTokenTransferLaneHistory] = useState({ loading: false, data: [], error: '' });
  const [tokenMintRecords, setTokenMintRecords] = useState({ loading: false, data: [], error: '' });

  // Bank setup - token configuration
  const [tokenConfigForm, setTokenConfigForm] = useState({ token_id: '', bank_api_base_url: '', bank_auth_key: '' });
  const [tokenConfigSubmitState, setTokenConfigSubmitState] = useState({ loading: false, message: '', error: '' });
  const [tokenConfigLookupTokenId, setTokenConfigLookupTokenId] = useState('');
  const [tokenConfigLookupState, setTokenConfigLookupState] = useState({ loading: false, data: null, error: '' });
  const [allTokenConfigsState, setAllTokenConfigsState] = useState({ loading: false, data: [], error: '' });

  // Bank setup - integration runbook
  const [integrationTokenId, setIntegrationTokenId] = useState('');
  const [integrationDetailsState, setIntegrationDetailsState] = useState({ loading: false, data: null, error: '' });
  const [registerCustomerForm, setRegisterCustomerForm] = useState({ name: '', password: '', role: 'customer' });
  const [registerCustomerState, setRegisterCustomerState] = useState({ loading: false, message: '', error: '' });
  const [lookupCustomerId, setLookupCustomerId] = useState('');
  const [lookupCustomerState, setLookupCustomerState] = useState({ loading: false, data: null, error: '' });

  // Bank setup - token handshake
  const [handshakeRequestForm, setHandshakeRequestForm] = useState({ otherTokenID: '' });
  const [handshakeRequestState, setHandshakeRequestState] = useState({ loading: false, message: '', error: '' });
  const [pendingHandshakesState, setPendingHandshakesState] = useState({ loading: false, data: [], error: '' });
  const [allHandshakesState, setAllHandshakesState] = useState({ loading: false, data: [], error: '' });
  const [approveHandshakeId, setApproveHandshakeId] = useState('');
  const [approveHandshakeState, setApproveHandshakeState] = useState({ loading: false, message: '', error: '' });
  
  // Wallet
  const [wallet, setWallet] = useState({ loading: false, data: null, error: '' });
  const [rawViewState, setRawViewState] = useState({});

  const toggleRawView = (scope, key) => {
    const compositeKey = `${scope}:${key}`;
    setRawViewState(prev => ({ ...prev, [compositeKey]: !prev[compositeKey] }));
  };

  const isRawViewOpen = (scope, key) => Boolean(rawViewState[`${scope}:${key}`]);

  useEffect(() => {
    const handler = event => {
      if (event?.detail) {
        setLatestRegistration(getStoredRegistrationSnapshot());
      }
    };
    window.addEventListener('latest-registration-credentials', handler);
    return () => window.removeEventListener('latest-registration-credentials', handler);
  }, []);

  const fetchCustomers = async () => {
    try {
      const data = await safeGet('/bank/participants/approved', { throwError: true }, []);
      const customerList = Array.isArray(data) ? data : [];
      
      // Calculate stats
      const kycCount = customerList.filter(c => c.kyc_status === 'verified' || c.kyc_status === true).length;
      const suspiciousCount = customerList.filter(c => c.kyc_status === 'suspicious').length;
      const inactiveCount = customerList.filter(c => c.status === 'inactive' || !c.status).length;
      
      setStats({
        totalCustomers: customerList.length,
        kycVerified: kycCount,
        suspicious: suspiciousCount,
        inactive: inactiveCount
      });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load customers';
      console.warn(detail);
      setStats({
        totalCustomers: 0,
        kycVerified: 0,
        suspicious: 0,
        inactive: 0
      });
    }
  };

  const fetchPendingApprovals = async () => {
    setPendingApprovals(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/customer-registrations/pending', { throwError: true }, []);
      const approvalList = Array.isArray(data) ? data : [];
      setPendingApprovals({ loading: false, data: approvalList, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load approvals';
      setPendingApprovals({ loading: false, data: [], error: detail });
    }
  };

  const fetchPendingMintApprovals = async () => {
    setPendingMintApprovals(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/customer-mint-requests/pending', { throwError: true }, []);
      const mintRequestList = Array.isArray(data)
        ? data
        : Array.isArray(data?.requests)
          ? data.requests
          : Array.isArray(data?.pending_requests)
            ? data.pending_requests
            : [];
      setPendingMintApprovals({ loading: false, data: mintRequestList, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load customer mint requests';
      setPendingMintApprovals({ loading: false, data: [], error: detail });
    }
  };

  const fetchPendingSenderTransfers = async () => {
    setPendingSenderTransfers(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/customer-to-token-transfers/pending-as-sender', { throwError: true }, []);
      const senderList = Array.isArray(data)
        ? data
        : Array.isArray(data?.pending_transfers)
          ? data.pending_transfers
          : Array.isArray(data?.transfers)
            ? data.transfers
            : [];
      setPendingSenderTransfers({ loading: false, data: senderList, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load sender-side pending transfers';
      setPendingSenderTransfers({ loading: false, data: [], error: detail });
    }
  };

  const fetchPendingReceiverTransfers = async () => {
    setPendingReceiverTransfers(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/customer-to-token-transfers/pending-as-receiver', { throwError: true }, []);
      const receiverList = Array.isArray(data)
        ? data
        : Array.isArray(data?.pending_transfers)
          ? data.pending_transfers
          : Array.isArray(data?.transfers)
            ? data.transfers
            : [];
      setPendingReceiverTransfers({ loading: false, data: receiverList, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load receiver-side pending transfers';
      setPendingReceiverTransfers({ loading: false, data: [], error: detail });
    }
  };

  const fetchApprovedParticipantsRecords = async () => {
    setApprovedParticipantsRecords(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/participants/approved', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.participants)
          ? data.participants
          : Array.isArray(data?.approved_participants)
            ? data.approved_participants
            : [];
      const deduped = dedupeByBusinessKey(list, item => {
        const customerRef = item?.customer_ref || item?.customer_id || item?.customerId || '';
        const networkAddress = item?.network_address || item?.networkAddress || '';
        const tokenID = item?.token_id || item?.tokenID || '';
        return `${customerRef}::${networkAddress}::${tokenID}`;
      });
      setApprovedParticipantsRecords({ loading: false, data: deduped, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load approved participants';
      setApprovedParticipantsRecords({ loading: false, data: [], error: detail });
    }
  };

  const fetchApprovedMintRequestsRecords = async () => {
    setApprovedMintRequestsRecords(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/participant-mint-requests/approved', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.requests)
          ? data.requests
          : Array.isArray(data?.approved_requests)
            ? data.approved_requests
            : [];
      const deduped = dedupeByBusinessKey(list, item => {
        const reqId = item?.request_id || item?.requestId || item?.requestID || item?.RequestID || item?.msg_id || item?.MsgID || '';
        const tokenID = item?.token_id || item?.tokenID || '';
        return `${reqId}::${tokenID}`;
      });
      setApprovedMintRequestsRecords({ loading: false, data: deduped, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load approved mint requests';
      setApprovedMintRequestsRecords({ loading: false, data: [], error: detail });
    }
  };

  const fetchTokenTransferHistoryRecords = async () => {
    setTokenTransferHistoryRecords(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const params = tokenTransferHistoryTokenId.trim()
        ? { tokenID: tokenTransferHistoryTokenId.trim() }
        : {};
      const data = await safeGet('/token-transfer-history', { params, throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.history)
          ? data.history
          : Array.isArray(data?.transfers)
            ? data.transfers
            : [];
      const deduped = dedupeByBusinessKey(list, item => {
        const reqId = item?.transfer_request_id || item?.transferRequestID || item?.request_id || item?.requestId || item?.msg_id || item?.MsgID || item?.transfer_id || item?.transferId || '';
        return reqId || `${item?.sender_token_id || ''}::${item?.receiver_token_id || ''}::${item?.amount || 0}::${item?.created_at || ''}`;
      });
      setTokenTransferHistoryRecords({ loading: false, data: deduped, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load token transfer history';
      setTokenTransferHistoryRecords({ loading: false, data: [], error: detail });
    }
  };

  const fetchCustomerToTokenHistoryRecords = async () => {
    setCustomerToTokenHistoryRecords(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/customer-to-token-transfers/history', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.completed_transfers)
          ? data.completed_transfers
          : Array.isArray(data?.completedTransfers)
            ? data.completedTransfers
        : Array.isArray(data?.history)
          ? data.history
          : Array.isArray(data?.transfers)
            ? data.transfers
            : [];
      const deduped = dedupeByBusinessKey(list, item => {
        const reqId = item?.transfer_request_id || item?.transferRequestID || item?.request_id || item?.requestId || item?.msg_id || item?.MsgID || item?.transfer_id || item?.transferId || '';
        return reqId || `${item?.sender_customer_ref || ''}::${item?.receiver_customer_ref || ''}::${item?.amount || 0}::${item?.created_at || ''}`;
      });
      setCustomerToTokenHistoryRecords({ loading: false, data: deduped, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load customer-to-token transfers history';
      setCustomerToTokenHistoryRecords({ loading: false, data: [], error: detail });
    }
  };

  const fetchWallet = async () => {
    if (!latestRegistration?.network_address) {
      setWallet({ loading: false, data: null, error: 'Not logged in' });
      return;
    }
    setWallet(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const { data } = await client.get('/bank/wallet', {
        params: { networkAddress: latestRegistration.network_address }
      });
      setWallet({ loading: false, data, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load wallet';
      setWallet({ loading: false, data: null, error: detail });
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchWallet();
  }, [latestRegistration?.network_address]);

  useEffect(() => {
    if (activeLane === 'customerApproval') {
      fetchPendingApprovals();
    }
  }, [activeLane]);

  useEffect(() => {
    if (activeLane === 'customerMint') {
      fetchPendingMintApprovals();
    }
  }, [activeLane]);

  useEffect(() => {
    if (activeLane === 'customerTransferApproval') {
      fetchPendingSenderTransfers();
      fetchPendingReceiverTransfers();
    }
  }, [activeLane]);

  useEffect(() => {
    if (activeLane !== 'customerTransferApproval') return;
    if (transferApprovalView === 'sender' && pendingSenderTransfers.data.length === 0 && !pendingSenderTransfers.loading) {
      fetchPendingSenderTransfers();
    }
    if (transferApprovalView === 'receiver' && pendingReceiverTransfers.data.length === 0 && !pendingReceiverTransfers.loading) {
      fetchPendingReceiverTransfers();
    }
  }, [activeLane, transferApprovalView]);

  useEffect(() => {
    if (activeLane !== 'customerRecords') return;
    if (recordsView === 'approvedParticipants') {
      fetchApprovedParticipantsRecords();
    } else if (recordsView === 'approvedMintRequests') {
      fetchApprovedMintRequestsRecords();
    } else if (recordsView === 'tokenTransferHistory') {
      fetchTokenTransferHistoryRecords();
    } else if (recordsView === 'customerToTokenHistory') {
      fetchCustomerToTokenHistoryRecords();
    }
  }, [activeLane, recordsView]);

  useEffect(() => {
    if (activeLane === 'tokenTransfer') {
      fetchPendingTokenTransferRequests();
      fetchTokenTransferLaneHistory();
      fetchTokenMintRecords();
    }
  }, [activeLane]);

  useEffect(() => {
    if (activeLane === 'tokenConfig') {
      fetchAllTokenConfigurations();
    }
  }, [activeLane]);

  useEffect(() => {
    if (activeLane === 'tokenHandshake') {
      fetchPendingHandshakes();
      fetchAllHandshakes();
    }
  }, [activeLane]);

  const handleApproveCustomer = async requestId => {
    const normalizedRequestId = requestId ? String(requestId).trim() : '';
    if (!normalizedRequestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setApprovalActionRequestId(normalizedRequestId);
      await client.post(`/bank/customer-registrations/${encodeURIComponent(normalizedRequestId)}/approve`, {
        status: 'approved'
      });
      setPendingApprovals(prev => ({
        ...prev,
        data: (prev.data || []).filter(item => {
          const id = resolveCustomerRegistrationRequestId(item);
          return String(id || '').trim() !== normalizedRequestId;
        })
      }));
      alert('✅ Registration approved successfully!');
      await fetchPendingApprovals();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Approval failed';
      alert(`❌ Error: ${detail}`);
    } finally {
      setApprovalActionRequestId('');
    }
  };

  const handleRejectCustomer = async requestId => {
    const normalizedRequestId = requestId ? String(requestId).trim() : '';
    if (!normalizedRequestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setApprovalActionRequestId(normalizedRequestId);
      await client.post(`/bank/customer-registrations/${encodeURIComponent(normalizedRequestId)}/approve`, {
        status: 'rejected'
      });
      setPendingApprovals(prev => ({
        ...prev,
        data: (prev.data || []).filter(item => {
          const id = resolveCustomerRegistrationRequestId(item);
          return String(id || '').trim() !== normalizedRequestId;
        })
      }));
      alert('✅ Registration rejected successfully!');
      await fetchPendingApprovals();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Rejection failed';
      alert(`❌ Error: ${detail}`);
    } finally {
      setApprovalActionRequestId('');
    }
  };

  const handleFetchCustomerDetails = async (approval, requestKey) => {
    const requestId = requestKey || approval?.request_id || approval?.requestId || approval?.id || `idx_${Date.now()}`;
    const { tokenID, customerID, customerIDCandidates } = resolveCustomerDetailsInputs(approval);

    if (!tokenID || !customerID) {
      setCustomerDetailsByRequest(prev => ({
        ...prev,
        [requestId]: {
          loading: false,
          data: null,
          error: 'Not present'
        }
      }));
      return;
    }

    setCustomerDetailsByRequest(prev => ({
      ...prev,
      [requestId]: { loading: true, data: null, error: '' }
    }));

    try {
      let responseData = null;
      let lastError = null;
      for (const candidate of customerIDCandidates.length > 0 ? customerIDCandidates : [customerID]) {
        try {
          const { data } = await client.get('/bank/customer-details', {
            params: { tokenID, customerID: candidate }
          });
          if (data?.source === 'fallback_minimal') {
            continue;
          }
          responseData = data;
          break;
        } catch (error) {
          lastError = error;
          const detail = error?.response?.data?.error || error?.response?.data?.detail || '';
          if (!String(detail).toLowerCase().includes('not found')) {
            throw error;
          }
        }
      }

      if (!responseData && lastError) {
        throw lastError;
      }

      setCustomerDetailsByRequest(prev => ({
        ...prev,
        [requestId]: { loading: false, data: responseData, error: '' }
      }));
    } catch (error) {
      const detail = error?.response?.data?.error || error?.response?.data?.detail || error?.message || 'Unable to fetch customer details';
      setCustomerDetailsByRequest(prev => ({
        ...prev,
        [requestId]: { loading: false, data: null, error: detail }
      }));
    }
  };

  const handleApproveMintRequest = async (requestId, tokenID = '') => {
    return handleMintRequestDecision(requestId, 'approved', tokenID);
  };

  const handleRejectMintRequest = async (requestId, tokenID = '') => {
    return handleMintRequestDecision(requestId, 'rejected', tokenID);
  };

  const handleMintRequestDecision = async (requestId, status, tokenID = '') => {
    if (!requestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setMintApprovalActionRequestId(requestId);
      const normalizedRequestId = String(requestId || '').trim();
      const normalizedTokenId = tokenID ? String(tokenID).trim() : '';
      await client.post(`/bank/customer-mint-requests/${encodeURIComponent(requestId)}/approve`, {
        status,
        ...(normalizedTokenId ? { tokenID: normalizedTokenId } : {})
      });
      setPendingMintApprovals(prev => ({
        ...prev,
        data: (prev.data || []).filter(item => {
          const id = resolveRequestId(item);
          return String(id || '').trim() !== normalizedRequestId;
        })
      }));
      alert(status === 'approved' ? '✅ Mint request approved successfully!' : '✅ Mint request rejected successfully!');
      await fetchPendingMintApprovals();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Mint request update failed';
      alert(`❌ Error: ${detail}`);
    } finally {
      setMintApprovalActionRequestId('');
    }
  };

  const handleApproveSenderTransfer = async requestId => {
    return handleSenderTransferDecision(requestId, 'approved');
  };

  const handleRejectSenderTransfer = async requestId => {
    return handleSenderTransferDecision(requestId, 'rejected');
  };

  const handleSenderTransferDecision = async (requestId, status) => {
    const normalizedRequestId = requestId ? String(requestId).trim() : '';
    if (!normalizedRequestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setSenderApprovalAction({ requestId: normalizedRequestId, status });
      await client.post('/bank/customer-to-token-transfers/approve-sender', {
        transferRequestID: normalizedRequestId,
        status
      });
      setPendingSenderTransfers(prev => ({
        ...prev,
        data: (prev.data || []).filter(item => {
          const id = resolveRequestId(item);
          return String(id || '').trim() !== normalizedRequestId;
        })
      }));
      alert(status === 'approved' ? '✅ Sender approval completed successfully!' : '✅ Sender rejection completed successfully!');
      await fetchPendingSenderTransfers();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Sender action failed';
      alert(`❌ Error: ${detail}`);
    } finally {
      setSenderApprovalAction({ requestId: '', status: '' });
    }
  };

  const handleApproveReceiverTransfer = async requestId => {
    return handleReceiverTransferDecision(requestId, 'approved');
  };

  const handleRejectReceiverTransfer = async requestId => {
    return handleReceiverTransferDecision(requestId, 'rejected');
  };

  const handleReceiverTransferDecision = async (requestId, status) => {
    const normalizedRequestId = requestId ? String(requestId).trim() : '';
    if (!normalizedRequestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setReceiverApprovalAction({ requestId: normalizedRequestId, status });
      await client.post('/bank/customer-to-token-transfers/approve-receiver', {
        transferRequestID: normalizedRequestId,
        status
      });
      setPendingReceiverTransfers(prev => ({
        ...prev,
        data: (prev.data || []).filter(item => {
          const id = resolveRequestId(item);
          return String(id || '').trim() !== normalizedRequestId;
        })
      }));
      alert(status === 'approved' ? '✅ Receiver approval completed successfully!' : '✅ Receiver rejection completed successfully!');
      await fetchPendingReceiverTransfers();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Receiver action failed';
      alert(`❌ Error: ${detail}`);
    } finally {
      setReceiverApprovalAction({ requestId: '', status: '' });
    }
  };

  const handleRequestTokenAccess = async () => {
    const institutionID = tokenAccessForm.institutionID.trim().toUpperCase();
    const institutionName = tokenAccessForm.institutionName.trim();
    const countryCode = tokenAccessForm.countryCode.trim().toUpperCase();
    const currencyCode = tokenAccessForm.currencyCode.trim().toUpperCase();
    const reference = tokenAccessForm.reference.trim() || `REQ-${Date.now()}`;
    if (!institutionID || !institutionName || !currencyCode) {
      setTokenAccessRequestState({ loading: false, message: '', error: 'Institution ID, Institution Name, and Currency Code are required' });
      return;
    }

    try {
      setTokenAccessRequestState({ loading: true, message: '', error: '' });
      const { data } = await client.post('/token-request', {
        institution_id: institutionID,
        institution_name: institutionName,
        country_code: countryCode,
        currency_code: currencyCode,
        reference
      });
      const requestRef = data?.msg_id || data?.request_id || '';
      setTokenAccessRequestState({
        loading: false,
        message: requestRef ? `Token access request submitted: ${requestRef}` : 'Token access request submitted successfully',
        error: ''
      });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to request token access';
      setTokenAccessRequestState({ loading: false, message: '', error: detail });
    }
  };

  const handleGetTokenAccess = async () => {
    try {
      setTokenAccessStatusState({ loading: true, data: null, error: '' });
      const { data } = await client.post('/bank/get-token-access', {});
      setTokenAccessStatusState({ loading: false, data, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to fetch token access status';
      setTokenAccessStatusState({ loading: false, data: null, error: detail });
    }
  };

  const handleSubmitMintRequest = async () => {
    const parsedAmount = Number(mintRequestForm.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setMintRequestState({ loading: false, message: '', error: 'Enter a valid positive amount' });
      return;
    }

    try {
      setMintRequestState({ loading: true, message: '', error: '' });
      const payload = { amount: parsedAmount, purpose: mintRequestForm.purpose || 'WORKING_CAPITAL' };
      if (mintRequestForm.tokenID.trim()) {
        payload.tokenID = mintRequestForm.tokenID.trim();
      }
      await client.post('/mint-request', payload);
      setMintRequestState({ loading: false, message: 'Mint request submitted successfully', error: '' });
      fetchWallet();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to submit mint request';
      setMintRequestState({ loading: false, message: '', error: detail });
    }
  };

  const handleInitiateTokenTransferRequest = async () => {
    const senderTokenID = tokenTransferForm.senderTokenID.trim();
    const receiverTokenID = tokenTransferForm.receiverTokenID.trim();
    const parsedAmount = Number(tokenTransferForm.amount);

    if (!senderTokenID || !receiverTokenID) {
      setTokenTransferRequestState({ loading: false, message: '', error: 'Sender and receiver token IDs are required' });
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setTokenTransferRequestState({ loading: false, message: '', error: 'Enter a valid positive amount' });
      return;
    }

    try {
      setTokenTransferRequestState({ loading: true, message: '', error: '' });
      await client.post('/token-transfer-request', {
        senderTokenID,
        receiverTokenID,
        amount: parsedAmount,
        purpose: 'INTERBANK_SETTLEMENT'
      });
      setTokenTransferRequestState({ loading: false, message: 'Transfer request initiated successfully', error: '' });
      fetchPendingTokenTransferRequests();
      fetchTokenTransferLaneHistory();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to initiate transfer request';
      setTokenTransferRequestState({ loading: false, message: '', error: detail });
    }
  };

  const fetchPendingTokenTransferRequests = async () => {
    setPendingTokenTransferRequests(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/token-transfer-requests/pending', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.requests)
          ? data.requests
          : Array.isArray(data?.pending_requests)
            ? data.pending_requests
            : [];
      setPendingTokenTransferRequests({ loading: false, data: list, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load pending transfer requests';
      setPendingTokenTransferRequests({ loading: false, data: [], error: detail });
    }
  };

  const handleApproveTokenTransferRequest = async requestId => {
    if (!requestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    const receiverOwnerAddress = latestRegistration?.network_address || latestRegistration?.networkAddress;
    if (!receiverOwnerAddress) {
      alert('❌ Error: Missing receiver owner address (bank network address)');
      return;
    }
    try {
      setTokenTransferApproveRequestId(requestId);
      await client.post(`/token-transfer-requests/${encodeURIComponent(requestId)}/approve`, {
        receiverOwnerAddress
      });
      fetchPendingTokenTransferRequests();
      fetchTokenTransferLaneHistory();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unable to approve transfer request';
      alert(`❌ Error: ${detail}`);
    } finally {
      setTokenTransferApproveRequestId('');
    }
  };

  const fetchTokenTransferLaneHistory = async () => {
    setTokenTransferLaneHistory(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/token-transfer-history', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.history)
          ? data.history
          : Array.isArray(data?.transfers)
            ? data.transfers
            : [];
      setTokenTransferLaneHistory({ loading: false, data: list, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load transfer history';
      setTokenTransferLaneHistory({ loading: false, data: [], error: detail });
    }
  };

  const fetchTokenMintRecords = async () => {
    setTokenMintRecords(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/token-mint-records', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.records)
          ? data.records
          : [];
      const deduped = dedupeByBusinessKey(list, item => {
        const recordId = item?.record_id || item?.request_id || item?.msg_id || '';
        return recordId || `${item?.token_id || ''}::${item?.amount || 0}::${item?.approved_at || item?.created_at || ''}`;
      });
      setTokenMintRecords({ loading: false, data: deduped, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to load token mint records';
      setTokenMintRecords({ loading: false, data: [], error: detail });
    }
  };

  const handleConfigureToken = async () => {
    const payload = {
      token_id: tokenConfigForm.token_id.trim(),
      bank_api_base_url: tokenConfigForm.bank_api_base_url.trim(),
      bank_auth_key: tokenConfigForm.bank_auth_key.trim()
    };
    if (!payload.token_id || !payload.bank_api_base_url || !payload.bank_auth_key) {
      setTokenConfigSubmitState({ loading: false, message: '', error: 'All token configuration fields are required' });
      return;
    }

    try {
      setTokenConfigSubmitState({ loading: true, message: '', error: '' });
      await client.post('/bank/token-config', payload);
      setTokenConfigSubmitState({ loading: false, message: 'Token configuration saved', error: '' });
      fetchAllTokenConfigurations();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to configure token';
      setTokenConfigSubmitState({ loading: false, message: '', error: detail });
    }
  };

  const handleGetTokenConfiguration = async () => {
    const tokenId = tokenConfigLookupTokenId.trim();
    if (!tokenId) {
      setTokenConfigLookupState({ loading: false, data: null, error: 'Token ID is required' });
      return;
    }
    try {
      setTokenConfigLookupState({ loading: true, data: null, error: '' });
      const { data } = await client.get(`/token/${encodeURIComponent(tokenId)}/bank-config`);
      setTokenConfigLookupState({ loading: false, data, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to fetch token configuration';
      setTokenConfigLookupState({ loading: false, data: null, error: detail });
    }
  };

  const fetchAllTokenConfigurations = async () => {
    setAllTokenConfigsState(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/token-configs', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.configs)
          ? data.configs
          : Array.isArray(data?.token_configs)
            ? data.token_configs
            : [];
      setAllTokenConfigsState({ loading: false, data: list, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to fetch all token configurations';
      setAllTokenConfigsState({ loading: false, data: [], error: detail });
    }
  };

  const handleGetTokenIntegrationDetails = async () => {
    const tokenId = integrationTokenId.trim();
    if (!tokenId) {
      setIntegrationDetailsState({ loading: false, data: null, error: 'Token ID is required' });
      return;
    }
    try {
      setIntegrationDetailsState({ loading: true, data: null, error: '' });
      const { data } = await client.get(`/token/${encodeURIComponent(tokenId)}/integration`);
      setIntegrationDetailsState({ loading: false, data, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to fetch token integration details';
      setIntegrationDetailsState({ loading: false, data: null, error: detail });
    }
  };

  const handleRegisterCustomerDocumentedApi = async () => {
    const payload = {
      name: registerCustomerForm.name.trim(),
      password: registerCustomerForm.password,
      role: registerCustomerForm.role
    };
    if (!payload.name || !payload.password) {
      setRegisterCustomerState({ loading: false, message: '', error: 'Name and password are required' });
      return;
    }
    try {
      setRegisterCustomerState({ loading: true, message: '', error: '' });
      await client.post('/api/bank/register-customer', payload);
      setRegisterCustomerState({ loading: false, message: 'Customer registered through documented API', error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to register customer via documented API';
      setRegisterCustomerState({ loading: false, message: '', error: detail });
    }
  };

  const handleLookupBankCustomer = async () => {
    const customerId = lookupCustomerId.trim();
    if (!customerId) {
      setLookupCustomerState({ loading: false, data: null, error: 'Customer ID is required' });
      return;
    }
    try {
      setLookupCustomerState({ loading: true, data: null, error: '' });
      const { data } = await client.get(`/between/customer/${encodeURIComponent(customerId)}`);
      setLookupCustomerState({ loading: false, data, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to lookup customer';
      setLookupCustomerState({ loading: false, data: null, error: detail });
    }
  };

  const handleSendHandshakeRequest = async () => {
    const otherTokenID = handshakeRequestForm.otherTokenID.trim();
    if (!otherTokenID) {
      setHandshakeRequestState({ loading: false, message: '', error: 'Target token ID is required' });
      return;
    }
    try {
      setHandshakeRequestState({ loading: true, message: '', error: '' });
      await client.post('/bank/handshake/request', { otherTokenID });
      setHandshakeRequestState({ loading: false, message: 'Handshake request sent', error: '' });
      fetchPendingHandshakes();
      fetchAllHandshakes();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to send handshake request';
      setHandshakeRequestState({ loading: false, message: '', error: detail });
    }
  };

  const fetchPendingHandshakes = async () => {
    setPendingHandshakesState(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/handshakes/pending', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.data?.pending)
          ? data.data.pending
          : Array.isArray(data?.data?.pending_handshakes)
            ? data.data.pending_handshakes
        : Array.isArray(data?.pending)
          ? data.pending
        : Array.isArray(data?.pending_handshakes)
          ? data.pending_handshakes
          : Array.isArray(data?.handshakes)
            ? data.handshakes
            : [];
      setPendingHandshakesState({ loading: false, data: list, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to fetch pending handshakes';
      setPendingHandshakesState({ loading: false, data: [], error: detail });
    }
  };

  const handleApproveHandshake = async handshakeIdArg => {
    const handshakeId = (handshakeIdArg || approveHandshakeId || '').trim();
    if (!handshakeId) {
      setApproveHandshakeState({ loading: false, message: '', error: 'Handshake/request ID is required' });
      return;
    }
    try {
      setApproveHandshakeState({ loading: true, message: '', error: '' });
      await client.post('/handshake/approve', { handshakeID: handshakeId });
      setApproveHandshakeState({ loading: false, message: 'Handshake approved', error: '' });
      fetchPendingHandshakes();
      fetchAllHandshakes();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to approve handshake';
      setApproveHandshakeState({ loading: false, message: '', error: detail });
    }
  };

  const fetchAllHandshakes = async () => {
    setAllHandshakesState(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const data = await safeGet('/bank/handshakes', { throwError: true }, []);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.handshakes)
          ? data.handshakes
          : Array.isArray(data?.all_handshakes)
            ? data.all_handshakes
            : [];
      setAllHandshakesState({ loading: false, data: list, error: '' });
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.message || 'Unable to fetch all handshakes';
      setAllHandshakesState({ loading: false, data: [], error: detail });
    }
  };

  const handleSignOut = () => {
    window.localStorage.clear();
    window.location.href = '/';
  };

  const customerLaneItems = [
    { key: 'customerApproval', label: 'Customer Approval', icon: '✅' },
    { key: 'customerMint', label: 'Customer Mint Approval', icon: '🪙' },
    { key: 'customerTransferApproval', label: 'Customer Transfer Approval', icon: '🔁' },
    { key: 'customerRecords', label: 'Customer Records', icon: '📚' }
  ];

  const tokenLaneItems = [
    { key: 'tokenAccess', label: 'Token Access', icon: '🪙' },
    { key: 'fundManagement', label: 'Fund Management', icon: '💵' },
    { key: 'tokenTransfer', label: 'Token Transfer', icon: '💱' }
  ];

  const bankSetupLaneItems = [
    { key: 'tokenConfig', label: 'Token Configuration', icon: '⚙️' },
    { key: 'integrationRunbook', label: 'Integration Runbook', icon: '🧩' },
    { key: 'tokenHandshake', label: 'Token Handshake', icon: '🤝' }
  ];

  const toggleGroupMenu = group => {
    setIsCustomerMenuOpen(group === 'customer' ? !isCustomerMenuOpen : false);
    setIsTokenMenuOpen(group === 'token' ? !isTokenMenuOpen : false);
    setIsBankSetupMenuOpen(group === 'bankSetup' ? !isBankSetupMenuOpen : false);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#fff' }}>
      {/* Left Sidebar */}
      <div style={{
        width: '220px',
        backgroundColor: '#fff',
        borderRight: '1px solid #E0E0E0',
        padding: '20px 0',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={() => {
              setActiveLane('dashboard');
            }}
            style={{
              width: '100%',
              padding: '14px 0 14px 32px',
              border: 'none',
              backgroundColor: activeLane === 'dashboard' ? '#F5F5F5' : 'transparent',
              borderLeft: activeLane === 'dashboard' ? '4px solid #333' : '4px solid transparent',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              borderRadius: '0 8px 8px 0',
              fontSize: '15px',
              color: activeLane === 'dashboard' ? '#000' : '#666',
              fontWeight: activeLane === 'dashboard' ? 600 : 500
            }}
          >
            <span style={{ fontSize: '20px' }}>📊</span>
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => toggleGroupMenu('customer')}
            style={{
              width: '100%',
              padding: '14px 0 14px 32px',
              border: 'none',
              backgroundColor: 'transparent',
              borderLeft: '4px solid transparent',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: '0 8px 8px 0',
              fontSize: '15px',
              color: '#444',
              fontWeight: 700,
              paddingRight: '16px'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '20px' }}>👥</span>
              <span>Customer</span>
            </span>
            <span style={{ fontSize: '12px', color: '#777' }}>
              {isCustomerMenuOpen ? '▲' : '▼'}
            </span>
          </button>

          {isCustomerMenuOpen ? (
            <div style={{ display: 'grid', gap: '6px' }}>
              {customerLaneItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => {
                    setActiveLane(item.key);
                    setIsCustomerMenuOpen(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '12px 0 12px 44px',
                    border: 'none',
                    backgroundColor: activeLane === item.key ? '#F5F5F5' : 'transparent',
                    borderLeft: activeLane === item.key ? '4px solid #333' : '4px solid transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    borderRadius: '0 8px 8px 0',
                    fontSize: '14px',
                    color: activeLane === item.key ? '#000' : '#666',
                    fontWeight: activeLane === item.key ? 600 : 500
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          <button
            onClick={() => toggleGroupMenu('token')}
            style={{
              width: '100%',
              padding: '14px 0 14px 32px',
              border: 'none',
              backgroundColor: 'transparent',
              borderLeft: '4px solid transparent',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: '0 8px 8px 0',
              fontSize: '15px',
              color: '#444',
              fontWeight: 700,
              paddingRight: '16px'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '20px' }}>🔐</span>
              <span>Token</span>
            </span>
            <span style={{ fontSize: '12px', color: '#777' }}>
              {isTokenMenuOpen ? '▲' : '▼'}
            </span>
          </button>

          {isTokenMenuOpen ? (
            <div style={{ display: 'grid', gap: '6px' }}>
              {tokenLaneItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => {
                    setActiveLane(item.key);
                    setIsTokenMenuOpen(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '12px 0 12px 44px',
                    border: 'none',
                    backgroundColor: activeLane === item.key ? '#F5F5F5' : 'transparent',
                    borderLeft: activeLane === item.key ? '4px solid #333' : '4px solid transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    borderRadius: '0 8px 8px 0',
                    fontSize: '14px',
                    color: activeLane === item.key ? '#000' : '#666',
                    fontWeight: activeLane === item.key ? 600 : 500
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}

          <button
            onClick={() => toggleGroupMenu('bankSetup')}
            style={{
              width: '100%',
              padding: '14px 0 14px 32px',
              border: 'none',
              backgroundColor: 'transparent',
              borderLeft: '4px solid transparent',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: '0 8px 8px 0',
              fontSize: '15px',
              color: '#444',
              fontWeight: 700,
              paddingRight: '16px'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span style={{ fontSize: '20px' }}>🛠️</span>
              <span>Bank Setup</span>
            </span>
            <span style={{ fontSize: '12px', color: '#777' }}>
              {isBankSetupMenuOpen ? '▲' : '▼'}
            </span>
          </button>

          {isBankSetupMenuOpen ? (
            <div style={{ display: 'grid', gap: '6px' }}>
              {bankSetupLaneItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => {
                    setActiveLane(item.key);
                    setIsBankSetupMenuOpen(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '12px 0 12px 44px',
                    border: 'none',
                    backgroundColor: activeLane === item.key ? '#F5F5F5' : 'transparent',
                    borderLeft: activeLane === item.key ? '4px solid #333' : '4px solid transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    borderRadius: '0 8px 8px 0',
                    fontSize: '14px',
                    color: activeLane === item.key ? '#000' : '#666',
                    fontWeight: activeLane === item.key ? 600 : 500
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{
          backgroundColor: '#fff',
          borderBottom: '1px solid #E0E0E0',
          padding: '0 40px',
          height: '82px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '20px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <img
              src="/betweenetwork-logo.svg"
              alt="Betweenetwork logo"
              style={{ width: '46px', height: '46px', objectFit: 'contain' }}
            />
            <span style={{ fontSize: '28px', fontWeight: 700, color: '#111' }}>
              Betweenetwork
            </span>
          </div>
          <button
            onClick={handleSignOut}
            style={{
              padding: '8px 16px',
              border: '1px solid #DDD',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
              backgroundColor: 'white',
              color: '#D32F2F',
              fontWeight: '500'
            }}
          >
            Sign Out
          </button>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, padding: '40px', overflowY: 'auto', backgroundColor: '#fff' }}>
          {/* Dashboard Lane */}
          {activeLane === 'dashboard' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                Dashboard
              </h2>

              {/* Stats Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px'
              }}>
                <div style={{
                  backgroundColor: '#F5F5F5',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #EFEFEF'
                }}>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#999', fontWeight: '500', textTransform: 'uppercase' }}>
                    Total Customers
                  </p>
                  <p style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: '#000' }}>
                    {stats.totalCustomers}
                  </p>
                </div>
                <div style={{
                  backgroundColor: '#E8F5E9',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #C8E6C9'
                }}>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#558B2F', fontWeight: '500', textTransform: 'uppercase' }}>
                    KYC Verified
                  </p>
                  <p style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: '#2E7D32' }}>
                    {stats.kycVerified}
                  </p>
                </div>
                <div style={{
                  backgroundColor: '#FFF3E0',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #FFE0B2'
                }}>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#8A6D1F', fontWeight: '500', textTransform: 'uppercase' }}>
                    Suspicious
                  </p>
                  <p style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: '#F57F17' }}>
                    {stats.suspicious}
                  </p>
                </div>
                <div style={{
                  backgroundColor: '#F0F0F0',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #E0E0E0'
                }}>
                  <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#666', fontWeight: '500', textTransform: 'uppercase' }}>
                    Inactive
                  </p>
                  <p style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: '#555' }}>
                    {stats.inactive}
                  </p>
                </div>
              </div>

              {/* Wallet Info */}
              {wallet.data && (
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '24px',
                  border: '1px solid #EFEFEF',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#000' }}>
                    Bank Account
                  </h3>
                  <div style={{ display: 'grid', gap: '16px' }}>
                    <div>
                      <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#999', fontWeight: '500' }}>Balance</p>
                      <p style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: '#000' }}>
                        {wallet.data?.walletBalanceDisplay || wallet.data?.wallet_balance_display || '—'}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#999', fontWeight: '500' }}>Bank BIC</p>
                      <p style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#000' }}>
                        {resolveWalletBIC(wallet.data)}
                      </p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#999', fontWeight: '500' }}>BIC Code</p>
                      <p style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#000' }}>
                        {resolveWalletBIC(wallet.data)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Token Access Lane */}
          {activeLane === 'tokenAccess' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                Token Access
              </h2>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Request Token Access</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <input
                    value={tokenAccessForm.institutionID}
                    onChange={event => setTokenAccessForm(prev => ({ ...prev, institutionID: event.target.value }))}
                    placeholder="Institution ID (BIC11)"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenAccessForm.institutionName}
                    onChange={event => setTokenAccessForm(prev => ({ ...prev, institutionName: event.target.value }))}
                    placeholder="Institution name"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenAccessForm.countryCode}
                    onChange={event => setTokenAccessForm(prev => ({ ...prev, countryCode: event.target.value }))}
                    placeholder="Country code (e.g. US)"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenAccessForm.currencyCode}
                    onChange={event => setTokenAccessForm(prev => ({ ...prev, currencyCode: event.target.value }))}
                    placeholder="Currency code (e.g. INR)"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenAccessForm.reference}
                    onChange={event => setTokenAccessForm(prev => ({ ...prev, reference: event.target.value }))}
                    placeholder="Reference (optional)"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleRequestTokenAccess}
                    disabled={tokenAccessRequestState.loading}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: tokenAccessRequestState.loading ? 'not-allowed' : 'pointer',
                      opacity: tokenAccessRequestState.loading ? 0.7 : 1
                    }}
                  >
                    {tokenAccessRequestState.loading ? 'Submitting...' : 'Request Token Access'}
                  </button>
                  {tokenAccessRequestState.message ? (
                    <span style={{ color: '#2E7D32', fontSize: '13px', fontWeight: 600 }}>{tokenAccessRequestState.message}</span>
                  ) : null}
                  {tokenAccessRequestState.error ? (
                    <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{tokenAccessRequestState.error}</span>
                  ) : null}
                </div>
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Get Token Access</h3>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleGetTokenAccess}
                    disabled={tokenAccessStatusState.loading}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: tokenAccessStatusState.loading ? 'not-allowed' : 'pointer',
                      opacity: tokenAccessStatusState.loading ? 0.7 : 1
                    }}
                  >
                    {tokenAccessStatusState.loading ? 'Fetching...' : 'Get Token Access'}
                  </button>
                  {tokenAccessStatusState.error ? (
                    <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{tokenAccessStatusState.error}</span>
                  ) : null}
                </div>
                {tokenAccessStatusState.data ? (
                  <pre style={{
                    margin: 0,
                    padding: '12px',
                    backgroundColor: '#F7F7F7',
                    borderRadius: '8px',
                    border: '1px solid #ECECEC',
                    fontSize: '12px',
                    color: '#333',
                    overflowX: 'auto'
                  }}>
                    {JSON.stringify(tokenAccessStatusState.data, null, 2)}
                  </pre>
                ) : null}
              </div>
            </div>
          )}

          {/* Fund Management Lane */}
          {activeLane === 'fundManagement' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                Fund Management
              </h2>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Submit Mint Request</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                  <input
                    value={mintRequestForm.amount}
                    onChange={event => setMintRequestForm(prev => ({ ...prev, amount: event.target.value }))}
                    placeholder="Amount"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={mintRequestForm.tokenID}
                    onChange={event => setMintRequestForm(prev => ({ ...prev, tokenID: event.target.value }))}
                    placeholder="Token ID (optional)"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <select
                    value={mintRequestForm.purpose}
                    onChange={event => setMintRequestForm(prev => ({ ...prev, purpose: event.target.value }))}
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px', backgroundColor: '#fff' }}
                  >
                    <option value="WORKING_CAPITAL">WORKING_CAPITAL</option>
                    <option value="SETTLEMENT">SETTLEMENT</option>
                    <option value="LIQUIDITY">LIQUIDITY</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleSubmitMintRequest}
                    disabled={mintRequestState.loading}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: mintRequestState.loading ? 'not-allowed' : 'pointer',
                      opacity: mintRequestState.loading ? 0.7 : 1
                    }}
                  >
                    {mintRequestState.loading ? 'Submitting...' : 'Submit Mint Request'}
                  </button>
                  {mintRequestState.message ? (
                    <span style={{ color: '#2E7D32', fontSize: '13px', fontWeight: 600 }}>{mintRequestState.message}</span>
                  ) : null}
                  {mintRequestState.error ? (
                    <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{mintRequestState.error}</span>
                  ) : null}
                </div>
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>View Bank Wallet</h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                  Required: Bank must be logged in with a valid network address.
                </p>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={fetchWallet}
                    disabled={wallet.loading}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: wallet.loading ? 'not-allowed' : 'pointer',
                      opacity: wallet.loading ? 0.7 : 1
                    }}
                  >
                    {wallet.loading ? 'Loading...' : 'View Bank Wallet'}
                  </button>
                  <button
                    onClick={() => toggleRawView('fundWallet', 'bankWallet')}
                    disabled={!wallet.data}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#1E3A8A',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: !wallet.data ? 'not-allowed' : 'pointer',
                      opacity: !wallet.data ? 0.6 : 1
                    }}
                  >
                    {isRawViewOpen('fundWallet', 'bankWallet') ? 'Hide' : 'View'}
                  </button>
                  {wallet.error ? (
                    <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{wallet.error}</span>
                  ) : null}
                </div>
                {wallet.data ? (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '10px 12px' }}>
                        <p style={{ margin: '0 0 4px 0', color: '#64748B', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>Balance</p>
                        <p style={{ margin: 0, color: '#0F172A', fontSize: '18px', fontWeight: 700 }}>
                          {formatWalletBalanceDisplay(wallet.data)}
                        </p>
                      </div>
                      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '10px 12px' }}>
                        <p style={{ margin: '0 0 4px 0', color: '#64748B', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>Bank BIC</p>
                        <p style={{ margin: 0, color: '#0F172A', fontSize: '14px', fontWeight: 700 }}>
                          {resolveWalletBIC(wallet.data)}
                        </p>
                      </div>
                      <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '10px 12px' }}>
                        <p style={{ margin: '0 0 4px 0', color: '#64748B', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' }}>BIC Code</p>
                        <p style={{ margin: 0, color: '#0F172A', fontSize: '14px', fontWeight: 700 }}>
                          {resolveWalletBIC(wallet.data)}
                        </p>
                      </div>
                    </div>
                    {isRawViewOpen('fundWallet', 'bankWallet') ? (
                      <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                        {JSON.stringify(wallet.data, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Token Transfer Lane */}
          {activeLane === 'tokenTransfer' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                Token Transfer
              </h2>
              <p style={{ margin: '0', fontSize: '13px', color: '#666' }}>
                Required for approval: Request ID, Sender Token ID, Receiver Token ID, Amount.
              </p>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Initiate Transfer Request</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
                  <input
                    value={tokenTransferForm.senderTokenID}
                    onChange={event => setTokenTransferForm(prev => ({ ...prev, senderTokenID: event.target.value }))}
                    placeholder="Sender Token ID"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenTransferForm.receiverTokenID}
                    onChange={event => setTokenTransferForm(prev => ({ ...prev, receiverTokenID: event.target.value }))}
                    placeholder="Receiver Token ID"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenTransferForm.amount}
                    onChange={event => setTokenTransferForm(prev => ({ ...prev, amount: event.target.value }))}
                    placeholder="Amount"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleInitiateTokenTransferRequest}
                    disabled={tokenTransferRequestState.loading}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: tokenTransferRequestState.loading ? 'not-allowed' : 'pointer',
                      opacity: tokenTransferRequestState.loading ? 0.7 : 1
                    }}
                  >
                    {tokenTransferRequestState.loading ? 'Submitting...' : 'Initiate Transfer Request'}
                  </button>
                  {tokenTransferRequestState.message ? (
                    <span style={{ color: '#2E7D32', fontSize: '13px', fontWeight: 600 }}>{tokenTransferRequestState.message}</span>
                  ) : null}
                  {tokenTransferRequestState.error ? (
                    <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{tokenTransferRequestState.error}</span>
                  ) : null}
                </div>
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Pending Requests</h3>
                  <button
                    onClick={fetchPendingTokenTransferRequests}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '13px'
                    }}
                  >
                    Refresh
                  </button>
                </div>

                {pendingTokenTransferRequests.loading ? (
                  <p style={{ textAlign: 'center', color: '#999' }}>Loading pending requests...</p>
                ) : pendingTokenTransferRequests.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {pendingTokenTransferRequests.error}
                  </div>
                ) : pendingTokenTransferRequests.data.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                    No pending transfer requests
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {pendingTokenTransferRequests.data.map((item, idx) => {
                      const requestId = resolveRequestId(item);
                      const viewKey = requestId || `pending_token_transfer_${idx}`;
                      const isSubmitting = tokenTransferApproveRequestId === requestId;
                      const showRaw = isRawViewOpen('tokenTransferPending', viewKey);
                      return (
                        <div key={requestId || idx} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px', display: 'grid', gap: '8px' }}>
                          <p style={{ margin: 0, color: '#666', fontSize: '12px' }}>
                            Request ID: {truncateId(requestId, 40)}
                          </p>
                          <p style={{ margin: 0, color: '#222', fontSize: '13px' }}>
                            {item.senderTokenID || item.sender_token_id || '—'} → {item.receiverTokenID || item.receiver_token_id || '—'} | Amount: {formatBackendAmount(item)}
                          </p>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => handleApproveTokenTransferRequest(requestId)}
                              disabled={isSubmitting || !requestId}
                              style={{
                                width: 'fit-content',
                                padding: '10px 14px',
                                backgroundColor: '#2E7D32',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                opacity: isSubmitting ? 0.7 : 1
                              }}
                            >
                              {isSubmitting ? 'Approving...' : 'Approve Transfer'}
                            </button>
                            <button
                              onClick={() => toggleRawView('tokenTransferPending', viewKey)}
                              style={{
                                width: 'fit-content',
                                padding: '10px 14px',
                                backgroundColor: '#1E3A8A',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '13px',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              {showRaw ? 'Hide' : 'View'}
                            </button>
                          </div>
                          {showRaw ? (
                            <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                              {JSON.stringify(item, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Transfer History</h3>
                  <button
                    onClick={fetchTokenTransferLaneHistory}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '13px'
                    }}
                  >
                    Refresh
                  </button>
                </div>

                {tokenTransferLaneHistory.loading ? (
                  <p style={{ textAlign: 'center', color: '#999' }}>Loading transfer history...</p>
                ) : tokenTransferLaneHistory.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {tokenTransferLaneHistory.error}
                  </div>
                ) : tokenTransferLaneHistory.data.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                    No transfer history found
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {tokenTransferLaneHistory.data.map((item, idx) => (
                      <div key={item.request_id || item.transfer_id || idx} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px' }}>
                        <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                          {item.senderTokenID || item.sender_token_id || '—'} → {item.receiverTokenID || item.receiver_token_id || '—'}
                        </p>
                        <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                          Amount: {formatBackendAmount(item)} | {formatDate(item.timestamp || item.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Token Mint Records</h3>
                  <button
                    onClick={fetchTokenMintRecords}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '13px'
                    }}
                  >
                    Refresh
                  </button>
                </div>

                {tokenMintRecords.loading ? (
                  <p style={{ textAlign: 'center', color: '#999' }}>Loading token mint records...</p>
                ) : tokenMintRecords.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {tokenMintRecords.error}
                  </div>
                ) : tokenMintRecords.data.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                    No token mint records found
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {tokenMintRecords.data.map((item, idx) => {
                      const recordId = item.record_id || item.request_id || item.msg_id || `token_mint_${idx}`;
                      return (
                        <div key={recordId} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px', display: 'grid', gap: '6px' }}>
                          <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                            Record ID: {truncateId(recordId, 44)}
                          </p>
                          <p style={{ margin: 0, color: '#666', fontSize: '12px' }}>
                            Token: {item.token_id || '—'} | Amount: {formatAmountWithCurrency(item.amount || 0, item.currency || '')}
                          </p>
                          <p style={{ margin: 0, color: '#666', fontSize: '12px' }}>
                            Purpose: {item.purpose || '—'} | Status: {item.status || 'APPROVED'}
                          </p>
                          <p style={{ margin: 0, color: '#666', fontSize: '12px' }}>
                            Approved: {formatDate(item.approved_at || item.created_at)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Token Configuration Lane */}
          {activeLane === 'tokenConfig' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                Token Configuration
              </h2>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Configure Token</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
                  <input
                    value={tokenConfigForm.token_id}
                    onChange={event => setTokenConfigForm(prev => ({ ...prev, token_id: event.target.value }))}
                    placeholder="Token ID"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenConfigForm.bank_api_base_url}
                    onChange={event => setTokenConfigForm(prev => ({ ...prev, bank_api_base_url: event.target.value }))}
                    placeholder="Bank API Base URL"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenConfigForm.bank_auth_key}
                    onChange={event => setTokenConfigForm(prev => ({ ...prev, bank_auth_key: event.target.value }))}
                    placeholder="Bank Auth Key"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleConfigureToken}
                    disabled={tokenConfigSubmitState.loading}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: tokenConfigSubmitState.loading ? 'not-allowed' : 'pointer',
                      opacity: tokenConfigSubmitState.loading ? 0.7 : 1
                    }}
                  >
                    {tokenConfigSubmitState.loading ? 'Saving...' : 'Configure Token'}
                  </button>
                  {tokenConfigSubmitState.message ? <span style={{ color: '#2E7D32', fontSize: '13px', fontWeight: 600 }}>{tokenConfigSubmitState.message}</span> : null}
                  {tokenConfigSubmitState.error ? <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{tokenConfigSubmitState.error}</span> : null}
                </div>
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Get Token Configuration</h3>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <input
                    value={tokenConfigLookupTokenId}
                    onChange={event => setTokenConfigLookupTokenId(event.target.value)}
                    placeholder="Token ID"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px', minWidth: '220px' }}
                  />
                  <button
                    onClick={handleGetTokenConfiguration}
                    disabled={tokenConfigLookupState.loading}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: tokenConfigLookupState.loading ? 'not-allowed' : 'pointer',
                      opacity: tokenConfigLookupState.loading ? 0.7 : 1
                    }}
                  >
                    {tokenConfigLookupState.loading ? 'Fetching...' : 'Get Token Configuration'}
                  </button>
                </div>
                {tokenConfigLookupState.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {tokenConfigLookupState.error}
                  </div>
                ) : null}
                {tokenConfigLookupState.data ? (
                  <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                    {JSON.stringify(tokenConfigLookupState.data, null, 2)}
                  </pre>
                ) : null}
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>All Configurations</h3>
                  <button
                    onClick={fetchAllTokenConfigurations}
                    style={{ padding: '8px 14px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                  >
                    Refresh
                  </button>
                </div>
                {allTokenConfigsState.loading ? (
                  <p style={{ textAlign: 'center', color: '#999' }}>Loading configurations...</p>
                ) : allTokenConfigsState.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {allTokenConfigsState.error}
                  </div>
                ) : allTokenConfigsState.data.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                    No configurations found
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {allTokenConfigsState.data.map((cfg, idx) => (
                      <div key={cfg.token_id || cfg.tokenID || idx} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px' }}>
                        <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                          Token: {cfg.token_id || cfg.tokenID || '—'}
                        </p>
                        <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                          API URL: {cfg.bank_api_base_url || cfg.bankApiBaseUrl || '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Integration Runbook Lane */}
          {activeLane === 'integrationRunbook' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                Integration Runbook
              </h2>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Get Token Integration Details</h3>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <input
                    value={integrationTokenId}
                    onChange={event => setIntegrationTokenId(event.target.value)}
                    placeholder="Token ID"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px', minWidth: '220px' }}
                  />
                  <button
                    onClick={handleGetTokenIntegrationDetails}
                    disabled={integrationDetailsState.loading}
                    style={{ padding: '10px 14px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: integrationDetailsState.loading ? 'not-allowed' : 'pointer', opacity: integrationDetailsState.loading ? 0.7 : 1 }}
                  >
                    {integrationDetailsState.loading ? 'Fetching...' : 'Get Integration Details'}
                  </button>
                </div>
                {integrationDetailsState.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {integrationDetailsState.error}
                  </div>
                ) : null}
                {integrationDetailsState.data ? (
                  <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                    {JSON.stringify(integrationDetailsState.data, null, 2)}
                  </pre>
                ) : null}
              </div>

            </div>
          )}

          {/* Token Handshake Lane */}
          {activeLane === 'tokenHandshake' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                Token Handshake
              </h2>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Send Handshake Request</h3>
                <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                  Your token ID is auto-fetched from backend. Enter only the target token ID.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  <input
                    value={handshakeRequestForm.otherTokenID}
                    onChange={event => setHandshakeRequestForm(prev => ({ ...prev, otherTokenID: event.target.value }))}
                    placeholder="Target Token ID"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleSendHandshakeRequest}
                    disabled={handshakeRequestState.loading}
                    style={{ padding: '10px 14px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: handshakeRequestState.loading ? 'not-allowed' : 'pointer', opacity: handshakeRequestState.loading ? 0.7 : 1 }}
                  >
                    {handshakeRequestState.loading ? 'Sending...' : 'Send Handshake Request'}
                  </button>
                  {handshakeRequestState.message ? <span style={{ color: '#2E7D32', fontSize: '13px', fontWeight: 600 }}>{handshakeRequestState.message}</span> : null}
                  {handshakeRequestState.error ? <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{handshakeRequestState.error}</span> : null}
                </div>
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Pending Handshakes</h3>
                  <button
                    onClick={fetchPendingHandshakes}
                    style={{ padding: '8px 14px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                  >
                    Refresh
                  </button>
                </div>
                {approveHandshakeState.message ? <p style={{ margin: 0, color: '#2E7D32', fontSize: '13px', fontWeight: 600 }}>{approveHandshakeState.message}</p> : null}
                {approveHandshakeState.error ? <p style={{ margin: 0, color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{approveHandshakeState.error}</p> : null}
                {pendingHandshakesState.loading ? (
                  <p style={{ textAlign: 'center', color: '#999' }}>Loading pending handshakes...</p>
                ) : pendingHandshakesState.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {pendingHandshakesState.error}
                  </div>
                ) : pendingHandshakesState.data.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                    No pending handshakes
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {pendingHandshakesState.data.map((hs, idx) => {
                      const handshakeID =
                        hs.handshakeID ||
                        hs.handshakeId ||
                        hs.handshake_id ||
                        hs.HandshakeID ||
                        hs.id ||
                        hs.request_id ||
                        '';
                      const firstTokenID = hs.first_token_id || hs.firstTokenID || hs.FirstTokenID || hs.tokenA || '';
                      const secondTokenID = hs.second_token_id || hs.secondTokenID || hs.SecondTokenID || hs.tokenB || '';
                      const pendingStatus = hs.status || hs.Status || 'PENDING';
                      const isApproving = approveHandshakeState.loading && approveHandshakeId === handshakeID;
                      return (
                        <div key={handshakeID || idx} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px', display: 'grid', gap: '8px' }}>
                          <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                            Handshake ID: {truncateId(handshakeID || 'Not present', 44)}
                          </p>
                          <p style={{ margin: 0, color: '#666', fontSize: '13px' }}>
                            {firstTokenID || 'Token A'} ↔ {secondTokenID || 'Token B'}
                          </p>
                          <p style={{ margin: 0, color: '#666', fontSize: '12px' }}>
                            Status: {pendingStatus}
                          </p>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                              onClick={async () => {
                                setApproveHandshakeId(handshakeID);
                                await handleApproveHandshake(handshakeID);
                              }}
                              disabled={!handshakeID || isApproving}
                              style={{
                                padding: '8px 12px',
                                backgroundColor: '#2E7D32',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: !handshakeID || isApproving ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                fontSize: '12px',
                                opacity: !handshakeID || isApproving ? 0.7 : 1
                              }}
                            >
                              {isApproving ? 'Approving...' : 'Approve Handshake'}
                            </button>
                            <button
                              onClick={() => toggleRawView('pendingHandshakes', handshakeID || `idx_${idx}`)}
                              style={{
                                padding: '8px 12px',
                                backgroundColor: '#1E3A8A',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '12px'
                              }}
                            >
                              {isRawViewOpen('pendingHandshakes', handshakeID || `idx_${idx}`) ? 'Hide' : 'View'}
                            </button>
                          </div>
                          {isRawViewOpen('pendingHandshakes', handshakeID || `idx_${idx}`) ? (
                            <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                              {JSON.stringify(hs, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>All Handshakes</h3>
                  <button
                    onClick={fetchAllHandshakes}
                    style={{ padding: '8px 14px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                  >
                    Refresh
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                  Required details: Handshake ID, First Token ID, Second Token ID, Status, Approved By, Created At.
                </p>
                {allHandshakesState.loading ? (
                  <p style={{ textAlign: 'center', color: '#999' }}>Loading all handshakes...</p>
                ) : allHandshakesState.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {allHandshakesState.error}
                  </div>
                ) : allHandshakesState.data.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                    No handshakes found
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '10px' }}>
                    {allHandshakesState.data.map((hs, idx) => {
                      const handshakeID =
                        hs.handshakeID ||
                        hs.handshakeId ||
                        hs.HandshakeID ||
                        hs.id ||
                        hs.request_id ||
                        '';
                      const firstTokenID = hs.firstTokenID || hs.first_token_id || hs.FirstTokenID || hs.tokenA || '';
                      const secondTokenID = hs.secondTokenID || hs.second_token_id || hs.SecondTokenID || hs.tokenB || '';
                      const status = hs.status || hs.Status || 'Not present';
                      const approvedBy = hs.approvedBy || hs.approved_by || hs.ApprovedBy || 'Not present';
                      const createdAt = hs.createdAt || hs.created_at || hs.CreatedAt || '';
                      const viewKey = handshakeID || `all_hs_${idx}`;
                      const showRaw = isRawViewOpen('allHandshakes', viewKey);

                      return (
                        <div
                          key={viewKey}
                          style={{
                            backgroundColor: '#fff',
                            border: '1px solid #EAEAEA',
                            borderRadius: '12px',
                            padding: '14px',
                            display: 'grid',
                            gap: '10px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                            <div>
                              <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                                Handshake ID: {truncateId(handshakeID || 'Not present', 52)}
                              </p>
                              <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                                {firstTokenID || 'Token A'} ↔ {secondTokenID || 'Token B'}
                              </p>
                            </div>
                            <button
                              onClick={() => toggleRawView('allHandshakes', viewKey)}
                              style={{
                                padding: '8px 12px',
                                backgroundColor: '#1E3A8A',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '12px'
                              }}
                            >
                              {showRaw ? 'Hide' : 'View'}
                            </button>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', fontSize: '13px' }}>
                            <div>
                              <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>First Token ID</p>
                              <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                {firstTokenID || 'Not present'}
                              </p>
                            </div>
                            <div>
                              <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Second Token ID</p>
                              <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                {secondTokenID || 'Not present'}
                              </p>
                            </div>
                            <div>
                              <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Status</p>
                              <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                {status}
                              </p>
                            </div>
                            <div>
                              <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Created At</p>
                              <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                {formatDate(createdAt)}
                              </p>
                            </div>
                          </div>

                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Approved By</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600, fontSize: '12px' }}>
                              {truncateId(approvedBy, 80)}
                            </p>
                          </div>

                          {showRaw ? (
                            <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                              {JSON.stringify(hs, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Customer Approval Lane */}
          {activeLane === 'customerApproval' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                  Customer Approval
                </h2>
                <button
                  onClick={fetchPendingApprovals}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px'
                  }}
                >
                  Refresh
                </button>
              </div>
              <p style={{ margin: '0', fontSize: '13px', color: '#666' }}>
                Required for approval: Request ID, KYC ID, KYC status, status, created time, expiry time.
              </p>

              {pendingApprovals.loading ? (
                <p style={{ textAlign: 'center', color: '#999' }}>Loading pending registrations...</p>
              ) : pendingApprovals.error ? (
                <div style={{
                  padding: '12px',
                  backgroundColor: '#FFECEC',
                  borderRadius: '8px',
                  color: '#C62828',
                  fontSize: '12px'
                }}>
                  {pendingApprovals.error}
                </div>
              ) : pendingApprovals.data.length === 0 ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  backgroundColor: '#F5F5F5',
                  borderRadius: '12px',
                  color: '#999'
                }}>
                  No pending registrations
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '14px' }}>
                  {pendingApprovals.data.map((approval, idx) => {
                    const requestId = resolveCustomerRegistrationRequestId(approval);
                    const requestKey = requestId || approval.requestId || approval.id || `idx_${idx}`;
                    const detailsInput = resolveCustomerDetailsInputs(approval);
                    const canFetchDetails = Boolean(detailsInput.tokenID && detailsInput.customerID);
                    const isSubmitting = approvalActionRequestId === requestId;
                    const detailsState = customerDetailsByRequest[requestKey] || { loading: false, data: null, error: '' };
                    const showRaw = isRawViewOpen('customerApproval', requestKey);
                    const kycVerified = isKycVerified(approval);
                    const approvalStatus = resolveApprovalStatus(approval);
                    const createdAt = approval?.created_at || approval?.CreatedAt || approval?.timestamp || approval?.createdOn || '';
                    const expiresAt = resolveApprovalExpiresAt(approval);
                    return (
                      <div
                        key={requestKey}
                        style={{
                          backgroundColor: '#fff',
                          border: '1px solid #EAEAEA',
                          borderRadius: '12px',
                          padding: '16px',
                          display: 'grid',
                          gap: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start' }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '17px', color: '#111' }}>
                              {sanitizeCustomerApprovalTitle(approval)}
                            </h4>
                            <p style={{ margin: '8px 0 0 0', color: '#777', fontSize: '12px' }}>
                              Request ID: {truncateId(requestId, 40)}
                            </p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => handleFetchCustomerDetails(approval, requestKey)}
                              disabled={detailsState.loading || !canFetchDetails}
                              style={{
                                padding: '8px 12px',
                                backgroundColor: '#1E3A8A',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: detailsState.loading || !canFetchDetails ? 'not-allowed' : 'pointer',
                                opacity: detailsState.loading || !canFetchDetails ? 0.7 : 1
                              }}
                            >
                              {detailsState.loading ? 'Fetching...' : canFetchDetails ? 'Customer Details' : 'Not present'}
                            </button>
                            <span style={{
                              padding: '6px 10px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              backgroundColor: approvalStatus.includes('APPROV') || approvalStatus.includes('VERIF') ? '#E8F5E9' : '#FFF3E0',
                              color: approvalStatus.includes('APPROV') || approvalStatus.includes('VERIF') ? '#2E7D32' : '#B26A00',
                              fontWeight: 600
                            }}>
                              {approvalStatus}
                            </span>
                          </div>
                        </div>

                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '10px',
                          fontSize: '13px'
                        }}>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Bank BIC</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {resolveDisplayBIC(approval)}
                            </p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>KYC Status</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {kycVerified ? 'Verified' : 'Pending'}
                            </p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>KYC ID</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {truncateId(resolveCustomerKycId(approval), 34)}
                            </p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Status</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {approvalStatus}
                            </p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Created</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {formatDate(createdAt)}
                            </p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Expires</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {formatDate(expiresAt)}
                            </p>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button
                            onClick={() => handleApproveCustomer(requestId)}
                            disabled={isSubmitting || !requestId}
                            style={{
                              padding: '10px 14px',
                              backgroundColor: '#2E7D32',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: isSubmitting ? 'not-allowed' : 'pointer',
                              opacity: isSubmitting ? 0.7 : 1
                            }}
                          >
                            {isSubmitting ? 'Processing...' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleRejectCustomer(requestId)}
                            disabled={isSubmitting || !requestId}
                            style={{
                              padding: '10px 14px',
                              backgroundColor: '#C62828',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: isSubmitting ? 'not-allowed' : 'pointer',
                              opacity: isSubmitting ? 0.7 : 1
                            }}
                          >
                            {isSubmitting ? 'Processing...' : 'Reject'}
                          </button>
                          <button
                            onClick={() => toggleRawView('customerApproval', requestKey)}
                            style={{
                              padding: '10px 14px',
                              backgroundColor: '#1E3A8A',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            {showRaw ? 'Hide' : 'View'}
                          </button>
                        </div>

                        {detailsState.error ? (
                          <div style={{ padding: '10px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                            {detailsState.error}
                          </div>
                        ) : null}

                        {detailsState.data ? (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            <p style={{ margin: 0, fontSize: '12px', color: '#666', fontWeight: 600 }}>
                              Customer Details (Backend Response)
                            </p>
                            <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                              {JSON.stringify(redactNetworkAddressFields(detailsState.data), null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        {showRaw ? (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            <p style={{ margin: 0, fontSize: '12px', color: '#666', fontWeight: 600 }}>
                              Full Backend Payload
                            </p>
                            <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                              {JSON.stringify(redactNetworkAddressFields(approval), null, 2)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Approvals Lane */}
          {activeLane === 'approvals' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                  Pending Approvals
                </h2>
                <button
                  onClick={fetchPendingApprovals}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px'
                  }}
                >
                  Refresh
                </button>
              </div>

              {pendingApprovals.loading ? (
                <p style={{ textAlign: 'center', color: '#999' }}>Loading approvals...</p>
              ) : pendingApprovals.error ? (
                <div style={{
                  padding: '12px',
                  backgroundColor: '#FFECEC',
                  borderRadius: '8px',
                  color: '#C62828',
                  fontSize: '12px'
                }}>
                  {pendingApprovals.error}
                </div>
              ) : pendingApprovals.data.length === 0 ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  backgroundColor: '#F5F5F5',
                  borderRadius: '12px',
                  color: '#999'
                }}>
                  No pending approvals
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '16px' }}>
                  {pendingApprovals.data.map((approval, idx) => {
                    const requestId = resolveCustomerRegistrationRequestId(approval);
                    const requestKey = requestId || approval.requestId || approval.id || `approvals_${idx}`;
                    const detailsInput = resolveCustomerDetailsInputs(approval);
                    const canFetchDetails = Boolean(detailsInput.tokenID && detailsInput.customerID);
                    const detailsState = customerDetailsByRequest[requestKey] || { loading: false, data: null, error: '' };
                    return (
                    <div
                      key={requestKey}
                      style={{
                        backgroundColor: 'white',
                        borderRadius: '12px',
                        padding: '20px',
                        border: '1px solid #EFEFEF',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                        <div>
                          <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600', color: '#000' }}>
                            {approval.name || 'Unknown'}
                          </h4>
                          <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
                            Request ID: {truncateId(requestId, 30)}
                          </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            onClick={() => handleFetchCustomerDetails(approval, requestKey)}
                            disabled={detailsState.loading || !canFetchDetails}
                            style={{
                              padding: '8px 12px',
                              backgroundColor: '#1E3A8A',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: detailsState.loading || !canFetchDetails ? 'not-allowed' : 'pointer',
                              opacity: detailsState.loading || !canFetchDetails ? 0.7 : 1
                            }}
                          >
                            {detailsState.loading ? 'Fetching...' : canFetchDetails ? 'Customer Details' : 'Not present'}
                          </button>
                          <span style={{
                            padding: '6px 12px',
                            backgroundColor: '#FFF3E0',
                            color: '#F57F17',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '600'
                          }}>
                            🟡 Pending
                          </span>
                        </div>
                      </div>

                      <div style={{
                        backgroundColor: '#F5F5F5',
                        borderRadius: '8px',
                        padding: '12px',
                        marginBottom: '16px',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '12px',
                        fontSize: '13px'
                      }}>
                        <div>
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#999', fontWeight: '500' }}>Bank BIC</p>
                          <p style={{ margin: 0, color: '#333', fontWeight: '600' }}>
                            {resolveDisplayBIC(approval)}
                          </p>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#999', fontWeight: '500' }}>KYC Status</p>
                          <p style={{ margin: 0, color: '#2E7D32', fontWeight: '600' }}>
                            {approval.kyc_status === 'verified' ? '✅ Verified' : '⏳ Pending'}
                          </p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        {(() => {
                          return (
                            <>
                        <button
                          onClick={() => handleApproveCustomer(requestId)}
                          disabled={approvalActionRequestId === requestId || !requestId}
                          style={{
                            flex: 1,
                            padding: '10px',
                            backgroundColor: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '13px'
                          }}
                        >
                          ✅ Approve
                        </button>
                        <button
                          onClick={() => handleRejectCustomer(requestId)}
                          disabled={approvalActionRequestId === requestId || !requestId}
                          style={{
                            flex: 1,
                            padding: '10px',
                            backgroundColor: '#F44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontSize: '13px'
                          }}
                        >
                          ❌ Reject
                        </button>
                            </>
                          );
                        })()}
                      </div>
                      {detailsState.error ? (
                        <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                          {detailsState.error}
                        </div>
                      ) : null}
                      {detailsState.data ? (
                        <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
                          <p style={{ margin: 0, fontSize: '12px', color: '#666', fontWeight: 600 }}>
                            Customer Details (Backend Response)
                          </p>
                          <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                            {JSON.stringify(detailsState.data, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  )})}
                </div>
              )}
            </div>
          )}

          {/* Customer Mint Approval Lane */}
          {activeLane === 'customerMint' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                  Customer Mint Approval
                </h2>
                <button
                  onClick={fetchPendingMintApprovals}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#333',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '14px'
                  }}
                >
                  Refresh
                </button>
              </div>
              <p style={{ margin: '0', fontSize: '13px', color: '#666' }}>
                Required for mint decision: Request ID, Token ID, Amount.
              </p>

              {pendingMintApprovals.loading ? (
                <p style={{ textAlign: 'center', color: '#999' }}>Loading pending mint requests...</p>
              ) : pendingMintApprovals.error ? (
                <div style={{
                  padding: '12px',
                  backgroundColor: '#FFECEC',
                  borderRadius: '8px',
                  color: '#C62828',
                  fontSize: '12px'
                }}>
                  {pendingMintApprovals.error}
                </div>
              ) : pendingMintApprovals.data.length === 0 ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  backgroundColor: '#F5F5F5',
                  borderRadius: '12px',
                  color: '#999'
                }}>
                  No pending mint requests
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '14px' }}>
                  {pendingMintApprovals.data.map((mintRequest, idx) => {
                    const requestId = resolveRequestId(mintRequest);
                    const mintTokenId =
                      mintRequest.token_id ||
                      mintRequest.tokenID ||
                      mintRequest.tokenId ||
                      mintRequest.TokenID ||
                      '';
                    const viewKey = requestId || `pending_mint_${idx}`;
                    const isSubmitting = mintApprovalActionRequestId === requestId;
                    const detailsInput = resolveCustomerDetailsInputs(mintRequest);
                    const canFetchDetails = Boolean(detailsInput.tokenID && detailsInput.customerID);
                    const detailsState = customerDetailsByRequest[viewKey] || { loading: false, data: null, error: '' };
                    const showRaw = isRawViewOpen('customerMintApproval', viewKey);
                    return (
                      <div
                        key={requestId || idx}
                        style={{
                          backgroundColor: '#fff',
                          border: '1px solid #EAEAEA',
                          borderRadius: '12px',
                          padding: '16px',
                          display: 'grid',
                          gap: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start' }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '17px', color: '#111' }}>
                              {mintRequest.name || mintRequest.customer_name || mintRequest.customer_ref || mintRequest.customer_id || 'Customer'}
                            </h4>
                            <p style={{ margin: '8px 0 0 0', color: '#777', fontSize: '12px' }}>
                              Request ID: {truncateId(requestId, 40)}
                            </p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => handleFetchCustomerDetails(mintRequest, viewKey)}
                              disabled={detailsState.loading || !canFetchDetails}
                              style={{
                                padding: '8px 12px',
                                backgroundColor: '#1E3A8A',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: detailsState.loading || !canFetchDetails ? 'not-allowed' : 'pointer',
                                opacity: detailsState.loading || !canFetchDetails ? 0.7 : 1
                              }}
                            >
                              {detailsState.loading ? 'Fetching...' : canFetchDetails ? 'Customer Details' : 'Not present'}
                            </button>
                            <span style={{
                              padding: '6px 10px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              backgroundColor: '#FFF3E0',
                              color: '#B26A00',
                              fontWeight: 600
                            }}>
                              Pending
                            </span>
                          </div>
                        </div>

                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '10px',
                          fontSize: '13px'
                        }}>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Amount</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {formatBackendAmount(mintRequest)}
                            </p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Token ID</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {mintRequest.token_id || mintRequest.tokenID || '—'}
                            </p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Created</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {formatDate(mintRequest.created_at || mintRequest.timestamp)}
                            </p>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button
                            onClick={() => handleApproveMintRequest(requestId, mintTokenId)}
                            disabled={isSubmitting || !requestId}
                            style={{
                              padding: '10px 14px',
                              backgroundColor: '#2E7D32',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: isSubmitting ? 'not-allowed' : 'pointer',
                              opacity: isSubmitting ? 0.7 : 1
                            }}
                          >
                            {isSubmitting ? 'Processing...' : 'Approve Mint Request'}
                          </button>
                          <button
                            onClick={() => handleRejectMintRequest(requestId, mintTokenId)}
                            disabled={isSubmitting || !requestId}
                            style={{
                              padding: '10px 14px',
                              backgroundColor: '#C62828',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: isSubmitting ? 'not-allowed' : 'pointer',
                              opacity: isSubmitting ? 0.7 : 1
                            }}
                          >
                            {isSubmitting ? 'Processing...' : 'Reject Mint Request'}
                          </button>
                          <button
                            onClick={() => toggleRawView('customerMintApproval', viewKey)}
                            style={{
                              padding: '10px 14px',
                              backgroundColor: '#1E3A8A',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '13px',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            {showRaw ? 'Hide' : 'View'}
                          </button>
                        </div>
                        {detailsState.error ? (
                          <div style={{ padding: '10px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                            {detailsState.error}
                          </div>
                        ) : null}
                        {detailsState.data ? (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            <p style={{ margin: 0, fontSize: '12px', color: '#666', fontWeight: 600 }}>
                              Customer Details (Backend Response)
                            </p>
                            <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                              {JSON.stringify(detailsState.data, null, 2)}
                            </pre>
                          </div>
                        ) : null}
                        {showRaw ? (
                          <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                            {JSON.stringify(mintRequest, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Customer Transfer Approval Lane */}
          {activeLane === 'customerTransferApproval' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                  Customer Transfer Approval
                </h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setTransferApprovalView('sender')}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: transferApprovalView === 'sender' ? '#333' : 'white',
                      color: transferApprovalView === 'sender' ? 'white' : '#333',
                      border: transferApprovalView === 'sender' ? 'none' : '1px solid #DDD',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '14px'
                    }}
                  >
                    Sender
                  </button>
                  <button
                    onClick={() => setTransferApprovalView('receiver')}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: transferApprovalView === 'receiver' ? '#333' : 'white',
                      color: transferApprovalView === 'receiver' ? 'white' : '#333',
                      border: transferApprovalView === 'receiver' ? 'none' : '1px solid #DDD',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '14px'
                    }}
                  >
                    Receiver
                  </button>
                  <button
                    onClick={() => {
                      if (transferApprovalView === 'sender') {
                        fetchPendingSenderTransfers();
                      } else {
                        fetchPendingReceiverTransfers();
                      }
                    }}
                    style={{
                      padding: '10px 16px',
                      backgroundColor: '#333',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '14px'
                    }}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              <p style={{ margin: '0', fontSize: '13px', color: '#666' }}>
                Required for transfer decision: Request ID, Sender Token ID, Receiver Token ID, Amount.
              </p>

              {transferApprovalView === 'sender' ? (
                <div style={{ display: 'grid', gap: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '22px', fontWeight: '600', color: '#111' }}>
                    Sender Side Pending
                  </h3>
                  {pendingSenderTransfers.loading ? (
                    <p style={{ textAlign: 'center', color: '#999' }}>Loading sender pending transfers...</p>
                  ) : pendingSenderTransfers.error ? (
                    <div style={{
                      padding: '12px',
                      backgroundColor: '#FFECEC',
                      borderRadius: '8px',
                      color: '#C62828',
                      fontSize: '12px'
                    }}>
                      {pendingSenderTransfers.error}
                    </div>
                  ) : pendingSenderTransfers.data.length === 0 ? (
                    <div style={{
                      padding: '24px',
                      textAlign: 'center',
                      backgroundColor: '#F5F5F5',
                      borderRadius: '12px',
                      color: '#999'
                    }}>
                      No sender-side pending transfers
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {pendingSenderTransfers.data.map((transfer, idx) => {
                        const requestId = resolveRequestId(transfer);
                        const viewKey = requestId || `sender_pending_${idx}`;
                        const isSubmitting = senderApprovalAction.requestId === requestId;
                        const isApproving = isSubmitting && senderApprovalAction.status === 'approved';
                        const isRejecting = isSubmitting && senderApprovalAction.status === 'rejected';
                        const showRaw = isRawViewOpen('senderTransferApproval', viewKey);
                        const senderToken = transfer.senderTokenID || transfer.sender_token_id || transfer.SenderTokenID || 'Not present';
                        const receiverToken = transfer.receiverTokenID || transfer.receiver_token_id || transfer.ReceiverTokenID || 'Not present';
                        const senderCustomerTokenId =
                          transfer.sender_customer_token_id ||
                          transfer.SenderCustomerTokenID ||
                          transfer.senderCustomerTokenID ||
                          transfer.sender_customer_token ||
                          transfer.senderCustomerToken ||
                          'Not present';
                        const receiverCustomerTokenId =
                          transfer.receiver_customer_token_id ||
                          transfer.ReceiverCustomerTokenID ||
                          transfer.receiverCustomerTokenID ||
                          transfer.receiver_customer_token ||
                          transfer.receiverCustomerToken ||
                          'Not present';
                        const senderCurrency = transfer.sender_currency || transfer.SenderCurrency || 'Not present';
                        const receiverCurrency = transfer.receiver_currency || transfer.ReceiverCurrency || 'Not present';
                        const createdAt = transfer.created_at || transfer.CreatedAt || transfer.timestamp || '';
                        const transferStatus = transfer.status || transfer.Status || 'Pending';
                        return (
                          <div
                            key={requestId || idx}
                            style={{
                              backgroundColor: '#fff',
                              border: '1px solid #EAEAEA',
                              borderRadius: '12px',
                              padding: '14px',
                              display: 'grid',
                              gap: '10px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#222', fontWeight: 600, fontSize: '14px' }}>
                                  Transfer Request ID: {truncateId(requestId || 'Not present', 44)}
                                </p>
                                <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                                  Status: {transferStatus}
                                </p>
                              </div>
                              <span style={{
                                padding: '6px 10px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                backgroundColor: '#FFF3E0',
                                color: '#B26A00',
                                fontWeight: 600
                              }}>
                                Sender Pending
                              </span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', fontSize: '13px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>From Token</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{senderToken}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>To Token</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{receiverToken}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Sender Customer Token ID</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{truncateId(senderCustomerTokenId, 42)}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Receiver Customer Token ID</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{truncateId(receiverCustomerTokenId, 42)}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Sender Currency</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{senderCurrency}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Receiver Currency</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{receiverCurrency}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Amount</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{formatBackendAmount(transfer)}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Created</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{formatDate(createdAt)}</p>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button
                                onClick={() => handleApproveSenderTransfer(requestId)}
                                disabled={isSubmitting || !requestId}
                                style={{
                                  padding: '10px 14px',
                                  backgroundColor: '#2E7D32',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                  opacity: isSubmitting ? 0.7 : 1
                                }}
                              >
                                {isApproving ? 'Approving...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => handleRejectSenderTransfer(requestId)}
                                disabled={isSubmitting || !requestId}
                                style={{
                                  padding: '10px 14px',
                                  backgroundColor: '#C62828',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                  opacity: isSubmitting ? 0.7 : 1
                                }}
                              >
                                {isRejecting ? 'Rejecting...' : 'Reject'}
                              </button>
                              <button
                                onClick={() => toggleRawView('senderTransferApproval', viewKey)}
                                style={{
                                  padding: '10px 14px',
                                  backgroundColor: '#1E3A8A',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                {showRaw ? 'Hide' : 'View'}
                              </button>
                            </div>
                            {showRaw ? (
                              <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                {JSON.stringify(transfer, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '22px', fontWeight: '600', color: '#111' }}>
                    Receiver Side Pending
                  </h3>
                  {pendingReceiverTransfers.loading ? (
                    <p style={{ textAlign: 'center', color: '#999' }}>Loading receiver pending transfers...</p>
                  ) : pendingReceiverTransfers.error ? (
                    <div style={{
                      padding: '12px',
                      backgroundColor: '#FFECEC',
                      borderRadius: '8px',
                      color: '#C62828',
                      fontSize: '12px'
                    }}>
                      {pendingReceiverTransfers.error}
                    </div>
                  ) : pendingReceiverTransfers.data.length === 0 ? (
                    <div style={{
                      padding: '24px',
                      textAlign: 'center',
                      backgroundColor: '#F5F5F5',
                      borderRadius: '12px',
                      color: '#999'
                    }}>
                      No receiver-side pending transfers
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {pendingReceiverTransfers.data.map((transfer, idx) => {
                        const requestId = resolveRequestId(transfer);
                        const viewKey = requestId || `receiver_pending_${idx}`;
                        const isSubmitting = receiverApprovalAction.requestId === requestId;
                        const isApproving = isSubmitting && receiverApprovalAction.status === 'approved';
                        const isRejecting = isSubmitting && receiverApprovalAction.status === 'rejected';
                        const showRaw = isRawViewOpen('receiverTransferApproval', viewKey);
                        const senderToken = transfer.senderTokenID || transfer.sender_token_id || transfer.SenderTokenID || 'Not present';
                        const receiverToken = transfer.receiverTokenID || transfer.receiver_token_id || transfer.ReceiverTokenID || 'Not present';
                        const senderCustomerTokenId =
                          transfer.sender_customer_token_id ||
                          transfer.SenderCustomerTokenID ||
                          transfer.senderCustomerTokenID ||
                          transfer.sender_customer_token ||
                          transfer.senderCustomerToken ||
                          'Not present';
                        const receiverCustomerTokenId =
                          transfer.receiver_customer_token_id ||
                          transfer.ReceiverCustomerTokenID ||
                          transfer.receiverCustomerTokenID ||
                          transfer.receiver_customer_token ||
                          transfer.receiverCustomerToken ||
                          'Not present';
                        const senderCurrency = transfer.sender_currency || transfer.SenderCurrency || 'Not present';
                        const receiverCurrency = transfer.receiver_currency || transfer.ReceiverCurrency || 'Not present';
                        const createdAt = transfer.created_at || transfer.CreatedAt || transfer.timestamp || '';
                        const transferStatus = transfer.status || transfer.Status || 'Pending';
                        return (
                          <div
                            key={requestId || idx}
                            style={{
                              backgroundColor: '#fff',
                              border: '1px solid #EAEAEA',
                              borderRadius: '12px',
                              padding: '14px',
                              display: 'grid',
                              gap: '10px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#222', fontWeight: 600, fontSize: '14px' }}>
                                  Transfer Request ID: {truncateId(requestId || 'Not present', 44)}
                                </p>
                                <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                                  Status: {transferStatus}
                                </p>
                              </div>
                              <span style={{
                                padding: '6px 10px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                backgroundColor: '#FFF3E0',
                                color: '#B26A00',
                                fontWeight: 600
                              }}>
                                Receiver Pending
                              </span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', fontSize: '13px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>From Token</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{senderToken}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>To Token</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{receiverToken}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Sender Customer Token ID</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{truncateId(senderCustomerTokenId, 42)}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Receiver Customer Token ID</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{truncateId(receiverCustomerTokenId, 42)}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Sender Currency</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{senderCurrency}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Receiver Currency</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{receiverCurrency}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Amount</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{formatBackendAmount(transfer)}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Created</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{formatDate(createdAt)}</p>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button
                                onClick={() => handleApproveReceiverTransfer(requestId)}
                                disabled={isSubmitting || !requestId}
                                style={{
                                  padding: '10px 14px',
                                  backgroundColor: '#2E7D32',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                  opacity: isSubmitting ? 0.7 : 1
                                }}
                              >
                                {isApproving ? 'Approving...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => handleRejectReceiverTransfer(requestId)}
                                disabled={isSubmitting || !requestId}
                                style={{
                                  padding: '10px 14px',
                                  backgroundColor: '#C62828',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                  opacity: isSubmitting ? 0.7 : 1
                                }}
                              >
                                {isRejecting ? 'Rejecting...' : 'Reject'}
                              </button>
                              <button
                                onClick={() => toggleRawView('receiverTransferApproval', viewKey)}
                                style={{
                                  padding: '10px 14px',
                                  backgroundColor: '#1E3A8A',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                {showRaw ? 'Hide' : 'View'}
                              </button>
                            </div>
                            {showRaw ? (
                              <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                {JSON.stringify(transfer, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Customer Records Lane */}
          {activeLane === 'customerRecords' && (
            <div style={{ display: 'grid', gap: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '32px', fontWeight: '600', color: '#000' }}>
                  Customer Records
                </h2>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setRecordsView('approvedParticipants')}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: recordsView === 'approvedParticipants' ? '#333' : 'white',
                      color: recordsView === 'approvedParticipants' ? 'white' : '#333',
                      border: recordsView === 'approvedParticipants' ? 'none' : '1px solid #DDD',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '13px'
                    }}
                  >
                    Approved Participants
                  </button>
                  <button
                    onClick={() => setRecordsView('approvedMintRequests')}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: recordsView === 'approvedMintRequests' ? '#333' : 'white',
                      color: recordsView === 'approvedMintRequests' ? 'white' : '#333',
                      border: recordsView === 'approvedMintRequests' ? 'none' : '1px solid #DDD',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '13px'
                    }}
                  >
                    Approved Mint Requests
                  </button>
                  <button
                    onClick={() => setRecordsView('tokenTransferHistory')}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: recordsView === 'tokenTransferHistory' ? '#333' : 'white',
                      color: recordsView === 'tokenTransferHistory' ? 'white' : '#333',
                      border: recordsView === 'tokenTransferHistory' ? 'none' : '1px solid #DDD',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '13px'
                    }}
                  >
                    Token Transfer History
                  </button>
                  <button
                    onClick={() => setRecordsView('customerToTokenHistory')}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: recordsView === 'customerToTokenHistory' ? '#333' : 'white',
                      color: recordsView === 'customerToTokenHistory' ? 'white' : '#333',
                      border: recordsView === 'customerToTokenHistory' ? 'none' : '1px solid #DDD',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '13px'
                    }}
                  >
                    Customer-to-Token Transfers History
                  </button>
                </div>
              </div>

              {recordsView === 'approvedParticipants' && (
                <div style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '22px', color: '#111' }}>Approved Participants</h3>
                    <button
                      onClick={fetchApprovedParticipantsRecords}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: '#333',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '13px'
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                    Required details: Message ID, Customer Network Address, KYC status, Approval time.
                  </p>
                  {approvedParticipantsRecords.loading ? (
                    <p style={{ textAlign: 'center', color: '#999' }}>Loading approved participants...</p>
                  ) : approvedParticipantsRecords.error ? (
                    <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                      {approvedParticipantsRecords.error}
                    </div>
                  ) : approvedParticipantsRecords.data.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                      No approved participants found
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {approvedParticipantsRecords.data.map((item, idx) => {
                        const participantKey =
                          item.customer_ref ||
                          item.customer_id ||
                          item.customerId ||
                          resolveCustomerRegistrationRequestId(item) ||
                          item.username ||
                          `approved_participant_${idx}`;
                        const msgId = resolveCustomerRegistrationRequestId(item);
                        const detailsInput = resolveCustomerDetailsInputs(item);
                        const canFetchDetails = Boolean(detailsInput.tokenID && detailsInput.customerID);
                        const detailsState = customerDetailsByRequest[String(participantKey)] || { loading: false, data: null, error: '' };
                        const showRaw = isRawViewOpen('approvedParticipantsRecords', String(participantKey));
                        return (
                          <div key={participantKey} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px', display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                                  Msg ID: {truncateId(msgId || 'Not present', 40)}
                                </p>
                                <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                                  Customer Network Address: {truncateId(resolveCustomerNetworkAddress(item), 40)}
                                </p>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button
                                  onClick={() => handleFetchCustomerDetails(item, String(participantKey))}
                                  disabled={detailsState.loading || !canFetchDetails}
                                  style={{
                                    padding: '8px 12px',
                                    backgroundColor: '#1E3A8A',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: detailsState.loading || !canFetchDetails ? 'not-allowed' : 'pointer',
                                    opacity: detailsState.loading || !canFetchDetails ? 0.7 : 1
                                  }}
                                >
                                  {detailsState.loading ? 'Fetching...' : canFetchDetails ? 'Customer Details' : 'Not present'}
                                </button>
                                <button
                                  onClick={() => toggleRawView('approvedParticipantsRecords', String(participantKey))}
                                  style={{
                                    padding: '8px 12px',
                                    backgroundColor: '#1E3A8A',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                  }}
                                >
                                  {showRaw ? 'Hide' : 'View'}
                                </button>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', fontSize: '13px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Message ID</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {truncateId(msgId || 'Not present', 34)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Customer Network Address</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.35 }}>
                                  {truncateId(resolveCustomerNetworkAddress(item), 34)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>KYC Status</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {resolveCustomerKycStatus(item)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>KYC ID</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {truncateId(resolveCustomerKycId(item), 34)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Approved At</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {formatDate(item.approved_at || item.approvedAt)}
                                </p>
                              </div>
                            </div>

                            {detailsState.error ? (
                              <div style={{ padding: '10px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                                {detailsState.error}
                              </div>
                            ) : null}
                            {detailsState.data ? (
                              <div style={{ display: 'grid', gap: '8px' }}>
                                <p style={{ margin: 0, color: '#444', fontSize: '12px', fontWeight: 600 }}>
                                  Customer Details (Backend Response)
                                </p>
                                <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                  {JSON.stringify(detailsState.data, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                            {showRaw ? (
                              <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                {JSON.stringify(item, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {recordsView === 'approvedMintRequests' && (
                <div style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '22px', color: '#111' }}>Approved Mint Requests</h3>
                    <button
                      onClick={fetchApprovedMintRequestsRecords}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: '#333',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '13px'
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                    Required details: Request ID, Customer, Token ID, Amount, Approval status/time.
                  </p>
                  {approvedMintRequestsRecords.loading ? (
                    <p style={{ textAlign: 'center', color: '#999' }}>Loading approved mint requests...</p>
                  ) : approvedMintRequestsRecords.error ? (
                    <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                      {approvedMintRequestsRecords.error}
                    </div>
                  ) : approvedMintRequestsRecords.data.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                      No approved mint requests found
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {approvedMintRequestsRecords.data.map((item, idx) => {
                        const requestId = item.request_id || item.requestId || item.requestID || item.RequestID || `approved_mint_${idx}`;
                        const detailsInput = resolveCustomerDetailsInputs(item);
                        const canFetchDetails = Boolean(detailsInput.tokenID && detailsInput.customerID);
                        const detailsState = customerDetailsByRequest[String(requestId)] || { loading: false, data: null, error: '' };
                        const showRaw = isRawViewOpen('approvedMintRequestsRecords', String(requestId));
                        return (
                          <div key={requestId} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px', display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                                  Request ID: {truncateId(requestId, 40)}
                                </p>
                                <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                                  Customer: {resolveCustomerName(item)}
                                </p>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button
                                  onClick={() => handleFetchCustomerDetails(item, String(requestId))}
                                  disabled={detailsState.loading || !canFetchDetails}
                                  style={{
                                    padding: '8px 12px',
                                    backgroundColor: '#1E3A8A',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: detailsState.loading || !canFetchDetails ? 'not-allowed' : 'pointer',
                                    opacity: detailsState.loading || !canFetchDetails ? 0.7 : 1
                                  }}
                                >
                                  {detailsState.loading ? 'Fetching...' : canFetchDetails ? 'Customer Details' : 'Not present'}
                                </button>
                                <button
                                  onClick={() => toggleRawView('approvedMintRequestsRecords', String(requestId))}
                                  style={{
                                    padding: '8px 12px',
                                    backgroundColor: '#1E3A8A',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                  }}
                                >
                                  {showRaw ? 'Hide' : 'View'}
                                </button>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', fontSize: '13px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Customer Name</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {resolveCustomerName(item)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Bank BIC</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.35 }}>
                                  {resolveDisplayBIC(item)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>KYC ID</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {truncateId(resolveCustomerKycId(item), 34)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>KYC Status</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {resolveCustomerKycStatus(item)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Amount</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {formatBackendAmount(item)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Status</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {item.status || (item.approved ? 'approved' : 'Not present')}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Approved At</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {formatDate(item.approved_at || item.approvedAt)}
                                </p>
                              </div>
                            </div>

                            {detailsState.error ? (
                              <div style={{ padding: '10px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                                {detailsState.error}
                              </div>
                            ) : null}
                            {detailsState.data ? (
                              <div style={{ display: 'grid', gap: '8px' }}>
                                <p style={{ margin: 0, color: '#444', fontSize: '12px', fontWeight: 600 }}>
                                  Customer Details (Backend Response)
                                </p>
                                <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                  {JSON.stringify(detailsState.data, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                            {showRaw ? (
                              <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                {JSON.stringify(item, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {recordsView === 'tokenTransferHistory' && (
                <div style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '22px', color: '#111' }}>Token Transfer History</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        value={tokenTransferHistoryTokenId}
                        onChange={event => setTokenTransferHistoryTokenId(event.target.value)}
                        placeholder="Token ID (optional)"
                        style={{
                          padding: '8px 10px',
                          border: '1px solid #DDD',
                          borderRadius: '6px',
                          fontSize: '13px'
                        }}
                      />
                      <button
                        onClick={fetchTokenTransferHistoryRecords}
                        style={{
                          padding: '8px 14px',
                          backgroundColor: '#333',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '13px'
                        }}
                      >
                        Fetch
                      </button>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                    Required details: Transfer ID, Sender token, Receiver token, Amount, Status/timestamp.
                  </p>
                  {tokenTransferHistoryRecords.loading ? (
                    <p style={{ textAlign: 'center', color: '#999' }}>Loading token transfer history...</p>
                  ) : tokenTransferHistoryRecords.error ? (
                    <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                      {tokenTransferHistoryRecords.error}
                    </div>
                  ) : tokenTransferHistoryRecords.data.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                      No token transfer history found
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {tokenTransferHistoryRecords.data.map((item, idx) => {
                        const transferId = item.transfer_id || item.transferId || item.request_id || item.requestId || `token_transfer_${idx}`;
                        const showRaw = isRawViewOpen('tokenTransferHistoryRecords', String(transferId));
                        return (
                          <div key={transferId} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px', display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                                  Transfer ID: {truncateId(transferId, 40)}
                                </p>
                                <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                                  Status: {item.status || 'Not present'}
                                </p>
                              </div>
                              <button
                                onClick={() => toggleRawView('tokenTransferHistoryRecords', String(transferId))}
                                style={{
                                  padding: '8px 12px',
                                  backgroundColor: '#1E3A8A',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                {showRaw ? 'Hide' : 'View'}
                              </button>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', fontSize: '13px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Sender Token</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {item.senderTokenID || item.sender_token_id || 'Not present'}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Receiver Token</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {item.receiverTokenID || item.receiver_token_id || 'Not present'}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Amount</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {formatBackendAmount(item)}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Timestamp</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {formatDate(item.timestamp || item.created_at || item.updated_at)}
                                </p>
                              </div>
                            </div>

                            {showRaw ? (
                              <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                {JSON.stringify(item, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {recordsView === 'customerToTokenHistory' && (
                <div style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '22px', color: '#111' }}>Customer-to-Token Transfers History</h3>
                    <button
                      onClick={fetchCustomerToTokenHistoryRecords}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: '#333',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '13px'
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                    Required details: Transfer ID, Customer, Source token, Destination token, Amount, transfer time.
                  </p>
                  {customerToTokenHistoryRecords.loading ? (
                    <p style={{ textAlign: 'center', color: '#999' }}>Loading customer-to-token history...</p>
                  ) : customerToTokenHistoryRecords.error ? (
                    <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                      {customerToTokenHistoryRecords.error}
                    </div>
                  ) : customerToTokenHistoryRecords.data.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#F5F5F5', borderRadius: '12px', color: '#999' }}>
                      No customer-to-token transfer history found
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {customerToTokenHistoryRecords.data.map((item, idx) => {
                        const transferId =
                          item.transfer_id ||
                          item.transferId ||
                          item.request_id ||
                          item.requestId ||
                          item.TransferRequestID ||
                          item.transfer_request_id ||
                          `customer_to_token_${idx}`;
                        const transferStatus = String(item.status || item.Status || 'Not present').trim().toUpperCase();
                        const senderTokenId =
                          item.senderTokenID ||
                          item.sender_token_id ||
                          item.SenderTokenID ||
                          item.from_token_id ||
                          'Not present';
                        const receiverTokenId =
                          item.receiverTokenID ||
                          item.receiver_token_id ||
                          item.ReceiverTokenID ||
                          item.to_token_id ||
                          'Not present';
                        const senderCustomerRef =
                          item.sender_customer_ref ||
                          item.SenderCustomerRef ||
                          item.sender_customer_token_id ||
                          item.SenderCustomerTokenID ||
                          item.sender_customer_id ||
                          item.SenderCustomerID ||
                          'Not present';
                        const receiverCustomerRef =
                          item.receiver_customer_ref ||
                          item.ReceiverCustomerRef ||
                          item.receiver_customer_token_id ||
                          item.ReceiverCustomerTokenID ||
                          item.receiver_customer_id ||
                          item.ReceiverCustomerID ||
                          'Not present';
                        const senderCurrency =
                          item.sender_currency ||
                          item.SenderCurrency ||
                          item.currency ||
                          '';
                        const receiverCurrency =
                          item.receiver_currency ||
                          item.ReceiverCurrency ||
                          senderCurrency ||
                          '';
                        const senderAmount =
                          item.sender_amount ??
                          item.SenderAmount ??
                          item.amount ??
                          item.Amount ??
                          item.transfer_amount ??
                          0;
                        const receiverAmount =
                          item.converted_amount ??
                          item.ConvertedAmount ??
                          item.receiver_amount ??
                          item.ReceiverAmount;
                        const commissionPercentage = item.commission_percentage ?? item.CommissionPercentage;
                        const senderApprovalRaw = item.approved_by_sender_owner ?? item.ApprovedBySenderOwner;
                        const receiverApprovalRaw = item.approved_by_receiver_owner ?? item.ApprovedByReceiverOwner;
                        const isCompleted = transferStatus === 'COMPLETED' || transferStatus === 'SETTLED';
                        const senderApprovedAt = item.sender_approved_at || item.SenderApprovedAt || item.SenderTokenOwnerApprovedAt || '';
                        const receiverApprovedAt = item.receiver_approved_at || item.ReceiverApprovedAt || item.ReceiverTokenOwnerApprovedAt || '';
                        const senderApproved = isCompleted || Boolean(senderApprovedAt) || senderApprovalRaw === true || String(senderApprovalRaw).toLowerCase() === 'true';
                        const receiverApproved = isCompleted || Boolean(receiverApprovedAt) || receiverApprovalRaw === true || String(receiverApprovalRaw).toLowerCase() === 'true';
                        const senderAmountDisplay = formatAmountWithCurrency(senderAmount, senderCurrency);
                        const receiverAmountDisplay = receiverAmount !== undefined && receiverAmount !== null
                          ? formatAmountWithCurrency(receiverAmount, receiverCurrency)
                          : 'Not present';
                        const statusBadge = ['SETTLED', 'COMPLETED', 'APPROVED'].includes(transferStatus) ? '#E8F5E9' : '#FFF3E0';
                        const statusBadgeText = ['SETTLED', 'COMPLETED', 'APPROVED'].includes(transferStatus) ? '#2E7D32' : '#B26A00';

                        const walletTokenId = String(resolveWalletTokenId(wallet.data) || '').trim();
                        const walletCurrency = String(
                          wallet?.data?.currency ||
                          wallet?.data?.Currency ||
                          wallet?.data?.wallet?.currency ||
                          ''
                        ).trim().toUpperCase();
                        const senderTokenIdNormalized = String(senderTokenId || '').trim();
                        const senderCurrencyNormalized = String(senderCurrency || '').trim().toUpperCase();
                        const senderIsOwnCurrency = walletTokenId
                          ? walletTokenId === senderTokenIdNormalized
                          : (walletCurrency ? walletCurrency === senderCurrencyNormalized : true);
                        const customerIdForDetails = senderIsOwnCurrency
                          ? (item.sender_customer_id || item.SenderCustomerID || item.senderCustomerID || '')
                          : (item.receiver_customer_id || item.ReceiverCustomerID || item.receiverCustomerID || '');
                        const tokenIdForDetails = senderIsOwnCurrency
                          ? (item.sender_token_id || item.SenderTokenID || item.senderTokenID || '')
                          : (item.receiver_token_id || item.ReceiverTokenID || item.receiverTokenID || '');
                        const detailsInput = {
                          tokenID: tokenIdForDetails ? String(tokenIdForDetails).trim() : '',
                          customerID: customerIdForDetails ? String(customerIdForDetails).trim() : '',
                          customerIDCandidates: customerIdForDetails ? [String(customerIdForDetails).trim()] : []
                        };
                        const canFetchDetails = Boolean(detailsInput.tokenID && detailsInput.customerID);
                        const detailsState = customerDetailsByRequest[String(transferId)] || { loading: false, data: null, error: '' };
                        const showRaw = isRawViewOpen('customerToTokenHistoryRecords', String(transferId));

                        return (
                          <div key={transferId} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px', display: 'grid', gap: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                                  Transfer ID: {truncateId(transferId, 42)}
                                </p>
                                <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                                  {senderTokenId} → {receiverTokenId}
                                </p>
                              </div>
                              <span style={{
                                padding: '6px 10px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                backgroundColor: statusBadge,
                                color: statusBadgeText,
                                fontWeight: 600
                              }}>
                                {transferStatus || 'NOT PRESENT'}
                              </span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: '10px', fontSize: '13px' }}>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Sender Customer Ref</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{truncateId(senderCustomerRef, 34)}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Receiver Customer Ref</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{truncateId(receiverCustomerRef, 34)}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Sender Amount</p>
                                <p style={{ margin: '4px 0 0 0', color: '#C62828', fontWeight: 700 }}>-{senderAmountDisplay}</p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Receiver Amount</p>
                                <p style={{ margin: '4px 0 0 0', color: '#2E7D32', fontWeight: 700 }}>
                                  {receiverAmountDisplay === 'Not present' ? receiverAmountDisplay : `+${receiverAmountDisplay}`}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Commission</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {commissionPercentage !== undefined && commissionPercentage !== null
                                    ? `${Number(commissionPercentage).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`
                                    : 'Not present'}
                                </p>
                              </div>
                              <div>
                                <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Transfer Time</p>
                                <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                                  {formatDate(
                                    item.timestamp ||
                                    item.completed_at ||
                                    item.CompletedAt ||
                                    item.created_at ||
                                    item.CreatedAt ||
                                    item.updated_at
                                  )}
                                </p>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
                              <div style={{ padding: '8px 10px', border: '1px solid #EAEAEA', borderRadius: '8px', fontSize: '12px' }}>
                                Sender Bank Approval:{' '}
                                <span style={{ fontWeight: 700, color: senderApproved ? '#2E7D32' : '#C62828' }}>
                                  {senderApproved ? 'TRUE' : 'FALSE'}
                                </span>
                              </div>
                              <div style={{ padding: '8px 10px', border: '1px solid #EAEAEA', borderRadius: '8px', fontSize: '12px' }}>
                                Receiver Bank Approval:{' '}
                                <span style={{ fontWeight: 700, color: receiverApproved ? '#2E7D32' : '#C62828' }}>
                                  {receiverApproved ? 'TRUE' : 'FALSE'}
                                </span>
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <button
                                onClick={() => handleFetchCustomerDetails(detailsInput, String(transferId))}
                                disabled={detailsState.loading || !canFetchDetails}
                                style={{
                                  padding: '8px 12px',
                                  backgroundColor: '#1E3A8A',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: detailsState.loading || !canFetchDetails ? 'not-allowed' : 'pointer',
                                  opacity: detailsState.loading || !canFetchDetails ? 0.7 : 1
                                }}
                              >
                                {detailsState.loading ? 'Fetching...' : canFetchDetails ? 'Customer Details' : 'Not present'}
                              </button>
                              <button
                                onClick={() => toggleRawView('customerToTokenHistoryRecords', String(transferId))}
                                style={{
                                  padding: '8px 12px',
                                  backgroundColor: '#1E3A8A',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                {showRaw ? 'Hide' : 'View'}
                              </button>
                            </div>

                            {detailsState.error ? (
                              <div style={{ padding: '10px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                                {detailsState.error}
                              </div>
                            ) : null}
                            {detailsState.data ? (
                              <div style={{ display: 'grid', gap: '8px' }}>
                                <p style={{ margin: 0, color: '#444', fontSize: '12px', fontWeight: 600 }}>
                                  Customer Details (Backend Response)
                                </p>
                                <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                  {JSON.stringify(detailsState.data, null, 2)}
                                </pre>
                              </div>
                            ) : null}
                            {showRaw ? (
                              <pre style={{ margin: 0, padding: '10px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                                {JSON.stringify(item, null, 2)}
                              </pre>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SimpleBankDashboard;
