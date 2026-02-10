import { useEffect, useState, useMemo, useRef } from 'react';
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

const LANES = [
  {
    key: 'kycConfig',
    icon: '🧾',
    title: 'Bank API Setup',
    subtitle: 'Connect External KYC Services',
    helper: 'Store each token\'s KYC form URL and secret once so customers can onboard safely.',
    functions: [
      {
        key: 'saveBankTokenConfig',
        title: 'Save KYC API Configuration',
        description: 'Record the bank-hosted KYC form/API URL and auth key for a token.',
        method: 'POST',
        endpoint: '/bank/token-config',
        fields: [
          { name: 'token_id', label: 'Token ID', required: true, placeholder: 'e.g., BNET-USD-ROOT-v1' },
          { name: 'bank_api_base_url', label: 'Bank KYC Base URL', required: true, placeholder: 'https://bank.example.com/kyc' },
          { name: 'bank_auth_key', label: 'Bank Auth Key', required: true, placeholder: 'Paste API key from your core banking system' }
        ],
        buildRequest: values => ({
          data: cleanPayload({
            token_id: values.token_id,
            bank_api_base_url: values.bank_api_base_url,
            bank_auth_key: values.bank_auth_key
          })
        })
      },
      {
        key: 'viewBankTokenConfig',
        title: 'View Stored KYC Config',
        description: 'Fetch sanitized config for a token (auth key hidden) to verify setup.',
        method: 'GET',
        endpoint: '/token/:tokenId/bank-config',
        fields: [
          { name: 'tokenId', label: 'Token ID', required: true, placeholder: 'e.g., BNET-USD-ROOT-v1' }
        ],
        buildRequest: values => {
          if (!values.tokenId) {
            throw new Error('Token ID is required');
          }
          return {
            url: `/token/${encodeURIComponent(values.tokenId)}/bank-config`,
            params: {}
          };
        }
      }
    ]
  },
  {
    key: 'customer',
    icon: '✅',
    title: 'Customer Approvals',
    subtitle: 'Manage Pending Registrations',
    helper: 'Review customer requests and approve or reject them.',
    functions: [
      {
        key: 'viewPendingCustomerRegistrations',
        title: 'View Pending Customer Registrations',
        description: 'List customer registrations waiting for approval.',
        method: 'GET',
        endpoint: '/bank/customer-registrations/pending',
        fields: [],
        buildRequest: () => ({
          params: cleanPayload({})
        })
      },
      {
        key: 'approveCustomerRegistration',
        title: 'Approve or Reject Registration',
        description: 'Decide on a pending customer registration request.',
        method: 'POST',
        endpoint: '/bank/customer-registrations/:requestId/approve',
        fields: [
          { name: 'requestId', label: 'Request ID', required: true, placeholder: 'Enter request id' },
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
          if (!values.requestId) {
            throw new Error('Request ID is required');
          }
          return {
            url: `/bank/customer-registrations/${encodeURIComponent(values.requestId)}/approve`,
            data: cleanPayload({
              status: values.status
            })
          };
        }
      }
    ]
  },
  {
    key: 'customerData',
    icon: '🕵️',
    title: 'Customer Intelligence',
    subtitle: 'Bank Database Access',
    helper: 'Securely fetch off-chain customer PII from your connected bank database.',
    functions: [
      {
        key: 'viewCustomerDetails',
        title: 'View Customer Details',
        description: 'Fetch Name, Phone, and Email from the Bank DB for a specific Customer ID.',
        method: 'GET',
        endpoint: '/bank/customer-details',
        fields: [
          { name: 'tokenID', label: 'Token ID', required: true, placeholder: 'e.g., BNET-USD-ROOT-v1' },
          { name: 'customerID', label: 'Customer ID', required: true, placeholder: 'e.g., u_123456789' }
        ],
        buildRequest: values => ({
          params: cleanPayload({
            tokenID: values.tokenID,
            customerID: values.customerID
          })
        })
      }
    ]
  },
  {
    key: 'token',
    icon: '💰',
    title: 'token Access',
    subtitle: 'Manage Currency Permissions',
    helper: 'Request and verify access to different currencies for your institution.',
    functions: [
      {
        key: 'requestTokenRequest',
        title: 'Request Currency Access',
        description: 'Submit a request to enable a new currency for your institution.',
        method: 'POST',
        endpoint: '/token-request',
        fields: [
          { name: 'name', label: 'Institution Name', required: true, placeholder: 'Your institution name' },
          { name: 'country', label: 'Country Code', defaultValue: 'US', placeholder: 'e.g., US, UK, CA' },
          { name: 'currency', label: 'Token ID', required: true, placeholder: 'e.g., token_1' }
        ],
        buildRequest: values => ({
          data: cleanPayload({
            name: values.name,
            country: values.country,
            currency: values.currency
          })
        })
      },
      {
        key: 'getTokenAccess',
        title: 'Check Currency Access Status',
        description: 'Verify if your institution has access to a specific currency.',
        method: 'POST',
        endpoint: '/bank/get-token-access',
        fields: [],
        buildRequest: () => ({
          data: {}
        })
      }
    ]
  },
  {
    key: 'mint',
    icon: '💵',
    title: 'Fund Management',
    subtitle: 'Issue and Manage Funds',
    helper: 'Request fund issuance and check account balances.',
    functions: [
      {
        key: 'requestMintCoins',
        title: 'Request Fund Issuance',
        description: 'Submit a request to issue funds to an account.',
        method: 'POST',
        endpoint: '/mint-request',
        fields: [
          { name: 'amount', label: 'Amount', required: true, type: 'number', placeholder: 'Enter amount (e.g., 1000)' }
        ],
        buildRequest: values => ({
          data: cleanPayload({
            amount: values.amount
          })
        })
      },
      {
        key: 'getWalletInfo',
        title: 'Check Account Balance',
        description: 'View the current balance and details of an account.',
        method: 'GET',
        endpoint: '/bank/wallet',
        fields: [],
        buildRequest: () => ({
          params: {}
        })
      }
    ]
  },
  {
    key: 'list',
    icon: '📋',
    title: 'Customer Records',
    subtitle: 'View Customer Data',
    helper: 'Access records of approved customers and their transaction history.',
    functions: [
      {
        key: 'listApprovedParticipants',
        title: 'View Approved Customers',
        description: 'List all customers approved for banking services.',
        method: 'GET',
        endpoint: '/bank/participants/approved',
        fields: [],
        buildRequest: values => ({
          params: cleanPayload({})
        })
      },
      {
        key: 'listApprovedParticipantMintRequests',
        title: 'View Approved Fund Issuance',
        description: 'View all approved fund issuance requests.',
        method: 'GET',
        endpoint: '/participant-mint-requests/approved',
        fields: [],
        buildRequest: values => ({
          params: cleanPayload({})
        })
      },
      {
        key: 'listTokenToTokenTransferHistory',
        title: 'View Currency Transfer History',
        description: 'View the history of transfers for a specific currency.',
        method: 'GET',
        endpoint: '/token-transfer-history',
        fields: [
          { name: 'tokenID', label: 'Token ID', required: true, placeholder: 'Enter token ID' }
        ],
        buildRequest: values => ({
          params: cleanPayload({
            tokenID: values.tokenID
          })
        })
      },
      {
        key: 'viewCustomerToTokenTransferHistory',
        title: 'View C-to-T Transfer History',
        description: 'View the history of completed customer-to-token transfers for your bank\'s token.',
        method: 'GET',
        endpoint: '/bank/customer-to-token-transfers/history',
        fields: [],
        buildRequest: () => ({
          params: {}
        })
      }
    ]
  },
  // KYC quick-access is provided via a navigation button (see below)
  {
    key: 'integrationRunbook',
    icon: '🛠️',
    title: 'Owner Integration Runbook',
    subtitle: 'Self-Wire Banking Database',
    helper: 'For each token, wire its own owner wallet, database URL, and API key. Pick a token to see the exact endpoints, payloads, and checklist for that currency.',
    functions: [] // No function cards for this lane
  },
  {
    key: 'tokenTransfer',
    icon: '↔️',
    title: 'Currency Exchange',
    subtitle: 'Cross-Currency Transfers',
    helper: 'Manage transfers between different currencies.',
    functions: [
      {
        key: 'createTokenTransferRequest',
        title: 'Create Currency Exchange',
        description: 'Initiate a transfer between two different currencies.',
        method: 'POST',
        endpoint: '/token-transfer-request',
        fields: [
          { name: 'senderTokenID', label: 'From Currency', required: true, placeholder: 'Source currency code' },
          { name: 'receiverTokenID', label: 'To Currency', required: true, placeholder: 'Destination currency code' },
          { name: 'senderOwnerAddress', label: 'Sender Account Number', required: true, placeholder: 'Your account number' },
          { name: 'amount', label: 'Amount', required: true, type: 'number', placeholder: 'Amount to transfer' }
        ],
        buildRequest: values => ({
          data: cleanPayload({
            senderTokenID: values.senderTokenID,
            receiverTokenID: values.receiverTokenID,
            senderOwnerAddress: values.senderOwnerAddress,
            amount: values.amount
          })
        })
      },
      {
        key: 'viewPendingTokenTransferRequests',
        title: 'View Pending Currency Exchanges',
        description: 'List pending currency exchange requests.',
        method: 'GET',
        endpoint: '/token-transfer-requests/pending',
        fields: [
          { name: 'receiverTokenID', label: 'Receiving Currency', required: true, placeholder: 'Currency code' },
          { name: 'receiverOwnerAddress', label: 'Receiver Account Number', required: true, placeholder: 'Receiver account number' }
        ],
        buildRequest: values => ({
          params: cleanPayload({
            receiverTokenID: values.receiverTokenID,
            receiverOwnerAddress: values.receiverOwnerAddress
          })
        })
      },
      {
        key: 'approveTokenTransferRequest',
        title: 'Approve Currency Exchange',
        description: 'Approve a pending currency exchange request.',
        method: 'POST',
        endpoint: '/token-transfer-requests/:requestId/approve',
        fields: [
          { name: 'requestId', label: 'Exchange Request ID', required: true, placeholder: 'Enter request ID' },
          { name: 'receiverOwnerAddress', label: 'Receiver Account Number', required: true, placeholder: 'Receiver account number' }
        ],
        buildRequest: values => {
          if (!values.requestId) {
            throw new Error('Exchange Request ID is required');
          }
          return {
            url: `/token-transfer-requests/${encodeURIComponent(values.requestId)}/approve`,
            data: cleanPayload({
              receiverOwnerAddress: values.receiverOwnerAddress
            })
          };
        }
      },

      {
        key: 'listTokenToTokenTransferHistory',
        title: 'View Exchange History',
        description: 'View historical currency exchanges.',
        method: 'GET',
        endpoint: '/token-transfer-history',
        fields: [
          { name: 'tokenID', label: 'Token ID', required: true, placeholder: 'Enter token ID' }
        ],
        buildRequest: values => ({
          params: cleanPayload({
            tokenID: values.tokenID
          })
        })
      }
    ]
  },
  {
    key: 'customerMint',
    icon: '💳',
    title: 'Fund Request Approvals',
    subtitle: 'Review Customer Fund Requests',
    helper: 'Review and approve requests from customers to add funds.',
    functions: [
      {
        key: 'viewPendingCustomerMintRequests',
        title: 'View Pending Fund Requests',
        description: 'View all customer requests to add funds awaiting approval.',
        method: 'GET',
        endpoint: '/bank/customer-mint-requests/pending',
        fields: [],
        buildRequest: () => ({
          params: {}
        })
      },
      {
        key: 'approveCustomerMint',
        title: 'Review Fund Request',
        description: 'Approve or reject a customer fund request.',
        method: 'POST',
        endpoint: '/bank/customer-mint-requests/:requestId/approve',
        fields: [
          { name: 'requestId', label: 'Fund Request ID', required: true, placeholder: 'Request ID' },
          {
            name: 'status',
            label: 'Decision',
            options: [
              { value: 'approved', label: 'Approve Request' },
              { value: 'rejected', label: 'Reject Request' }
            ],
            defaultValue: 'approved'
          }
        ],
        buildRequest: values => {
          if (!values.requestId) {
            throw new Error('Fund Request ID is required');
          }
          return {
            url: `/bank/customer-mint-requests/${encodeURIComponent(values.requestId)}/approve`,
            data: cleanPayload({
              status: values.status
            })
          };
        }
      }
    ]
  },
  {
    key: 'tokenHandshake',
    icon: '🤝',
    title: 'Token Handshake',
    subtitle: 'Request & Approve Inter-Token Communication',
    helper: 'Request handshake approval with other bank tokens for cross-currency transfers. Once both approve, you can transfer funds.',
    functions: [
      {
        key: 'requestTokenHandshake',
        title: 'Request Token Handshake',
        description: 'Request communication permission with another bank\'s token.',
        method: 'POST',
        endpoint: '/bank/handshake/request',
        fields: [
          { name: 'otherTokenID', label: 'Target Bank Token ID', required: true, placeholder: 'Target token (e.g., token_2)' }
        ],
        buildRequest: values => {
          if (!values.otherTokenID) {
            throw new Error('Target Bank Token ID is required');
          }
          return {
            url: `/bank/handshake/request`,
            data: cleanPayload({
              otherTokenID: values.otherTokenID
            })
          };
        }
      },
      {
        key: 'viewPendingTokenHandshakes',
        title: 'View Pending Requests',
        description: 'See handshake requests waiting for your approval.',
        method: 'GET',
        endpoint: '/bank/handshakes/pending',
        fields: [],
        buildRequest: () => ({
          params: {}
        })
      },
      {
        key: 'tokenHandshakeApprove',
        title: 'Approve Handshake Request',
        description: 'Approve a pending handshake request to enable transfers.',
        method: 'POST',
        endpoint: '/handshake/approve',
        fields: [
          { name: 'handshakeID', label: 'Handshake ID', required: true, placeholder: 'e.g., handshake_token1_token2' }
        ],
        buildRequest: values => ({
          url: `/handshake/approve`,
          data: cleanPayload({
            handshakeID: values.handshakeID
          })
        })
      },
      {
        key: 'viewTokenHandshakes',
        title: 'View Approved Handshakes',
        description: 'List all approved handshakes for your token. These are ready for transactions.',
        method: 'GET',
        endpoint: '/bank/handshakes',
        fields: [],
        buildRequest: () => ({
          params: {}
        })
      }
    ]
  },
  {
    key: 'customerToTokenTransfer',
    icon: '💱',
    title: 'Token Transfers',
    subtitle: 'Manage Customer-to-Token Transfers',
    helper: 'Review and approve customer requests to convert their tokens to other tokens.',
    functions: [
      {
        key: 'viewPendingCustomerToTokenTransfersAsSender',
        title: 'View Pending C-to-T Transfers (As Sender)',
        description: 'View all pending customer-to-token transfer requests where your token is the sender.',
        method: 'GET',
        endpoint: '/bank/customer-to-token-transfers/pending-as-sender',
        fields: [],
        buildRequest: () => ({
          params: {}
        })
      },
      {
        key: 'viewPendingCustomerToTokenTransfersAsReceiver',
        title: 'View Pending C-to-T Transfers (As Receiver)',
        description: 'View all pending customer-to-token transfer requests where your token is the receiver.',
        method: 'GET',
        endpoint: '/bank/customer-to-token-transfers/pending-as-receiver',
        fields: [],
        buildRequest: () => ({
          params: {}
        })
      },

      {
        key: 'approveSenderTokenTransfer',
        title: 'Approve C-to-T Transfer (As Sender)',
        description: 'Approve a customer-to-token transfer as the sender token owner.',
        method: 'POST',
        endpoint: '/bank/customer-to-token-transfers/approve-sender',
        fields: [
          {
            name: 'transferRequestID',
            label: 'Transfer Request ID',
            type: 'text',
            placeholder: 'e.g., custtotoken_...',
            required: true
          }
        ],
        buildRequest: values => {
          if (!values.transferRequestID) {
            throw new Error('Transfer Request ID is required');
          }
          return {
            data: {
              transferRequestID: values.transferRequestID
            }
          };
        }
      },
      {
        key: 'approveReceiverTokenTransfer',
        title: 'Approve C-to-T Transfer (As Receiver)',
        description: 'Approve a customer-to-token transfer as the receiver token owner. This completes the transfer.',
        method: 'POST',
        endpoint: '/bank/customer-to-token-transfers/approve-receiver',
        fields: [
          {
            name: 'transferRequestID',
            label: 'Transfer Request ID',
            type: 'text',
            placeholder: 'e.g., custtotoken_...',
            required: true
          }
        ],
        buildRequest: values => {
          if (!values.transferRequestID) {
            throw new Error('Transfer Request ID is required');
          }
          return {
            data: {
              transferRequestID: values.transferRequestID
            }
          };
        }
      }
    ]
  },
  {
    key: 'commissionSettings',
    icon: '⚙️',
    title: 'Commission Settings',
    subtitle: 'Configure Transfer Commissions',
    helper: 'Set the commission percentage that your bank will charge for token transfers.',
    functions: [
      {
        key: 'setBankCommission',
        title: 'Set Commission Rate',
        description: 'Configure the commission percentage your bank charges for token transfers.',
        method: 'POST',
        endpoint: '/bank/commission',
        fields: [
          {
            name: 'tokenId',
            label: 'Token ID',
            type: 'text',
            placeholder: 'e.g., HDFC-USD-8f2a3b4c-v1',
            required: true
          },
          {
            name: 'commissionPercentage',
            label: 'Commission Percentage',
            type: 'number',
            placeholder: 'e.g., 2.5',
            required: true,
            step: '0.01',
            min: '0'
          }
        ],
        buildRequest: values => {
          if (!values.tokenId || values.commissionPercentage === undefined) {
            throw new Error('Token ID and Commission Percentage are required');
          }
          return {
            data: cleanPayload({
              token_id: values.tokenId,
              commission_percentage: parseFloat(values.commissionPercentage)
            })
          };
        }
      },
      {
        key: 'getBankCommission',
        title: 'View Current Commission',
        description: 'Check the current commission rate configured for a token.',
        method: 'GET',
        endpoint: '/bank/:tokenId/commission',
        fields: [
          {
            name: 'tokenId',
            label: 'Token ID',
            type: 'text',
            placeholder: 'e.g., HDFC-USD-8f2a3b4c-v1',
            required: true
          }
        ],
        buildRequest: values => {
          if (!values.tokenId) {
            throw new Error('Token ID is required');
          }
          return {
            url: `/bank/${encodeURIComponent(values.tokenId)}/commission`,
            params: {}
          };
        }
      }
    ]
  }
];


const getStoredRegistrationSnapshot = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('latestRegistrationCredentials');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

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
          <p className="text-xs uppercase tracking-wide text-white/40 mb-2">📄 Customer Registration</p>
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

// Approved Customer Card Component
const ApprovedCustomerCard = ({ customer }) => {
  const {
    customer_id,
    username,
    kyc_status,
    created_at,
    approved_at,
    token_id,
    name,
    email,
    phone
  } = customer;

  const kycDisplay = formatKycStatus(kyc_status);
  const approvalDate = formatDate(approved_at || created_at);
  const customerId = customer_id || username || 'N/A';

  return (
    <div className="glass-panel p-6 border border-white/5 space-y-4 hover:border-accent/30 transition">
      <div className="flex items-start justify-between border-b border-white/10 pb-3">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-white/40 mb-2">👤 Approved Customer</p>
          <h4 className="text-lg font-semibold text-white">{name || username || 'Customer'}</h4>
        </div>
        <div>
          <span className="inline-block px-3 py-1 rounded-full bg-green-500/20 border border-green-500/40 text-xs font-medium text-green-300">
            ✅ Active
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Customer ID</p>
          <div className="flex items-center gap-2">
            <p className="text-sm font-mono text-white/80 break-all flex-1">{customerId.length > 20 ? customerId.substring(0, 20) + '...' : customerId}</p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(customerId);
                alert('Customer ID copied!');
              }}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-white/70 transition"
              title="Copy customer ID"
            >
              📋
            </button>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40 mb-1">Token Product</p>
          <p className="text-sm font-semibold text-accent">{token_id || 'N/A'}</p>
        </div>
      </div>

      <div className="bg-white/5 rounded-lg p-3 border border-white/10">
        <p className="text-xs uppercase tracking-wide text-white/40 mb-3 font-semibold">Account Details</p>
        <div className="space-y-2 text-sm">
          {email && (
            <div className="flex justify-between items-start">
              <span className="text-white/60">Email:</span>
              <span className="text-white/80 text-right break-all">{email}</span>
            </div>
          )}
          {phone && (
            <div className="flex justify-between items-start">
              <span className="text-white/60">Phone:</span>
              <span className="text-white/80">{phone}</span>
            </div>
          )}
          <div className="flex justify-between items-start">
            <span className="text-white/60">KYC Status:</span>
            <span className="text-green-400 font-semibold">{kycDisplay}</span>
          </div>
          <div className="flex justify-between items-start">
            <span className="text-white/60">Approved:</span>
            <span className="text-white/80">{approvalDate}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Approved Fund Request Card Component
const ApprovedFundRequestCard = ({ fundRequest }) => {
  const {
    request_id,
    RequestID,
    requested_by,
    RequestedBy,
    name,
    Name,
    token_id,
    TokenID,
    amount,
    Amount,
    kyc_status,
    KYCStatus,
    approved_at,
    ApprovedAt,
    created_at,
    CreatedAt
  } = fundRequest;

  const requestId = request_id || RequestID || 'N/A';
  const customerId = requested_by || RequestedBy || 'N/A';
  const fundAmount = amount || Amount || 0;
  const tokenId = token_id || TokenID || 'N/A';
  const kycDisplay = formatKycStatus(kyc_status || KYCStatus || 'false');
  const approvalDate = formatDate(approved_at || ApprovedAt || created_at || CreatedAt);
  const requestIdDisplay = truncateId(requestId);
  const customerIdDisplay = truncateId(customerId);
  const amountDisplay = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(fundAmount);

  return (
    <div className="glass-panel border border-white/10 hover:border-green-500/40 transition group">
      <div className="grid grid-cols-6 gap-4 p-4 items-center text-sm">
        {/* Request ID with copy button */}
        <div className="truncate">
          <p className="text-xs uppercase text-white/40 mb-1">Request ID</p>
          <div className="flex items-center gap-2 group">
            <code className="text-xs font-mono text-white/80 truncate">{requestIdDisplay}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(requestId);
                alert('Request ID copied!');
              }}
              className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-xs text-white/50 hover:text-white hover:bg-white/10 transition"
              title="Copy Request ID"
            >
              📋
            </button>
          </div>
        </div>

        {/* Customer ID with copy button */}
        <div className="truncate">
          <p className="text-xs uppercase text-white/40 mb-1">Customer ID</p>
          <div className="flex items-center gap-2 group">
            <code className="text-xs font-mono text-white/80 truncate">{customerIdDisplay}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(customerId);
                alert('Customer ID copied!');
              }}
              className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 rounded text-xs text-white/50 hover:text-white hover:bg-white/10 transition"
              title="Copy Customer ID"
            >
              📋
            </button>
          </div>
        </div>

        {/* Token */}
        <div>
          <p className="text-xs uppercase text-white/40 mb-1">Token</p>
          <p className="font-semibold text-accent">{tokenId}</p>
        </div>

        {/* Amount */}
        <div>
          <p className="text-xs uppercase text-white/40 mb-1">Amount</p>
          <p className="font-semibold text-green-400">{amountDisplay}</p>
        </div>

        {/* KYC Status */}
        <div>
          <p className="text-xs uppercase text-white/40 mb-1">KYC Status</p>
          <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-500/20 border border-green-500/40 text-xs font-medium text-green-300">
            {kycDisplay}
          </span>
        </div>

        {/* Approved Date */}
        <div>
          <p className="text-xs uppercase text-white/40 mb-1">Approved</p>
          <p className="text-white/80 text-xs">{approvalDate}</p>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ icon, label, value, subtext }) => (
  <div className="glass-panel p-6 border border-white/5">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-xs uppercase tracking-wide text-white/50 mb-1">{label}</p>
        <p className="text-3xl font-bold text-white mb-1">{value}</p>
        {subtext && <p className="text-xs text-white/40">{subtext}</p>}
      </div>
      <div className="text-3xl opacity-20">{icon}</div>
    </div>
  </div>
);

const ApprovalTable = ({ title, subtitle, fetchUrl, approveUrl, rejectUrl, columns, helper, mapRowToRequest, mapRequestToFields }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const [latestRegistration, setLatestRegistration] = useState(() => getStoredRegistrationSnapshot());

  const fetchData = async () => {
    if (!latestRegistration?.network_address) return;
    setLoading(true);
    try {
      const params = {
        ownerNetworkAddress: latestRegistration.network_address,
      };
      const response = await safeGet(fetchUrl, { params });
      setData(Array.isArray(response) ? response : []);
    } catch (err) {
      console.error("Fetch error", err);
    } finally {
      setLoading(false);
    }
  };

  // Manual-only fetch: do not auto-poll. User must click Refresh.
  useEffect(() => {
    // when registration snapshot changes, clear data; user can refresh manually
    setData([]);
  }, [latestRegistration, fetchUrl]);

  const handleAction = async (item, decision) => {
    setProcessingId(item.key || item.request_id || item.RequestID);
    try {
      const url = decision === 'approved' ? approveUrl : rejectUrl;
      const finalUrl = url.replace(':requestId', item.request_id || item.RequestID);

      const payload = mapRequestToFields ? mapRequestToFields(item, decision, latestRegistration) : {};

      await client.post(finalUrl, payload);
      await fetchData();
    } catch (err) {
      alert("Action failed: " + (err.response?.data?.detail || err.message));
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="glass-panel p-6 border border-white/5 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <p className="text-sm text-white/50">{subtitle}</p>
        </div>
        <button onClick={fetchData} className="text-xs bg-white/5 hover:bg-white/10 px-3 py-1 rounded">
          Refresh
        </button>
      </div>

      {loading && data.length === 0 ? (
        <div className="text-center py-8 text-white/40">Loading pending requests...</div>
      ) : data.length === 0 ? (
        <div className="text-center py-8 bg-white/5 rounded-xl border border-dashed border-white/10">
          <p className="text-white/60">No pending requests found</p>
          <p className="text-xs text-white/40 mt-1">Click Refresh to load or update requests</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase text-white/40">
                {columns.map((col, i) => <th key={i} className="pb-3 pl-2 font-medium">{col.header}</th>)}
                <th className="pb-3 text-right pr-2">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm text-gray-300">
              {data.map((item, idx) => (
                <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition group">
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className="py-3 pl-2">
                      {col.render ? col.render(item) : item[col.field]}
                    </td>
                  ))}
                  <td className="py-3 text-right pr-2">
                    <div className="flex justify-end gap-2 opacity-80 group-hover:opacity-100 transition">
                      <button
                        onClick={() => handleAction(item, 'rejected')}
                        disabled={!!processingId}
                        className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs font-medium disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => handleAction(item, 'approved')}
                        disabled={!!processingId}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 text-xs font-medium disabled:opacity-50"
                      >
                        {processingId === (item.request_id || item.RequestID) ? '...' : 'Approve'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const LaneSelector = ({ activeLane, onSelect }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    {LANES.map(lane => (
      <button
        key={lane.key}
        type="button"
        onClick={() => onSelect(lane.key)}
        className={`p-4 rounded-xl text-left transition border ${activeLane === lane.key
          ? 'bg-accent/10 border-accent text-white'
          : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:border-white/10'
          }`}
        data-testid={`lane-${lane.key}`}
      >
        <div className="text-2xl mb-2">{lane.icon}</div>
        <div className="text-sm font-semibold">{lane.title}</div>
      </button>
    ))}
  </div>
);

const LaneSection = ({ lane, activeLane, customerRegistrations, customerRegProcessing, onApproveCustomer, onRejectCustomer, customerRegLoading, approvedCustomers, approvedCustomersLoading, ownedTokens, selectedCustomerToken, onTokenChange, approvedFundRequests, approvedFundRequestsLoading }) => {
  // Check if this lane allows Unified Dashboard View
  // We apply this to 'customerMint' (Fund Requests), 'customer' (Approvals), and 'list' (Records)

  if (lane.key === 'list') {
    return (
      <div className="space-y-6">
        <div className="glass-panel p-6 border border-white/5 flex items-start gap-4">
          <div className="text-4xl">{lane.icon}</div>
          <div className="flex-1">
            <h3 className="text-2xl font-semibold mb-1">{lane.subtitle}</h3>
            <p className="text-sm text-white/60">{lane.helper}</p>
          </div>
        </div>

        {/* Registered Customers Section */}
        <div className="space-y-4">
          <div className="glass-panel p-4 border border-accent/30 bg-accent/5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h4 className="text-lg font-semibold text-white flex items-center gap-2">
                  <span>👥</span> Registered Customers
                </h4>
                <p className="text-xs text-white/60 mt-1">Customers approved for this token</p>
              </div>
              {ownedTokens.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs uppercase text-white/60 font-semibold">Filter by Token:</label>
                  <select
                    value={selectedCustomerToken}
                    onChange={(e) => onTokenChange(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:border-accent"
                  >
                    {ownedTokens.map(token => (
                      <option key={token.token_id} value={token.token_id}>
                        {token.token_id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {approvedCustomersLoading ? (
            <div className="glass-panel p-6 text-center text-white/70 border border-white/5">
              Loading approved customers...
            </div>
          ) : (() => {
            // Filter customers by selected token
            const filteredByToken = selectedCustomerToken 
              ? approvedCustomers.filter(c => c.token_id === selectedCustomerToken)
              : [];
            
            return filteredByToken.length === 0 ? (
              <div className="glass-panel p-6 text-center border border-dashed border-white/20">
                <p className="text-white/60">No customers for {selectedCustomerToken || 'this token'}</p>
                <p className="text-xs text-white/40 mt-2">Approved customers will appear here.</p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredByToken.map((customer, idx) => (
                  <ApprovedCustomerCard key={customer.customer_id || customer.username || idx} customer={customer} />
                ))}
              </div>
            );
          })()}
        </div>

        {/* Fallback to traditional cards if they want to access raw functions */}
        <details className="group">
          <summary className="list-none text-xs uppercase tracking-wide text-white/30 cursor-pointer hover:text-white/50 py-4 flex items-center gap-2">
            <span>▶</span> Advanced / Other Tools
          </summary>
          <div className="grid gap-6 lg:grid-cols-2 mt-2 pl-4 border-l-2 border-white/5">
            {lane.functions.map(fn => (
              <FunctionCard key={fn.key} {...fn} />
            ))}
          </div>
        </details>
      </div>
    );
  }

  if (lane.key === 'customer') {
    return (
      <div className="space-y-6">
        <div className="glass-panel p-6 border border-white/5 flex items-start gap-4">
          <div className="text-4xl">{lane.icon}</div>
          <div className="flex-1">
            <h3 className="text-2xl font-semibold mb-1">{lane.subtitle}</h3>
            <p className="text-sm text-white/60">{lane.helper}</p>
          </div>
        </div>

        {/* Visual Card Grid for Customer Registrations */}
        {customerRegLoading ? (
          <div className="glass-panel p-6 text-center text-white/70 border border-white/5">
            Loading pending customer registrations...
          </div>
        ) : customerRegistrations.length === 0 ? (
          <div className="glass-panel p-6 text-center border border-dashed border-white/20">
            <p className="text-white/60">No pending customer registrations</p>
            <p className="text-xs text-white/40 mt-2">When customers request registration, they'll appear here for approval.</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {customerRegistrations.map(reg => (
              <CustomerRegistrationCard
                key={reg.request_id}
                registration={reg}
                onApprove={onApproveCustomer}
                onReject={onRejectCustomer}
                isLoading={customerRegProcessing[reg.request_id]}
              />
            ))}
          </div>
        )}

        {/* Fallback to traditional cards if they want to access raw functions */}
        <details className="group">
          <summary className="list-none text-xs uppercase tracking-wide text-white/30 cursor-pointer hover:text-white/50 py-4 flex items-center gap-2">
            <span>▶</span> Advanced / Manual Functions
          </summary>
          <div className="grid gap-6 lg:grid-cols-2 mt-2 pl-4 border-l-2 border-white/5">
            {lane.functions.map(fn => (
              <FunctionCard key={fn.key} {...fn} />
            ))}
          </div>
        </details>
      </div>
    );
  }

  if (lane.key === 'customerMint') {
    return (
      <div className="space-y-6">
        <div className="glass-panel p-6 border border-white/5 flex items-start gap-4">
          <div className="text-4xl">{lane.icon}</div>
          <div className="flex-1">
            <h3 className="text-2xl font-semibold mb-1">{lane.subtitle}</h3>
            <p className="text-sm text-white/60">{lane.helper}</p>
          </div>
        </div>

        {/* Approved Fund Issuance Section */}
        <div className="space-y-4">
          <div className="glass-panel p-4 border border-green-500/30 bg-green-500/5">
            <h4 className="text-lg font-semibold text-white flex items-center gap-2">
              <span>💰</span> Funds Accepted History
            </h4>
            <p className="text-xs text-white/60 mt-1">All approved fund issuance requests</p>
          </div>

          {/* Token Filter */}
          {ownedTokens && ownedTokens.length > 0 && (
            <div className="glass-panel p-4 border border-white/10">
              <label className="text-xs uppercase text-white/60 block mb-2">Filter by Token</label>
              <select
                value={selectedCustomerToken}
                onChange={(e) => onTokenChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-sm focus:outline-none focus:border-accent transition"
              >
                <option value="">Select a token...</option>
                {ownedTokens.map(token => {
                  const tokenId = token.token_id || token.TokenID || token.id || token;
                  return (
                    <option key={tokenId} value={tokenId}>{tokenId}</option>
                  );
                })}
              </select>
            </div>
          )}

          {approvedFundRequestsLoading ? (
            <div className="glass-panel p-6 text-center text-white/70 border border-white/5">
              Loading approved fund requests...
            </div>
          ) : (() => {
            // Filter fund requests by selected token
            const filteredByToken = selectedCustomerToken 
              ? approvedFundRequests.filter(f => (f.token_id || f.TokenID) === selectedCustomerToken)
              : [];
            
            return filteredByToken.length === 0 ? (
              <div className="glass-panel p-6 text-center border border-dashed border-white/20">
                <p className="text-white/60">No approved fund requests for {selectedCustomerToken || 'this token'}</p>
                <p className="text-xs text-white/40 mt-2">Approved fund issuances will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Table Header */}
                <div className="hidden lg:grid grid-cols-6 gap-4 px-4 py-3 bg-white/5 border border-white/10 rounded-lg">
                  <div className="text-xs uppercase font-semibold text-white/60">Request ID</div>
                  <div className="text-xs uppercase font-semibold text-white/60">Customer ID</div>
                  <div className="text-xs uppercase font-semibold text-white/60">Token</div>
                  <div className="text-xs uppercase font-semibold text-white/60">Amount</div>
                  <div className="text-xs uppercase font-semibold text-white/60">KYC Status</div>
                  <div className="text-xs uppercase font-semibold text-white/60">Approved</div>
                </div>

                {/* Table Rows */}
                {filteredByToken.map((fund, idx) => (
                  <ApprovedFundRequestCard key={fund.request_id || fund.RequestID || idx} fundRequest={fund} />
                ))}
              </div>
            );
          })()}
        </div>

        {/* Fallback to traditional cards if they want to access raw functions */}
        <details className="group">
          <summary className="list-none text-xs uppercase tracking-wide text-white/30 cursor-pointer hover:text-white/50 py-4 flex items-center gap-2">
            <span>▶</span> Advanced / Deployment Functions
          </summary>
          <div className="grid gap-6 lg:grid-cols-2 mt-2 pl-4 border-l-2 border-white/5">
            {lane.functions.map(fn => (
              <FunctionCard key={fn.key} {...fn} />
            ))}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="glass-panel p-6 space-y-6 border border-white/5">
      <div className="flex items-start gap-4">
        <div className="text-4xl">{lane.icon}</div>
        <div className="flex-1">
          <h3 className="text-2xl font-semibold mb-1">{lane.subtitle}</h3>
          {lane.helper && <p className="text-sm text-white/60">{lane.helper}</p>}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {lane.functions.map(fn => (
          <FunctionCard key={fn.key} {...fn} />
        ))}
      </div>
    </div>
  );
};

const BankDashboard = () => {
  const [latestRegistration, setLatestRegistration] = useState(() => getStoredRegistrationSnapshot());
  const [activeLane, setActiveLane] = useState(LANES[0]?.key || 'kycConfig');
  const [autoCustomerStatus, setAutoCustomerStatus] = useState({ state: 'idle', detail: '' });
  const lastAutoUserRef = useRef('');
  const [stats, setStats] = useState({
    customers: 0,
    pendingApprovals: 0,
    activeCurrencies: 0,
    transactions: 0
  });
  const [walletSnapshot, setWalletSnapshot] = useState({ loading: false, data: null, error: '' });
  const [tokenConfigs, setTokenConfigs] = useState([]);
  const [ownedTokens, setOwnedTokens] = useState([]);
  const [ownedTokensLoading, setOwnedTokensLoading] = useState(false);
  const [ownedTokensError, setOwnedTokensError] = useState('');
  const [selectedIntegrationToken, setSelectedIntegrationToken] = useState('');
  const [integrationGuide, setIntegrationGuide] = useState(null);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationError, setIntegrationError] = useState('');
  const [customerRegistrations, setCustomerRegistrations] = useState([]);
  const [customerRegLoading, setCustomerRegLoading] = useState(false);
  const [customerRegProcessing, setCustomerRegProcessing] = useState({});
  const [approvedCustomers, setApprovedCustomers] = useState([]);
  const [approvedCustomersLoading, setApprovedCustomersLoading] = useState(false);
  const [selectedCustomerToken, setSelectedCustomerToken] = useState('');
  const [approvedFundRequests, setApprovedFundRequests] = useState([]);
  const [approvedFundRequestsLoading, setApprovedFundRequestsLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncSnapshot = () => setLatestRegistration(getStoredRegistrationSnapshot());
    const handleCustomEvent = event => {
      if (event?.detail) {
        setLatestRegistration(event.detail);
      } else {
        syncSnapshot();
      }
    };

    window.addEventListener('storage', syncSnapshot);
    window.addEventListener('latest-registration-credentials', handleCustomEvent);
    syncSnapshot();

    return () => {
      window.removeEventListener('storage', syncSnapshot);
      window.removeEventListener('latest-registration-credentials', handleCustomEvent);
    };
  }, []);

  // Automatically register and verify the current customer without exposing frontend forms
  useEffect(() => {
    const userId = latestRegistration?.username;
    const networkAddress = latestRegistration?.network_address;

    if (!userId || !networkAddress) {
      setAutoCustomerStatus({ state: 'idle', detail: '' });
      return;
    }

    // Avoid duplicate calls for the same user (e.g., React strict mode)
    if (lastAutoUserRef.current === userId) {
      return;
    }

    let cancelled = false;
    const run = async () => {
      setAutoCustomerStatus({ state: 'pending', detail: 'Registering customer automatically...' });
      try {
        const { data: registration } = await client.post('/participant/register', { userId });
        if (cancelled) return;
        const { data: verification } = await client.get('/participant/exists', {
          params: { networkAddress }
        });
        if (cancelled) return;
        setAutoCustomerStatus({
          state: 'success',
          detail: `Customer ${userId} registered and verified automatically.`,
          registration,
          verification
        });
        lastAutoUserRef.current = userId;
      } catch (error) {
        if (cancelled) return;
        const detail =
          error?.response?.data?.detail ||
          error?.response?.data?.error ||
          error?.message ||
          'Automatic registration failed';
        setAutoCustomerStatus({
          state: 'error',
          detail
        });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [latestRegistration?.username, latestRegistration?.network_address]);

  useEffect(() => {
    let cancelled = false;
    const loadTokenConfigs = async () => {
      try {
        const response = await safeGet('/bank/token-configs', { configs: [] });
        if (!cancelled) {
          setTokenConfigs(Array.isArray(response?.configs) ? response.configs : []);
        }
      } catch (error) {
        if (!cancelled) {
          setTokenConfigs([]);
        }
      }
    };
    loadTokenConfigs();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!latestRegistration?.network_address) {
      setOwnedTokens([]);
      return;
    }
    let cancelled = false;
    const fetchOwnedTokens = async () => {
      setOwnedTokensLoading(true);
      setOwnedTokensError('');
      try {
        const { data } = await client.get('/bank/tokens/owned', {
          params: {
            ownerNetworkAddress: latestRegistration.network_address,
            userId: latestRegistration.username
          }
        });
        if (!cancelled) {
          setOwnedTokens(Array.isArray(data?.tokens) ? data.tokens : []);
          setOwnedTokensLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          const detail = error?.response?.data?.error || error?.message || 'Unable to fetch owned tokens';
          setOwnedTokensError(detail);
          setOwnedTokens([]);
          setOwnedTokensLoading(false);
        }
      }
    };
    fetchOwnedTokens();
    return () => {
      cancelled = true;
    };
  }, [latestRegistration?.network_address, latestRegistration?.username]);

  useEffect(() => {
    if (!selectedIntegrationToken && ownedTokens.length > 0) {
      setSelectedIntegrationToken(ownedTokens[0].token_id);
    }
  }, [ownedTokens, selectedIntegrationToken]);

  useEffect(() => {
    if (!selectedIntegrationToken) {
      setIntegrationGuide(null);
      setIntegrationError('');
      return;
    }
    let cancelled = false;
    const loadIntegrationGuide = async () => {
      setIntegrationLoading(true);
      setIntegrationError('');
      try {
        const { data } = await client.get(`/token/${encodeURIComponent(selectedIntegrationToken)}/integration`);
        if (cancelled) return;
        if (!data?.success) {
          throw new Error(data?.detail || 'Unable to load integration guide');
        }
        setIntegrationGuide(data.guide || null);
      } catch (error) {
        if (!cancelled) {
          const detail = error?.response?.data?.detail || error?.message || 'Unable to load integration guide';
          setIntegrationGuide(null);
          setIntegrationError(detail);
        }
      } finally {
        if (!cancelled) {
          setIntegrationLoading(false);
        }
      }
    };
    loadIntegrationGuide();
    return () => {
      cancelled = true;
    };
  }, [selectedIntegrationToken]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [
          participants,
          currencies,
          pendingTokenReqs,
          pendingMintReqs,
          tokenTransferHistory
        ] = await Promise.all([
          safeGet('/bank/participants/approved', []),
          safeGet('/bank/view-all-tokens', []),
          safeGet('/token-requests/pending', []),
          safeGet('/mint-requests/pending', []),
          safeGet('/token-transfer-history', [])
        ]);

        const totalPending =
          (Array.isArray(pendingTokenReqs) ? pendingTokenReqs.length : 0) +
          (Array.isArray(pendingMintReqs) ? pendingMintReqs.length : 0);

        const today = new Date().toDateString();
        const todayTransactions = [
          ...(Array.isArray(tokenTransferHistory) ? tokenTransferHistory : [])
        ].filter(tx => {
          if (!tx.timestamp) return false;
          const txDate = new Date(tx.timestamp).toDateString();
          return txDate === today;
        }).length;

        setStats({
          customers: Array.isArray(participants) ? participants.length : 0,
          pendingApprovals: totalPending,
          activeCurrencies: Array.isArray(currencies) ? currencies.length : 0,
          transactions: todayTransactions
        });
      } catch (error) {
        console.warn('Failed to fetch stats:', error);
      }
    };

    fetchStats();
  }, []);

  useEffect(() => {
    if (!latestRegistration?.network_address || !latestRegistration?.username) {
      setWalletSnapshot(prev => ({ ...prev, data: null }));
      return;
    }

    let cancelled = false;
    const fetchWalletSnapshot = async () => {
      setWalletSnapshot(prev => ({ ...prev, loading: true, error: '' }));
      try {
        const { data } = await client.get('/bank/wallet', {
          params: {
            networkAddress: latestRegistration.network_address
          }
        });
        if (!cancelled) {
          setWalletSnapshot({ loading: false, data, error: '' });
        }
      } catch (error) {
        if (!cancelled) {
          const detail = error?.response?.data?.detail || error?.message || 'Unable to load wallet snapshot';
          setWalletSnapshot({ loading: false, data: null, error: detail });
        }
      }
    };

    fetchWalletSnapshot();
    return () => {
      cancelled = true;
    };
  }, [latestRegistration]);

  const foreignCurrencies = Array.isArray(walletSnapshot.data?.foreignCurrencies)
    ? walletSnapshot.data.foreignCurrencies
    : Array.isArray(walletSnapshot.data?.foreign_currencies)
      ? walletSnapshot.data.foreign_currencies
      : [];

  const bindRequestToRegistration = (fn) => (cleanedValues, rawValues) => {
    const base = fn ? fn(cleanedValues, rawValues) : {};
    if (!latestRegistration?.username || !latestRegistration?.network_address) {
      return base;
    }
    const enforcedParams = {
      ownerNetworkAddress: latestRegistration.network_address,
      networkAddress: latestRegistration.network_address,
      ownerID: latestRegistration.network_address
    };
    const enforcedData = {
      ownerNetworkAddress: latestRegistration.network_address,
      networkAddress: latestRegistration.network_address,
      ownerID: latestRegistration.network_address
    };
    if (base.params) {
      base.params = { ...enforcedParams, ...base.params };
    } else {
      base.params = enforcedParams;
    }
    if (base.data) {
      base.data = { ...enforcedData, ...base.data };
    } else {
      base.data = enforcedData;
    }
    return base;
  };

  const dynamicLanes = useMemo(() => {
    return LANES.map(lane => ({
      ...lane,
      functions: (lane.functions || []).map(func => ({
        ...func,
        buildRequest: bindRequestToRegistration(func.buildRequest),
        fields: (func.fields || []).map(field => {
          const isNetworkAddress = [
            'networkAddress',
            'ownerNetworkAddress',
            'senderOwnerAddress',
            'receiverOwnerAddress',
            'approver',
            'ownerID',
            'senderParticipantID'
          ].includes(field.name);

          const isUserId = [
            'userId',
            'requestedBy'
          ].includes(field.name);

          if (latestRegistration?.network_address && isNetworkAddress) {
            return {
              ...field,
              defaultValue: latestRegistration.network_address,
              disabled: true,
              helper: 'Bound to your registered network address'
            };
          }

          if (latestRegistration?.username && isUserId) {
            return {
              ...field,
              defaultValue: latestRegistration.username
            };
          }

          return field;
        })
      }))
    }));
  }, [latestRegistration]);

  // Fetch customer registrations on activation
  const fetchCustomerRegistrations = async () => {
    setCustomerRegLoading(true);
    try {
      const regs = await safeGet('/bank/customer-registrations/pending', []);
      setCustomerRegistrations(Array.isArray(regs) ? regs : []);
    } catch (error) {
      console.warn('Failed to fetch customer registrations:', error);
      setCustomerRegistrations([]);
    } finally {
      setCustomerRegLoading(false);
    }
  };

  // Fetch customer registrations when customer lane becomes active
  useEffect(() => {
    if (activeLane === 'customer') {
      fetchCustomerRegistrations();
    }
  }, [activeLane]);

  // Fetch approved customers when list lane becomes active
  const fetchApprovedCustomers = async () => {
    setApprovedCustomersLoading(true);
    try {
      const approved = await safeGet('/bank/participants/approved', []);
      const allCustomers = Array.isArray(approved) ? approved : [];
      
      // Filter customers to only show those belonging to the user's owned tokens
      const userTokenIds = ownedTokens.map(t => t.token_id);
      const filteredCustomers = allCustomers.filter(customer => 
        userTokenIds.includes(customer.token_id)
      );
      
      console.log('All approved customers:', allCustomers.length);
      console.log('User owns tokens:', userTokenIds);
      console.log('Filtered for this dashboard:', filteredCustomers.length);
      
      setApprovedCustomers(filteredCustomers);
    } catch (error) {
      console.warn('Failed to fetch approved customers:', error);
      setApprovedCustomers([]);
    } finally {
      setApprovedCustomersLoading(false);
    }
  };

  // Fetch approved fund requests (already approved mint requests)
  const fetchApprovedFundRequests = async () => {
    setApprovedFundRequestsLoading(true);
    try {
      const funds = await safeGet('/participant-mint-requests/approved', []);
      const allFunds = Array.isArray(funds) ? funds : [];
      
      // Filter fund requests to only show those belonging to the user's owned tokens
      const userTokenIds = ownedTokens.map(t => {
        return t.token_id || t.TokenID || t.id || t;
      });
      
      const filteredFunds = allFunds.filter(fund => {
        const fundTokenId = fund.token_id || fund.TokenID || fund.id;
        return userTokenIds.includes(fundTokenId);
      });
      
      console.log('All approved fund requests:', allFunds.length);
      console.log('User owns tokens:', userTokenIds);
      console.log('Filtered for this dashboard:', filteredFunds.length, filteredFunds);
      
      setApprovedFundRequests(filteredFunds);
    } catch (error) {
      console.warn('Failed to fetch approved fund requests:', error);
      setApprovedFundRequests([]);
    } finally {
      setApprovedFundRequestsLoading(false);
    }
  };

  // Set default token when owned tokens load
  useEffect(() => {
    if (ownedTokens.length > 0 && !selectedCustomerToken) {
      setSelectedCustomerToken(ownedTokens[0].token_id);
    }
  }, [ownedTokens]);

  useEffect(() => {
    if (activeLane === 'list') {
      fetchApprovedCustomers();
    }
  }, [activeLane, ownedTokens]);

  // Fetch approved fund requests when customerMint lane becomes active
  useEffect(() => {
    if (activeLane === 'customerMint') {
      fetchApprovedFundRequests();
    }
  }, [activeLane, ownedTokens]);

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

  const currentLane = dynamicLanes.find(lane => lane.key === activeLane) || dynamicLanes[0];
  return (
    <div className="space-y-8">
      <div className="glass-panel p-6 space-y-4 border border-white/5">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/40">Bank Operations Center</p>
          <h2 className="text-3xl font-bold mt-1">International Transaction Management</h2>
          <p className="text-sm text-white/60 mt-2">
            Manage customer accounts, approve transactions, and oversee international fund transfers.
          </p>
          {/* KYC quick-access removed */}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon="👥" label="Total Customers" value={stats.customers.toLocaleString()} subtext="Approved accounts" />
        <StatCard icon="⏳" label="Pending Approvals" value={stats.pendingApprovals.toLocaleString()} subtext="Awaiting review" />
        <StatCard icon="💰" label="Active Currencies" value={stats.activeCurrencies.toLocaleString()} subtext="Available for trading" />
        <StatCard icon="📊" label="Transactions Today" value={stats.transactions.toLocaleString()} subtext="Completed transfers" />
      </div>

      {walletSnapshot.loading && (
        <div className="glass-panel p-4 border border-white/5 text-sm text-white/70">Loading wallet snapshot…</div>
      )}
      {walletSnapshot.error && (
        <div className="glass-panel p-4 border border-red-500/30 bg-red-500/5 text-sm text-red-200">
          {walletSnapshot.error}
        </div>
      )}
      {walletSnapshot.data && !walletSnapshot.loading && (
        <div className="glass-panel p-6 border border-white/5 grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-white/50">Primary Currency</p>
            <p className="text-xl font-semibold">{walletSnapshot.data.currency || 'Pending assignment'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-white/50">Minted Supply</p>
            <p className="text-xl font-semibold">
              {walletSnapshot.data.mintedCoinsDisplay ||
                walletSnapshot.data.minted_coins_display ||
                walletSnapshot.data.mintedCoins ||
                0}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-white/50">Wallet Balance</p>
            <p className="text-xl font-semibold">
              {walletSnapshot.data.walletBalanceDisplay ||
                walletSnapshot.data.wallet_balance_display ||
                (walletSnapshot.data.currencySymbol || walletSnapshot.data.currency_symbol || '$') +
                (walletSnapshot.data.walletBalance ||
                  walletSnapshot.data.wallet_balance ||
                  0).toLocaleString()}
            </p>
          </div>
        </div>
      )}
      {walletSnapshot.data && foreignCurrencies.length > 0 && (
        <div className="glass-panel p-6 border border-accent/20 space-y-4">
          <div>
            <p className="text-xs uppercase text-white/50">Foreign Currency Holdings</p>
            <p className="text-sm text-white/60">
              Balances received from other tokens are tracked separately from your domestic currency.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {foreignCurrencies.map((fx, idx) => (
              <div key={`${fx.currency || 'foreign'}-${idx}`} className="bg-white/5 rounded-xl p-4 space-y-2">
                <div className="text-xs uppercase text-white/50">Currency</div>
                <div className="text-lg font-semibold text-white">{fx.currency || 'Foreign'}</div>
                <div className="text-xs uppercase text-white/50">Balance</div>
                <div className="text-lg font-semibold text-white">
                  {fx.display ||
                    `${fx.currency_symbol || ''}${(fx.amount || 0).toLocaleString()}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {latestRegistration?.wallet_created && (
        <div className="glass-panel border-2 border-accent/30 p-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔑</span>
            <p className="text-sm uppercase tracking-wide text-accent font-semibold">Recent Registration</p>
          </div>
          <p className="text-sm text-white/70">Use these credentials when performing operations.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="bg-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-white/40 mb-1">Username</p>
              <p className="font-mono text-sm text-white break-all">{latestRegistration.username}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-white/40 mb-1">Role</p>
              <p className="text-sm text-white">{latestRegistration.role === 'bank' ? 'Bank Institution' : latestRegistration.role === 'customer' ? 'Customer' : latestRegistration.role}</p>
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-xs uppercase text-white/40 mb-1">Account Number</p>
            <p className="font-mono text-sm break-all text-accent">{latestRegistration.network_address || '—'}</p>
          </div>
        </div>
      )}

      <div className="glass-panel p-6 space-y-6 border border-white/5">
        <div>
          <h3 className="text-xl font-semibold mb-1">Operation Categories</h3>
          <p className="text-sm text-white/60">Choose a category to view and perform banking operations.</p>
        </div>
        <LaneSelector activeLane={activeLane} onSelect={setActiveLane} />
      </div>

      <div className="glass-panel p-6 space-y-4 border border-white/5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/40">Bank API Coverage</p>
            <h3 className="text-2xl font-semibold mt-1">KYC Configurations</h3>
            <p className="text-sm text-white/60">
              Track which tokens already have a login URL + auth key wired up so customers can onboard.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-white/50">Configured Tokens</p>
            <p className="text-3xl font-bold text-white">{tokenConfigs.length}</p>
          </div>
        </div>

        {tokenConfigs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 p-4 text-sm text-white/60">
            No tokens configured yet. Use “Bank API Setup” above to add the bank login URL + API key for each token.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-white/60 uppercase text-xs">
                  <th className="py-2 pr-4">Token ID</th>
                  <th className="py-2 pr-4">Bank Login URL</th>
                  <th className="py-2 pr-4">Auth Key</th>
                  <th className="py-2 pr-4">Updated</th>
                </tr>
              </thead>
              <tbody>
                {tokenConfigs.map(config => (
                  <tr key={config.token_id} className="border-t border-white/5">
                    <td className="py-3 pr-4 font-mono text-xs text-white">{config.token_id}</td>
                    <td className="py-3 pr-4 text-white/80 break-all">{config.bank_api_base_url || '—'}</td>
                    <td className="py-3 pr-4">{config.has_auth_key ? '🔐 Present' : <span className="text-red-300">Missing</span>}</td>
                    <td className="py-3 pr-4 text-white/70">
                      {config.updated_at ? new Date(config.updated_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="glass-panel p-6 space-y-4 border border-white/5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/40">Assigned Tokens</p>
            <h3 className="text-2xl font-semibold mt-1">Your Token Inventory</h3>
            <p className="text-sm text-white/60">
              Visible only to the logged-in owner—shows the exact token IDs issued to your institution.
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-white/50">Total Tokens</p>
            <p className="text-3xl font-bold text-white">{ownedTokens.length}</p>
          </div>
        </div>

        {ownedTokensLoading ? (
          <div className="rounded-xl border border-white/10 p-4 text-sm text-white/70">Loading owned tokens…</div>
        ) : ownedTokensError ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {ownedTokensError}
          </div>
        ) : ownedTokens.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/20 p-4 text-sm text-white/60">
            No tokens assigned to {latestRegistration?.network_address || 'this owner'} yet.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-white/60 uppercase text-xs">
                  <th className="py-2 pr-4">Token ID</th>
                  <th className="py-2 pr-4">Currency</th>
                  <th className="py-2 pr-4">Minted</th>
                  <th className="py-2 pr-4">Available</th>
                  <th className="py-2 pr-4">Assigned At</th>
                </tr>
              </thead>
              <tbody>
                {ownedTokens.map(token => (
                  <tr key={token.token_id} className="border-t border-white/5">
                    <td className="py-3 pr-4 font-mono text-xs text-white">{token.token_id}</td>
                    <td className="py-3 pr-4 text-white/80">{token.currency || token.Currency || 'N/A'}</td>
                    <td className="py-3 pr-4 text-white/80">{token.minted || 0}</td>
                    <td className="py-3 pr-4">{token.available ? '✅ Ready' : '⏳ Pending'}</td>
                    <td className="py-3 pr-4 text-white/70">
                      {token.assigned_at || token.assignedAt
                        ? new Date(token.assigned_at || token.assignedAt).toLocaleString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Only show the Owner Integration Runbook section if the integrationRunbook lane is selected */}
      {activeLane === 'integrationRunbook' && (
        <div className="glass-panel p-6 space-y-5 border border-accent/30">
          <div className="flex flex-col gap-2">
            <p className="text-xs uppercase tracking-wide text-accent/80">BetweenNetwork Lane</p>
            <h3 className="text-2xl font-semibold text-white">Owner Integration Runbook</h3>
            <p className="text-sm text-white/70">
              One token = one owner wallet + one bank database + one secret. Select a token to view the per-token steps: connect owner, attach bank API URL/key,
              register customers for that currency, approve, and let BetweenNetwork pull PII.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-white/80">Select Token</span>
              <select
                value={selectedIntegrationToken}
                onChange={event => setSelectedIntegrationToken(event.target.value)}
                className="mt-2 w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40"
              >
                <option value="" disabled>
                  {ownedTokens.length > 0 ? 'Choose a token' : 'No tokens assigned'}
                </option>
                {ownedTokens.map(token => (
                  <option key={token.token_id} value={token.token_id} className="bg-slate-900 text-white">
                    {token.token_id}
                  </option>
                ))}
              </select>
              {ownedTokens.length === 0 && (
                <p className="text-xs text-white/50 mt-2">No tokens yet. Once assigned, integration steps will appear here.</p>
              )}
            </label>
            {integrationLoading ? (
              <div className="rounded-xl border border-white/10 p-4 flex items-center justify-center text-sm text-white/70">
                Loading integration instructions…
              </div>
            ) : integrationError ? (
              <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-200">
                {integrationError}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                {!integrationGuide ? 'Select a token to view integration instructions.' : 'Guide ready below.'}
              </div>
            )}
          </div>

          {integrationGuide && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <p className="text-xs uppercase tracking-wide text-white/50">Owner Details</p>
                  <p className="text-sm text-white">
                    <strong>Wallet label:</strong>{' '}
                    <span className="font-mono text-accent">{integrationGuide.ownerUserId || 'not assigned'}</span>
                  </p>
                  <p className="text-sm text-white">
                    <strong>networkAddress:</strong>{' '}
                    <span className="font-mono text-accent break-all">{integrationGuide.ownerNetworkAddress || 'pending generation'}</span>
                  </p>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-white/50 mb-1">Endpoints</p>
                    <ul className="text-sm text-white/80 space-y-1">
                      {Object.entries(integrationGuide.endpoints || {}).map(([key, value]) => (
                        <li key={key}>
                          <span className="font-semibold">{key}:</span> <span className="break-all">{value}</span>
                        </li>
                      ))}
                      {Object.keys(integrationGuide.endpoints || {}).length === 0 && <li>No endpoints returned.</li>}
                    </ul>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <p className="text-xs uppercase tracking-wide text-white/50">Bank Database Integration Guide</p>
                  <p className="text-sm text-white/80">
                    To enable <strong>Customer Intelligence</strong>, your bank server must expose the following secure endpoint:
                  </p>
                  <div className="bg-black/40 p-3 rounded-lg text-xs font-mono text-accent space-y-1">
                    <p>GET /between/customer/:id</p>
                    <p className="text-white/60">Headers: x-bank-api-key: &lt;your-secret-key&gt;</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-white/50 mb-1">Required Response Format</p>
                    <pre className="bg-black/40 p-3 rounded-lg text-xs text-white/80 overflow-auto">
                      {JSON.stringify({
                        ok: true,
                        customer: {
                          name: "John Doe",
                          phone: "+1-555-0199",
                          email: "john@example.com"
                        }
                      }, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-white/50 mb-1">Integration Steps</p>
                    <ol className="list-decimal pl-5 text-sm text-white/80 space-y-1">
                      <li>Use the owner wallet for this token (see wallet label above) to sign API calls or JWT.</li>
                      <li>In <strong>Bank API Setup</strong>, enter this token ID, the bank KYC Base URL for this database, and its API key.</li>
                      <li>Expose the endpoint above so BetweenNetwork can pull PII with your `x-bank-api-key`.</li>
                      <li>When a user signs up, call <code>/api/bank/register-customer</code> with this token ID using the owner wallet.</li>
                      <li>Approve the pending registration in the dashboard; BetweenNetwork will then fetch PII from your endpoint.</li>
                      <li>Repeat these steps for every token (do not reuse demo-bank URLs/keys).</li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-white/50 mb-2">Register-Customer Example</p>
                  <pre className="text-xs text-white/80 overflow-auto max-h-64">
                    {JSON.stringify({
                      method: 'POST',
                      url: `${integrationGuide?.endpoints?.registerCustomer || '/api/bank/register-customer'}`,
                      headers: {
                        'Content-Type': 'application/json',
                        'x-user-id': integrationGuide.ownerUserId || '<owner wallet label>'
                      },
                      body: {
                        bankId: 'YOUR-BANK',
                        customerId: 'u_123456789',
                        tokenID: selectedIntegrationToken || '<token_id>',
                        publicDetails: {
                          tier: 'gold',
                          region: 'north'
                        }
                      }
                    }, null, 2)}
                  </pre>
                </div>
                <div className="space-y-4">
                  {integrationGuide.examples?.curl_register && (
                    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <p className="text-xs uppercase tracking-wide text-white/50 mb-2">cURL Example</p>
                      <pre className="text-xs text-white/80 overflow-auto max-h-56">{integrationGuide.examples.curl_register}</pre>
                    </div>
                  )}
                  {integrationGuide.examples?.node_fetch && (
                    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                      <p className="text-xs uppercase tracking-wide text-white/50 mb-2">Node Example</p>
                      <pre className="text-xs text-white/80 overflow-auto max-h-56">{integrationGuide.examples.node_fetch}</pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <LaneSection 
        lane={currentLane} 
        customerRegistrations={customerRegistrations}
        customerRegLoading={customerRegLoading}
        customerRegProcessing={customerRegProcessing}
        onApproveCustomer={handleApproveCustomer}
        onRejectCustomer={handleRejectCustomer}
        approvedCustomers={approvedCustomers}
        approvedCustomersLoading={approvedCustomersLoading}
        ownedTokens={ownedTokens}
        selectedCustomerToken={selectedCustomerToken}
        onTokenChange={setSelectedCustomerToken}
        approvedFundRequests={approvedFundRequests}
        approvedFundRequestsLoading={approvedFundRequestsLoading}
      />
    </div>
  );
};

export default BankDashboard;
