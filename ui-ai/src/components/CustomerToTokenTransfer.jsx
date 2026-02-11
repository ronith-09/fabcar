import { useState, useEffect } from 'react';
import {
  initiateCustomerToTokenTransfer,
  approveBySenderBank,
  approveByReceiverBank,
  getPendingTransfers,
  getTransferHistory
} from '../services/customerToTokenTransferService';

export default function CustomerToTokenTransfer({ userRole, userNetworkAddress, tokenId }) {
  const [activeTab, setActiveTab] = useState('initiate');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  // Initiate Transfer Form State
  const [formData, setFormData] = useState({
    senderTokenID: '',
    receiverTokenID: '',
    receiverCustomerNetworkAddress: '',
    amount: ''
  });

  // Bank Approval States
  const [pendingTransfers, setPendingTransfers] = useState([]);
  const [transferHistory, setTransferHistory] = useState([]);
  const [selectedTransfer, setSelectedTransfer] = useState(null);

  useEffect(() => {
    if (activeTab === 'pending' && (userRole === 'bank' || userRole === 'admin')) {
      fetchPendingTransfers();
    } else if (activeTab === 'history') {
      fetchTransferHistory();
    }
  }, [activeTab]);

  const fetchPendingTransfers = async () => {
    setLoading(true);
    try {
      const response = await getPendingTransfers(tokenId || '', userNetworkAddress || '');
      setPendingTransfers(response.pending_transfers || []);
    } catch (err) {
      setError('Failed to load pending transfers: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransferHistory = async () => {
    setLoading(true);
    try {
      const response = await getTransferHistory(tokenId || '');
      setTransferHistory(response.completed_transfers || []);
    } catch (err) {
      setError('Failed to load transfer history: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInitiateTransfer = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (!formData.senderTokenID || !formData.receiverTokenID || !formData.receiverCustomerNetworkAddress || !formData.amount) {
        throw new Error('All fields (sender token, receiver token, receiver customer network address, amount) are required');
      }

      const result = await initiateCustomerToTokenTransfer(
        formData.senderTokenID,
        formData.receiverTokenID,
        formData.receiverCustomerNetworkAddress,
        formData.amount
      );

      console.log('Transfer response received:', result);

      // Display detailed commission and exchange rate breakdown
      const commissionDisplay = result.commission_percentage 
        ? `${result.commission_percentage.toFixed(2)}% (${result.commission_amount} ${formData.receiverTokenID.split('-')[1] || 'units'})`
        : 'No commission configured';

      const exchangeRateDisplay = result.exchange_rate && result.exchange_rate !== 1.0
        ? `1 : ${result.exchange_rate.toFixed(6)}`
        : 'Same currency (1:1)';

      setMessage({
        type: 'success',
        title: '✅ Transfer Initiated Successfully',
        details: {
          transferId: result.transfer_id,
          amount: result.amount,
          exchangeRate: {
            rate: result.exchange_rate,
            display: exchangeRateDisplay,
            convertedAmount: result.converted_amount
          },
          commission: {
            percentage: result.commission_percentage,
            amount: result.commission_amount,
            display: commissionDisplay
          },
          receiverNet: result.receiver_net_amount,
          status: result.status
        }
      });

      setFormData({
        senderTokenID: '',
        receiverTokenID: '',
        receiverCustomerNetworkAddress: '',
        amount: ''
      });
    } catch (err) {
      console.error('Transfer error:', err);
      console.error('Error details:', err.response?.data || err.message);
      setError(err.response?.data?.error || err.message || 'Failed to initiate transfer');
    } finally {
      setLoading(false);
    }
  };

  const handleSenderBankApproval = async (transferId, approve) => {
    setLoading(true);
    setError(null);

    try {
      const result = await approveBySenderBank(transferId, approve);

      setMessage({
        type: 'success',
        title: approve ? 'Transfer Approved' : 'Transfer Rejected',
        details: result.message
      });

      await fetchPendingTransfers();
      setSelectedTransfer(null);
    } catch (err) {
      setError(err.message || 'Failed to approve transfer');
    } finally {
      setLoading(false);
    }
  };

  const handleReceiverBankApproval = async (transferId, approve) => {
    setLoading(true);
    setError(null);

    try {
      const result = await approveByReceiverBank(transferId, approve);

      setMessage({
        type: 'success',
        title: approve ? 'Transfer Completed' : 'Transfer Rejected',
        details: result.message
      });

      await fetchPendingTransfers();
      setSelectedTransfer(null);
    } catch (err) {
      setError(err.message || 'Failed to process transfer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10">
        <button
          onClick={() => setActiveTab('initiate')}
          className={`px-6 py-3 font-semibold transition ${
            activeTab === 'initiate'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-white/60 hover:text-white'
          }`}
        >
          💳 Initiate Transfer
        </button>
        {(userRole === 'bank' || userRole === 'admin') && (
          <>
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-6 py-3 font-semibold transition ${
                activeTab === 'pending'
                  ? 'text-yellow-400 border-b-2 border-yellow-400'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              ⏳ Pending Approvals
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-3 font-semibold transition ${
                activeTab === 'history'
                  ? 'text-green-400 border-b-2 border-green-400'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              ✅ History
            </button>
          </>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-200">
          <p className="font-semibold">Error</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {message && (
        <TransferConfirmationCard 
          message={message} 
          onDismiss={() => setMessage(null)}
        />
      )}

      {/* Content */}
      {activeTab === 'initiate' && (
        <InitiateTransferForm
          formData={formData}
          setFormData={setFormData}
          loading={loading}
          onSubmit={handleInitiateTransfer}
        />
      )}

      {activeTab === 'pending' && (
        <PendingTransfersList
          transfers={pendingTransfers}
          loading={loading}
          userRole={userRole}
          selectedTransfer={selectedTransfer}
          setSelectedTransfer={setSelectedTransfer}
          onSenderApprove={handleSenderBankApproval}
          onReceiverApprove={handleReceiverBankApproval}
        />
      )}

      {activeTab === 'history' && (
        <TransferHistoryList transfers={transferHistory} loading={loading} />
      )}
    </div>
  );
}

// Sub-component: Initiate Transfer Form
function InitiateTransferForm({ formData, setFormData, loading, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="glass-panel p-6 space-y-4">
      <h2 className="text-2xl font-bold">Initiate Customer-to-Token Transfer</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-2">Sender Token ID</label>
          <input
            type="text"
            placeholder="e.g., HDFC-USD-8f2a3b4c-v1"
            value={formData.senderTokenID}
            onChange={(e) => setFormData({ ...formData, senderTokenID: e.target.value })}
            className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-blue-400"
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Receiver Token ID</label>
          <input
            type="text"
            placeholder="e.g., SBI-INR-5a8c9f2d-v1"
            value={formData.receiverTokenID}
            onChange={(e) => setFormData({ ...formData, receiverTokenID: e.target.value })}
            className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-blue-400"
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Receiver Customer Network Address</label>
          <input
            type="text"
            placeholder="e.g., cust_2a4b8c9f-d3e2-4a5b-8c9f-2a4b8c9f"
            value={formData.receiverCustomerNetworkAddress}
            onChange={(e) => setFormData({ ...formData, receiverCustomerNetworkAddress: e.target.value })}
            className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-blue-400"
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Amount</label>
          <input
            type="number"
            placeholder="100"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/50 focus:outline-none focus:border-blue-400"
            disabled={loading}
            min="0"
          />
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-xs text-white/60 mb-4">
        💡 <strong>Commission Rate:</strong> Automatically applied from the configured rate for the receiver token
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white font-semibold transition"
      >
        {loading ? '⏳ Processing...' : '🚀 Initiate Transfer'}
      </button>
    </form>
  );
}

// Sub-component: Pending Transfers List
function PendingTransfersList({
  transfers,
  loading,
  userRole,
  selectedTransfer,
  setSelectedTransfer,
  onSenderApprove,
  onReceiverApprove
}) {
  if (loading && transfers.length === 0) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (transfers.length === 0) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-white/60">No pending transfers</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {transfers.map((transfer) => (
        <div key={transfer.TransferRequestID} className="glass-panel p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-white/50">Transfer ID</p>
              <p className="font-mono text-sm truncate">{transfer.TransferRequestID}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Amount</p>
              <p className="font-bold text-lg">{transfer.Amount}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Commission</p>
              <p className="text-yellow-400 font-semibold">
                {transfer.CommissionAmount ? `${transfer.CommissionAmount} (${(transfer.CommissionPercentage || 0).toFixed(2)}%)` : 'None'}
              </p>
            </div>
            <div>
              <p className="text-xs text-white/50">Status</p>
              <p className="font-semibold">{transfer.Status}</p>
            </div>
          </div>

          {selectedTransfer === transfer.TransferRequestID && (
            <ApprovalSection
              transfer={transfer}
              onSenderApprove={onSenderApprove}
              onReceiverApprove={onReceiverApprove}
              loading={loading}
            />
          )}

          <button
            onClick={() =>
              setSelectedTransfer(
                selectedTransfer === transfer.TransferRequestID
                  ? null
                  : transfer.TransferRequestID
              )
            }
            className="mt-2 px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-sm font-semibold transition"
          >
            {selectedTransfer === transfer.TransferRequestID ? '▼ Hide Details' : '▶ Show Details'}
          </button>
        </div>
      ))}
    </div>
  );
}

// Sub-component: Approval Section
function ApprovalSection({ transfer, onSenderApprove, onReceiverApprove, loading }) {
  return (
    <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
      {transfer.Status === 'PendingSenderTokenApproval' && (
        <div className="space-y-2">
          <p className="text-sm text-yellow-400">🔔 Awaiting Sender Token Approval</p>
          <div className="flex gap-2">
            <button
              onClick={() => onSenderApprove(transfer.TransferRequestID, true)}
              disabled={loading}
              className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white text-sm font-semibold transition"
            >
              ✅ Approve
            </button>
            <button
              onClick={() => onSenderApprove(transfer.TransferRequestID, false)}
              disabled={loading}
              className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white text-sm font-semibold transition"
            >
              ❌ Reject
            </button>
          </div>
        </div>
      )}

      {transfer.Status === 'PendingReceiverTokenApproval' && (
        <div className="space-y-2">
          <p className="text-sm text-yellow-400">🔔 Awaiting Receiver Token Approval</p>
          <div className="flex gap-2">
            <button
              onClick={() => onReceiverApprove(transfer.TransferRequestID, true)}
              disabled={loading}
              className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white text-sm font-semibold transition"
            >
              ✅ Approve
            </button>
            <button
              onClick={() => onReceiverApprove(transfer.TransferRequestID, false)}
              disabled={loading}
              className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 disabled:bg-red-600/50 text-white text-sm font-semibold transition"
            >
              ❌ Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component: Transfer History List
function TransferHistoryList({ transfers, loading }) {
  if (loading && transfers.length === 0) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (transfers.length === 0) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-white/60">No transfer history</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {transfers.map((transfer) => (
        <div key={transfer.TransferRequestID} className="glass-panel p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <p className="text-xs text-white/50">Transfer ID</p>
              <p className="font-mono text-sm truncate">{transfer.TransferRequestID}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Amount Sent</p>
              <p className="font-bold text-lg">{transfer.Amount}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Commission</p>
              <p className="text-yellow-400 font-semibold">
                {transfer.CommissionAmount ? `${transfer.CommissionAmount}` : '0'} ({transfer.CommissionPercentage ? `${transfer.CommissionPercentage.toFixed(2)}%` : '0%'})
              </p>
            </div>
            <div>
              <p className="text-xs text-white/50">Receiver Got</p>
              <p className="text-green-400 font-semibold">
                {(transfer.Amount || 0) - (transfer.CommissionAmount || 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-white/50">Completed At</p>
              <p className="text-sm">
                {transfer.CompletedAt ? new Date(transfer.CompletedAt).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Transfer Confirmation Card Component
function TransferConfirmationCard({ message, onDismiss }) {
  const getCurrencySymbol = (currency) => {
    const symbols = {
      'USD': '$',
      'INR': '₹',
      'EUR': '€',
      'GBP': '£',
      'JPY': '¥'
    };
    return symbols[currency?.toUpperCase()] || '$';
  };

  const details = message.details;
  const hasExchangeRate = details.exchangeRate && details.exchangeRate.rate !== 1.0;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-2xl border border-green-500/30 shadow-2xl max-w-2xl w-full overflow-hidden">
        
        {/* Header with checkmark */}
        <div className="bg-gradient-to-r from-green-600/20 to-emerald-600/20 border-b border-green-500/30 px-8 py-8 text-center">
          <div className="text-6xl mb-4 animate-bounce">✅</div>
          <h2 className="text-3xl font-bold text-green-300 mb-2">{message.title}</h2>
          <p className="text-green-400/80 text-sm">Your transfer has been processed successfully</p>
        </div>

        {/* Main Content */}
        <div className="px-8 py-10 space-y-8">
          
          {/* Amount Sent Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-red-500/10 rounded-lg p-4 border border-red-500/30">
              <div>
                <p className="text-red-400/80 text-sm uppercase tracking-wide font-semibold">Amount Sent</p>
                <p className="text-2xl font-bold text-red-300 mt-1">{details.amount}</p>
              </div>
              <div className="text-4xl opacity-30">📤</div>
            </div>
          </div>

          {/* Exchange Rate and Receiver Amount */}
          {hasExchangeRate && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-cyan-500/10 rounded-lg p-4 border border-cyan-500/30">
                <p className="text-cyan-400/80 text-sm uppercase tracking-wide font-semibold">Exchange Rate</p>
                <p className="text-xl font-bold text-cyan-300 mt-2">{details.exchangeRate.display}</p>
              </div>
              <div className="bg-green-500/10 rounded-lg p-4 border border-green-500/30">
                <p className="text-green-400/80 text-sm uppercase tracking-wide font-semibold">Recipient Received</p>
                <p className="text-xl font-bold text-green-300 mt-2">{details.receiverNet}</p>
              </div>
            </div>
          )}

          {/* Commission Details */}
          <div className="bg-orange-500/10 rounded-lg p-4 border border-orange-500/30">
            <p className="text-orange-400/80 text-sm uppercase tracking-wide font-semibold">Transaction Fees</p>
            <p className="text-white mt-2">
              {details.commission.display === 'No commission configured' ? (
                <span className="text-green-400 font-semibold">✓ {details.commission.display}</span>
              ) : (
                <span className="text-yellow-400">{details.commission.display}</span>
              )}
            </p>
          </div>

          {/* Status and Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-500/30">
              <p className="text-blue-400/80 text-xs uppercase tracking-wide font-semibold">Status</p>
              <p className="text-blue-300 font-bold mt-2 capitalize">{details.status}</p>
            </div>
            <div className="bg-purple-500/10 rounded-lg p-4 border border-purple-500/30">
              <p className="text-purple-400/80 text-xs uppercase tracking-wide font-semibold">Date & Time</p>
              <p className="text-purple-300 font-bold mt-2">{new Date().toLocaleDateString()} • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>

          {/* Transfer ID */}
          <div className="bg-slate-800/50 rounded-lg p-4 border border-white/10">
            <p className="text-white/60 text-xs uppercase tracking-wide font-semibold mb-2">Transaction ID</p>
            <p className="font-mono text-xs text-white/80 break-all">{details.transferId}</p>
          </div>

          {/* Action Button */}
          <button
            onClick={onDismiss}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-4 rounded-lg transition transform hover:scale-105 active:scale-95"
          >
            ← BACK TO TRANSFERS
          </button>
        </div>
      </div>
    </div>
  );
}
