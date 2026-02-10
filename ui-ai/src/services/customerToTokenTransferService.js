import client, { safePost, safeGet } from './apiClient';

/**
 * Customer-to-Token Transfer Service
 * Handles all API calls for C-to-T transfer operations
 */

export async function initiateCustomerToTokenTransfer(
  senderTokenID,
  receiverTokenID,
  receiverCustomerNetworkAddress,
  amount
) {
  try {
    const response = await safePost(
      '/customer-to-token-transfer',
      {
        senderTokenID,
        receiverTokenID,
        receiverCustomerNetworkAddress,
        amount: parseInt(amount)
      },
      { throwError: true }
    );
    return response;
  } catch (error) {
    console.error('Failed to initiate C-to-T transfer:', error);
    throw error;
  }
}

export async function approveBySenderBank(
  transferId,
  approved
) {
  try {
    const response = await safePost(
      `/customer-to-token-transfer/${transferId}/sender-approve`,
      {
        approved: Boolean(approved)
      },
      { throwError: true }
    );
    return response;
  } catch (error) {
    console.error('Failed to approve by sender bank:', error);
    throw error;
  }
}

export async function approveByReceiverBank(
  transferId,
  approved
) {
  try {
    const response = await safePost(
      `/customer-to-token-transfer/${transferId}/receiver-approve`,
      {
        approved: Boolean(approved)
      },
      { throwError: true }
    );
    return response;
  } catch (error) {
    console.error('Failed to approve by receiver bank:', error);
    throw error;
  }
}

export async function getPendingTransfersAsSender(tokenId, ownerNetworkAddress) {
  try {
    const response = await safeGet(
      `/customer-to-token-transfers/pending-as-sender/${tokenId}?ownerNetworkAddress=${encodeURIComponent(ownerNetworkAddress)}`,
      { throwError: true }
    );
    return response;
  } catch (error) {
    console.error('Failed to fetch pending transfers as sender:', error);
    return {
      success: false,
      perspective: 'sender',
      pending_transfers: [],
      pending_count: 0,
      error: error.message
    };
  }
}

export async function getPendingTransfersAsReceiver(tokenId, ownerNetworkAddress) {
  try {
    const response = await safeGet(
      `/customer-to-token-transfers/pending-as-receiver/${tokenId}?ownerNetworkAddress=${encodeURIComponent(ownerNetworkAddress)}`,
      { throwError: true }
    );
    return response;
  } catch (error) {
    console.error('Failed to fetch pending transfers as receiver:', error);
    return {
      success: false,
      perspective: 'receiver',
      pending_transfers: [],
      pending_count: 0,
      error: error.message
    };
  }
}

export async function getPendingTransfers(tokenId, ownerNetworkAddress) {
  try {
    const response = await safeGet(
      `/customer-to-token-transfers/pending/${tokenId}?ownerNetworkAddress=${encodeURIComponent(ownerNetworkAddress)}`,
      { throwError: true }
    );
    return response;
  } catch (error) {
    console.error('Failed to fetch pending transfers:', error);
    return {
      success: false,
      pending_transfers: [],
      pending_count: 0,
      error: error.message
    };
  }
}

export async function getTransferHistory(tokenId) {
  try {
    const response = await safeGet(
      `/customer-to-token-transfers/history/${tokenId}`,
      { throwError: true }
    );
    return response;
  } catch (error) {
    console.error('Failed to fetch transfer history:', error);
    return {
      success: false,
      completed_transfers: [],
      completed_count: 0,
      error: error.message
    };
  }
}

export default {
  initiateCustomerToTokenTransfer,
  approveBySenderBank,
  approveByReceiverBank,
  getPendingTransfers,
  getPendingTransfersAsSender,
  getPendingTransfersAsReceiver,
  getTransferHistory
};
