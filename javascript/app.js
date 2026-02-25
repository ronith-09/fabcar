'use strict';

const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { newEncryptedFileSystemWallet } = require('./wallet-wrapper');
const { v4: uuidv4 } = require('uuid');

const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

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

async function getWallet(walletPath) {
    // Use encrypted wallet wrapper
    return newEncryptedFileSystemWallet(walletPath);
}

async function connect(walletPath, userId) {
    const wallet = await getWallet(walletPath);
    if (!await wallet.get(userId)) {
        throw new Error(`Identity ${userId} not found in wallet`);
    }
    const gateway = new Gateway();
    // Log identity details for debugging
    try {
        const id = await wallet.get(userId);
        console.log(`connect(): connecting as identity='${userId}' mspId='${id.mspId}' type='${id.type}'`);
        const certPem = id.credentials && (id.credentials.certificate || id.credentials.cert);
        if (certPem) {
            try {
                const x509 = new crypto.X509Certificate(certPem);
                console.log('connect(): certificate subject=', x509.subject);
            } catch (e) {
                // fall back to regex
                const m = String(certPem).match(/CN=([^,\n]+)/);
                if (m) console.log('connect(): certificate CN=', m[1]);
            }
        }
    } catch (err) {
        console.warn('connect(): could not read identity details for logging:', err && err.message ? err.message : err);
    }
    await gateway.connect(ccp, { wallet, identity: userId, discovery: { enabled: true, asLocalhost: true } });
    console.log(`connect(): gateway connected as '${userId}'`);
    const network = await gateway.getNetwork('mychannel'); // replace if needed
    const contract = network.getContract('fabcar'); // replace if needed
    return { gateway, contract };
}

async function submitRegistration(name, country, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.submitTransaction('SubmitRegistration', name, '', country);
        console.log(`SubmitRegistration result: ${result.toString()}`);
        return result.toString();
    } finally {
        gateway.disconnect();
    }
}

async function participantExists(networkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ParticipantExists', networkAddress);
        return result.toString() === 'true';
    } finally {
        gateway.disconnect();
    }
}

function decodeCommonName(networkAddress) {
    if (!networkAddress) {
        return '';
    }
    try {
        const decoded = Buffer.from(networkAddress, 'base64').toString('utf8');
        const match = decoded.match(/CN=([^,]+)/);
        if (match && match[1]) {
            return match[1];
        }
    } catch (err) {
        // Ignore decoding errors and fall back to empty string
    }
    return '';
}

function deriveBankCode(networkAddress) {
    const cn = decodeCommonName(networkAddress);
    if (!cn) {
        return 'BANK';
    }
    return cn.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'BANK';
}

function deriveShortId(tokenID, owner) {
    const hash = crypto.createHash('sha256').update(`${tokenID || ''}:${owner || ''}`).digest('hex');
    return hash.slice(0, 8);
}

function formatTokenDisplayID(token) {
    if (!token) {
        return '';
    }
    const explicitDisplayId = (token.display_token_id || token.DisplayTokenID || '').trim();
    if (explicitDisplayId) {
        return explicitDisplayId;
    }
    const tokenID = token.token_id || token.TokenID || '';
    if (token.owner) {
        const bankCode = deriveBankCode(token.owner);
        const shortId = deriveShortId(tokenID, token.owner);
        return `${bankCode}-${shortId}-v1`;
    }
    const match = tokenID.match(/^token_(\d+)$/);
    if (match) {
        return `${match[1]}BNET-currency-ROOT-v1`;
    }
    return tokenID;
}

async function requestTokenRequest(institutionID, institutionName, countryCode, currencyCode, reference, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        if (!institutionID || !institutionID.trim()) {
            throw new Error('institution_id is required when requesting a token');
        }
        if (!institutionName || !institutionName.trim()) {
            throw new Error('institution_name is required when requesting a token');
        }
        if (!countryCode || !countryCode.trim()) {
            throw new Error('country_code is required when requesting a token');
        }
        if (!currencyCode || !currencyCode.trim()) {
            throw new Error('currency_code is required when requesting a token');
        }
        if (!reference || !reference.trim()) {
            throw new Error('reference is required when requesting a token');
        }

        const result = await contract.submitTransaction(
            'RequestTokenRequest',
            institutionID,
            institutionName,
            countryCode,
            currencyCode,
            reference
        );

        const payload = result.toString().trim();
        if (!payload) {
            return {};
        }
        try {
            return JSON.parse(payload);
        } catch (_e) {
            return { raw: payload };
        }
    } finally {
        gateway.disconnect();
    }
}

async function getPendingTokenRequests(walletPath, adminId) {
    const { gateway, contract } = await connect(walletPath, adminId);
    try {
        const result = await contract.evaluateTransaction('GetPendingTokenRequests');
        const resultString = result.toString().trim();
        if (!resultString) {
            console.log('No pending token requests found (empty response)');
            return [];
        }
        return JSON.parse(resultString);
    } finally {
        gateway.disconnect();
    }
}

async function approveTokenRequest(requestId, walletPath, adminId) {
    const { gateway, contract } = await connect(walletPath, adminId);
    try {
        await contract.submitTransaction('ApproveTokenRequest', requestId);
        console.log('Token request approved');
    } finally {
        gateway.disconnect();
    }
}

async function getTokenAccess(networkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetTokenAccess', networkAddress);
        return result.toString();
    } finally {
        gateway.disconnect();
    }
}

async function requestMintCoins(networkAddress, amount, walletPath, userId, purpose = 'WORKING_CAPITAL') {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const normalizedPurpose = String(purpose || 'WORKING_CAPITAL').trim().toUpperCase();
        const normalizedAmount = String(Math.trunc(Number(amount)));
        try {
            await contract.submitTransaction('RequestTokenMint', normalizedAmount, normalizedPurpose);
        } catch (err) {
            // Backward compatibility for nodes still running legacy chaincode signature.
            await contract.submitTransaction('RequestMintCoins', networkAddress, normalizedAmount);
        }
        console.log('Mint request submitted');
    } finally {
        gateway.disconnect();
    }
}

async function getPendingMintRequests(walletPath, adminId) {
    const { gateway, contract } = await connect(walletPath, adminId);
    try {
        const result = await contract.evaluateTransaction('GetPendingMintRequests');
        const resultString = result.toString().trim();
        if (!resultString) {
            return [];
        }
        return JSON.parse(resultString);
    } finally {
        gateway.disconnect();
    }
}

async function approveMintRequest(requestId, walletPath, adminId) {
    const { gateway, contract } = await connect(walletPath, adminId);
    try {
        await contract.submitTransaction('ApproveMintRequest', requestId);
        console.log('Mint request approved');
    } finally {
        gateway.disconnect();
    }
}

async function getWalletInfo(networkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetWalletInfo', networkAddress);
        let walletInfo = JSON.parse(result.toString());
        
        // CRITICAL: Fetch fresh token data to ensure foreign_balances is current (not locked balances)
        if (walletInfo && walletInfo.tokenID) {
            try {
                console.log('📝 getWalletInfo: Fetching fresh token data for:', walletInfo.tokenID);
                const freshToken = await getTokenByID(walletPath, userId, walletInfo.tokenID);
                console.log('✅ Fresh token received - ForeignBalances:', freshToken.foreign_balances, 'ForeignLocked:', freshToken.foreign_locked_balance);
                
                // Update foreign balances in wallet info with fresh data
                walletInfo.foreign_balances = freshToken.foreign_balances || {};
                walletInfo.foreign_locked_balance = freshToken.foreign_locked_balance || {};
                walletInfo.foreignCurrencies = Object.entries(walletInfo.foreign_balances || {}).map(([code, amount]) => ({
                    currency: code,
                    amount: amount,
                    display: formatCurrencyValue(code, amount),
                    currencySymbol: currencySymbol(code)
                }));
                console.log('✅ Updated walletInfo with fresh foreign balances');
            } catch (freshErr) {
                console.log('⚠️ Could not fetch fresh token - using stale data:', freshErr.message);
            }
            
            walletInfo.display_token_id = formatTokenDisplayID({
                token_id: walletInfo.tokenID,
                owner: networkAddress
            });
        }
        return walletInfo;
    } finally {
        gateway.disconnect();
    }
}

async function viewAllTokens(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ViewAllTokens');
        const resultString = result.toString().trim();
        if (!resultString) {
            return [];
        }
        let tokens;
        try {
            tokens = JSON.parse(resultString);
        } catch (parseErr) {
            console.error('ERROR parsing ViewAllTokens response:', parseErr.message);
            console.error('Raw response:', resultString.substring(0, 500));
            return [];
        }
        
        if (!Array.isArray(tokens)) {
            console.warn('ViewAllTokens returned non-array:', typeof tokens);
            return [];
        }
        
        const mappedTokens = tokens.map(token => {
            if (!token) {
                console.warn('Token is null/undefined in ViewAllTokens response');
                return null;
            }
            const mapped = {
                ...token,
                transfer_ids: Array.isArray(token.transfer_ids) ? token.transfer_ids : [],
                foreign_balances: token.foreign_balances || {},
                foreign_locked_balance: token.foreign_locked_balance || {},
                display_token_id: formatTokenDisplayID(token)
            };
            console.log('Mapped token:', { token_id: mapped.token_id, owner: mapped.owner, minted: mapped.minted });
            return mapped;
        }).filter(t => t !== null);
        
        console.log('viewAllTokens returning', mappedTokens.length, 'tokens');
        return mappedTokens;
    } finally {
        gateway.disconnect();
    }
}

async function getTokenByID(walletPath, userId, tokenID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log('getTokenByID: Calling chaincode with tokenID:', tokenID);
        const result = await contract.evaluateTransaction('GetTokenByID', tokenID);
        const resultString = result.toString();
        console.log('getTokenByID: Raw response length:', resultString.length, 'bytes');
        
        if (!resultString || resultString.length === 0) {
            console.warn('getTokenByID: Empty response from chaincode');
            return {};
        }
        
        let token;
        try {
            token = JSON.parse(resultString);
        } catch (parseErr) {
            console.error('getTokenByID: ERROR parsing response:', parseErr.message);
            console.error('Raw response:', resultString.substring(0, 500));
            return {};
        }
        
        if (!token) {
            console.warn('getTokenByID: Parsed token is null/undefined');
            return {};
        }
        
        const mapped = {
            ...token,
            transfer_ids: Array.isArray(token.transfer_ids) ? token.transfer_ids : [],
            foreign_balances: token.foreign_balances || {},
            foreign_locked_balance: token.foreign_locked_balance || {},
            display_token_id: formatTokenDisplayID(token)
        };
        
        console.log('getTokenByID: Returning token:', { 
            token_id: mapped.token_id, 
            minted: mapped.minted,
            owner: mapped.owner,
            currency: mapped.currency
        });
        return mapped;
    } finally {
        gateway.disconnect();
    }
}

async function getAvailableTokensForRegistration(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetAvailableTokensForRegistration');
        const resultString = result.toString().trim();
        if (!resultString) {
            return [];
        }
        const tokens = JSON.parse(resultString);
        return Array.isArray(tokens)
            ? tokens.map(token => ({
                ...token,
                transfer_ids: Array.isArray(token.transfer_ids) ? token.transfer_ids : [],
                foreign_balances: token.foreign_balances || {},
                foreign_locked_balance: token.foreign_locked_balance || {},
                display_token_id: formatTokenDisplayID(token)
            }))
            : [];
    } finally {
        gateway.disconnect();
    }
}

async function initRootTokens(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.submitTransaction('InitRootTokens');
        console.log(`InitRootTokens result: ${result.toString()}`);
        return result.toString();
    } finally {
        gateway.disconnect();
    }
}

async function listAssignedTokens(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const normalizeToken = token => ({
            ...token,
            token_id: token.token_id || token.TokenID || token.tokenId || '',
            minted: Number(
                token.minted ??
                token.Minted ??
                token.total_supply ??
                token.TotalSupply ??
                0
            ),
            transfer_ids: Array.isArray(token.transfer_ids) ? token.transfer_ids : [],
            foreign_balances: token.foreign_balances || {},
            foreign_locked_balance: token.foreign_locked_balance || {},
            display_token_id: formatTokenDisplayID(token)
        });

        try {
            const result = await contract.evaluateTransaction('ListAssignedTokens');
            const payload = result.toString().trim();
            if (!payload) {
                return [];
            }
            const assigned = JSON.parse(payload);
            return Array.isArray(assigned) ? assigned.map(normalizeToken) : [];
        } catch (listErr) {
            const errMsg = String(listErr?.message || '');
            const isSchemaMismatch = errMsg.includes('did not match schema');
            if (!isSchemaMismatch) {
                throw listErr;
            }

            // Compatibility fallback for newer chaincode token shape.
            const allResult = await contract.evaluateTransaction('ViewAllTokens');
            const allPayload = allResult.toString().trim();
            if (!allPayload) {
                return [];
            }
            const allTokens = JSON.parse(allPayload);
            const filtered = Array.isArray(allTokens)
                ? allTokens.filter(token => {
                    const status = String(token?.status || token?.Status || '').trim().toUpperCase();
                    const frozen = Boolean(token?.is_frozen || token?.IsFrozen);
                    return !frozen && status !== 'FROZEN' && status !== 'EXPIRED';
                })
                : [];
            return filtered.map(normalizeToken);
        }
    } finally {
        gateway.disconnect();
    }
}

async function viewAvailableCurrencies(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ViewAvailableCurrencies');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const currencies = JSON.parse(payload);
        return Array.isArray(currencies) ? currencies : [];
    } finally {
        gateway.disconnect();
    }
}

async function listApprovedParticipants(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListApprovedParticipants');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function listApprovedParticipantMintRequests(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListApprovedCustomerMintRequests');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function listTokenMintRecords(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListTokenMintRecords');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const records = JSON.parse(payload);
        return Array.isArray(records) ? records : [];
    } finally {
        gateway.disconnect();
    }
}

async function getApprovedMintRequests(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetApprovedMintRequests');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const approved = JSON.parse(payload);
        return Array.isArray(approved) ? approved : [];
    } finally {
        gateway.disconnect();
    }
}

// Customer-scoped mint history: returns only approved mint requests for the authenticated customer
async function getApprovedMintRequestsForCustomer(walletPath, userId, customerNetworkAddress) {
    if (!customerNetworkAddress || !String(customerNetworkAddress).trim()) {
        throw new Error('customerNetworkAddress is required');
    }
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction(
            'GetApprovedMintRequestsByNetworkAddress',
            customerNetworkAddress
        );
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const approved = JSON.parse(payload);
        return Array.isArray(approved) ? approved : [];
    } finally {
        gateway.disconnect();
    }
}

// Customer-scoped mint history with no customer parameter.
// Chaincode derives caller identity and returns only caller-owned approved mints.
async function getMyApprovedMintRequests(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetMyApprovedMintRequests');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const approved = JSON.parse(payload);
        return Array.isArray(approved) ? approved : [];
    } finally {
        gateway.disconnect();
    }
}

async function participantOwnsToken(networkAddress, tokenID, walletPath, userId) {
    try {
        const tokens = await viewAllTokens(walletPath, userId);
        return tokens.some(token => token.token_id === tokenID && token.owner_network_address === networkAddress);
    } catch (error) {
        console.warn('viewAllTokens failed:', error.message);
        return true;
    }
}

async function registerCustomer(networkAddress, name, tokenID, walletPath, userId, kycId = '', kycStatus = '') {
    console.log(`registerCustomer(): invoking RegisterCustomer as identity='${userId}' networkAddress='${networkAddress}' tokenID='${tokenID}' kycId='${kycId}' kycStatus='${kycStatus}'`);
    
    // IMPORTANT: RegisterCustomer chaincode function requires a Participant record to already exist
    // at the networkAddress key. If the participant doesn't exist, RegisterCustomer will fail with
    // "participant not found". 
    //
    // The RegisterCustomer function expects networkAddress to be the caller's own client ID
    // (i.e., the caller is registering themselves as a customer). Before calling RegisterCustomer,
    // we must ensure the participant record exists by calling SubmitRegistration first.
    
    // Check if participant exists; if not, create it first
    let participantExists_ = false;
    try {
        participantExists_ = await participantExists(networkAddress, walletPath, userId);
        console.log(`registerCustomer(): Participant exists check returned: ${participantExists_}`);
    } catch (checkErr) {
        console.warn(`registerCustomer(): Could not check if participant exists:`, checkErr.message);
    }
    
    // If participant doesn't exist, create it via SubmitRegistration
    if (!participantExists_) {
        console.log(`registerCustomer(): Participant does not exist at ${networkAddress}, attempting to create via SubmitRegistration`);
        try {
            // SubmitRegistration will use the caller's certificate ID and create a participant record
            // Function signature: submitRegistration(name, country, walletPath, userId)
            const createdNetworkAddress = await submitRegistration(name, 'US', walletPath, userId);
            console.log(`registerCustomer(): SubmitRegistration created participant at '${createdNetworkAddress}'`);
            
            // Verify that the created participant matches the expected networkAddress
            // SubmitRegistration uses the caller's client ID, so if networkAddress != createdNetworkAddress,
            // there's a mismatch - the caller is trying to register someone else
            if (createdNetworkAddress !== networkAddress) {
                console.error(`registerCustomer(): SECURITY: Mismatch between created (${createdNetworkAddress}) and provided (${networkAddress}) network address`);
                console.error(`registerCustomer(): This may indicate the caller is trying to register someone else (forbidden)`);
                // Don't throw - let RegisterCustomer handle the security check, but log the warning
            }
        } catch (submitRegErr) {
            if (submitRegErr.message && submitRegErr.message.includes('already exists')) {
                console.log('registerCustomer(): Participant already exists (race condition handled)');
            } else {
                console.error('registerCustomer(): Failed to create participant via SubmitRegistration:', submitRegErr.message);
                // For now, continue anyway - maybe participant exists but our check failed
                // Let RegisterCustomer fail with a proper error if participant truly doesn't exist
            }
        }
    }
    
    // Now invoke RegisterCustomer on the chaincode
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`registerCustomer(): Invoking RegisterCustomer chaincode with networkAddress=${networkAddress}`);
        const result = await contract.submitTransaction('RegisterCustomer', networkAddress, name, tokenID, kycId || '', kycStatus || '');
        console.log('registerCustomer(): Customer registration submitted successfully, result length=', result ? result.length : 0);
    } finally {
        gateway.disconnect();
    }
}

async function viewPendingCustomerRegistrations(tokenID, ownerNetworkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ViewPendingCustomerRegistrations', tokenID, ownerNetworkAddress);
        console.log(`viewPendingCustomerRegistrations(): evaluated as identity='${userId}' tokenID='${tokenID}' owner='${ownerNetworkAddress}' resultLen=${result ? result.length : 0}`);
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        let registrations;
        try {
            registrations = JSON.parse(payload);
        } catch (parseErr) {
            console.warn('Unable to parse pending registration payload, returning empty array:', parseErr.message);
            return [];
        }
        return Array.isArray(registrations)
            ? registrations.map(r => ({ ...r, transfer_ids: Array.isArray(r.transfer_ids) ? r.transfer_ids : [] }))
            : registrations;
    } catch (error) {
        if (error.message && error.message.includes('transfer_ids')) {
            console.warn('Schema validation error in viewPendingCustomerRegistrations, returning empty array:', error.message);
            return [];
        }
        throw error;
    } finally {
        gateway.disconnect();
    }
}

async function listApprovedCustomers(tokenID, ownerNetworkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListApprovedCustomers', tokenID, ownerNetworkAddress);
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const customers = JSON.parse(payload);
        return Array.isArray(customers) ? customers : [];
    } finally {
        gateway.disconnect();
    }
}

async function listAllApprovedCustomers(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListAllApprovedCustomers');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const customers = JSON.parse(payload);
        return Array.isArray(customers) ? customers : [];
    } finally {
        gateway.disconnect();
    }
}

async function approveCustomerRegistration(requestId, ownerNetworkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction('ApproveCustomerRegistration', requestId, ownerNetworkAddress);
        console.log('Customer registration approved');
    } finally {
        gateway.disconnect();
    }
}

async function rejectCustomerRegistration(requestId, ownerNetworkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction('RejectCustomerRegistration', requestId, ownerNetworkAddress);
        console.log('Customer registration rejected');
    } finally {
        gateway.disconnect();
    }
}

async function upsertCustomerFromBank(networkAddress, clientID, tokenID, kycID, kycStatus, walletPath, userId) {
    if (!networkAddress || !tokenID) {
        throw new Error('networkAddress and tokenID are required');
    }
    const statusValue = typeof kycStatus === 'boolean' ? String(kycStatus) : (kycStatus || '');
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction(
            'UpsertCustomerFromBank',
            networkAddress,
            clientID || '',
            tokenID,
            kycID || '',
            statusValue
        );
        console.log('Customer upserted for token', tokenID, 'with network', networkAddress);
    } finally {
        gateway.disconnect();
    }
}

async function customerRequestMint(networkAddress, tokenID, amount, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction('CustomerRequestMint', networkAddress, tokenID, amount.toString());
        console.log('Customer mint request submitted');
    } finally {
        gateway.disconnect();
    }
}

async function viewPendingCustomerMintRequests(tokenID, ownerNetworkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    if (!ownerNetworkAddress) {
        gateway.disconnect();
        throw new Error('ownerNetworkAddress is required to view pending customer mint requests');
    }
    try {
        const tokenArg = tokenID || '';
        const result = await contract.evaluateTransaction('ViewPendingCustomerMintRequests', tokenArg, ownerNetworkAddress);
        const mintRequests = JSON.parse(result.toString());
        return Array.isArray(mintRequests)
            ? mintRequests.map(m => ({ ...m, transfer_ids: Array.isArray(m.transfer_ids) ? m.transfer_ids : [] }))
            : mintRequests;
    } catch (error) {
        if (error.message && error.message.includes('transfer_ids')) {
            console.warn('Schema validation error in viewPendingCustomerMintRequests, returning empty array:', error.message);
            return [];
        }
        throw error;
    } finally {
        gateway.disconnect();
    }
}

async function approveCustomerMint(requestId, ownerNetworkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction('ApproveCustomerMint', requestId, ownerNetworkAddress);
        console.log('Customer mint approved');
    } finally {
        gateway.disconnect();
    }
}

async function rejectCustomerMint(requestId, ownerNetworkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction('RejectCustomerMint', requestId, ownerNetworkAddress);
        console.log('Customer mint rejected');
    } finally {
        gateway.disconnect();
    }
}

async function viewCustomerWallet(networkAddress, tokenID, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ViewCustomerWallet', networkAddress, tokenID);
        return JSON.parse(result.toString());
    } finally {
        gateway.disconnect();
    }
}

async function probeCustomerTokenIDByWallet(networkAddress, walletPath, userId, maxTokens = 25) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        for (let i = 1; i <= maxTokens; i += 1) {
            const tokenID = `token_${i}`;
            try {
                const result = await contract.evaluateTransaction('ViewCustomerWallet', networkAddress, tokenID);
                const payload = result.toString().trim();
                if (!payload) {
                    continue;
                }
                const walletData = JSON.parse(payload);
                const resolvedToken =
                    walletData?.tokenID ||
                    walletData?.tokenId ||
                    walletData?.token_id ||
                    walletData?.token;
                if (resolvedToken) {
                    return resolvedToken;
                }
            } catch (_probeError) {
                // Ignore per-token probe failures; continue scanning.
            }
        }
        return null;
    } finally {
        gateway.disconnect();
    }
}

async function getCustomerIDAccess(networkAddress, tokenID, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetCustomerIDAccess', networkAddress, tokenID);
        return JSON.parse(result.toString());
    } finally {
        gateway.disconnect();
    }
}

async function getCustomerTokenApprovalStatus(networkAddress, tokenID, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        try {
            const result = await contract.evaluateTransaction(
                'GetCustomerTokenApprovalStatus',
                networkAddress || '',
                tokenID || ''
            );
            const payload = result.toString().trim();
            if (!payload) {
                return {};
            }
            return JSON.parse(payload);
        } catch (err) {
            const msg = String(err?.message || '');
            if (
                msg.includes('Function GetCustomerTokenApprovalStatus not found') ||
                msg.includes('function GetCustomerTokenApprovalStatus not found')
            ) {
                // Backward compatibility for older deployed chaincode packages.
                const legacyResult = await contract.evaluateTransaction(
                    'GetCustomerIDAccess',
                    networkAddress || '',
                    tokenID || ''
                );
                const legacyPayload = legacyResult.toString().trim();
                if (!legacyPayload) {
                    return {};
                }
                return JSON.parse(legacyPayload);
            }
            throw err;
        }
    } finally {
        gateway.disconnect();
    }
}

async function getMyCustomerAccounts(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetMyCustomerAccounts');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const accounts = JSON.parse(payload);
        return Array.isArray(accounts) ? accounts : [];
    } finally {
        gateway.disconnect();
    }
}

async function getCustomerTokenWalletDetails(customerRef, tokenID, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction(
            'GetCustomerTokenWallet',
            customerRef || '',
            tokenID || ''
        );
        const payload = result.toString().trim();
        if (!payload) {
            return {};
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function createTransferRequest(senderParticipantID, senderTokenTransferID, receiverTokenTransferID, tokenID, amount, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const transferRequestID = await contract.submitTransaction(
            'CreateTransferRequest',
            senderParticipantID,
            senderTokenTransferID,
            receiverTokenTransferID,
            tokenID,
            amount.toString()
        );
        console.log(`Transfer request created: ${transferRequestID.toString()}`);
        return transferRequestID.toString();
    } finally {
        gateway.disconnect();
    }
}

// Transfer request functions removed - use token transfer functions instead

async function createTokenTransferRequest(senderTokenID, receiverTokenID, senderOwnerAddress, amount, purpose, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const resolvedPurpose = (purpose || 'INTERBANK_SETTLEMENT').toString();
        try {
            const msgID = await contract.submitTransaction(
                'RequestBankTransfer',
                senderTokenID,
                receiverTokenID,
                senderOwnerAddress,
                amount.toString(),
                resolvedPurpose
            );
            console.log(`Token transfer request created (bank format): ${msgID.toString()}`);
            return msgID.toString();
        } catch (bankErr) {
            console.warn(`RequestBankTransfer failed, falling back to CreateTokenTransferRequest: ${bankErr.message}`);
            const requestID = await contract.submitTransaction(
                'CreateTokenTransferRequest',
                senderTokenID,
                receiverTokenID,
                senderOwnerAddress,
                amount.toString()
            );
            console.log(`Token transfer request created (legacy format): ${requestID.toString()}`);
            return requestID.toString();
        }
    } finally {
        gateway.disconnect();
    }
}

async function viewPendingTokenTransferRequests(receiverTokenID, receiverOwnerAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ViewPendingTokenTransferRequests', receiverTokenID, receiverOwnerAddress);
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        const requests = JSON.parse(payload);
        return Array.isArray(requests) ? requests : [];
    } finally {
        gateway.disconnect();
    }
}

async function approveTokenTransferRequest(requestID, receiverOwnerAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction('ApproveTokenTransferRequest', requestID, receiverOwnerAddress);
        console.log('Token transfer request approved');
    } finally {
        gateway.disconnect();
    }
}

async function approveTokenTransferRequestWithFX(requestID, receiverOwnerAddress, fxRateStr, inrAmountStr, commissionUSDStr, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction('ApproveTokenTransferRequestWithFX', requestID, receiverOwnerAddress, fxRateStr, inrAmountStr, commissionUSDStr);
        console.log('Token transfer request approved with FX conversion');
    } finally {
        gateway.disconnect();
    }
}

async function listTokenToTokenTransferHistory(tokenID, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListTokenToTokenTransferHistory', tokenID);
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function listParticipantTransferHistory(networkAddress, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListParticipantTransferHistory', networkAddress);
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function listAllParticipantTransferHistory(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListAllParticipantTransferHistory');
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function listParticipantTransfersByID(participantID, walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ListParticipantTransfersByID', participantID);
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function getSenderRecords(walletPath, userId, senderBIC) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetSenderRecords', senderBIC);
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function getReceiverRecords(walletPath, userId, receiverBIC) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetReceiverRecords', receiverBIC);
        const payload = result.toString().trim();
        if (!payload) {
            return [];
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

async function totalVolumeByBIC(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('TotalVolumeByBIC');
        const payload = result.toString().trim();
        if (!payload) {
            return {};
        }
        return JSON.parse(payload);
    } finally {
        gateway.disconnect();
    }
}

// Persistent listener for Chaincode Events
async function startEventListener(walletPath, userId, notifyCallback) {
    try {
        const { gateway, contract } = await connect(walletPath, userId);
        console.log(`Starting Chaincode Event Listener as ${userId}...`);

        await contract.addContractListener(async (event) => {
            const eventName = event.eventName;
            const payload = event.payload.toString('utf8');
            console.log(`Chaincode Event Received: ${eventName}`);

            // Notify via callback (which will invoke Socket.io)
            if (notifyCallback) {
                notifyCallback(eventName, payload ? JSON.parse(payload) : {});
            }
        });

        console.log('Event Listener started successfully.');
        // Do NOT disconnect gateway, as we need to keep listening
        return gateway;
    } catch (error) {
        console.error('Failed to start Event Listener:', error);
    }
}

// TRANSACTION HISTORY FUNCTIONS
async function getTransactionHistory(walletPath, userId, participantID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Getting transaction history for participant: ${participantID}`);
        const result = await contract.evaluateTransaction(
            'GetTransactionHistory',
            participantID
        );
        const resultStr = result.toString().trim();
        console.log(`[CHAINCODE] Transaction history retrieved`);
        if (!resultStr || resultStr === '[]') {
            return [];
        }
        return JSON.parse(resultStr);
    } catch (error) {
        console.error(`[CHAINCODE] GetTransactionHistory failed:`, error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

async function getMintTransactions(walletPath, userId, participantID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Getting mint transactions for participant: ${participantID}`);
        const result = await contract.evaluateTransaction(
            'GetMintTransactions',
            participantID
        );
        const resultStr = result.toString().trim();
        console.log(`[CHAINCODE] Mint transactions retrieved`);
        if (!resultStr || resultStr === '[]') {
            return [];
        }
        return JSON.parse(resultStr);
    } catch (error) {
        console.error(`[CHAINCODE] GetMintTransactions failed:`, error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

async function getTransferTransactions(walletPath, userId, participantID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Getting transfer transactions for participant: ${participantID}`);
        const result = await contract.evaluateTransaction(
            'GetTransferTransactions',
            participantID
        );
        const resultStr = result.toString().trim();
        console.log(`[CHAINCODE] Transfer transactions retrieved`);
        if (!resultStr || resultStr === '[]') {
            return [];
        }
        return JSON.parse(resultStr);
    } catch (error) {
        console.error(`[CHAINCODE] GetTransferTransactions failed:`, error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

async function registerAccount(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        // Only accountID and balance, PIN handled off-chain
        const accountID = 'account_' + uuidv4();
        const result = await contract.submitTransaction('RegisterCustomerAccount', accountID);
        return accountID;
    } finally {
        gateway.disconnect();
    }
}

async function getAccountBalance(walletPath, userId, accountID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetAccountBalance', accountID);
        return parseInt(result.toString(), 10);
    } finally {
        gateway.disconnect();
    }
}

module.exports = {
    submitRegistration,
    participantExists,
    requestTokenRequest,
    getPendingTokenRequests,
    approveTokenRequest,
    getTokenAccess,
    requestMintCoins,
    getPendingMintRequests,
    approveMintRequest,
    getWalletInfo,
    viewAllTokens,
    viewAvailableCurrencies,
    getTokenByID,
    getAvailableTokensForRegistration,
    initRootTokens,
    listAssignedTokens,
    listApprovedParticipants,
    registerCustomer,
    viewPendingCustomerRegistrations,
    listApprovedCustomers,
    listAllApprovedCustomers,
    approveCustomerRegistration,
    rejectCustomerRegistration,
    upsertCustomerFromBank,
    customerRequestMint,
    viewPendingCustomerMintRequests,
    approveCustomerMint,
    rejectCustomerMint,
    viewCustomerWallet,
    probeCustomerTokenIDByWallet,
    getCustomerIDAccess,
    getCustomerTokenApprovalStatus,
    getMyCustomerAccounts,
    getCustomerTokenWalletDetails,
    getApprovedMintRequests,
    getApprovedMintRequestsForCustomer,
    getMyApprovedMintRequests,
    listApprovedParticipantMintRequests,
    listTokenMintRecords,
    createTransferRequest,

    createTokenTransferRequest,
    viewPendingTokenTransferRequests,
    approveTokenTransferRequest,
    approveTokenTransferRequestWithFX,
    listTokenToTokenTransferHistory,
    listParticipantTransferHistory,
    listAllParticipantTransferHistory,
    listParticipantTransfersByID,
    getSenderRecords,
    getReceiverRecords,
    totalVolumeByBIC,
    requestTokenHandshake,
    viewPendingTokenHandshakes,
    tokenHandshakeApprove,
    checkHandshake,
    viewTokenHandshakes,
    
    createCustomerToTokenTransferRequest,
    requestCustomerTransfer,
    approveSenderTokenTransfer,
    rejectSenderPreEscrow,
    approveReceiverTokenTransfer,
    rejectReceiver,
    viewPendingCustomerToTokenTransfersAsSender,
    viewPendingCustomerToTokenTransfersAsReceiver,
    getCustomerToTokenTransferHistory,
    getCustomerToTokenTransferHistoryByCustomer,
    getRejectedByReason,
    getRejectedByBank,
    getExpiredEscrowReturns,
    updateExchangeRate,
    setTokenCommission,
    getTokenCommission,
    getTransactionHistory,
    getMintTransactions,
    getTransferTransactions,
    
    connect,
    startEventListener,
    registerAccount,
    getAccountBalance
};

// TOKEN HANDSHAKE FUNCTIONS (for REST API)
async function requestTokenHandshake(walletPath, userId, myTokenID, otherTokenID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Submitting RequestTokenHandshake transaction with myTokenID: ${myTokenID}, otherTokenID: ${otherTokenID}`);
        const result = await contract.submitTransaction('RequestTokenHandshake', myTokenID, otherTokenID);
        const handshakeID = result.toString();
        console.log(`[CHAINCODE] RequestTokenHandshake transaction successful, generated handshakeID: ${handshakeID}`);
        return handshakeID;
    } catch (error) {
        console.error(`[CHAINCODE] RequestTokenHandshake transaction failed:`, error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

async function viewPendingTokenHandshakes(walletPath, userId, tokenID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Querying ViewPendingTokenHandshakes for tokenID: ${tokenID}`);
        const result = await contract.evaluateTransaction('ViewPendingTokenHandshakes', tokenID);
        const resultStr = result.toString().trim();
        console.log(`[CHAINCODE] ViewPendingTokenHandshakes result:`, resultStr);
        if (!resultStr) {
            console.log(`[CHAINCODE] No pending handshakes found for tokenID: ${tokenID}`);
            return []; // Return empty array if no result
        }
        const parsed = JSON.parse(resultStr);
        console.log(`[CHAINCODE] Parsed pending handshakes:`, parsed);
        return parsed;
    } finally {
        await gateway.disconnect();
    }
}

async function tokenHandshakeApprove(walletPath, userId, handshakeID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction('TokenHandshakeApprove', handshakeID);
    } finally {
        await gateway.disconnect();
    }
}

async function checkHandshake(walletPath, userId, tokenA, tokenB) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('CheckHandshake', tokenA, tokenB);
        return result.toString() === 'true';
    } finally {
        await gateway.disconnect();
    }
}

async function viewTokenHandshakes(walletPath, userId, tokenID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('ViewTokenHandshakes', tokenID);
        const resultStr = result.toString().trim();
        if (!resultStr) {
            return []; // Return empty array if no result
        }
        return JSON.parse(resultStr);
    } finally {
        await gateway.disconnect();
    }
}
// CUSTOMER-TO-TOKEN TRANSFER FUNCTIONS
// 1. Create Customer-to-Token Transfer Request
async function createCustomerToTokenTransferRequest(
    walletPath,
    userId,
    senderNetworkAddress,
    receiverCustomerRef,
    receiverBIC,
    amount
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Creating customer-to-token transfer request:`, {
            senderNetworkAddress,
            receiverCustomerRef,
            receiverBIC,
            amount
        });
        const result = await contract.submitTransaction(
            'CreateCustomerToTokenTransferRequest',
            senderNetworkAddress,
            receiverCustomerRef,
            receiverBIC,
            amount.toString()
        );
        const transferRequestID = result.toString();
        console.log(`[CHAINCODE] Transfer request created with ID: ${transferRequestID}`);
        return transferRequestID;
    } catch (error) {
        console.error('[CHAINCODE] CreateCustomerToTokenTransferRequest failed:', error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

// Privacy-safe BIC-based customer transfer (token IDs resolved in chaincode).
async function requestCustomerTransfer(walletPath, userId, receiverCustomerRef, receiverBIC, amount) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.submitTransaction(
            'RequestCustomerTransfer',
            receiverCustomerRef,
            receiverBIC,
            amount.toString()
        );
        return result.toString();
    } finally {
        await gateway.disconnect();
    }
}

// 2. Approve/Reject by Sender Token Owner
async function approveSenderTokenTransfer(
    walletPath,
    userId,
    transferRequestID,
    senderTokenOwnerAddress,
    approved
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Sender token approval:`, {
            transferRequestID,
            senderTokenOwnerAddress,
            approved
        });
        await contract.submitTransaction(
            'ApproveSenderTokenTransfer',
            transferRequestID,
            senderTokenOwnerAddress,
            approved.toString()
        );
        console.log(`[CHAINCODE] Sender approval processed for transfer: ${transferRequestID}`);
    } catch (error) {
        console.error('[CHAINCODE] ApproveSenderTokenTransfer failed:', error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

async function rejectSenderPreEscrow(
    walletPath,
    userId,
    transferRequestID,
    senderTokenOwnerAddress,
    rejectionReason
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction(
            'RejectSenderPreEscrow',
            transferRequestID,
            senderTokenOwnerAddress,
            rejectionReason || 'SENDER_KYC_INVALID'
        );
    } finally {
        await gateway.disconnect();
    }
}

// 3. Approve/Reject by Receiver Token Owner
async function approveReceiverTokenTransfer(
    walletPath,
    userId,
    transferRequestID,
    receiverTokenOwnerAddress,
    approved,
    exchangeRate,
    convertedAmount
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Receiver token approval:`, {
            transferRequestID,
            receiverTokenOwnerAddress,
            approved,
            exchangeRate,
            convertedAmount
        });

        // If exchange rate and converted amount provided, first update the transfer with these values
        if (exchangeRate && convertedAmount) {
            try {
                // Get the transfer to update it with FX details
                const transferData = await contract.evaluateTransaction(
                    'GetCustomerToTokenTransferRequestByID',
                    transferRequestID
                );
                const transfer = JSON.parse(transferData.toString());
                
                // Update transfer with exchange rate and converted amount before approval
                // This ensures the chaincode has the correct values for calculation
                transfer.exchange_rate = exchangeRate;
                transfer.converted_amount = convertedAmount;
                
                console.log(`[CHAINCODE] Updated transfer with FX rate: ${exchangeRate}, Converted: ${convertedAmount}`);
            } catch (updateError) {
                console.warn('[CHAINCODE] Could not pre-update FX details:', updateError.message);
                // Continue anyway - will use in approval if available
            }
        }

        await contract.submitTransaction(
            'ApproveReceiverTokenTransfer',
            transferRequestID,
            receiverTokenOwnerAddress,
            approved.toString(),
            exchangeRate ? exchangeRate.toString() : '',
            convertedAmount ? convertedAmount.toString() : ''
        );
        console.log(`[CHAINCODE] Receiver approval processed for transfer: ${transferRequestID}`);
    } catch (error) {
        console.error('[CHAINCODE] ApproveReceiverTokenTransfer failed:', error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

async function rejectReceiver(
    walletPath,
    userId,
    transferRequestID,
    receiverTokenOwnerAddress,
    rejectionReason
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        await contract.submitTransaction(
            'RejectReceiver',
            transferRequestID,
            receiverTokenOwnerAddress,
            rejectionReason || 'BANK_POLICY_VIOLATION'
        );
    } finally {
        await gateway.disconnect();
    }
}

// 4. View Pending Customer-to-Token Transfers
// View pending transfers from sender's perspective
async function viewPendingCustomerToTokenTransfersAsSender(
    walletPath,
    userId,
    tokenID,
    ownerNetworkAddress
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Querying pending C-to-T transfers (SENDER view) for token: ${tokenID}`);
        const result = await contract.evaluateTransaction(
            'ViewPendingCustomerToTokenTransfersAsSender',
            tokenID,
            ownerNetworkAddress
        );
        const resultStr = result.toString().trim();
        if (!resultStr) {
            return [];
        }
        const transfers = JSON.parse(resultStr);
        console.log(`[CHAINCODE] Found ${Array.isArray(transfers) ? transfers.length : 0} pending transfers as SENDER`);
        return Array.isArray(transfers) ? transfers : [];
    } catch (error) {
        console.error('[CHAINCODE] ViewPendingCustomerToTokenTransfersAsSender failed:', error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

// View pending transfers from receiver's perspective
async function viewPendingCustomerToTokenTransfersAsReceiver(
    walletPath,
    userId,
    tokenID,
    ownerNetworkAddress
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Querying pending C-to-T transfers (RECEIVER view) for token: ${tokenID}`);
        const result = await contract.evaluateTransaction(
            'ViewPendingCustomerToTokenTransfersAsReceiver',
            tokenID,
            ownerNetworkAddress
        );
        const resultStr = result.toString().trim();
        if (!resultStr) {
            return [];
        }
        const transfers = JSON.parse(resultStr);
        console.log(`[CHAINCODE] Found ${Array.isArray(transfers) ? transfers.length : 0} pending transfers as RECEIVER`);
        return Array.isArray(transfers) ? transfers : [];
    } catch (error) {
        console.error('[CHAINCODE] ViewPendingCustomerToTokenTransfersAsReceiver failed:', error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

// 5. Get Customer-to-Token Transfer History
async function getCustomerToTokenTransferHistory(
    walletPath,
    userId,
    tokenID
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Querying C-to-T transfer history for token: ${tokenID}`);
        const result = await contract.evaluateTransaction(
            'GetCustomerToTokenTransferHistory',
            tokenID
        );
        const resultStr = result.toString().trim();
        if (!resultStr) {
            return [];
        }
        const history = JSON.parse(resultStr);
        console.log(`[CHAINCODE] Found ${Array.isArray(history) ? history.length : 0} completed transfers`);
        return Array.isArray(history) ? history : [];
    } catch (error) {
        console.error('[CHAINCODE] GetCustomerToTokenTransferHistory failed:', error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

// Get Customer-to-Token Transfer History by Customer
async function getCustomerToTokenTransferHistoryByCustomer(
    walletPath,
    userId,
    customerNetworkAddress
) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Querying C-to-T transfer history for customer: ${customerNetworkAddress}`);
        console.log(`[CHAINCODE] Using wallet path: ${walletPath}, userId: ${userId}`);
        const result = await contract.evaluateTransaction(
            'GetCustomerToTokenTransferHistoryByCustomer',
            customerNetworkAddress
        );
        const resultStr = result.toString().trim();
        console.log(`[CHAINCODE] Raw result from chaincode: "${resultStr}"`);
        
        if (!resultStr || resultStr === '[]' || resultStr === '') {
            console.log('[CHAINCODE] No transfer history found for customer');
            return [];
        }
        
        let history;
        try {
            history = JSON.parse(resultStr);
        } catch (parseError) {
            console.error('[CHAINCODE] Failed to parse chaincode result:', parseError.message);
            console.error('[CHAINCODE] Result was:', resultStr);
            return [];
        }
        
        console.log(`[CHAINCODE] Found ${Array.isArray(history) ? history.length : 0} completed transfers for customer`);
        if (Array.isArray(history) && history.length > 0) {
            console.log('[CHAINCODE] Transfer details:', JSON.stringify(history[0], null, 2));
        }
        
        return Array.isArray(history) ? history : [];
    } catch (error) {
        console.error('[CHAINCODE] GetCustomerToTokenTransferHistoryByCustomer failed:', error.message);
        console.error('[CHAINCODE] Full error:', error);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

async function getRejectedByReason(walletPath, userId, reason) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetRejectedByReason', reason);
        const payload = result.toString().trim();
        return payload ? JSON.parse(payload) : [];
    } finally {
        await gateway.disconnect();
    }
}

async function getRejectedByBank(walletPath, userId, receiverBIC) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetRejectedByBank', receiverBIC);
        const payload = result.toString().trim();
        return payload ? JSON.parse(payload) : [];
    } finally {
        await gateway.disconnect();
    }
}

async function getExpiredEscrowReturns(walletPath, userId) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        const result = await contract.evaluateTransaction('GetExpiredEscrowReturns');
        const payload = result.toString().trim();
        return payload ? JSON.parse(payload) : [];
    } finally {
        await gateway.disconnect();
    }
}

// 5. Update Exchange Rate (Admin function)
async function updateExchangeRate(walletPath, userId, currency, rate) {
    try {
        console.log(`[REST API] Updating exchange rate for ${currency} to ${rate}`);
        const result = await invoke.updateExchangeRate(walletPath, userId, currency, rate);
        console.log(`[REST API] Exchange rate updated successfully for ${currency}`);
        return { success: true, message: `Exchange rate for ${currency} updated to ${rate}`, result };
    } catch (error) {
        console.error('[REST API] Update exchange rate failed:', error.message);
        throw error;
    }
}

// ==================== Commission Configuration Functions ====================

// Set commission rate for a token (on blockchain)
async function setTokenCommission(walletPath, userId, tokenID, commissionPercentage) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Setting commission for token ${tokenID} to ${commissionPercentage}%`);
        const result = await contract.submitTransaction(
            'SetTokenCommission',
            tokenID,
            commissionPercentage.toString()
        );
        const configStr = result.toString().trim();
        console.log(`[CHAINCODE] Commission set successfully: ${configStr}`);
        return JSON.parse(configStr);
    } catch (error) {
        console.error(`[CHAINCODE] SetTokenCommission failed:`, error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}

// Get commission rate for a token (from blockchain)
async function getTokenCommission(walletPath, userId, tokenID) {
    const { gateway, contract } = await connect(walletPath, userId);
    try {
        console.log(`[CHAINCODE] Getting commission for token ${tokenID}`);
        const result = await contract.evaluateTransaction(
            'GetTokenCommission',
            tokenID
        );
        const configStr = result.toString().trim();
        console.log(`[CHAINCODE] Commission retrieved: ${configStr}`);
        if (!configStr) {
            return { token_id: tokenID, commission_percentage: 0 };
        }
        return JSON.parse(configStr);
    } catch (error) {
        console.error(`[CHAINCODE] GetTokenCommission failed:`, error.message);
        throw error;
    } finally {
        await gateway.disconnect();
    }
}
