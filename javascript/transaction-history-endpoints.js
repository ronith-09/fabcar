/**
 * TRANSACTION HISTORY ENDPOINTS
 * These endpoints handle fetching, filtering, and displaying transaction history
 * for both MINT and TRANSFER transactions
 */

// ============================================================================
// TRANSACTION HISTORY ENDPOINTS
// ============================================================================

// 1. GET /api/transactions/history - Fetch transaction history for a customer
app.get('/api/transactions/history', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { customerId, tokenId, limit = 50, offset = 0 } = req.query;

        // Resolve customer ID (use tokenId if customerId not provided)
        const resolvedCustomerId = customerId || caller;
        const resolvedTokenId = tokenId || '';

        console.log('Transaction history request:', {
            caller,
            customerId: resolvedCustomerId,
            tokenId: resolvedTokenId,
            limit,
            offset
        });

        const walletPath = path.join(process.cwd(), 'wallet');

        // Fetch all relevant transactions
        const transactionHistory = await fetchTransactionHistory(
            walletPath,
            caller,
            resolvedCustomerId,
            resolvedTokenId,
            parseInt(limit),
            parseInt(offset)
        );

        res.json({
            success: true,
            customer_id: resolvedCustomerId,
            token_id: resolvedTokenId,
            total_count: transactionHistory.totalCount,
            limit: parseInt(limit),
            offset: parseInt(offset),
            transactions: transactionHistory.transactions
        });
    } catch (error) {
        console.error('Transaction history error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch transaction history',
            detail: error.message
        });
    }
});

// 2. GET /api/transactions/:transactionId - Get detailed transaction information
app.get('/api/transactions/:transactionId', authenticateJWT, async (req, res) => {
    try {
        const { transactionId } = req.params;
        const caller = req.user.username;

        console.log('Transaction detail request:', { transactionId, caller });

        const walletPath = path.join(process.cwd(), 'wallet');

        const transactionDetails = await fetchTransactionDetails(
            walletPath,
            caller,
            transactionId
        );

        if (!transactionDetails) {
            return res.status(404).json({
                success: false,
                error: 'Transaction not found',
                transaction_id: transactionId
            });
        }

        res.json({
            success: true,
            transaction: transactionDetails
        });
    } catch (error) {
        console.error('Transaction detail error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch transaction details',
            detail: error.message
        });
    }
});

// 3. GET /api/transactions/stats/:customerId - Get transaction statistics
app.get('/api/transactions/stats/:customerId', authenticateJWT, async (req, res) => {
    try {
        const { customerId } = req.params;
        const { timeframe = 'month' } = req.query;
        const caller = req.user.username;

        console.log('Transaction stats request:', { customerId, timeframe, caller });

        const walletPath = path.join(process.cwd(), 'wallet');

        const stats = await calculateTransactionStats(
            walletPath,
            caller,
            customerId,
            timeframe
        );

        res.json({
            success: true,
            customer_id: customerId,
            timeframe,
            stats
        });
    } catch (error) {
        console.error('Transaction stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to calculate transaction statistics',
            detail: error.message
        });
    }
});

// ============================================================================
// HELPER FUNCTIONS FOR TRANSACTION HISTORY
// ============================================================================

/**
 * Fetch all transaction history for a customer
 * Combines MINT and TRANSFER transaction data
 */
async function fetchTransactionHistory(
    walletPath,
    callerId,
    customerId,
    tokenId,
    limit = 50,
    offset = 0
) {
    const transactions = [];

    try {
        // Fetch MINT transactions
        const mintTransactions = await fetchMintTransactions(
            walletPath,
            callerId,
            customerId,
            tokenId
        );
        transactions.push(...mintTransactions);

        // Fetch TRANSFER transactions
        const transferTransactions = await fetchTransferTransactions(
            walletPath,
            callerId,
            customerId,
            tokenId
        );
        transactions.push(...transferTransactions);

        // Sort by timestamp (newest first)
        transactions.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
        });

        // Apply pagination
        const paginatedTransactions = transactions.slice(offset, offset + limit);

        return {
            totalCount: transactions.length,
            transactions: paginatedTransactions
        };
    } catch (error) {
        console.error('Error fetching transaction history:', error);
        throw error;
    }
}

/**
 * Fetch MINT transactions for a customer
 */
async function fetchMintTransactions(
    walletPath,
    callerId,
    customerId,
    tokenId
) {
    const mintTransactions = [];

    try {
        // Query approved mint requests for the customer
        const approvedMints = await getApprovedMintRequestsForCustomer(
            walletPath,
            callerId
        );

        if (Array.isArray(approvedMints)) {
            approvedMints.forEach(mintReq => {
                // Filter by customer and token if provided
                const reqCustomerId = mintReq.requested_by_name || mintReq.RequestedBy || '';
                const reqTokenId = mintReq.token_id || mintReq.TokenID || '';

                if (customerId && reqCustomerId !== customerId) return;
                if (tokenId && reqTokenId !== tokenId) return;

                mintTransactions.push({
                    transactionID: mintReq.request_id || mintReq.RequestID || mintReq.requestID,
                    type: 'MINT',
                    category: 'Mint',
                    amount: {
                        value: mintReq.amount || 0,
                        symbol: mintReq.currency || 'USD',
                        formatted: `${mintReq.currency || 'USD'} ${(mintReq.amount || 0).toFixed(2)}`
                    },
                    status: mintReq.approved ? 'COMPLETED' : 'PENDING',
                    timestamp: mintReq.approved_at || mintReq.ApprovedAt || new Date().toISOString(),
                    displayTime: formatDisplayTime(mintReq.approved_at || mintReq.ApprovedAt),
                    mintedBy: mintReq.requested_by || mintReq.RequestedBy || 'Unknown Bank',
                    tokenID: reqTokenId,
                    details: {
                        requestID: mintReq.request_id || mintReq.RequestID,
                        approved: mintReq.approved || false,
                        approvedAt: mintReq.approved_at || mintReq.ApprovedAt
                    }
                });
            });
        }
    } catch (error) {
        console.warn('Error fetching mint transactions:', error.message);
    }

    return mintTransactions;
}

/**
 * Fetch TRANSFER transactions for a customer
 */
async function fetchTransferTransactions(
    walletPath,
    callerId,
    customerId,
    tokenId
) {
    const transferTransactions = [];

    try {
        // Query customer-to-token transfer history (both outgoing and incoming)
        const transferHistory = await getCustomerToTokenTransferHistoryByCustomer(
            walletPath,
            callerId
        );

        if (Array.isArray(transferHistory)) {
            transferHistory.forEach(transfer => {
                // Filter by customer and token if provided
                const senderCustomerId = transfer.sender_customer_name || transfer.SenderCustomerName || '';
                const receiverCustomerId = transfer.receiver_customer_name || transfer.ReceiverCustomerName || '';
                const tokenTransferId = transfer.sender_token_id || transfer.SenderTokenID || '';

                // Determine if this is an outgoing or incoming transfer for the customer
                let isOutgoing = false;
                let isIncoming = false;

                if (customerId) {
                    isOutgoing = senderCustomerId === customerId;
                    isIncoming = receiverCustomerId === customerId;
                    if (!isOutgoing && !isIncoming) return; // Skip if customer not involved
                } else {
                    // If no customerId specified, include both
                    isOutgoing = true;
                    isIncoming = true;
                }

                if (tokenId && tokenTransferId !== tokenId) return; // Filter by token if specified

                transferTransactions.push({
                    transactionID: transfer.transfer_request_id || transfer.TransferRequestID,
                    type: 'TRANSFER',
                    category: 'Transfer',
                    direction: isOutgoing ? 'OUTGOING' : 'INCOMING',
                    colorClass: isOutgoing ? 'debit' : 'credit',

                    // Sender Details
                    sender: {
                        id: transfer.sender_customer_id || transfer.SenderCustomerID || '',
                        name: senderCustomerId,
                        tokenID: transfer.sender_token_id || transfer.SenderTokenID || '',
                        kycStatus: transfer.sender_kyc_status || transfer.SenderKycStatus || 'VERIFIED'
                    },

                    // Receiver Details
                    receiver: {
                        id: transfer.receiver_customer_id || transfer.ReceiverCustomerID || '',
                        name: receiverCustomerId,
                        tokenID: transfer.receiver_token_id || transfer.ReceiverTokenID || '',
                        kycStatus: transfer.receiver_kyc_status || transfer.ReceiverKycStatus || 'VERIFIED'
                    },

                    // Amount Details
                    amount: {
                        value: transfer.amount || 0,
                        symbol: transfer.sender_currency || transfer.SenderCurrency || 'USD',
                        formatted: `${transfer.sender_currency || 'USD'} ${(transfer.amount || 0).toFixed(2)}`
                    },

                    receivedAmount: {
                        value: transfer.receiver_customer_amount || transfer.ReceiverCustomerAmount || 
                               (transfer.amount ? Math.floor(transfer.amount * 0.98) : 0),
                        symbol: transfer.receiver_currency || transfer.ReceiverCurrency || 'USD',
                        formatted: `${transfer.receiver_currency || 'USD'} ${(
                            transfer.receiver_customer_amount || 
                            transfer.ReceiverCustomerAmount || 
                            (transfer.amount ? Math.floor(transfer.amount * 0.98) : 0)
                        ).toFixed(2)}`
                    },

                    // Commission Details
                    commission: {
                        percentage: transfer.commission_percentage || transfer.CommissionPercentage || 2.0,
                        amount: transfer.commission_amount || transfer.CommissionAmount || 
                               Math.floor((transfer.amount || 0) * 0.02),
                        symbol: transfer.receiver_currency || transfer.ReceiverCurrency || 'USD',
                        receivingBank: transfer.receiver_name || transfer.ReceiverName || 'Receiving Bank',
                        bankMSP: 'Org2MSP' // Would be extracted from transfer if available
                    },

                    // Transaction Status
                    status: transfer.status || transfer.Status || 'COMPLETED',
                    statusSteps: {
                        debitStatus: transfer.debit_status || transfer.DebitStatus || 'DEBITED',
                        creditStatus: transfer.credit_status || transfer.CreditStatus || 'CREDITED'
                    },

                    // Timestamps
                    timestamp: transfer.completed_at || transfer.CompletedAt || new Date().toISOString(),
                    displayTime: formatDisplayTime(transfer.completed_at || transfer.CompletedAt),

                    // Additional Details
                    exchangeRate: transfer.exchange_rate || transfer.ExchangeRate || 1.0,
                    convertedAmount: transfer.converted_amount || transfer.ConvertedAmount || (transfer.amount || 0),
                    escrowedAmount: transfer.escrowed_amount || transfer.EscrowedAmount || 0,

                    // Approval Trail
                    approvals: {
                        senderApprovedAt: transfer.sender_approved_at || transfer.SenderApprovedAt,
                        receiverApprovedAt: transfer.receiver_approved_at || transfer.ReceiverApprovedAt,
                        completedAt: transfer.completed_at || transfer.CompletedAt
                    }
                });
            });
        }
    } catch (error) {
        console.warn('Error fetching transfer transactions:', error.message);
    }

    return transferTransactions;
}

/**
 * Fetch details of a specific transaction
 */
async function fetchTransactionDetails(walletPath, callerId, transactionId) {
    try {
        const { gateway, contract } = await connect(walletPath, callerId);

        try {
            // Try to fetch as a transfer first
            try {
                const transferBytes = await contract.evaluateTransaction(
                    'GetCustomerToTokenTransferRequestByID',
                    transactionId
                );
                const transfer = JSON.parse(transferBytes.toString());
                gateway.disconnect();
                return transformTransferTransactionDetails(transfer);
            } catch (transferErr) {
                // If not a transfer, try mint request
                const mintBytes = await contract.evaluateTransaction(
                    'ReadMintRequest',
                    transactionId
                );
                const mint = JSON.parse(mintBytes.toString());
                gateway.disconnect();
                return transformMintTransactionDetails(mint);
            }
        } finally {
            if (gateway) gateway.disconnect();
        }
    } catch (error) {
        console.error('Error fetching transaction details:', error);
        return null;
    }
}

/**
 * Calculate transaction statistics
 */
async function calculateTransactionStats(walletPath, callerId, customerId, timeframe) {
    try {
        const { transactions } = await fetchTransactionHistory(
            walletPath,
            callerId,
            customerId,
            '',
            1000,
            0
        );

        // Filter by timeframe
        const now = new Date();
        let startDate = new Date();

        switch (timeframe) {
            case 'week':
                startDate.setDate(now.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(now.getMonth() - 1);
                break;
            case 'year':
                startDate.setFullYear(now.getFullYear() - 1);
                break;
            default:
                startDate = new Date(0); // All time
        }

        const filteredTransactions = transactions.filter(
            t => new Date(t.timestamp) >= startDate
        );

        // Calculate stats
        const mints = filteredTransactions.filter(t => t.type === 'MINT');
        const transfers = filteredTransactions.filter(t => t.type === 'TRANSFER');
        const outgoing = transfers.filter(t => t.direction === 'OUTGOING');
        const incoming = transfers.filter(t => t.direction === 'INCOMING');

        const stats = {
            total_transactions: filteredTransactions.length,
            total_mints: mints.length,
            total_mints_amount: mints.reduce((sum, t) => sum + (t.amount?.value || 0), 0),
            total_transfers: transfers.length,
            total_outgoing: outgoing.length,
            total_outgoing_amount: outgoing.reduce((sum, t) => sum + (t.amount?.value || 0), 0),
            total_incoming: incoming.length,
            total_incoming_amount: incoming.reduce((sum, t) => sum + (t.receivedAmount?.value || 0), 0),
            total_commission_paid: outgoing.reduce((sum, t) => sum + (t.commission?.amount || 0), 0),
            timeframe: timeframe,
            period_start: startDate.toISOString(),
            period_end: now.toISOString()
        };

        return stats;
    } catch (error) {
        console.error('Error calculating transaction stats:', error);
        throw error;
    }
}

/**
 * Transform a transfer transaction for detailed view
 */
function transformTransferTransactionDetails(transfer) {
    // Implementation based on the transfer object structure
    return {
        transactionID: transfer.transfer_request_id || transfer.TransferRequestID,
        type: 'TRANSFER',
        category: 'Transfer',
        // ... map all fields from transfer object
    };
}

/**
 * Transform a mint transaction for detailed view
 */
function transformMintTransactionDetails(mint) {
    // Implementation based on the mint object structure
    return {
        transactionID: mint.request_id || mint.RequestID,
        type: 'MINT',
        category: 'Mint',
        // ... map all fields from mint object
    };
}

/**
 * Format display time from ISO timestamp
 */
function formatDisplayTime(isoTimestamp) {
    if (!isoTimestamp) return 'N/A';
    try {
        const date = new Date(isoTimestamp);
        return date.toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (error) {
        return 'N/A';
    }
}
