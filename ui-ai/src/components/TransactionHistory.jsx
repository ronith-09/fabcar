import React, { useState, useEffect } from 'react';
import { getTransactionHistory, filterTransactions, sortTransactions } from '../services/transactionService';
import TransactionHistoryRow from './TransactionHistoryRow';
import { Loader, AlertCircle, Filter, Download, ChevronDown, ChevronUp } from 'lucide-react';

const TransactionHistory = ({ customerId, tokenId }) => {
  const [transactions, setTransactions] = useState([]);
  const [filteredTransactions, setFilteredTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'mint', 'transfer'
  const [pagination, setPagination] = useState({
    limit: 50,
    offset: 0,
    total_count: 0,
    returned_count: 0,
    has_more: false
  });

  // Filter state
  const [filters, setFilters] = useState({
    category: 'ALL', // ALL, MINT, TRANSFER
    status: 'ALL',   // ALL, PENDING, COMPLETED, REJECTED, FAILED
    dateFrom: null,
    dateTo: null,
    searchTerm: ''
  });

  const [sortBy, setSortBy] = useState('newest'); // newest, oldest, highestAmount, lowestAmount

  // Fetch transactions on component mount or when customerId/tokenId changes
  useEffect(() => {
    fetchTransactions();
  }, [customerId, tokenId]);

  // Apply filters and sorting when filters change
  useEffect(() => {
    applyFiltersAndSort();
  }, [transactions, filters, sortBy, activeTab]);

  const fetchTransactions = async (offset = 0) => {
    try {
      setLoading(true);
      setError(null);
      const response = await getTransactionHistory(customerId, tokenId, offset, pageSize);
      
      // Handle both old format (array) and new format (with pagination metadata)
      if (response && typeof response === 'object' && 'transactions' in response) {
        setTransactions(response.transactions || []);
        setPagination(response.pagination || {});
      } else if (Array.isArray(response)) {
        setTransactions(response);
      } else {
        console.warn('Unexpected response format:', response);
        setTransactions([]);
      }
    } catch (err) {
      console.error('Error fetching transactions:', err);
      setError('Failed to load transaction history. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let result = [...transactions];

    // Apply tab filter
    if (activeTab === 'mint') {
      result = result.filter(t => t.category === 'MINT' || t.type === 'MINT');
    } else if (activeTab === 'transfer') {
      result = result.filter(t => t.category === 'TRANSFER' || t.type === 'TRANSFER');
    }

    // Apply filters
    result = filterTransactions(result, filters);

    // Apply sorting
    result = sortTransactions(result, sortBy);

    setFilteredTransactions(result);
    setCurrentPage(1); // Reset to first page when filters change
  };

  const handleFilterChange = (newFilters) => {
    setFilters({ ...filters, ...newFilters });
  };

  const handleSortChange = (sortOption) => {
    setSortBy(sortOption);
  };

  const generateCSV = (data) => {
    if (!data || data.length === 0) return '';
    
    const headers = ['Transaction ID', 'Type', 'Category', 'Amount', 'Currency', 'Sender', 'Receiver', 'Status', 'Date'];
    const rows = data.map(t => [
      t.transaction_id || t.transactionID || '',
      t.transaction_type || t.type || '',
      t.transaction_category || t.category || '',
      t.amount || '',
      t.currency || '',
      t.sender || '',
      t.receiver || '',
      t.status || '',
      t.timestamp ? new Date(t.timestamp).toLocaleString() : ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    return csvContent;
  };

  const downloadCSV = (csv, filename) => {
    const element = document.createElement('a');
    element.setAttribute('href', `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`);
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportTransactions = () => {
    const csv = generateCSV(filteredTransactions);
    downloadCSV(csv, `transactions_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const handlePageChange = (newOffset) => {
    setCurrentPage(Math.floor(newOffset / pageSize) + 1);
    fetchTransactions(newOffset);
  };

  const handleNextPage = () => {
    if (pagination.has_more) {
      handlePageChange(pagination.offset + pagination.limit);
    }
  };

  const handlePrevPage = () => {
    if (pagination.offset > 0) {
      handlePageChange(Math.max(0, pagination.offset - pagination.limit));
    }
  };

  // Pagination
  const totalPages = Math.ceil(pagination.total_count / pageSize) || 1;
  const paginatedTransactions = filteredTransactions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-gray-600">Loading transaction history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Transaction History</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExportTransactions}
            className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10">
        {['all', 'mint', 'transfer'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-sm font-medium transition border-b-2 ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab === 'all' ? 'All Transactions' : tab === 'mint' ? 'Mint Transactions' : 'Transfer Transactions'}
          </button>
        ))}
        <span className="ml-auto px-4 py-3 text-sm text-white/70">
          {pagination.total_count} total transaction{pagination.total_count !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filter & Sort Section */}
      <FilterSection
        filters={filters}
        sortBy={sortBy}
        onFilterChange={handleFilterChange}
        onSortChange={handleSortChange}
        transactionCount={filteredTransactions.length}
      />

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {filteredTransactions.length === 0 && !error && (
        <div className="text-center py-12">
          <p className="text-gray-500">No {activeTab === 'all' ? '' : activeTab} transactions found matching your criteria.</p>
        </div>
      )}

      {/* Transactions List */}
      {filteredTransactions.length > 0 && (
        <>
          <div className="space-y-4">
            {paginatedTransactions.map((transaction) => (
              <TransactionCard
                key={transaction.transactionID || transaction.transaction_id}
                transaction={transaction}
              />
            ))}
          </div>

          {/* Pagination */}
          {(pagination.has_more || pagination.offset > 0) && (
            <div className="flex items-center justify-between mt-6 p-4 bg-white/5 rounded-lg border border-white/10">
              <button
                onClick={handlePrevPage}
                disabled={pagination.offset === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition"
              >
                ← Previous
              </button>
              <div className="flex items-center gap-4 text-sm text-white/70">
                <span>
                  Showing {pagination.returned_count} of {pagination.total_count} transactions
                </span>
                <span>
                  Page {Math.floor(pagination.offset / pagination.limit) + 1}
                </span>
              </div>
              <button
                onClick={handleNextPage}
                disabled={!pagination.has_more}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Summary Stats */}
      {filteredTransactions.length > 0 && (
        <TransactionSummary transactions={filteredTransactions} />
      )}
    </div>
  );
};

// Transaction Card Component - Redesigned per user specifications
const TransactionCard = ({ transaction }) => {
  const [expanded, setExpanded] = useState(false);
  
  const isMint = transaction.transaction_category === 'MINT' || transaction.type === 'MINT';
  const isTransfer = transaction.transaction_category === 'TRANSFER' || transaction.type === 'TRANSFER';
  const isCredit = transaction.transaction_type === 'CREDIT';
  const isDebit = transaction.transaction_type === 'DEBIT';
  
  // Color classes based on transaction type
  const borderColor = isCredit ? 'border-green-500/30' : isDebit ? 'border-red-500/30' : 'border-white/20';
  const bgColor = isCredit ? 'bg-green-50' : isDebit ? 'bg-red-50' : 'bg-blue-50';
  const badgeBg = isCredit ? 'bg-green-100 text-green-700' : isDebit ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700';
  const amountColor = isCredit ? 'text-green-600' : isDebit ? 'text-red-600' : 'text-blue-600';

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

  const formatAmount = (amount, currencyOrSymbol = '$') => {
    const symbol = getCurrencySymbol(currencyOrSymbol);
    return `${symbol}${parseFloat(amount || 0).toFixed(2)}`;
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      'COMPLETED': { bg: 'bg-green-500/20 border-green-500/30', text: 'text-green-300' },
      'PENDING': { bg: 'bg-yellow-500/20 border-yellow-500/30', text: 'text-yellow-300' },
      'FAILED': { bg: 'bg-red-500/20 border-red-500/30', text: 'text-red-300' },
      'REJECTED': { bg: 'bg-orange-500/20 border-orange-500/30', text: 'text-orange-300' }
    };
    return statusMap[status] || statusMap['PENDING'];
  };

  return (
    <div className={`border-2 ${borderColor} rounded-xl overflow-hidden hover:shadow-2xl transition cursor-pointer backdrop-blur-sm bg-gradient-to-br ${isCredit ? 'from-green-500/5 to-emerald-500/5' : isDebit ? 'from-red-500/5 to-orange-500/5' : 'from-blue-500/5 to-cyan-500/5'}`}>
      {/* Main Row */}
      <div 
        onClick={() => setExpanded(!expanded)}
        className={`p-5 ${bgColor} transition hover:${bgColor.replace('50', '100')}`}
      >
        <div className="grid grid-cols-12 gap-4 items-center">
          
          {/* Category Badge */}
          <div className="col-span-2 sm:col-span-1">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${badgeBg} shadow-sm`}>
              {isMint ? '💰 MINT' : isDebit ? '🔴 DEBIT' : '🟢 CREDIT'}
            </span>
          </div>

          {/* Sender/Receiver Info (TRANSFER only) */}
          {isTransfer && (
            <div className="col-span-5 sm:col-span-3">
              <div className="text-sm">
                <p className="text-xs text-gray-600 font-semibold uppercase tracking-wide">
                  {isDebit ? 'Sent to' : 'Received from'}
                </p>
                <p className="font-semibold text-gray-900 truncate">
                  {isDebit ? transaction.receiver : transaction.sender}
                </p>
              </div>
            </div>
          )}

          {/* Amount */}
          <div className={`col-span-3 sm:col-span-2`}>
            <p className={`text-lg font-bold ${amountColor}`}>
              {isCredit ? '+' : isDebit ? '-' : ''}{formatAmount(transaction.amount, transaction.currency)}
            </p>
          </div>

          {/* Amount Received (Transfer only) */}
          {isTransfer && isDebit && (
            <div className="col-span-2 hidden md:block">
              <p className="text-xs text-gray-600 font-semibold uppercase">Received</p>
              <p className="text-sm font-bold text-green-600">
                {formatAmount(transaction.net_amount, transaction.currency)}
              </p>
            </div>
          )}

          {/* Time */}
          <div className="col-span-2 hidden lg:block">
            <p className="text-xs text-gray-600 font-semibold uppercase">Time</p>
            <p className="text-xs text-gray-900 font-medium">
              {new Date(transaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          {/* Status */}
          <div className="col-span-3 sm:col-span-2 text-right">
            <span className={`px-3 py-1 rounded-lg text-xs font-bold border ${getStatusBadge(transaction.status).bg} ${getStatusBadge(transaction.status).text}`}>
              {transaction.status}
            </span>
          </div>

          {/* Expand Icon */}
          <div className="col-span-1 text-right text-gray-500">
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className={`border-t-2 ${borderColor} p-8 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 space-y-6`}>
          {isMint ? (
            <MintTransactionDetails transaction={transaction} />
          ) : (
            <TransferTransactionDetails transaction={transaction} />
          )}
        </div>
      )}
    </div>
  );
};

// MINT Transaction Details
const MintTransactionDetails = ({ transaction }) => {
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

  const formatAmount = (amount, currencyOrSymbol = '$') => {
    const symbol = getCurrencySymbol(currencyOrSymbol);
    return `${symbol}${parseFloat(amount || 0).toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      {/* Amount Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DetailBox 
          label="Amount" 
          value={formatAmount(transaction.amount, transaction.currency)}
          color="green"
        />
        <DetailBox 
          label="Currency" 
          value={transaction.currency}
          color="gray"
        />
        <DetailBox 
          label="Time" 
          value={new Date(transaction.timestamp).toLocaleString()}
          color="gray"
        />
        <DetailBox 
          label="Status" 
          value={transaction.status}
          color={transaction.status === 'COMPLETED' ? 'green' : 'yellow'}
        />
      </div>

      {/* Additional Details */}
      <div className="border-t pt-4">
        <h4 className="font-semibold text-gray-900 mb-3">Transaction Details</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DetailRowSmall label="Transaction ID" value={transaction.transaction_id} code={true} />
          <DetailRowSmall label="Requested By" value={transaction.sender} />
          <DetailRowSmall label="Approved At" value={transaction.timestamp} />
          <DetailRowSmall label="Currency Type" value={transaction.currency} />
        </div>
      </div>
    </div>
  );
};

// TRANSFER Transaction Details
const TransferTransactionDetails = ({ transaction }) => {
  const isDebit = transaction.transaction_type === 'DEBIT';
  
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

  const formatAmount = (amount, currencyOrSymbol = '$') => {
    const symbol = getCurrencySymbol(currencyOrSymbol);
    return `${symbol}${parseFloat(amount || 0).toFixed(2)}`;
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric'
    });
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="space-y-0">
      {/* Header with Status */}
      <div className="bg-gradient-to-r from-green-500/20 to-green-600/10 border-b border-green-500/30 px-6 py-4 rounded-t-lg">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">✅</span>
          <h3 className="text-xl font-bold text-green-300">Transfer Completed</h3>
        </div>
      </div>

      {/* Amount Sent Section */}
      <div className="px-6 py-5 border-b border-white/10 bg-red-500/5">
        <h4 className="text-xs uppercase tracking-widest text-white/60 font-semibold mb-3">Amount Sent</h4>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-2xl font-bold text-red-300">{formatAmount(transaction.amount, transaction.currency)}</p>
            <p className="text-sm text-white/60 mt-1">Sent to <span className="text-white/90 font-semibold">{transaction.receiver}</span></p>
          </div>
          <div className="text-right">
            <p className="text-xs text-white/50">Currency</p>
            <p className="text-lg font-semibold text-white">{transaction.currency}</p>
          </div>
        </div>
      </div>

      {/* Recipient Received Section */}
      {transaction.receiver_currency && transaction.receiver_currency !== transaction.currency ? (
        <div className="px-6 py-5 border-b border-white/10 bg-green-500/5">
          <h4 className="text-xs uppercase tracking-widest text-white/60 font-semibold mb-3">Recipient Received</h4>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-2xl font-bold text-green-300">{formatAmount(transaction.receiver_amount || transaction.net_amount, transaction.receiver_currency)}</p>
              <p className="text-sm text-white/60 mt-1">{transaction.receiver_currency}</p>
            </div>
            <div className="text-right bg-white/5 p-3 rounded-lg border border-white/10">
              <p className="text-xs text-white/50 mb-1">Exchange Rate</p>
              <p className="text-sm font-semibold text-cyan-300">1 {transaction.currency} = {parseFloat(transaction.exchange_rate || 1).toFixed(2)} {transaction.receiver_currency}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-6 py-5 border-b border-white/10 bg-green-500/5">
          <h4 className="text-xs uppercase tracking-widest text-white/60 font-semibold mb-3">Recipient Received</h4>
          <p className="text-2xl font-bold text-green-300">{formatAmount(transaction.net_amount, transaction.currency)}</p>
        </div>
      )}

      {/* Fees Section */}
      <div className="px-6 py-5 border-b border-white/10 bg-orange-500/5">
        <h4 className="text-xs uppercase tracking-widest text-white/60 font-semibold mb-3">Fees</h4>
        {transaction.commission_amount > 0 ? (
          <div className="flex items-center justify-between">
            <span className="text-white/80">{transaction.commission_description || 'Transaction fee'}</span>
            <span className="text-lg font-semibold text-orange-300">{formatAmount(transaction.commission_amount, transaction.currency)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-green-300 font-semibold">✓</span>
            <span className="text-white/80">{formatAmount(0, transaction.currency)} (No charges applied)</span>
          </div>
        )}
      </div>

      {/* Date & Time Section */}
      <div className="px-6 py-5 border-b border-white/10 bg-blue-500/5">
        <h4 className="text-xs uppercase tracking-widest text-white/60 font-semibold mb-3">Date & Time</h4>
        <div className="flex items-center gap-2">
          <span className="text-white/80">{formatDate(transaction.timestamp)}</span>
          <span className="text-white/40">•</span>
          <span className="text-white/80">{formatTime(transaction.timestamp)}</span>
        </div>
      </div>

      {/* Transaction ID Section */}
      <div className="px-6 py-5 bg-purple-500/5 rounded-b-lg border-t border-white/10">
        <h4 className="text-xs uppercase tracking-widest text-white/60 font-semibold mb-3">Transaction ID</h4>
        <div className="flex items-center gap-3 bg-black/30 p-3 rounded-lg">
          <span className="font-mono text-xs text-white/80 break-all flex-1">{transaction.transaction_id}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(transaction.transaction_id);
              // Optional: Show toast notification
              const btn = event.target;
              const original = btn.textContent;
              btn.textContent = '✓';
              setTimeout(() => btn.textContent = original, 2000);
            }}
            className="px-3 py-1 rounded text-xs font-medium bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition whitespace-nowrap"
            title="Copy transaction ID"
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailRow = ({ label, value, color = 'gray' }) => {
  const colorClass = color === 'green' ? 'text-green-600' : color === 'orange' ? 'text-orange-600' : 'text-gray-900';
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-600 font-medium">{label}</span>
      <span className={`font-semibold ${colorClass}`}>{value}</span>
    </div>
  );
};

// New DetailBox Component for expanded view
const DetailBox = ({ label, value, color = 'gray' }) => {
  const colorMap = {
    green: 'bg-green-500/20 border-green-500/30 text-green-300',
    red: 'bg-red-500/20 border-red-500/30 text-red-300',
    orange: 'bg-orange-500/20 border-orange-500/30 text-orange-300',
    yellow: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300',
    blue: 'bg-blue-500/20 border-blue-500/30 text-blue-300',
    gray: 'bg-white/10 border-white/20 text-white/80'
  };
  
  return (
    <div className={`border p-4 rounded-xl ${colorMap[color]} shadow-lg`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-75 mb-2">{label}</p>
      <p className="font-bold text-sm break-words text-white">{value}</p>
    </div>
  );
};

// New DetailRowSmall Component for expanded view
const DetailRowSmall = ({ label, value, code = false }) => {
  return (
    <div className="flex justify-between items-start gap-2 pb-2 border-b border-white/10 last:border-b-0">
      <span className="text-sm font-medium text-white/60 min-w-max">{label}:</span>
      <span className={`text-sm text-right break-words font-medium ${
        code ? 'font-mono bg-black/30 px-2 py-1 rounded text-xs text-white/80' : 'text-white/90'
      }`}>
        {value}
      </span>
    </div>
  );
};

// Filter Section Component
const FilterSection = ({ filters, sortBy, onFilterChange, onSortChange, transactionCount }) => {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="space-y-4">
      {/* Quick Filters & Sort */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition ${
            showFilters
              ? 'bg-blue-50 border-blue-300 text-blue-700'
              : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>

        {/* Category Filter */}
        <select
          value={filters.category}
          onChange={(e) => onFilterChange({ category: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ALL">All Categories</option>
          <option value="MINT">Mint Only</option>
          <option value="TRANSFER">Transfer Only</option>
        </select>

        {/* Status Filter */}
        <select
          value={filters.status}
          onChange={(e) => onFilterChange({ status: e.target.value })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="ALL">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="COMPLETED">Completed</option>
          <option value="REJECTED">Rejected</option>
          <option value="FAILED">Failed</option>
        </select>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="highestAmount">Highest Amount</option>
          <option value="lowestAmount">Lowest Amount</option>
        </select>
      </div>

      {/* Extended Filters */}
      {showFilters && (
        <div className="p-4 bg-white/10 rounded-lg border border-white/20 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                From Date
              </label>
              <input
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => onFilterChange({ dateFrom: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                To Date
              </label>
              <input
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => onFilterChange({ dateTo: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search (Name, ID, or Token)
            </label>
            <input
              type="text"
              value={filters.searchTerm}
              onChange={(e) => onFilterChange({ searchTerm: e.target.value })}
              placeholder="e.g., Customer A, token_123, sender_456"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Clear Filters */}
          {Object.values(filters).some(v => v && v !== 'ALL') && (
            <button
              onClick={() => {
                onFilterChange({
                  category: 'ALL',
                  status: 'ALL',
                  dateFrom: null,
                  dateTo: null,
                  searchTerm: ''
                });
              }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Transaction Summary Component
const TransactionSummary = ({ transactions }) => {
  const mints = transactions.filter(t => t.category === 'MINT' || t.type === 'MINT');
  const transfers = transactions.filter(t => t.category === 'TRANSFER' || t.type === 'TRANSFER');
  const outgoing = transfers.filter(t => t.type === 'DEBIT' || t.direction === 'OUTGOING');
  const incoming = transfers.filter(t => t.type === 'CREDIT' || t.direction === 'INCOMING');

  const totalMinted = mints.reduce((sum, t) => sum + (t.amount?.value || t.amount || 0), 0);
  const totalTransferred = transfers.reduce((sum, t) => sum + (t.amount?.value || t.amount || 0), 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/10">
      <SummaryCard
        label="Total Mints"
        value={mints.length}
        subtext={`${totalMinted.toFixed(2)}`}
        color="blue"
      />
      <SummaryCard
        label="Total Transfers"
        value={transfers.length}
        subtext={`Sent: ${outgoing.length} | Received: ${incoming.length}`}
        color="purple"
      />
      <SummaryCard
        label="Outgoing"
        value={outgoing.length}
        subtext="Debits (Red)"
        color="red"
      />
      <SummaryCard
        label="Incoming"
        value={incoming.length}
        subtext="Credits (Green)"
        color="green"
      />
    </div>
  );
};

const SummaryCard = ({ label, value, subtext, color }) => {
  const colorClasses = {
    blue: 'bg-blue-500/20 border-blue-500/30 text-blue-300',
    green: 'bg-green-500/20 border-green-500/30 text-green-300',
    red: 'bg-red-500/20 border-red-500/30 text-red-300',
    purple: 'bg-purple-500/20 border-purple-500/30 text-purple-300'
  };

  return (
    <div className={`p-4 rounded-xl border ${colorClasses[color]} shadow-lg`}>
      <p className="text-sm font-medium opacity-75">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtext && <p className="text-xs mt-2 opacity-60">{subtext}</p>}
    </div>
  );
};

export default TransactionHistory;
