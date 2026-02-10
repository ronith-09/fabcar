/*
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const fs = require('fs');

const PARTICIPANT_TRANSFER_PREFIX = 'participanttransfer_';

function requireParticipantNetworkAddress(identifier, fieldName = 'participant') {
    if (!identifier) {
        throw new Error(`${fieldName} network address is required`);
    }
    if (identifier.startsWith(PARTICIPANT_TRANSFER_PREFIX)) {
        throw new Error(`${fieldName} must be provided as a network address, not a participant transfer ID`);
    }
    return identifier;
}

async function connect(walletPath, userId) {
    const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
    const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

    const wallet = await Wallets.newFileSystemWallet(walletPath || path.join(process.cwd(), 'wallet'));

    const identity = userId || 'appUser';
    const identityData = await wallet.get(identity);
    if (!identityData) {
        throw new Error(`An identity for the user "${identity}" does not exist in the wallet`);
    }

    const gateway = new Gateway();
    await gateway.connect(ccp, { wallet, identity: identity, discovery: { enabled: true, asLocalhost: true } });
    const network = await gateway.getNetwork('mychannel');
    const contract = network.getContract('fabcar');

    return { gateway, contract };
}

async function getPendingTokenRequests() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('GetPendingTokenRequests');
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function getPendingMintRequests() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('GetPendingMintRequests');
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function getApprovedMintRequests() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('GetApprovedMintRequests');
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

// Get approved mint requests for a specific customer (by network address) - SECURITY: Enforces customer isolation
async function getApprovedMintRequestsForCustomer(walletPath, userId, customerNetworkAddress) {
    const { gateway, contract } = await connect(walletPath, userId);
    const result = await contract.evaluateTransaction('GetApprovedMintRequestsByNetworkAddress', customerNetworkAddress);
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

async function getWalletInfo(networkAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('GetWalletInfo', networkAddress);
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function viewAllTokens(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    const result = await contract.evaluateTransaction('ViewAllTokens');
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function getTokenByID(walletPath, userId, tokenID) {
    const { gateway, contract } = await connect(walletPath, userId);
    const result = await contract.evaluateTransaction('GetTokenByID', tokenID);
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function listAssignedTokens() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ListAssignedTokens');
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

async function listApprovedParticipants() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ListApprovedParticipants');
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

async function listApprovedParticipantMintRequests(networkAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ListApprovedParticipantMintRequests', networkAddress);
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

async function viewPendingCustomerRegistrations(tokenID, ownerNetworkAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ViewPendingCustomerRegistrations', tokenID, ownerNetworkAddress);
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function listApprovedCustomers(tokenID, ownerNetworkAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ListApprovedCustomers', tokenID, ownerNetworkAddress);
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

async function listAllApprovedCustomers() {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ListAllApprovedCustomers');
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

async function viewPendingCustomerMintRequests(tokenID, ownerNetworkAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ViewPendingCustomerMintRequests', tokenID, ownerNetworkAddress);
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function viewCustomerWallet(networkAddress, tokenID) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ViewCustomerWallet', networkAddress, tokenID);
    gateway.disconnect();
    return JSON.parse(result.toString());
}

async function viewPendingTokenTransferRequests(receiverTokenID, receiverOwnerAddress) {
    const { gateway, contract } = await connect();
    const result = await contract.evaluateTransaction('ViewPendingTokenTransferRequests', receiverTokenID, receiverOwnerAddress);
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

async function viewTransferRequestsForOwner(ownerID) {
    const { gateway, contract } = await connect();
    const canonicalOwnerID = requireParticipantNetworkAddress(ownerID, 'ownerID');
    const result = await contract.evaluateTransaction('ViewTransferRequestsForOwner', canonicalOwnerID);
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

async function viewTransferRequestsForReceiver(receiverID) {
    const { gateway, contract } = await connect();
    const canonicalReceiverID = requireParticipantNetworkAddress(receiverID, 'receiverID');
    const result = await contract.evaluateTransaction('ViewTransferRequestsForReceiver', canonicalReceiverID);
    gateway.disconnect();
    const payload = result.toString();
    return payload ? JSON.parse(payload) : [];
}

module.exports = {
    getPendingTokenRequests,
    getPendingMintRequests,
    getApprovedMintRequests,
    getApprovedMintRequestsForCustomer,
    getWalletInfo,
    viewAllTokens,
    getTokenByID,
    listAssignedTokens,
    listApprovedParticipants,
    viewPendingCustomerRegistrations,
    listApprovedCustomers,
    listAllApprovedCustomers,
    viewPendingCustomerMintRequests,
    viewCustomerWallet,
    listApprovedParticipantMintRequests,
    viewPendingTokenTransferRequests,
    viewTransferRequestsForOwner,
    viewTransferRequestsForReceiver,
};
