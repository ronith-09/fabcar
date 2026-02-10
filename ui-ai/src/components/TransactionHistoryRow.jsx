import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Check,
  Clock,
  X,
  AlertCircle,
  Zap,
  ArrowUpRight,
  ArrowDownLeft
} from 'lucide-react';

const TransactionHistoryRow = ({ transaction }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isMint = transaction.type === 'MINT';
  const isTransfer = transaction.type === 'TRANSFER';
  const isOutgoing = transaction.direction === 'OUTGOING';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition">
      {/* Main Row */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left hover:bg-gray-50 transition"
      >
        <div className="p-4 flex items-center justify-between">
          {/* Left Section: Category & Type */}
          <div className="flex items-center gap-4 flex-1">
            {/* Type Icon & Badge */}
            <div className="flex items-center gap-2">
              {isMint ? (
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100">
                  <Zap className="w-5 h-5 text-blue-600" />
                </div>
              ) : (
                <div className={`flex items-center justify-center w-10 h-10 rounded-full ${
                  isOutgoing ? 'bg-red-100' : 'bg-green-100'
                }`}>
                  {isOutgoing ? (
                    <ArrowUpRight className={`w-5 h-5 ${isOutgoing ? 'text-red-600' : 'text-green-600'}`} />
                  ) : (
                    <ArrowDownLeft className="w-5 h-5 text-green-600" />
                  )}
                </div>
              )}

              {/* Category & Direction Info */}
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">
                    {transaction.category || transaction.type}
                  </span>
                  {isTransfer && (
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      isOutgoing
                        ? 'bg-red-100 text-red-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {isOutgoing ? '🔴 DEBIT' : '🟢 CREDIT'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(transaction.timestamp).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </p>
              </div>
            </div>

            {/* Center: Amount Info */}
            <div className="text-right flex-1 hidden md:block">
              <p className={`font-bold text-lg ${
                isOutgoing ? 'text-red-600' : 'text-green-600'
              }`}>
                {isOutgoing ? '-' : '+'}
                {transaction.amount?.formatted || `${transaction.amount?.symbol} ${transaction.amount?.value}`}
              </p>
              {isTransfer && transaction.receivedAmount && !isOutgoing && (
                <p className="text-xs text-gray-500">
                  Received: {transaction.receivedAmount.formatted}
                </p>
              )}
            </div>
          </div>

          {/* Right Section: Status & Toggle */}
          <div className="flex items-center gap-4">
            {/* Status Badge */}
            <StatusBadge status={transaction.status} />

            {/* Expand Toggle */}
            <button className="text-gray-400 hover:text-gray-600">
              {isExpanded ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className={`border-t border-gray-200 p-4 bg-gray-50 space-y-4 ${
          isOutgoing ? 'bg-red-50' : isTransfer ? 'bg-green-50' : 'bg-blue-50'
        }`}>
          {isMint && <MintTransactionDetails transaction={transaction} />}
          {isTransfer && <TransferTransactionDetails transaction={transaction} />}
        </div>
      )}
    </div>
  );
};

// Status Badge Component
const StatusBadge = ({ status }) => {
  const statusConfig = {
    PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Clock },
    COMPLETED: { bg: 'bg-green-100', text: 'text-green-800', icon: Check },
    REJECTED: { bg: 'bg-red-100', text: 'text-red-800', icon: X },
    FAILED: { bg: 'bg-orange-100', text: 'text-orange-800', icon: AlertCircle }
  };

  const config = statusConfig[status] || statusConfig.PENDING;
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-1 px-2 py-1 rounded ${config.bg} ${config.text}`}>
      <Icon className="w-4 h-4" />
      <span className="text-xs font-medium">{status}</span>
    </div>
  );
};

// MINT Transaction Details
const MintTransactionDetails = ({ transaction }) => {
  return (
    <div className="space-y-4">
      <DetailSection title="Amount Details">
        <DetailRow
          label="Amount"
          value={transaction.amount?.formatted || 'N/A'}
          highlight
        />
        <DetailRow
          label="Currency"
          value={transaction.amount?.symbol || 'N/A'}
        />
      </DetailSection>

      <DetailSection title="Minting Information">
        <DetailRow
          label="Minted By (Bank)"
          value={transaction.mintedBy || 'N/A'}
        />
        <DetailRow
          label="Token ID"
          value={transaction.tokenID || 'N/A'}
          code
        />
        <DetailRow
          label="Request ID"
          value={transaction.details?.requestID || 'N/A'}
          code
        />
      </DetailSection>

      <DetailSection title="Timeline">
        <DetailRow
          label="Minted At"
          value={formatDateTime(transaction.timestamp)}
        />
        {transaction.details?.approvedAt && (
          <DetailRow
            label="Approved At"
            value={formatDateTime(transaction.details.approvedAt)}
          />
        )}
      </DetailSection>
    </div>
  );
};

// TRANSFER Transaction Details
const TransferTransactionDetails = ({ transaction }) => {
  const isOutgoing = transaction.direction === 'OUTGOING';

  return (
    <div className="space-y-4">
      {/* Sender & Receiver */}
      <DetailSection title={isOutgoing ? "Sender (You)" : "Receiver (You)"}>
        <DetailRow label="ID" value={transaction.sender.id} code />
        <DetailRow label="Name" value={transaction.sender.name} />
        <DetailRow label="Token ID" value={transaction.sender.tokenID} code />
        <DetailRow label="KYC Status" value={transaction.sender.kycStatus} />
      </DetailSection>

      <DetailSection title={isOutgoing ? "Receiver" : "Sender"}>
        <DetailRow label="ID" value={transaction.receiver.id} code />
        <DetailRow label="Name" value={transaction.receiver.name} />
        <DetailRow label="Token ID" value={transaction.receiver.tokenID} code />
        <DetailRow label="KYC Status" value={transaction.receiver.kycStatus} />
      </DetailSection>

      {/* Amount Details */}
      <DetailSection title="Amount Details">
        <DetailRow
          label={isOutgoing ? "Amount Sent" : "Original Amount Sent"}
          value={transaction.amount?.formatted || 'N/A'}
          highlight
        />
        {transaction.receivedAmount && (
          <DetailRow
            label={isOutgoing ? "Amount Received by Receiver" : "Amount You Received"}
            value={transaction.receivedAmount.formatted}
            highlight
            className="text-green-600"
          />
        )}
        {transaction.exchangeRate && transaction.exchangeRate !== 1.0 && (
          <DetailRow
            label="Exchange Rate"
            value={`1 ${transaction.amount?.symbol} = ${transaction.exchangeRate} ${transaction.receiver.symbol}`}
          />
        )}
      </DetailSection>

      {/* Commission Details */}
      {transaction.commission && (
        <DetailSection title="Commission Details">
          <DetailRow
            label="Commission Percentage"
            value={`${transaction.commission.percentage}%`}
          />
          <DetailRow
            label="Commission Amount"
            value={transaction.commission.amount > 0 ? 
              `${transaction.commission.symbol} ${transaction.commission.amount}` : 
              'No commission'
            }
          />
          <DetailRow
            label="Receiving Bank"
            value={transaction.commission.receivingBank}
          />
          <DetailRow
            label="Bank MSP ID"
            value={transaction.commission.bankMSP}
            code
          />
        </DetailSection>
      )}

      {/* Status Details */}
      <DetailSection title="Transaction Status">
        <DetailRow
          label="Debit Status"
          value={transaction.statusSteps?.debitStatus || 'N/A'}
          highlight
        />
        <DetailRow
          label="Credit Status"
          value={transaction.statusSteps?.creditStatus || 'N/A'}
          highlight
        />
      </DetailSection>

      {/* Timeline & Approvals */}
      <DetailSection title="Timeline">
        <DetailRow
          label="Initiated At"
          value={formatDateTime(transaction.timestamp)}
        />
        {transaction.approvals?.senderApprovedAt && (
          <DetailRow
            label="Sender Approved At"
            value={formatDateTime(transaction.approvals.senderApprovedAt)}
          />
        )}
        {transaction.approvals?.receiverApprovedAt && (
          <DetailRow
            label="Receiver Approved At"
            value={formatDateTime(transaction.approvals.receiverApprovedAt)}
          />
        )}
        {transaction.approvals?.completedAt && (
          <DetailRow
            label="Completed At"
            value={formatDateTime(transaction.approvals.completedAt)}
          />
        )}
      </DetailSection>

      {/* Additional Details */}
      <DetailSection title="Additional Information">
        <DetailRow
          label="Transfer Request ID"
          value={transaction.transactionID}
          code
        />
        {transaction.escrowedAmount && (
          <DetailRow
            label="Escrowed Amount"
            value={`${transaction.amount?.symbol} ${transaction.escrowedAmount}`}
          />
        )}
      </DetailSection>
    </div>
  );
};

// Detail Section Component
const DetailSection = ({ title, children }) => (
  <div>
    <h4 className="font-semibold text-gray-900 text-sm mb-3 border-b border-gray-300 pb-2">
      {title}
    </h4>
    <div className="space-y-2 ml-2">
      {children}
    </div>
  </div>
);

// Detail Row Component
const DetailRow = ({
  label,
  value,
  code = false,
  highlight = false,
  className = ''
}) => (
  <div className="flex justify-between items-start gap-4">
    <span className="text-sm font-medium text-gray-600 min-w-max">{label}:</span>
    <span className={`text-sm text-right break-words ${
      code ? 'font-mono bg-gray-200 px-2 py-1 rounded text-xs' : 'text-gray-900'
    } ${highlight ? 'font-bold text-blue-600' : ''} ${className}`}>
      {value}
    </span>
  </div>
);

// Helper function to format date and time
const formatDateTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }) + ' ' + date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
};

export default TransactionHistoryRow;
