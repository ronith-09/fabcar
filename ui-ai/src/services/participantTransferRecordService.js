import { safeGet } from './apiClient';

function normalizeRecord(item = {}) {
  return {
    tx_ref: item.tx_ref || item.TxRef || item.record_id || item.RecordID || '',
    request_msg_id:
      item.request_msg_id ||
      item.RequestMsgID ||
      item.transfer_request_id ||
      item.TransferRequestID ||
      '',
    sender_customer_ref:
      item.sender_customer_ref || item.SenderCustomerRef || item.sender_participant_id || item.SenderParticipantID || '',
    sender_bic: item.sender_bic || item.SenderBIC || '',
    receiver_customer_ref:
      item.receiver_customer_ref || item.ReceiverCustomerRef || item.receiver_participant_id || item.ReceiverParticipantID || '',
    receiver_bic: item.receiver_bic || item.ReceiverBIC || '',
    amount: Number(item.amount ?? item.Amount ?? 0),
    currency: item.currency || item.Currency || 'INR',
    commission: Number(item.commission ?? item.Commission ?? 0),
    net_amount: Number(item.net_amount ?? item.NetAmount ?? 0),
    exchange_rate: Number(item.exchange_rate ?? item.ExchangeRate ?? 1),
    status: String(item.status || item.Status || 'SETTLED').toUpperCase(),
    settled_at: item.settled_at || item.SettledAt || item.completed_at || item.CompletedAt || '',
    block_height: item.block_height || item.BlockHeight || ''
  };
}

export async function getSenderParticipantTransferRecords(senderBIC) {
  const response = await safeGet(
    `/participant-transfer-records/sender/${encodeURIComponent(senderBIC)}`,
    { throwError: true }
  );
  return {
    ...response,
    records: (response.records || []).map(normalizeRecord)
  };
}

export async function getReceiverParticipantTransferRecords(receiverBIC) {
  const response = await safeGet(
    `/participant-transfer-records/receiver/${encodeURIComponent(receiverBIC)}`,
    { throwError: true }
  );
  return {
    ...response,
    records: (response.records || []).map(normalizeRecord)
  };
}

export async function getParticipantTransferVolumeByBIC() {
  const response = await safeGet('/participant-transfer-records/volume-by-bic', { throwError: true });
  return response.volume_by_bic || {};
}

export default {
  getSenderParticipantTransferRecords,
  getReceiverParticipantTransferRecords,
  getParticipantTransferVolumeByBIC
};
