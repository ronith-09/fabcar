/*
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const fs = require('fs');

async function connect() {
    const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
    const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

    const walletPath = path.join(process.cwd(), 'wallet');
    const wallet = await Wallets.newFileSystemWallet(walletPath);

    const identity = await wallet.get('appUser');
    if (!identity) {
        throw new Error('An identity for the user "appUser" does not exist in the wallet');
    }

    const gateway = new Gateway();
    await gateway.connect(ccp, { wallet, identity: 'appUser', discovery: { enabled: true, asLocalhost: true } });
    const network = await gateway.getNetwork('mychannel');
    const contract = network.getContract('fabcar');

    return { gateway, contract };
}

async function submitRegistration(name, country) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('SubmitRegistration', name, '', country);
    console.log('SubmitRegistration transaction has been submitted');
    gateway.disconnect();
}

async function requestTokenRequest(name, networkAddress, country, currency) {
    const { gateway, contract } = await connect();
    if (!currency || !currency.trim()) {
        throw new Error('currency is required');
    }
    await contract.submitTransaction('RequestTokenRequest', name, networkAddress, country, currency);
    console.log('RequestTokenRequest transaction has been submitted');
    gateway.disconnect();
}

async function approveTokenRequest(networkAddress) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveTokenRequest', networkAddress);
    console.log('ApproveTokenRequest transaction has been submitted');
    gateway.disconnect();
}

async function requestMintCoins(networkAddress, amount) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('RequestMintCoins', networkAddress, amount.toString());
    console.log('RequestMintCoins transaction has been submitted');
    gateway.disconnect();
}

async function approveMintRequest(requestID) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveMintRequest', requestID);
    console.log('ApproveMintRequest transaction has been submitted');
    gateway.disconnect();
}

async function registerCustomer(networkAddress, name, tokenID, kycId = '', kycStatus = '') {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('RegisterCustomer', networkAddress, name, tokenID, kycId || '', kycStatus || '');
    console.log('RegisterCustomer transaction has been submitted');
    gateway.disconnect();
}

async function approveCustomerRegistration(requestID, ownerNetworkAddress) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveCustomerRegistration', requestID, ownerNetworkAddress);
    console.log('ApproveCustomerRegistration transaction has been submitted');
    gateway.disconnect();
}

async function customerRequestMint(networkAddress, tokenID, amount) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('CustomerRequestMint', networkAddress, tokenID, amount.toString());
    console.log('CustomerRequestMint transaction has been submitted');
    gateway.disconnect();
}

async function approveCustomerMint(requestID, ownerNetworkAddress) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveCustomerMint', requestID, ownerNetworkAddress);
    console.log('ApproveCustomerMint transaction has been submitted');
    gateway.disconnect();
}

async function createTransferRequest(senderParticipantID, senderTokenTransferID, receiverTokenTransferID, tokenID, amount) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('CreateTransferRequest', senderParticipantID, senderTokenTransferID, receiverTokenTransferID, tokenID, amount.toString());
    console.log('CreateTransferRequest transaction has been submitted');
    gateway.disconnect();
}

async function approveTransferByOwner(transferRequestID, approver) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveTransferByOwner', transferRequestID, approver);
    console.log('ApproveTransferByOwner transaction has been submitted');
    gateway.disconnect();
}

async function approveTransferByReceiver(transferRequestID, approver) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveTransferByReceiver', transferRequestID, approver);
    console.log('ApproveTransferByReceiver transaction has been submitted');
    gateway.disconnect();
}

async function createTokenTransferRequest(senderTokenID, receiverTokenID, senderOwnerAddress, amount) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('CreateTokenTransferRequest', senderTokenID, receiverTokenID, senderOwnerAddress, amount.toString());
    console.log('CreateTokenTransferRequest transaction has been submitted');
    gateway.disconnect();
}

async function approveTokenTransferRequest(requestID, receiverOwnerAddress) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveTokenTransferRequest', requestID, receiverOwnerAddress);
    console.log('ApproveTokenTransferRequest transaction has been submitted');
    gateway.disconnect();
}

async function listAssignedTokens() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ListAssignedTokens');
    console.log('Assigned tokens:', JSON.parse(result.toString()));
    gateway.disconnect();
}

async function getApprovedMintRequests() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('GetApprovedMintRequests');
    console.log('Approved mint requests:', JSON.parse(result.toString()));
    gateway.disconnect();
}

async function listApprovedParticipants() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ListApprovedParticipants');
    console.log('Approved participants:', JSON.parse(result.toString()));
    gateway.disconnect();
}

async function listApprovedParticipantMintRequests(networkAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ListApprovedParticipantMintRequests', networkAddress);
    console.log('Approved participant mint requests:', JSON.parse(result.toString()));
    gateway.disconnect();
}

// CUSTOMER-TO-TOKEN-TO-CUSTOMER TRANSFER FUNCTIONS
async function createCustomerToTokenTransferRequest(senderNetworkAddress, senderTokenID, receiverTokenID, receiverCustomerNetworkAddress, amount, commissionAmount) {
    const { gateway, contract } = await connect();
    const transferID = await contract.submitTransaction('CreateCustomerToTokenTransferRequest', 
        senderNetworkAddress, 
        senderTokenID, 
        receiverTokenID, 
        receiverCustomerNetworkAddress, 
        amount.toString(),
        commissionAmount.toString()
    );
    console.log('CreateCustomerToTokenTransferRequest transaction submitted:', transferID.toString());
    gateway.disconnect();
    return transferID.toString();
}

async function approveSenderTokenTransfer(transferRequestID, senderTokenOwnerAddress, approved) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveSenderTokenTransfer', transferRequestID, senderTokenOwnerAddress, approved.toString());
    console.log('ApproveSenderTokenTransfer transaction submitted');
    gateway.disconnect();
}

async function approveReceiverTokenTransfer(transferRequestID, receiverTokenOwnerAddress, approved) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('ApproveReceiverTokenTransfer', transferRequestID, receiverTokenOwnerAddress, approved.toString());
    console.log('ApproveReceiverTokenTransfer transaction submitted');
    gateway.disconnect();
}

async function updateExchangeRate(currency, rate) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('UpdateExchangeRate', currency, rate.toString());
    console.log(`UpdateExchangeRate transaction submitted: ${currency} = ${rate}`);
    gateway.disconnect();
}

async function viewPendingCustomerToTokenTransfersAsSender(tokenID, ownerNetworkAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ViewPendingCustomerToTokenTransfersAsSender', tokenID, ownerNetworkAddress);
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function viewPendingCustomerToTokenTransfersAsReceiver(tokenID, ownerNetworkAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ViewPendingCustomerToTokenTransfersAsReceiver', tokenID, ownerNetworkAddress);
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function getCustomerToTokenTransferHistory(tokenID) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('GetCustomerToTokenTransferHistory', tokenID);
    gateway.disconnect();
    return JSON.parse(result.toString());
}

module.exports = {
    submitRegistration,
    requestTokenRequest,
    approveTokenRequest,
    requestMintCoins,
    approveMintRequest,
    registerCustomer,
    approveCustomerRegistration,
    customerRequestMint,
    approveCustomerMint,
    createTransferRequest,
    approveTransferByOwner,
    approveTransferByReceiver,
    createTokenTransferRequest,
    approveTokenTransferRequest,
    listAssignedTokens,
    getApprovedMintRequests,
    listApprovedParticipants,
    listApprovedParticipantMintRequests,
    tokenHandshakeApprove,
    checkHandshake,
    viewTokenHandshakes,
    createCustomerToTokenTransferRequest,
    approveSenderTokenTransfer,
    approveReceiverTokenTransfer,
    updateExchangeRate,
    viewPendingCustomerToTokenTransfersAsSender,
    viewPendingCustomerToTokenTransfersAsReceiver,
    getCustomerToTokenTransferHistory,
};

// TOKEN HANDSHAKE FUNCTIONS
async function tokenHandshakeApprove(handshakeID, myTokenID, otherTokenID) {
    const { gateway, contract } = await connect();
    await contract.submitTransaction('TokenHandshakeApprove', handshakeID, myTokenID, otherTokenID);
    console.log(`TokenHandshakeApprove: ${myTokenID} approved handshake with ${otherTokenID}`);
    gateway.disconnect();
}

async function checkHandshake(tokenA, tokenB) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('CheckHandshake', tokenA, tokenB);
    gateway.disconnect();
    return result.toString() === 'true';
}

async function viewTokenHandshakes(tokenID) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ViewTokenHandshakes', tokenID);
    gateway.disconnect();
    return JSON.parse(result.toString());
}
