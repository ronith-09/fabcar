import axios from 'axios';

const API_BASE_URL = 'http://localhost:4000';

/**
 * Fetch transaction history for a customer/token
 * @param {string} customerId - Customer's network address or ID
 * @param {string} tokenId - Token ID (optional - if not provided, gets all)
 * @param {number} offset - Pagination offset (default 0)
 * @param {number} limit - Pagination limit (default 50)
 * @returns {Promise<Object|Array>} Transaction response with pagination metadata or array of transactions
 */
export const getTransactionHistory = async (customerId, tokenId = null, offset = 0, limit = 50) => {
  try {
    const params = new URLSearchParams();
    if (customerId) params.append('customerId', customerId);
    if (tokenId) params.append('tokenId', tokenId);
    params.append('offset', offset);
    params.append('limit', limit);

    const response = await axios.get(
      `${API_BASE_URL}/api/customer/transfer-history?${params.toString()}`
    );

    // Handle response format: {success, customer_id, pagination, transactions}
    if (response.data && response.data.success !== false) {
      return {
        transactions: response.data.transactions || transformTransactions(response.data),
        pagination: response.data.pagination || {
          limit,
          offset,
          total_count: (response.data.transactions || []).length,
          returned_count: (response.data.transactions || []).length,
          has_more: false
        }
      };
    }
    
    return response.data;
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    throw error;
  }
};

/**
 * Get transaction details by ID
 * @param {string} transactionId - Transaction ID
 * @returns {Promise<Object>} Transaction details
 */
export const getTransactionDetails = async (transactionId) => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/transactions/${transactionId}`
    );
    return transformTransaction(response.data);
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    throw error;
  }
};

/**
 * Get transaction statistics/summary
 * @param {string} customerId - Customer ID
 * @param {string} timeframe - 'week', 'month', 'year', or specific date range
 * @returns {Promise<Object>} Statistics object
 */
export const getTransactionStats = async (customerId, timeframe = 'month') => {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/api/transactions/stats/${customerId}?timeframe=${timeframe}`
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching transaction stats:', error);
    throw error;
  }
};

/**
 * Filter transactions based on criteria
 * @param {Array} transactions - Array of transaction objects
 * @param {Object} filters - Filter object with category, status, dateFrom, dateTo, searchTerm
 * @returns {Array} Filtered transactions
 */
export const filterTransactions = (transactions, filters) => {
  let result = [...transactions];

  // Filter by category
  if (filters.category && filters.category !== 'ALL') {
    result = result.filter(t => t.type === filters.category);
  }

  // Filter by status
  if (filters.status && filters.status !== 'ALL') {
    result = result.filter(t => t.status === filters.status);
  }

  // Filter by date range
  if (filters.dateFrom) {
    const fromDate = new Date(filters.dateFrom);
    result = result.filter(t => new Date(t.timestamp) >= fromDate);
  }

  if (filters.dateTo) {
    const toDate = new Date(filters.dateTo);
    toDate.setHours(23, 59, 59, 999); // Include entire day
    result = result.filter(t => new Date(t.timestamp) <= toDate);
  }

  // Search in text fields
  if (filters.searchTerm && filters.searchTerm.trim()) {
    const searchLower = filters.searchTerm.toLowerCase();
    result = result.filter(t => {
      const searchFields = [
        t.transactionID,
        t.sender?.name,
        t.sender?.id,
        t.sender?.tokenID,
        t.receiver?.name,
        t.receiver?.id,
        t.receiver?.tokenID,
        t.mintedBy,
        t.tokenID
      ].filter(Boolean).map(f => f.toString().toLowerCase());

      return searchFields.some(field => field.includes(searchLower));
    });
  }

  return result;
};

/**
 * Sort transactions based on criteria
 * @param {Array} transactions - Array of transaction objects
 * @param {string} sortBy - Sort option: 'newest', 'oldest', 'highestAmount', 'lowestAmount'
 * @returns {Array} Sorted transactions
 */
export const sortTransactions = (transactions, sortBy) => {
  const result = [...transactions];

  switch (sortBy) {
    case 'newest':
      return result.sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );

    case 'oldest':
      return result.sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );

    case 'highestAmount':
      return result.sort((a, b) => {
        const aAmount = a.amount?.value || 0;
        const bAmount = b.amount?.value || 0;
        return bAmount - aAmount;
      });

    case 'lowestAmount':
      return result.sort((a, b) => {
        const aAmount = a.amount?.value || 0;
        const bAmount = b.amount?.value || 0;
        return aAmount - bAmount;
      });

    default:
      return result;
  }
};

/**
 * Group transactions by date
 * @param {Array} transactions - Array of transaction objects
 * @returns {Object} Grouped transactions { 'Today': [], 'Yesterday': [], etc }
 */
export const groupTransactionsByDate = (transactions) => {
  const groups = {
    'Today': [],
    'Yesterday': [],
    'This Week': [],
    'This Month': [],
    'Older': []
  };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  transactions.forEach(transaction => {
    const txDate = new Date(transaction.timestamp);
    const txDateOnly = new Date(txDate.getFullYear(), txDate.getMonth(), txDate.getDate());

    if (txDateOnly.getTime() === today.getTime()) {
      groups['Today'].push(transaction);
    } else if (txDateOnly.getTime() === yesterday.getTime()) {
      groups['Yesterday'].push(transaction);
    } else if (txDate >= weekAgo) {
      groups['This Week'].push(transaction);
    } else if (txDate >= monthAgo) {
      groups['This Month'].push(transaction);
    } else {
      groups['Older'].push(transaction);
    }
  });

  // Remove empty groups
  return Object.fromEntries(
    Object.entries(groups).filter(([_, transactions]) => transactions.length > 0)
  );
};

/**
 * Transform raw API response to transaction objects
 * @param {Array} rawTransactions - Raw transaction data from API
 * @returns {Array} Transformed transaction objects
 */
const transformTransactions = (rawTransactions) => {
  if (!Array.isArray(rawTransactions)) {
    return [];
  }

  return rawTransactions.map(tx => transformTransaction(tx));
};

/**
 * Transform single transaction from API format to display format
 * @param {Object} rawTransaction - Raw transaction data
 * @returns {Object} Transformed transaction
 */
const transformTransaction = (rawTransaction) => {
  // Check if it's a mint transaction
  if (rawTransaction.type === 'MINT' || rawTransaction.requestID && !rawTransaction.senderTokenID) {
    return transformMintTransaction(rawTransaction);
  }

  // Otherwise it's a transfer transaction
  return transformTransferTransaction(rawTransaction);
};

/**
 * Transform MINT transaction
 */
const transformMintTransaction = (data) => ({
  transactionID: data.requestID || data.transactionID,
  type: 'MINT',
  category: 'Mint',
  amount: {
    value: data.amount || 0,
    symbol: data.currency || 'USD',
    formatted: `${data.currency || 'USD'} ${formatNumber(data.amount || 0)}`
  },
  status: data.approved ? 'COMPLETED' : (data.status || 'PENDING'),
  timestamp: data.approvedAt || data.createdAt || new Date().toISOString(),
  displayTime: new Date(data.approvedAt || data.createdAt || new Date()).toLocaleString(),
  mintedBy: data.requestedBy || 'Unknown Bank',
  tokenID: data.tokenID,
  details: {
    requestID: data.requestID || data.transactionID,
    approved: data.approved || false,
    approvedAt: data.approvedAt
  }
});

/**
 * Transform TRANSFER transaction
 */
const transformTransferTransaction = (data) => {
  // Determine direction based on current user context (would be passed from parent)
  const isOutgoing = data.direction === 'OUTGOING' || !data.direction;

  return {
    transactionID: data.transfer_request_id || data.transferRequestID || data.transactionID,
    type: 'TRANSFER',
    category: 'Transfer',
    direction: data.direction || (isOutgoing ? 'OUTGOING' : 'INCOMING'),
    colorClass: data.direction === 'INCOMING' ? 'credit' : 'debit',

    // Sender Details
    sender: {
      id: data.sender_participant_id || data.senderParticipantID || data.senderCustomerID,
      name: data.sender_name || data.senderName || data.senderCustomerName,
      tokenID: data.sender_token_id || data.senderTokenID,
      kycStatus: data.sender_kyc_status || data.senderKycStatus || 'VERIFIED'
    },

    // Receiver Details
    receiver: {
      id: data.receiver_participant_id || data.receiverParticipantID || data.receiverCustomerID,
      name: data.receiver_name || data.receiverName || data.receiverCustomerName,
      tokenID: data.receiver_token_id || data.receiverTokenID,
      kycStatus: data.receiver_kyc_status || data.receiverKycStatus || 'VERIFIED'
    },

    // Amount Details
    amount: {
      value: data.amount || 0,
      symbol: data.currency || data.senderCurrency || 'USD',
      formatted: `${data.currency || data.senderCurrency || 'USD'} ${formatNumber(data.amount || 0)}`
    },

    receivedAmount: {
      value: data.receiver_customer_amount || data.receiverCustomerAmount || (data.amount ? Math.floor(data.amount * 0.98) : 0),
      symbol: data.receiverCurrency || data.currency || 'USD',
      formatted: `${data.receiverCurrency || data.currency || 'USD'} ${formatNumber(
        data.receiver_customer_amount || data.receiverCustomerAmount || (data.amount ? Math.floor(data.amount * 0.98) : 0)
      )}`
    },

    // Commission Details
    commission: {
      percentage: data.commission_percentage || data.commissionPercentage || 2.0,
      amount: data.commission_amount || data.commissionAmount || Math.floor((data.amount || 0) * 0.02),
      symbol: data.currency || data.receiverCurrency || 'USD',
      receivingBank: data.receiver_name || data.receiverName || 'Receiving Bank',
      bankMSP: data.receiver_msp || data.receiverMSP || 'Org2MSP'
    },

    // Transaction Status
    status: data.status || 'COMPLETED',
    statusSteps: {
      debitStatus: data.debit_status || data.debitStatus || 'DEBITED',
      creditStatus: data.credit_status || data.creditStatus || 'CREDITED'
    },

    // Timestamps
    timestamp: data.completed_at || data.completedAt || data.createdAt || new Date().toISOString(),
    displayTime: new Date(
      data.completed_at || data.completedAt || data.createdAt || new Date()
    ).toLocaleString(),

    // Additional Details
    exchangeRate: data.exchange_rate || data.exchangeRate || 1.0,
    convertedAmount: data.converted_amount || data.convertedAmount || (data.amount || 0),
    escrowedAmount: data.escrowed_amount || data.escrowedAmount || 0,

    // Approval Trail
    approvals: {
      senderApprovedAt: data.sender_approved_at || data.senderApprovedAt,
      receiverApprovedAt: data.receiver_approved_at || data.receiverApprovedAt,
      completedAt: data.completed_at || data.completedAt
    }
  };
};

/**
 * Format number with thousands separator
 */
const formatNumber = (num) => {
  return parseFloat(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

export default {
  getTransactionHistory,
  getTransactionDetails,
  getTransactionStats,
  filterTransactions,
  sortTransactions,
  groupTransactionsByDate
};
