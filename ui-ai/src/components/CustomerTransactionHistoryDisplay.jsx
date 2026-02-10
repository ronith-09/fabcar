import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const CustomerTransactionHistoryDisplay = ({ data }) => {
  const [expandedTxId, setExpandedTxId] = useState(null);

  if (!data || !data.transactions || data.transactions.length === 0) {
    return (
      <div className="rounded-xl border border-white/20 bg-white/5 p-8 text-center">
        <p className="text-white/60">No transaction history found</p>
      </div>
    );
  }

  const getCurrencySymbol = (currency) => {
    const symbols = {
      'USD': '$',
      'INR': '₹',
      'EUR': '€',
      'GBP': '£',
      'JPY': '¥',
      'CAD': 'C$',
      'AUD': 'A$',
      'CHF': 'CHF'
    };
    return symbols[currency?.toUpperCase()] || currency || '$';
  };

  const formatAmount = (amount, currency = 'USD') => {
    const symbol = getCurrencySymbol(currency);
    return `${symbol}${parseFloat(amount || 0).toFixed(2)}`;
  };

  const isDebit = (txType) => txType === 'DEBIT';
  const isCredit = (txType) => txType === 'CREDIT';

  return (
    <div className="space-y-4">
      {/* Summary Section */}
      {data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="glass-panel p-4 border border-white/10 rounded-lg">
            <p className="text-xs text-white/50 uppercase tracking-wide mb-1">Total Transactions</p>
            <p className="text-2xl font-bold text-white">{data.summary.total_transactions || 0}</p>
          </div>
          <div className="glass-panel p-4 border border-white/10 rounded-lg">
            <p className="text-xs text-white/50 uppercase tracking-wide mb-1">Transfers</p>
            <p className="text-2xl font-bold text-accent">{data.summary.transfers || 0}</p>
          </div>
          <div className="glass-panel p-4 border border-white/10 rounded-lg">
            <p className="text-xs text-white/50 uppercase tracking-wide mb-1">Debits</p>
            <p className="text-2xl font-bold text-red-400">{data.summary.total_debits || 0}</p>
          </div>
          <div className="glass-panel p-4 border border-white/10 rounded-lg">
            <p className="text-xs text-white/50 uppercase tracking-wide mb-1">Credits</p>
            <p className="text-2xl font-bold text-green-400">{data.summary.total_credits || 0}</p>
          </div>
        </div>
      )}

      {/* Transactions List */}
      <div className="space-y-4">
        {data.transactions.map((tx) => {
          const txId = tx.transaction_id || tx.transactionID || '';
          const isExpanded = expandedTxId === txId;
          const isDebited = isDebit(tx.transaction_type);
          const isCredited = isCredit(tx.transaction_type);

          const headerBgColor = isDebited ? 'from-red-500/10 to-red-500/5 border-red-500/30' :
                                isCredited ? 'from-green-500/10 to-green-500/5 border-green-500/30' :
                                'from-blue-500/10 to-blue-500/5 border-blue-500/30';

          const statusBadgeColor = isDebited ? 'bg-red-500/20 text-red-300 border-red-500/30' :
                                   isCredited ? 'bg-green-500/20 text-green-300 border-green-500/30' :
                                   'bg-blue-500/20 text-blue-300 border-blue-500/30';

          const statusText = tx.status || 'UNKNOWN';
          const statusBadgeInner = isDebited ? '🔴 DEBIT' :
                                   isCredited ? '🟢 CREDIT' :
                                   '⚪ TRANSFER';

          return (
            <div
              key={txId}
              className={`border rounded-lg backdrop-blur-sm overflow-hidden transition cursor-pointer hover:shadow-lg bg-gradient-to-br ${headerBgColor}`}
            >
              {/* Transaction Header */}
              <div
                onClick={() => setExpandedTxId(isExpanded ? null : txId)}
                className="p-5 hover:bg-white/5 transition"
              >
                <div className="flex items-center justify-between gap-4">
                  {/* Left: Type Badge & Info */}
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex-shrink-0">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusBadgeColor} border`}>
                        {statusBadgeInner}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {tx.transaction_type_description || 'Transfer'}
                        </p>
                      </div>
                      <p className="text-xs text-white/50">
                        {new Date(tx.timestamp).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric'
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Center: Sender/Receiver */}
                  <div className="hidden md:block text-right">
                    <p className="text-xs text-white/50 uppercase tracking-wide mb-1">
                      {isDebited ? 'Sent to' : 'Received from'}
                    </p>
                    <p className="text-sm font-semibold text-white truncate max-w-xs">
                      {isDebited ? tx.receiver : tx.sender}
                    </p>
                  </div>

                  {/* Right: Amount */}
                  <div className="text-right">
                    <p className={`text-lg font-bold ${isDebited ? 'text-red-400' : isCredited ? 'text-green-400' : 'text-blue-400'}`}>
                      {isDebited ? '-' : isCredited ? '+' : ''}{formatAmount(tx.amount, tx.currency)}
                    </p>
                    {tx.receiver_currency && tx.receiver_currency !== tx.currency && (
                      <p className="text-xs text-white/50 mt-1">
                        Converted: {formatAmount(tx.converted_amount, tx.receiver_currency)}
                      </p>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div className="flex-shrink-0 text-right ml-4">
                    <span className="inline-block px-3 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-green-500/30 to-emerald-500/30 text-green-300 border border-green-500/30">
                      ✓ {statusText}
                    </span>
                  </div>

                  {/* Expand Icon */}
                  <div className="flex-shrink-0 text-white/50 ml-2">
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="border-t border-white/10 p-6 bg-gradient-to-b from-slate-950/50 to-slate-900/30 space-y-6">
                  {/* Amount Details Section */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-white/80 uppercase tracking-wide pb-3 border-b border-white/10">
                      Amount Details
                    </h4>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <p className="text-xs text-white/50 uppercase tracking-wide mb-2">Sender Amount</p>
                        <p className="text-2xl font-bold text-white">
                          {formatAmount(tx.amount, tx.currency)}
                        </p>
                        <p className="text-xs text-white/40 mt-1">{tx.currency}</p>
                      </div>
                      <div>
                        <p className="text-xs text-white/50 uppercase tracking-wide mb-2">Sender ID</p>
                        <p className="text-sm font-mono text-white/80 break-all">{tx.sender}</p>
                      </div>
                    </div>
                  </div>

                  {/* Receiver Details Section */}
                  {tx.receiver && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-white/80 uppercase tracking-wide pb-3 border-b border-white/10">
                        Receiver Details
                      </h4>
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <p className="text-xs text-white/50 uppercase tracking-wide mb-2">Amount Received</p>
                          <p className={`text-2xl font-bold ${isDebited ? 'text-green-400' : 'text-white'}`}>
                            {formatAmount(tx.converted_amount || tx.receiver_amount || tx.net_amount, tx.receiver_currency || tx.currency)}
                          </p>
                          <p className="text-xs text-white/40 mt-1">{tx.receiver_currency || tx.currency}</p>
                        </div>
                        <div>
                          <p className="text-xs text-white/50 uppercase tracking-wide mb-2">Receiver ID</p>
                          <p className="text-sm font-mono text-white/80 break-all">{tx.receiver}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Exchange Rate & Commission Section */}
                  {(tx.exchange_rate || tx.commission_description) && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-white/80 uppercase tracking-wide pb-3 border-b border-white/10">
                        Transaction Details
                      </h4>
                      <div className="bg-white/5 rounded-lg p-4 space-y-3">
                        {tx.exchange_rate && tx.exchange_rate !== 1 && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-white/60">Exchange Rate:</span>
                            <span className="text-sm font-semibold text-white">
                              1 {tx.currency} = {tx.exchange_rate} {tx.receiver_currency || tx.currency}
                            </span>
                          </div>
                        )}
                        {tx.commission_description && (
                          <div className="flex justify-between items-start gap-3">
                            <span className="text-sm text-white/60">Commission:</span>
                            <span className="text-sm font-semibold text-white text-right">
                              {tx.commission_description}
                            </span>
                          </div>
                        )}
                        {tx.commission_amount !== undefined && (
                          <div className="flex justify-between items-center pt-2 border-t border-white/10">
                            <span className="text-sm text-white/60">Commission Amount:</span>
                            <span className={`text-sm font-bold ${tx.commission_amount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {tx.commission_amount > 0 ? '-' : ''}{formatAmount(tx.commission_amount, tx.currency)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Timeline Section */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-white/80 uppercase tracking-wide pb-3 border-b border-white/10">
                      Timeline
                    </h4>
                    <div className="bg-white/5 rounded-lg p-4">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-white/60">Transaction Time:</span>
                        <span className="text-sm font-mono text-white">
                          {new Date(tx.timestamp).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Transaction ID */}
                  <div className="space-y-2 pt-3 border-t border-white/10">
                    <p className="text-xs text-white/50 uppercase tracking-wide">Transaction ID</p>
                    <div className="bg-black/30 rounded-lg p-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-white/70 font-mono break-all flex-1">{txId}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(txId);
                          const btn = event.target;
                          const originalText = btn.textContent;
                          btn.textContent = '✓ Copied';
                          btn.classList.add('text-green-400');
                          setTimeout(() => {
                            btn.textContent = originalText;
                            btn.classList.remove('text-green-400');
                          }, 2000);
                        }}
                        className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition text-white/70 hover:text-white text-xs font-medium whitespace-nowrap"
                        title="Copy transaction ID"
                      >
                        📋 Copy
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CustomerTransactionHistoryDisplay;
