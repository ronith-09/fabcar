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
  item?.request_id ||
  item?.requestId ||
  item?.transfer_id ||
  item?.transferId ||
  item?.id ||
  '';

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
  const [senderApprovalRequestId, setSenderApprovalRequestId] = useState('');
  const [receiverApprovalRequestId, setReceiverApprovalRequestId] = useState('');
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
  const [tokenAccessForm, setTokenAccessForm] = useState({ name: '', country: 'US', currency: '' });
  const [tokenAccessRequestState, setTokenAccessRequestState] = useState({ loading: false, message: '', error: '' });
  const [tokenAccessStatusState, setTokenAccessStatusState] = useState({ loading: false, data: null, error: '' });

  // Fund management
  const [mintRequestForm, setMintRequestForm] = useState({ amount: '', tokenID: '' });
  const [mintRequestState, setMintRequestState] = useState({ loading: false, message: '', error: '' });

  // Token transfer
  const [tokenTransferForm, setTokenTransferForm] = useState({ senderTokenID: '', receiverTokenID: '', amount: '' });
  const [tokenTransferRequestState, setTokenTransferRequestState] = useState({ loading: false, message: '', error: '' });
  const [pendingTokenTransferRequests, setPendingTokenTransferRequests] = useState({ loading: false, data: [], error: '' });
  const [tokenTransferApproveRequestId, setTokenTransferApproveRequestId] = useState('');
  const [tokenTransferLaneHistory, setTokenTransferLaneHistory] = useState({ loading: false, data: [], error: '' });

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
  const [handshakeRequestForm, setHandshakeRequestForm] = useState({ bankId: '', tokenId: '' });
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
      setApprovedParticipantsRecords({ loading: false, data: list, error: '' });
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
      setApprovedMintRequestsRecords({ loading: false, data: list, error: '' });
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
      setTokenTransferHistoryRecords({ loading: false, data: list, error: '' });
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
        : Array.isArray(data?.history)
          ? data.history
          : Array.isArray(data?.transfers)
            ? data.transfers
            : [];
      setCustomerToTokenHistoryRecords({ loading: false, data: list, error: '' });
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
    if (!requestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setApprovalActionRequestId(requestId);
      await client.post(`/bank/customer-registrations/${encodeURIComponent(requestId)}/approve`, {
        status: 'approved'
      });
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
    if (!requestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setApprovalActionRequestId(requestId);
      await client.post(`/bank/customer-registrations/${encodeURIComponent(requestId)}/approve`, {
        status: 'rejected'
      });
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
    const tokenID = approval?.token_id || approval?.tokenID || '';
    const customerID =
      approval?.customer_id ||
      approval?.customerID ||
      approval?.userId ||
      approval?.username ||
      approval?.name ||
      '';

    if (!tokenID || !customerID) {
      setCustomerDetailsByRequest(prev => ({
        ...prev,
        [requestId]: {
          loading: false,
          data: null,
          error: 'Missing tokenID or customerID in this request'
        }
      }));
      return;
    }

    setCustomerDetailsByRequest(prev => ({
      ...prev,
      [requestId]: { loading: true, data: null, error: '' }
    }));

    try {
      const { data } = await client.get('/bank/customer-details', {
        params: { tokenID, customerID }
      });
      setCustomerDetailsByRequest(prev => ({
        ...prev,
        [requestId]: { loading: false, data, error: '' }
      }));
    } catch (error) {
      const detail = error?.response?.data?.error || error?.response?.data?.detail || error?.message || 'Unable to fetch customer details';
      setCustomerDetailsByRequest(prev => ({
        ...prev,
        [requestId]: { loading: false, data: null, error: detail }
      }));
    }
  };

  const handleApproveMintRequest = async requestId => {
    return handleMintRequestDecision(requestId, 'approved');
  };

  const handleRejectMintRequest = async requestId => {
    return handleMintRequestDecision(requestId, 'rejected');
  };

  const handleMintRequestDecision = async (requestId, status) => {
    if (!requestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setMintApprovalActionRequestId(requestId);
      await client.post(`/bank/customer-mint-requests/${encodeURIComponent(requestId)}/approve`, {
        status
      });
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
    if (!requestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setSenderApprovalRequestId(requestId);
      await client.post('/bank/customer-to-token-transfers/approve-sender', {
        transferRequestID: requestId
      });
      alert('✅ Sender approval completed successfully!');
      await fetchPendingSenderTransfers();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Sender approval failed';
      alert(`❌ Error: ${detail}`);
    } finally {
      setSenderApprovalRequestId('');
    }
  };

  const handleApproveReceiverTransfer = async requestId => {
    if (!requestId) {
      alert('❌ Error: Missing request ID');
      return;
    }
    try {
      setReceiverApprovalRequestId(requestId);
      await client.post('/bank/customer-to-token-transfers/approve-receiver', {
        transferRequestID: requestId
      });
      alert('✅ Receiver approval completed successfully!');
      await fetchPendingReceiverTransfers();
    } catch (error) {
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Receiver approval failed';
      alert(`❌ Error: ${detail}`);
    } finally {
      setReceiverApprovalRequestId('');
    }
  };

  const handleRequestTokenAccess = async () => {
    const name = tokenAccessForm.name.trim();
    const country = tokenAccessForm.country.trim();
    const currency = tokenAccessForm.currency.trim();
    if (!name || !currency) {
      setTokenAccessRequestState({ loading: false, message: '', error: 'Institution name and token ID are required' });
      return;
    }

    try {
      setTokenAccessRequestState({ loading: true, message: '', error: '' });
      await client.post('/token-request', { name, country, currency });
      setTokenAccessRequestState({ loading: false, message: 'Token access request submitted successfully', error: '' });
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
      const payload = { amount: parsedAmount };
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
        amount: parsedAmount
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
    const payload = {
      bankId: handshakeRequestForm.bankId.trim(),
      tokenId: handshakeRequestForm.tokenId.trim()
    };
    if (!payload.bankId || !payload.tokenId) {
      setHandshakeRequestState({ loading: false, message: '', error: 'Bank ID and Token ID are required' });
      return;
    }
    try {
      setHandshakeRequestState({ loading: true, message: '', error: '' });
      await client.post('/bank/handshake/request', payload);
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

  const handleApproveHandshake = async () => {
    const handshakeId = approveHandshakeId.trim();
    if (!handshakeId) {
      setApproveHandshakeState({ loading: false, message: '', error: 'Handshake/request ID is required' });
      return;
    }
    try {
      setApproveHandshakeState({ loading: true, message: '', error: '' });
      await client.post('/handshake/approve', { requestId: handshakeId });
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
                      <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#999', fontWeight: '500' }}>Token ID</p>
                      <p style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#000' }}>
                        {wallet.data?.tokenID || wallet.data?.token_id || '—'}
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
                    value={tokenAccessForm.name}
                    onChange={event => setTokenAccessForm(prev => ({ ...prev, name: event.target.value }))}
                    placeholder="Institution name"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenAccessForm.country}
                    onChange={event => setTokenAccessForm(prev => ({ ...prev, country: event.target.value }))}
                    placeholder="Country code (e.g. US)"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={tokenAccessForm.currency}
                    onChange={event => setTokenAccessForm(prev => ({ ...prev, currency: event.target.value }))}
                    placeholder="Token ID"
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
                  {wallet.error ? (
                    <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{wallet.error}</span>
                  ) : null}
                </div>
                {wallet.data ? (
                  <div style={{ display: 'grid', gap: '8px', fontSize: '13px', color: '#222' }}>
                    <p style={{ margin: 0 }}>
                      Balance: {wallet.data?.walletBalanceDisplay || wallet.data?.wallet_balance_display || '—'}
                    </p>
                    <p style={{ margin: 0 }}>
                      Token ID: {wallet.data?.tokenID || wallet.data?.token_id || '—'}
                    </p>
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
                            {item.senderTokenID || item.sender_token_id || '—'} → {item.receiverTokenID || item.receiver_token_id || '—'} | Amount: ${Number(item.amount || 0).toLocaleString()}
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
                          Amount: ${Number(item.amount || 0).toLocaleString()} | {formatDate(item.timestamp || item.created_at)}
                        </p>
                      </div>
                    ))}
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

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Register Customer (Documented API)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <input
                    value={registerCustomerForm.name}
                    onChange={event => setRegisterCustomerForm(prev => ({ ...prev, name: event.target.value }))}
                    placeholder="Name"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    type="password"
                    value={registerCustomerForm.password}
                    onChange={event => setRegisterCustomerForm(prev => ({ ...prev, password: event.target.value }))}
                    placeholder="Password"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <select
                    value={registerCustomerForm.role}
                    onChange={event => setRegisterCustomerForm(prev => ({ ...prev, role: event.target.value }))}
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  >
                    <option value="customer">customer</option>
                    <option value="bank">bank</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleRegisterCustomerDocumentedApi}
                    disabled={registerCustomerState.loading}
                    style={{ padding: '10px 14px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: registerCustomerState.loading ? 'not-allowed' : 'pointer', opacity: registerCustomerState.loading ? 0.7 : 1 }}
                  >
                    {registerCustomerState.loading ? 'Registering...' : 'Register Customer'}
                  </button>
                  {registerCustomerState.message ? <span style={{ color: '#2E7D32', fontSize: '13px', fontWeight: 600 }}>{registerCustomerState.message}</span> : null}
                  {registerCustomerState.error ? <span style={{ color: '#C62828', fontSize: '13px', fontWeight: 600 }}>{registerCustomerState.error}</span> : null}
                </div>
              </div>

              <div style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '16px', display: 'grid', gap: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '20px', color: '#111' }}>Bank-side Customer Lookup</h3>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <input
                    value={lookupCustomerId}
                    onChange={event => setLookupCustomerId(event.target.value)}
                    placeholder="Customer ID"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px', minWidth: '220px' }}
                  />
                  <button
                    onClick={handleLookupBankCustomer}
                    disabled={lookupCustomerState.loading}
                    style={{ padding: '10px 14px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: lookupCustomerState.loading ? 'not-allowed' : 'pointer', opacity: lookupCustomerState.loading ? 0.7 : 1 }}
                  >
                    {lookupCustomerState.loading ? 'Looking up...' : 'Lookup Customer'}
                  </button>
                </div>
                {lookupCustomerState.error ? (
                  <div style={{ padding: '12px', backgroundColor: '#FFECEC', borderRadius: '8px', color: '#C62828', fontSize: '12px' }}>
                    {lookupCustomerState.error}
                  </div>
                ) : null}
                {lookupCustomerState.data ? (
                  <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                    {JSON.stringify(lookupCustomerState.data, null, 2)}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
                  <input
                    value={handshakeRequestForm.bankId}
                    onChange={event => setHandshakeRequestForm(prev => ({ ...prev, bankId: event.target.value }))}
                    placeholder="Target Bank ID"
                    style={{ padding: '10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <input
                    value={handshakeRequestForm.tokenId}
                    onChange={event => setHandshakeRequestForm(prev => ({ ...prev, tokenId: event.target.value }))}
                    placeholder="Token ID"
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
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      value={approveHandshakeId}
                      onChange={event => setApproveHandshakeId(event.target.value)}
                      placeholder="Handshake/Request ID"
                      style={{ padding: '8px 10px', border: '1px solid #DDD', borderRadius: '6px', fontSize: '13px' }}
                    />
                    <button
                      onClick={handleApproveHandshake}
                      disabled={approveHandshakeState.loading}
                      style={{ padding: '8px 14px', backgroundColor: '#2E7D32', color: 'white', border: 'none', borderRadius: '6px', cursor: approveHandshakeState.loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '13px', opacity: approveHandshakeState.loading ? 0.7 : 1 }}
                    >
                      {approveHandshakeState.loading ? 'Approving...' : 'Approve Handshake'}
                    </button>
                    <button
                      onClick={fetchPendingHandshakes}
                      style={{ padding: '8px 14px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                    >
                      Refresh
                    </button>
                  </div>
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
                  <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                    {JSON.stringify(pendingHandshakesState.data, null, 2)}
                  </pre>
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
                  <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                    {JSON.stringify(allHandshakesState.data, null, 2)}
                  </pre>
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
                Required for approval: Request ID, Token ID, KYC Status (verified).
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
                    const requestId = resolveRequestId(approval);
                    const requestKey = requestId || approval.requestId || approval.id || `idx_${idx}`;
                    const isSubmitting = approvalActionRequestId === requestId;
                    const detailsState = customerDetailsByRequest[requestKey] || { loading: false, data: null, error: '' };
                    const showRaw = isRawViewOpen('customerApproval', requestKey);
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
                              {approval.name || approval.username || 'Unknown User'}
                            </h4>
                            <p style={{ margin: '8px 0 0 0', color: '#777', fontSize: '12px' }}>
                              Request ID: {truncateId(requestId, 40)}
                            </p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => handleFetchCustomerDetails(approval, requestKey)}
                              disabled={detailsState.loading}
                              style={{
                                padding: '8px 12px',
                                backgroundColor: '#1E3A8A',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: detailsState.loading ? 'not-allowed' : 'pointer',
                                opacity: detailsState.loading ? 0.7 : 1
                              }}
                            >
                              {detailsState.loading ? 'Fetching...' : 'Customer Details'}
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
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Token ID</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>{approval.token_id || '—'}</p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>KYC Status</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {approval.kyc_status === 'verified' ? 'Verified' : 'Pending'}
                            </p>
                          </div>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Created</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              {formatDate(approval.created_at || approval.timestamp)}
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
                              {JSON.stringify(detailsState.data, null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        {showRaw ? (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            <p style={{ margin: 0, fontSize: '12px', color: '#666', fontWeight: 600 }}>
                              Full Backend Payload
                            </p>
                            <pre style={{ margin: 0, padding: '12px', backgroundColor: '#F7F7F7', borderRadius: '8px', border: '1px solid #ECECEC', fontSize: '12px', color: '#333', overflowX: 'auto' }}>
                              {JSON.stringify(approval, null, 2)}
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
                  {pendingApprovals.data.map((approval, idx) => (
                    <div
                      key={idx}
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
                            Request ID: {truncateId(resolveRequestId(approval), 30)}
                          </p>
                        </div>
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
                          <p style={{ margin: '0 0 4px 0', fontSize: '11px', color: '#999', fontWeight: '500' }}>Token ID</p>
                          <p style={{ margin: 0, color: '#333', fontWeight: '600' }}>{approval.token_id || '—'}</p>
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
                          const requestId = resolveRequestId(approval);
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
                    </div>
                  ))}
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
                    const viewKey = requestId || `pending_mint_${idx}`;
                    const isSubmitting = mintApprovalActionRequestId === requestId;
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
                              {mintRequest.name || mintRequest.customer_name || mintRequest.customer_id || 'Customer'}
                            </h4>
                            <p style={{ margin: '8px 0 0 0', color: '#777', fontSize: '12px' }}>
                              Request ID: {truncateId(requestId, 40)}
                            </p>
                          </div>
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

                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '10px',
                          fontSize: '13px'
                        }}>
                          <div>
                            <p style={{ margin: 0, color: '#999', fontSize: '11px' }}>Amount</p>
                            <p style={{ margin: '4px 0 0 0', color: '#222', fontWeight: 600 }}>
                              ${Number(mintRequest.amount || 0).toLocaleString()}
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
                            onClick={() => handleApproveMintRequest(requestId)}
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
                            onClick={() => handleRejectMintRequest(requestId)}
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
                        const isSubmitting = senderApprovalRequestId === requestId;
                        const showRaw = isRawViewOpen('senderTransferApproval', viewKey);
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
                            <p style={{ margin: 0, color: '#777', fontSize: '12px' }}>
                              Request ID: {truncateId(requestId, 40)}
                            </p>
                            <div style={{ display: 'grid', gap: '4px', fontSize: '13px' }}>
                              <p style={{ margin: 0, color: '#222' }}>
                                From: {transfer.senderTokenID || transfer.sender_token_id || '—'}
                              </p>
                              <p style={{ margin: 0, color: '#222' }}>
                                To: {transfer.receiverTokenID || transfer.receiver_token_id || '—'}
                              </p>
                              <p style={{ margin: 0, color: '#222' }}>
                                Amount: ${Number(transfer.amount || 0).toLocaleString()}
                              </p>
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
                                {isSubmitting ? 'Processing...' : 'Approve as Sender'}
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
                        const isSubmitting = receiverApprovalRequestId === requestId;
                        const showRaw = isRawViewOpen('receiverTransferApproval', viewKey);
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
                            <p style={{ margin: 0, color: '#777', fontSize: '12px' }}>
                              Request ID: {truncateId(requestId, 40)}
                            </p>
                            <div style={{ display: 'grid', gap: '4px', fontSize: '13px' }}>
                              <p style={{ margin: 0, color: '#222' }}>
                                From: {transfer.senderTokenID || transfer.sender_token_id || '—'}
                              </p>
                              <p style={{ margin: 0, color: '#222' }}>
                                To: {transfer.receiverTokenID || transfer.receiver_token_id || '—'}
                              </p>
                              <p style={{ margin: 0, color: '#222' }}>
                                Amount: ${Number(transfer.amount || 0).toLocaleString()}
                              </p>
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
                                {isSubmitting ? 'Processing...' : 'Approve as Receiver'}
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
                    Customer-to-Token History
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
                    <div style={{ display: 'grid', gap: '10px' }}>
                      {approvedParticipantsRecords.data.map((item, idx) => (
                        <div key={item.customer_id || item.username || idx} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px' }}>
                          <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>{item.name || item.username || 'Participant'}</p>
                          <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                            ID: {truncateId(item.customer_id || item.username || '', 28)}
                          </p>
                        </div>
                      ))}
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
                    <div style={{ display: 'grid', gap: '10px' }}>
                      {approvedMintRequestsRecords.data.map((item, idx) => (
                        <div key={item.request_id || item.requestId || idx} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px' }}>
                          <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                            Request: {truncateId(item.request_id || item.requestId || '', 30)}
                          </p>
                          <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                            Amount: ${Number(item.amount || 0).toLocaleString()}
                          </p>
                        </div>
                      ))}
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
                    <div style={{ display: 'grid', gap: '10px' }}>
                      {tokenTransferHistoryRecords.data.map((item, idx) => (
                        <div key={item.request_id || item.transfer_id || idx} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px' }}>
                          <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                            From: {item.senderTokenID || item.sender_token_id || '—'} | To: {item.receiverTokenID || item.receiver_token_id || '—'}
                          </p>
                          <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                            Amount: ${Number(item.amount || 0).toLocaleString()}
                          </p>
                        </div>
                      ))}
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
                    <div style={{ display: 'grid', gap: '10px' }}>
                      {customerToTokenHistoryRecords.data.map((item, idx) => (
                        <div key={item.request_id || item.transfer_id || idx} style={{ backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: '12px', padding: '14px' }}>
                          <p style={{ margin: 0, color: '#222', fontWeight: 600 }}>
                            {item.senderTokenID || item.sender_token_id || '—'} → {item.receiverTokenID || item.receiver_token_id || '—'}
                          </p>
                          <p style={{ margin: '4px 0 0 0', color: '#666', fontSize: '12px' }}>
                            Amount: ${Number(item.amount || 0).toLocaleString()} | {formatDate(item.timestamp || item.created_at)}
                          </p>
                        </div>
                      ))}
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
