const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const FabricCAServices = require('fabric-ca-client');
const { Wallets, Gateway } = require('fabric-network');
const path = require('path');
const fs = require('fs');
const { newEncryptedFileSystemWallet } = require('./wallet-wrapper');
const { encryptWalletFile, getMasterPassword } = require('./wallet-encryption');

// Import all fabric functions
const {
    connect,
    submitRegistration,
    participantExists,
    requestTokenRequest,
    getPendingTokenRequests,
    approveTokenRequest,
    getTokenAccess,
    requestMintCoins,
    getPendingMintRequests,
    getApprovedMintRequests,
    getApprovedMintRequestsForCustomer,
    getMyApprovedMintRequests,
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
    customerRequestMint,
    viewPendingCustomerMintRequests,
    approveCustomerMint,
    viewCustomerWallet,
    getCustomerIDAccess,

    createTransferRequest,
    createTokenTransferRequest,
    createCustomerToTokenTransferRequest,
    viewPendingTokenTransferRequests,
    viewPendingCustomerToTokenTransfersAsSender,
    viewPendingCustomerToTokenTransfersAsReceiver,
    getCustomerToTokenTransferHistory,
    getCustomerToTokenTransferHistoryByCustomer,
    approveSenderTokenTransfer,
    approveReceiverTokenTransfer,
    approveTokenTransferRequest,
    approveTokenTransferRequestWithFX,
    listTokenToTokenTransferHistory,
    listParticipantTransferHistory,
    listAllParticipantTransferHistory,
    listParticipantTransfersByID,
    listApprovedParticipantMintRequests,
    

    updateExchangeRate,
    setTokenCommission,
    getTokenCommission,
    upsertCustomerFromBank,
    requestTokenHandshake,
    viewPendingTokenHandshakes,
    tokenHandshakeApprove,
    checkHandshake,
    viewTokenHandshakes,
    startEventListener,
    registerAccount,
    getAccountBalance
} = require('./app.js');

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fabric-jwt-secret';

const JWT_EXPIRES_IN = '24h';
const WALLET_PATH = path.join(process.cwd(), 'wallet');
let eventListenerGateway = null;

// All data comes from real Hyperledger Fabric blockchain - no more mock data

// All storage is now on real Hyperledger Fabric blockchain

// Middleware
app.use(cors());
app.use(express.json());

// Prevent kycId from being used to create directories
app.use((req, res, next) => {
    // Remove kycId from req.body to prevent directory creation
    if (req.body && req.body.kycId) {
        // kycId is stored but not used for file system operations
        // Ensure it's never passed to any file system function
        delete req.body.kycIdPath;
    }
    next();
});

// Global auth gate: protect all /api routes except explicit public endpoints
app.use('/api', (req, res, next) => {
    const pathOnly = req.path || '';
    const fullPath = req.originalUrl || pathOnly;
    const publicPrefixes = ['/auth/', '/api/auth/', '/health', '/api/health'];
    const publicExact = new Set([
        '/auth/login',
        '/auth/register',
        '/auth/enroll',
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/enroll',
        '/health',
        '/api/health'
    ]);
    const isPublic =
        publicPrefixes.some(prefix => pathOnly.startsWith(prefix) || fullPath.startsWith(prefix)) ||
        publicExact.has(pathOnly) ||
        publicExact.has(fullPath);
    if (isPublic) {
        return next();
    }
    return authenticateJWT(req, res, next);
});

// Identity middleware: normalize requested identity from body/headers/JWT
app.use('/api', async (req, res, next) => {
    try {
        const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
        // Prefer authenticated identity; reject mismatched userId to prevent spoofing
        const jwtUser = req.user && (req.user.username || req.user.sub);
        const bodyUser = req.body && (req.body.userId || req.body.user || req.body.username);
        const queryUser = req.query.userId;
        const headerUser = req.headers['x-user-id'];

        if (jwtUser) {
            const provided = bodyUser || queryUser || headerUser;
            if (provided && String(provided).trim() !== String(jwtUser).trim()) {
                return res.status(403).json({
                    success: false,
                    detail: 'Forbidden: userId mismatch with authenticated token'
                });
            }
        }

        const candidate = jwtUser || bodyUser || queryUser || headerUser;
        if (candidate) {
            const id = String(candidate).trim();
            req.requestedIdentity = id;
            const identity = await wallet.get(id);
            if (!identity) {
                console.warn(`Requested wallet identity '${id}' not found in wallet`);
            }
        }
    } catch (err) {
        console.error('Identity middleware error:', err && err.message ? err.message : err);
    }
    return next();
});

// After JWT validation, force caller identity into body/query to prevent spoofing
app.use('/api', (req, res, next) => {
    const caller = req.user && (req.user.username || req.user.sub);
    if (caller) {
        if (req.body && typeof req.body === 'object') {
            req.body.userId = caller;
            req.body.username = caller;
            // Remove spoofable identity fields from body for authenticated requests
            const scrubBodyFields = [
                'networkAddress',
                'ownerNetworkAddress',
                'ownerID',
                'senderOwnerAddress',
                'senderID',
                'approver'
            ];
            scrubBodyFields.forEach(f => {
                if (f in req.body) {
                    delete req.body[f];
                }
            });
        }
        if (req.query) {
            req.query.userId = caller;
            req.query.username = caller;
            // Remove spoofable identity fields from query for authenticated requests
            const scrubQueryFields = [
                'networkAddress',
                'ownerNetworkAddress',
                'ownerID',
                'senderOwnerAddress',
                'senderID',
                'approver'
            ];
            scrubQueryFields.forEach(f => {
                if (f in req.query) {
                    delete req.query[f];
                }
            });
        }
        req.requestedIdentity = caller;
    }
    return next();
});

// Inject caller's registered network address into payloads for downstream app.js functions
app.use('/api', (req, res, next) => {
    const caller = req.user && (req.user.username || req.user.sub);
    if (!caller) {
        return next();
    }
    const callerNetworkAddress = getNetworkAddressForUser(caller);
    if (!callerNetworkAddress) {
        return next();
    }
    req.callerNetworkAddress = callerNetworkAddress;

    const setDefaults = (container) => {
        if (!container || typeof container !== 'object') return;
        if (!container.networkAddress) container.networkAddress = callerNetworkAddress;
        if (!container.ownerNetworkAddress) container.ownerNetworkAddress = callerNetworkAddress;
        if (!container.ownerID) container.ownerID = callerNetworkAddress;
        if (!container.senderOwnerAddress) container.senderOwnerAddress = callerNetworkAddress;
        if (!container.approver) container.approver = callerNetworkAddress;
    };

    setDefaults(req.body);
    setDefaults(req.query);
    return next();
});

// Simple logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`, req.body);
    next();
});

const VALID_ROLES = new Set(['admin', 'bank', 'customer']);
const DEFAULT_ROLE = 'customer';
const REGISTRATION_CACHE = new Map();
const ACCOUNT_HASH_CACHE = new Map();

// Rate limiting for transfer initiation (5 requests per minute per user)
const transferInitiationCounts = new Map();
const TRANSFER_RATE_LIMIT = 5; // per minute
const TRANSFER_RATE_WINDOW = 60 * 1000; // 1 minute

// Deduplication cache for concurrent transfer prevention (15 minute window)
const recentTransfers = new Map();
const DUPLICATE_CHECK_WINDOW = 15 * 60 * 1000; // 15 minutes

// Periodic cleanup of expired rate limit and deduplication records
setInterval(() => {
    const now = Date.now();
    // Clean rate limiter
    for (const [key, data] of transferInitiationCounts) {
        if (now - data.firstRequest > TRANSFER_RATE_WINDOW) {
            transferInitiationCounts.delete(key);
        }
    }
    // Clean deduplication cache
    for (const [key, timestamp] of recentTransfers) {
        if (now - timestamp > DUPLICATE_CHECK_WINDOW) {
            recentTransfers.delete(key);
        }
    }
}, 60 * 1000); // Clean every 60 seconds

// Clean up any kyc_ directories that might have been created
// kycId should be stored only in blockchain, not as filesystem directories
function cleanupKYCDirectories() {
    try {
        const dir = process.cwd();
        const entries = fs.readdirSync(dir);
        const kycDirs = entries.filter(f => f.startsWith('kyc_') && fs.statSync(path.join(dir, f)).isDirectory());
        kycDirs.forEach(kycDir => {
            try {
                const kycPath = path.join(dir, kycDir);
                const isEmpty = fs.readdirSync(kycPath).length === 0;
                if (isEmpty) {
                    fs.rmdirSync(kycPath);
                    console.log(`Cleaned up empty kyc directory: ${kycDir}`);
                }
            } catch (e) {
                // Skip directories that can't be removed
            }
        });
    } catch (e) {
        // Skip if cleanup fails
    }
}

// Run cleanup on startup
cleanupKYCDirectories();

const BANK_TOKEN_CONFIG_PATH = path.join(__dirname, 'bank-token-configs.json');
let BANK_TOKEN_CONFIG_CACHE = null;

if (!fs.existsSync(BANK_TOKEN_CONFIG_PATH)) {
    fs.writeFileSync(BANK_TOKEN_CONFIG_PATH, JSON.stringify({}, null, 2));
}

function ensureBankTokenConfigCache() {
    // Always reload from disk so updates to bank-token-configs.json take effect without restart
    try {
        if (fs.existsSync(BANK_TOKEN_CONFIG_PATH)) {
            BANK_TOKEN_CONFIG_CACHE = JSON.parse(fs.readFileSync(BANK_TOKEN_CONFIG_PATH, 'utf8'));
            return BANK_TOKEN_CONFIG_CACHE;
        }
        BANK_TOKEN_CONFIG_CACHE = {};
        return BANK_TOKEN_CONFIG_CACHE;
    } catch (error) {
        console.warn('Failed to load bank token config cache:', error.message);
        BANK_TOKEN_CONFIG_CACHE = {};
        return BANK_TOKEN_CONFIG_CACHE;
    }
}

function persistBankTokenConfigCache() {
    if (!BANK_TOKEN_CONFIG_CACHE) {
        BANK_TOKEN_CONFIG_CACHE = {};
    }
    const dir = path.dirname(BANK_TOKEN_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(BANK_TOKEN_CONFIG_PATH, JSON.stringify(BANK_TOKEN_CONFIG_CACHE, null, 2));
}

function normalizeBankAPIBaseUrl(rawUrl) {
    if (!rawUrl || !rawUrl.trim()) {
        throw new Error('bank_api_base_url is required');
    }
    let parsed;
    try {
        parsed = new URL(rawUrl.trim());
    } catch (error) {
        throw new Error('bank_api_base_url must be a valid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('bank_api_base_url must use http or https');
    }
    parsed.hash = '';
    const normalized = parsed.toString().replace(/\/+$/, '');
    return normalized || rawUrl.trim();
}

function upsertBankTokenConfig(tokenID, updates) {
    if (!tokenID || !tokenID.trim()) {
        throw new Error('token_id is required');
    }
    const cache = ensureBankTokenConfigCache();
    const normalizedToken = tokenID.trim();
    const existing = cache[normalizedToken] || { token_id: normalizedToken };
    cache[normalizedToken] = {
        ...existing,
        ...updates,
        token_id: normalizedToken,
        updated_at: new Date().toISOString()
    };
    persistBankTokenConfigCache();
    return cache[normalizedToken];
}

function getBankTokenConfig(tokenID) {
    if (!tokenID) {
        return null;
    }
    const cache = ensureBankTokenConfigCache();
    return cache[tokenID] || null;
}

function sanitizeBankTokenConfig(config) {
    if (!config) {
        return null;
    }
    return {
        token_id: config.token_id,
        bank_api_base_url: config.bank_api_base_url,
        updated_at: config.updated_at,
        has_auth_key: Boolean(config.bank_auth_key)
    };
}

function listSanitizedBankTokenConfigs() {
    const cache = ensureBankTokenConfigCache();
    if (!cache) {
        return [];
    }
    return Object.values(cache)
        .map(sanitizeBankTokenConfig)
        .filter(Boolean);
}

function interpretKYCStatus(status) {
    if (typeof status === 'boolean') {
        return status;
    }
    if (status === undefined || status === null) {
        return false;
    }
    const normalized = String(status).trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return ['true', '1', 'approved', 'approve', 'success', 'passed', 'pass', 'verified', 'complete', 'completed'].includes(normalized);
}

function buildBankLoginURL(config, tokenID, networkAddress) {
    if (!config || !config.bank_api_base_url) {
        throw new Error('Bank API base URL missing for token');
    }
    if (!tokenID || !networkAddress) {
        throw new Error('tokenId and networkAddress are required to initiate bank login');
    }
    let loginURL;
    try {
        loginURL = new URL('/between/login', config.bank_api_base_url);
    } catch (error) {
        throw new Error(`Invalid bank API base URL: ${error.message}`);
    }
    loginURL.searchParams.set('tokenId', tokenID);
    loginURL.searchParams.set('networkAddress', networkAddress);
    loginURL.searchParams.set('ts', Date.now().toString());
    return loginURL.toString();
}

// FX Configuration
// Token-to-currency mappings are dynamically assigned by token owners at token creation time

// Fallback FX rates (for offline use)
const FX_RATES_FALLBACK = {
    'USD_INR': 83.50,
    'INR_USD': 0.01198,
    'USD_EUR': 0.92,
    'EUR_USD': 1.087,
    'USD_GBP': 0.79,
    'GBP_USD': 1.266,
    'EUR_INR': 91.44,
    'INR_EUR': 0.01094,
    'GBP_INR': 105.04,
    'INR_GBP': 0.00952
};

// Server-side FX fee (percentage of source amount); set to zero to keep transfers fee-free by default
const FX_FEE_PERCENTAGE = 0.0;

// Cache for FX rates to reduce API calls
const FX_RATES_CACHE = {};
const RATE_CACHE_DURATION = 3600000; // 1 hour in milliseconds

// Fetch FX rate from external API (exchange-rates-api.com)
async function getFXRate(sourceCurrency, targetCurrency) {
    const rateKey = `${sourceCurrency}_${targetCurrency}`;
    const now = Date.now();

    // Check cache first
    if (FX_RATES_CACHE[rateKey] && (now - FX_RATES_CACHE[rateKey].timestamp) < RATE_CACHE_DURATION) {
        console.log(`Using cached FX rate: ${rateKey} = ${FX_RATES_CACHE[rateKey].rate}`);
        return FX_RATES_CACHE[rateKey].rate;
    }

    try {
        // Use exchangerate-api.com (free tier with no key required for basic usage)
        // For production, consider using fixer.io or your preferred API
        const apiUrl = `https://api.exchangerate-api.com/v4/latest/${sourceCurrency}`;
        console.log(`Fetching live FX rate from API: ${apiUrl}`);

        const response = await fetch(apiUrl, {
            timeout: 5000,
            headers: {
                'User-Agent': 'FabricBankingApp/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();

        if (data.rates && data.rates[targetCurrency]) {
            const rate = data.rates[targetCurrency];

            // Cache the rate
            FX_RATES_CACHE[rateKey] = {
                rate: rate,
                timestamp: now
            };

            console.log(`Live FX rate fetched: ${sourceCurrency}/${targetCurrency} = ${rate}`);
            return rate;
        } else {
            throw new Error(`Target currency ${targetCurrency} not found in API response`);
        }
    } catch (error) {
        console.error(`Error fetching live FX rate for ${rateKey}:`, error.message);

        // Fallback to cached fallback rates
        if (FX_RATES_FALLBACK[rateKey]) {
            console.warn(`Using fallback FX rate: ${rateKey} = ${FX_RATES_FALLBACK[rateKey]}`);
            return FX_RATES_FALLBACK[rateKey];
        }

        console.warn(`No rate available for ${rateKey}, using 1.0 as last resort`);
        return 1.0;
    }
}

function formatDistinguishedName(dn) {
    return (dn || '')
        .split(/\r?\n/)
        .map(part => part.trim())
        .map(part => part.replace(/\s*\+\s*/g, '+'))
        .filter(Boolean)
        .reverse()
        .join(',');
}

function buildChaincodeIdentityFromCert(certificatePem) {
    if (!certificatePem) {
        return null;
    }
    try {
        const cert = new crypto.X509Certificate(certificatePem);
        const subjectDN = formatDistinguishedName(cert.subject);
        const issuerDN = formatDistinguishedName(cert.issuer);
        const rawIdentity = `x509::${subjectDN}::${issuerDN}`;
        const chaincodeID = Buffer.from(rawIdentity, 'utf8').toString('base64');
        return {
            chaincodeID,
            subjectDN,
            issuerDN
        };
    } catch (err) {
        console.warn('Failed to derive chaincode identity from certificate:', err.message);
        return null;
    }
}

function normalizeStoredRole(role, fallbackRole = DEFAULT_ROLE) {
    if (role && VALID_ROLES.has(role)) {
        return role;
    }
    if (fallbackRole && VALID_ROLES.has(fallbackRole)) {
        return fallbackRole;
    }
    return DEFAULT_ROLE;
}

function getRegistrationFilePath(username) {
    return path.join(__dirname, 'registrations', `${username}.json`);
}

function getTokenDataDir(tokenId) {
    if (!tokenId) return null;
    return path.join(__dirname, 'token-data', tokenId);
}

function readTokenMeta(tokenId) {
    const dir = getTokenDataDir(tokenId);
    if (!dir) return null;
    const metaPath = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (err) {
        return null;
    }
}

function listTokenRegistrations(tokenId) {
    const dir = getTokenDataDir(tokenId);
    if (!dir) return [];
    const regsDir = path.join(dir, 'registrations');
    if (!fs.existsSync(regsDir)) return [];
    const out = [];
    for (const f of fs.readdirSync(regsDir)) {
        if (!f.endsWith('.json')) continue;
        try {
            const j = JSON.parse(fs.readFileSync(path.join(regsDir, f), 'utf8'));
            out.push(j);
        } catch (e) {
            // skip
        }
    }
    return out;
}

function authenticateJWT(req, res, next) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) {
            return res.status(401).json({
                success: false,
                detail: 'Authorization token missing'
            });
        }
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
    } catch (error) {
        console.error('JWT authentication error:', error.message);
        return res.status(401).json({
            success: false,
            detail: 'Invalid or expired token'
        });
    }
}

function authenticateJWTOptional(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        req.user = null;
        return next();
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        return next();
    } catch (error) {
        console.error('JWT authentication error:', error.message);
        return res.status(401).json({
            success: false,
            detail: 'Invalid or expired token'
        });
    }
}

function loadRegistrationSnapshot(username) {
    try {
        const registrationPath = getRegistrationFilePath(username);
        if (fs.existsSync(registrationPath)) {
            return JSON.parse(fs.readFileSync(registrationPath, 'utf8'));
        }
    } catch (error) {
        console.warn(`Failed to load registration data for ${username}: ${error.message}`);
    }
    return null;
}

function getNetworkAddressForUser(username) {
    if (!username) {
        return null;
    }
    const snapshot = loadRegistrationSnapshot(username);
    return snapshot && snapshot.networkAddress ? snapshot.networkAddress : null;
}

function persistRegistrationSnapshot(username, snapshot) {
    const registrationPath = getRegistrationFilePath(username);
    const registrationDir = path.dirname(registrationPath);
    if (!fs.existsSync(registrationDir)) {
        fs.mkdirSync(registrationDir, { recursive: true });
    }
    fs.writeFileSync(registrationPath, JSON.stringify(snapshot, null, 2));
    if (snapshot && snapshot.networkAddress) {
        REGISTRATION_CACHE.set(snapshot.networkAddress, username);
    }
    if (username) {
        const hash = crypto.createHash('sha256').update(username).digest('hex');
        ACCOUNT_HASH_CACHE.set(hash, username);
    }
}

function normalizeParticipantIdentifier(identifier) {
    if (!identifier) {
        return identifier;
    }
    const prefix = 'participanttransfer_';
    if (identifier.startsWith(prefix)) {
        const candidate = identifier.substring(prefix.length);
        return candidate || identifier;
    }
    return identifier;
}

function decodeBase64CustomerID(base64ID) {
    if (!base64ID) {
        return base64ID;
    }
    try {
        // Check if it looks like base64 (contains only valid base64 characters)
        // Base64 valid chars: A-Z, a-z, 0-9, +, /, and = for padding
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64ID)) {
            // Not base64, return as-is
            return base64ID;
        }
        
        // Try to decode
        const decoded = Buffer.from(base64ID, 'base64').toString('utf8');
        
        // Verify it's valid UTF-8 and looks like a certificate DN
        if (decoded && (decoded.includes('CN=') || decoded.includes('OU=') || decoded.includes('::'))) {
            console.log(`[DECODE] Successfully decoded base64 customer ID`);
            return decoded;
        }
        
        // If decode didn't produce a certificate DN, return original
        return base64ID;
    } catch (error) {
        console.warn(`[DECODE] Failed to decode base64 customer ID: ${error.message}`);
        return base64ID;
    }
}

function deriveParticipantTransferID(networkAddress) {
    if (!networkAddress) return '';
    const prefix = 'participanttransfer_';
    if (networkAddress.startsWith(prefix)) {
        return networkAddress;
    }
    return prefix + networkAddress;
}

function requireNetworkAddress(identifier, fieldName) {
    if (!identifier) {
        throw new Error(`${fieldName || 'participant'} network address is required`);
    }
    const prefix = 'participanttransfer_';
    if (identifier.startsWith(prefix)) {
        throw new Error(`${fieldName || 'participant'} must be provided as a network address, not a participant transfer ID`);
    }
    return identifier;
}

function normalizeTokenIdentifier(identifier) {
    if (!identifier) {
        return identifier;
    }
    const prefix = 'banktransfer_';
    if (identifier.startsWith(prefix)) {
        return identifier.substring(prefix.length);
    }
    return identifier;
}

// Retry utility for handling MVCC_READ_CONFLICT and transient errors
async function submitWithRetry(asyncFn, maxRetries = 3, context = '') {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await asyncFn();
        } catch (error) {
            const isTransient = 
                error.transactionCode === 'MVCC_READ_CONFLICT' ||
                error.message?.includes('MVCC_READ_CONFLICT') ||
                error.message?.includes('read/write set conflict') ||
                error.message?.includes('ENDORSEMENT_POLICY_FAILURE') ||
                error.code === 'ECONNREFUSED';
            
            const isLastAttempt = attempt === maxRetries - 1;
            
            if (isTransient && !isLastAttempt) {
                const backoffDelay = 100 * Math.pow(2, attempt); // exponential backoff: 100ms, 200ms, 400ms
                console.log(`[RETRY] ${context} - Attempt ${attempt + 1}/${maxRetries} failed (${error.transactionCode || error.code}). Retrying in ${backoffDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                continue;
            }
            
            throw error;
        }
    }
}

// Helper function to get currency symbol
function currencySymbol(code) {
    const symbols = {
        'USD': '$',
        'EUR': '€',
        'GBP': '£',
        'JPY': '¥',
        'INR': '₹',
        'NGN': '₦',
        'KES': 'Ksh ',
        'CNY': '¥',
        'AUD': 'A$',
        'CAD': 'C$'
    };
    if (!code) return '';
    return symbols[code.toUpperCase()] || (code ? `${code} ` : '');
}

// Helper function to format currency values
function formatCurrencyValue(code, amount) {
    const symbol = currencySymbol(code);
    if (typeof amount !== 'number') {
        amount = parseFloat(amount) || 0;
    }
    return `${symbol}${amount.toFixed(2)}`;
}

function resolveUsernameFromHash(accountHash) {
    if (!accountHash || !/^[0-9a-f]{64}$/i.test(accountHash)) {
        return null;
    }
    if (ACCOUNT_HASH_CACHE.has(accountHash)) {
        return ACCOUNT_HASH_CACHE.get(accountHash);
    }
    const registrationsDir = path.join(__dirname, 'registrations');
    if (!fs.existsSync(registrationsDir)) {
        ACCOUNT_HASH_CACHE.set(accountHash, null);
        return null;
    }
    try {
        for (const entry of fs.readdirSync(registrationsDir)) {
            if (!entry.endsWith('.json')) {
                continue;
            }
            const username = entry.slice(0, -5);
            const hash = crypto.createHash('sha256').update(username).digest('hex');
            ACCOUNT_HASH_CACHE.set(hash, username);
            if (hash === accountHash) {
                return username;
            }
        }
    } catch (err) {
        console.warn(`Unable to resolve username from hash ${accountHash}: ${err.message}`);
    }
    ACCOUNT_HASH_CACHE.set(accountHash, null);
    return null;
}

function resolveParticipantNetworkAddress(identifier) {
    if (!identifier) {
        return null;
    }
    if (identifier.includes('::') || identifier.startsWith('eDUw')) {
        return identifier;
    }
    const direct = getNetworkAddressForUser(identifier);
    if (direct) {
        return direct;
    }
    const usernameFromHash = resolveUsernameFromHash(identifier);
    if (usernameFromHash) {
        return getNetworkAddressForUser(usernameFromHash) || identifier;
    }
    return identifier;
}

function isBcryptHash(value) {
    return typeof value === 'string' && value.startsWith('$2');
}

function resolveIdentityFromNetworkAddress(networkAddress) {
    if (!networkAddress) {
        return null;
    }
    if (REGISTRATION_CACHE.has(networkAddress)) {
        return REGISTRATION_CACHE.get(networkAddress);
    }
    const registrationsDir = path.join(__dirname, 'registrations');
    try {
        if (!fs.existsSync(registrationsDir)) {
            REGISTRATION_CACHE.set(networkAddress, null);
            return null;
        }
        const entries = fs.readdirSync(registrationsDir);
        for (const entry of entries) {
            if (!entry.endsWith('.json')) {
                continue;
            }
            const username = entry.slice(0, -5);
            const snapshot = loadRegistrationSnapshot(username);
            if (snapshot && snapshot.networkAddress === networkAddress) {
                REGISTRATION_CACHE.set(networkAddress, username);
                return username;
            }
        }
    } catch (error) {
        console.warn(`Failed to resolve identity for ${networkAddress}: ${error.message}`);
    }
    REGISTRATION_CACHE.set(networkAddress, null);
    return null;
}

function requireNetworkAddressForUser(userId, providedNetworkAddress) {
    if (!userId) {
        throw new Error('userId is required');
    }
    const storedAddress = getNetworkAddressForUser(userId);
    if (!storedAddress) {
        throw new Error(`No stored network address for user '${userId}'. Complete registration first.`);
    }
    const normalizedProvided = decodeURIComponent(providedNetworkAddress || '').replace(/ /g, '+');
    if (normalizedProvided && normalizedProvided !== storedAddress) {
        throw new Error('Provided networkAddress does not match registered address for this user');
    }
    return storedAddress;
}

async function resolveCustomerTokenID(resolvedNetworkAddress, walletPath, callerUserId) {
    const matchByAddress = list => (Array.isArray(list)
        ? list.find(c =>
            c.network_address === resolvedNetworkAddress ||
            c.NetworkAddress === resolvedNetworkAddress ||
            c.networkAddress === resolvedNetworkAddress)
        : null);

    // OPTIMIZATION: Attempt 1 - Try participant wallet info (single connection as caller)
    try {
        const walletInfo = await getWalletInfo(resolvedNetworkAddress, walletPath, callerUserId);
        const participantToken =
            walletInfo?.tokenID || walletInfo?.tokenId || walletInfo?.token_id || walletInfo?.token;
        if (participantToken) {
            console.log('resolveCustomerTokenID: derived from getWalletInfo');
            return participantToken;
        }
    } catch (infoErr) {
        console.log('resolveCustomerTokenID: token not found in getWalletInfo (this is normal for first wallet open):', infoErr?.message);
    }

    // OPTIMIZATION: Attempt 2 - Try approved customers as admin ONLY (limit to 1 admin connection)
    try {
        const list = await listAllApprovedCustomers(walletPath, 'admin');
        const match = matchByAddress(list);
        const customerToken =
            match?.token_id || match?.tokenID || match?.tokenId || match?.token || match?.TokenID;
        if (customerToken) {
            console.log('resolveCustomerTokenID: derived from approved customers (admin)', customerToken);
            return customerToken;
        }
    } catch (approvedErr) {
        console.log('resolveCustomerTokenID: approved customers (admin) lookup failed:', approvedErr?.message);
    }

    // FALLBACK: Scan all tokens and check per-token approved customers as last resort
    // This is needed because some customers might be approved but not in the global approved list
    try {
        console.log('resolveCustomerTokenID: attempting token scan fallback...');
        const tokens = await viewAllTokens(walletPath, 'admin');
        if (Array.isArray(tokens)) {
            for (const token of tokens) {
                const tokenId = token?.token_id || token?.tokenID || token?.tokenId || token?.TokenID;
                const owner = token?.owner || token?.Owner;
                if (!tokenId || !owner) continue;
                try {
                    const ownerUserId = resolveIdentityFromNetworkAddress(owner);
                    if (!ownerUserId) {
                        console.log(`resolveCustomerTokenID: unable to resolve owner identity for token ${tokenId}`);
                        continue;
                    }
                    const customers = await listApprovedCustomers(tokenId, owner, walletPath, ownerUserId);
                    const match = matchByAddress(customers);
                    if (match) {
                        console.log('resolveCustomerTokenID: derived from token owner lookup', tokenId);
                        return tokenId;
                    }
                } catch (perTokenErr) {
                    console.log(`resolveCustomerTokenID: listApprovedCustomers failed for ${tokenId}:`, perTokenErr?.message);
                }
            }
        }
    } catch (tokenScanErr) {
        console.log('resolveCustomerTokenID: viewAllTokens fallback failed:', tokenScanErr?.message);
    }

    console.log('resolveCustomerTokenID: unable to derive token (customer may not be approved yet)');
    return null;
}

function getCallerFromJWT(req) {
    const caller = req.user && (req.user.username || req.user.sub);
    if (!caller) {
        throw new Error('Authentication required: missing JWT user');
    }
    return caller;
}

function getBankCallerContext(req) {
    const userId = req.query.userId || req.body.userId || req.requestedIdentity || (req.user && (req.user.username || req.user.sub)) || null;
    const providedAddress =
        req.query.ownerNetworkAddress ||
        req.query.owner_network_address ||
        req.body.ownerNetworkAddress ||
        req.body.owner_network_address ||
        req.query.networkAddress ||
        req.body.networkAddress ||
        '';
    const ownerNetworkAddress = requireNetworkAddressForUser(userId, providedAddress);
    return { userId, ownerNetworkAddress };
}

async function ensureTokenPoolInitialized(walletPath) {
    try {
        const tokens = await viewAllTokens(walletPath, 'admin');
        if (Array.isArray(tokens) && tokens.length > 0) {
            return false;
        }
    } catch (error) {
        console.log('Unable to read tokens before initialization:', error.message);
    }

    console.log('Initializing token pool via InitLedger...');
    const ccpPath = path.resolve(
        __dirname,
        '..',
        '..',
        'test-network',
        'organizations',
        'peerOrganizations',
        'org1.example.com',
        'connection-org1.json'
    );
    const wallet = await Wallets.newFileSystemWallet(walletPath);
    const adminId = 'admin';
    const identity = await wallet.get(adminId);
    if (!identity) {
        throw new Error('Admin identity not found in wallet. Cannot initialize token ledger.');
    }

    const gateway = new Gateway();
    try {
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
        await gateway.connect(ccp, {
            wallet,
            identity: adminId,
            discovery: { enabled: true, asLocalhost: true }
        });
        const network = await gateway.getNetwork('mychannel');
        const contract = network.getContract('fabcar');
        await contract.submitTransaction('InitLedger');
        console.log('Token pool initialized via InitLedger transaction');
    } finally {
        gateway.disconnect();
    }

    return true;
}

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'FabCar Backend API Server',
        status: 'running',
        timestamp: new Date(),
        endpoints: [
            // Health & Auth
            '/api/health',
            '/api/auth/register',
            '/api/auth/login',
            '/api/auth/enroll',
            '/api/auth/users',
            '/api/users',

            // Token Management
            '/api/token-request',
            '/api/token-requests/pending',
            '/api/token-requests/:requestId/approve',

            // Mint Management  
            '/api/mint-request',
            '/api/mint-requests/pending',
            '/api/admin/mint-requests/pending',
            '/api/mint-requests/:requestId/approve',

            // Customer Management
            '/api/customer/wallet',
            '/api/customer/transfer-history',
            '/api/customer-register',

            // FX Exchange
            '/api/fx-calculate',

            // Bank Management
            '/api/bank/wallet',
            '/api/bank/get-token-access',
            '/api/bank/request-mint',
            '/api/bank/mint-requests',
            '/api/bank/view-all-tokens',
            '/api/bank/register-customer',
            '/api/bank/pending-customer-registrations',
            '/api/bank/customer-registrations/pending',
            '/api/bank/customer-registrations/:requestId/approve',
            '/api/bank/customer-mint-requests/pending',
            '/api/bank/customer-mint-requests/:requestId/approve',

            // Transfer Management

            '/api/token-transfer-request',
            '/api/token-transfer-requests/pending',
            '/api/token-transfer-requests/:requestId/approve',
            '/api/token/transfer-history',
            '/api/token/participants-transactions',
            '/api/owner/transfer-history',

            // Admin Management
            '/api/admin/init-ledger',
            '/api/admin/tokens/all',
            '/api/admin/tokens/:tokenId/owners',
            '/api/admin/tokens/:tokenId/access',

            // Wallet Management
            '/api/register',
            '/api/wallet/register-user'
        ]
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'Fabric server running', timestamp: new Date() });
});

// Calculate FX conversion for display purposes
app.post('/api/fx-calculate', async (req, res) => {
    try {
        const { sourceTokenID, targetTokenID, amount, userId } = req.body;

        if (!sourceTokenID || !targetTokenID || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: sourceTokenID, targetTokenID, amount'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const resolvedUserId = userId || 'admin';

        // Fetch actual token currencies from blockchain
        const allTokens = await viewAllTokens(walletPath, resolvedUserId);

        let sourceCurrency = null;
        let targetCurrency = null;

        if (Array.isArray(allTokens)) {
            const sourceToken = allTokens.find(t => t.token_id === sourceTokenID);
            const targetToken = allTokens.find(t => t.token_id === targetTokenID);

            sourceCurrency = sourceToken?.currency;
            targetCurrency = targetToken?.currency;
        }

        if (!sourceCurrency || !targetCurrency) {
            return res.status(400).json({
                success: false,
                error: `Invalid or unassigned token IDs. Token ${sourceTokenID} currency: ${sourceCurrency || 'not assigned'}, Token ${targetTokenID} currency: ${targetCurrency || 'not assigned'}`
            });
        }

        // Get FX rate from live API
        const fxRate = await getFXRate(sourceCurrency, targetCurrency);
        const sourceAmount = parseFloat(amount);
        const feeAmount = 0; // No fees as per requirements
        const targetAmount = sourceAmount * fxRate - feeAmount;

        res.json({
            success: true,
            sourceTokenID,
            targetTokenID,
            sourceCurrency,
            targetCurrency,
            sourceAmount: sourceAmount,
            targetAmount: parseFloat(targetAmount.toFixed(2)),
            fxRate: fxRate,
            feeAmount: feeAmount,
            message: `${sourceAmount} ${sourceCurrency} = ${parseFloat(targetAmount.toFixed(2))} ${targetCurrency} (rate: ${fxRate}, fee: ${feeAmount}%)`
        });
    } catch (error) {
        console.error('FX calculation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get available users in wallet
app.get('/api/users', async (req, res) => {
    try {
        const { Wallets } = require('fabric-network');
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        // Wallet.list() returns either label strings (older SDKs) or objects (newer SDKs),
        // so normalize everything into a consistent structure.
        const identities = await wallet.list();
        const users = await Promise.all(identities.map(async (identityInfo) => {
            if (typeof identityInfo === 'string') {
                const storedIdentity = await wallet.get(identityInfo);
                return {
                    label: identityInfo,
                    mspId: storedIdentity?.mspId || storedIdentity?.mspid || null,
                    type: storedIdentity?.type || null
                };
            }

            const label = identityInfo.label || identityInfo.name || identityInfo.id || 'unknown';
            if (identityInfo.mspId) {
                return {
                    label,
                    mspId: identityInfo.mspId,
                    type: identityInfo.type || null
                };
            }

            const storedIdentity = await wallet.get(label);
            return {
                label,
                mspId: storedIdentity?.mspId || storedIdentity?.mspid || null,
                type: storedIdentity?.type || identityInfo.type || null
            };
        }));

        console.log('Available users in wallet:', users);
        res.json({
            success: true,
            users: users,
            message: `Found ${users.length} registered users`
        });
    } catch (error) {
        console.error('Error listing users:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list users',
            message: error.message
        });
    }
});

// Fabric network registration function
async function registerUserWithFabric(name, password) {
    try {
        // Load connection profile
        const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');

        // Check if connection profile exists
        if (!fs.existsSync(ccpPath)) {
            console.log('Connection profile not found, running in demo mode');
            return { success: true, demo: true };
        }

        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        // Setup Fabric CA client
        const caURL = ccp.certificateAuthorities['ca.org1.example.com'].url;
        const ca = new FabricCAServices(caURL);

        // Setup wallet to hold identities
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        // Check if user already exists
        if (await wallet.get(name)) {
            throw new Error(`User identity ${name} already exists in wallet`);
        }

        // Check admin identity for registration
        const adminIdentity = await wallet.get('admin');
        if (!adminIdentity) {
            throw new Error('Admin identity not found in wallet. Please enroll admin first.');
        }

        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        // Register the user (enrollment secret)
        const secret = await ca.register({
            affiliation: 'org1.department1',
            enrollmentID: name,
            role: 'client'
        }, adminUser);

        // Enroll the user using secret
        const enrollment = await ca.enroll({
            enrollmentID: name,
            enrollmentSecret: secret
        });

        // Import user identity into wallet
        const identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: 'Org1MSP',
            type: 'X.509',
        };
        await wallet.put(name, identity);

        // Encrypt wallet file after import
        const walletFilePath = path.join(walletPath, `${name}.id`);
        const masterPassword = getMasterPassword();
        try {
            encryptWalletFile(walletFilePath, masterPassword);
        } catch (encryptError) {
            console.warn(`⚠️  Warning: Failed to encrypt wallet after enrollment:`, encryptError.message);
        }

        return { success: true, demo: false };

    } catch (error) {
        console.error('Fabric registration error:', error.message);
        throw error;
    }
}

// Registration endpoint with real Fabric integration
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, password, role = 'customer' } = req.body;

        console.log('Registration request:', { name, role });

        if (!name || !password) {
            return res.status(400).json({
                success: false,
                detail: 'Missing name or password'
            });
        }

        // Try to register with Fabric network
        let fabricResult;
        try {
            fabricResult = await registerUserWithFabric(name, password);
        } catch (error) {
            return res.status(500).json({
                success: false,
                detail: `Fabric registration failed: ${error.message}`
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const identity = await wallet.get(name);
        const derivedIdentity = identity ? buildChaincodeIdentityFromCert(identity.credentials.certificate) : null;
        const networkAddress = derivedIdentity?.chaincodeID || crypto.createHash('sha256').update(name).digest('hex');

        // Compute bcrypt password hash
        const passwordHash = await bcrypt.hash(password, 12);

        const normalizedRole = normalizeStoredRole(role);

        // Create session token
        const token = jwt.sign({ username: name, networkAddress: networkAddress, role: normalizedRole }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        // Store registration data for future use
        const registrationData = {
            passwordHash: passwordHash,
            networkAddress: networkAddress,
            role: normalizedRole,
            timestamp: Date.now()
        };

        persistRegistrationSnapshot(name, registrationData);

        const userObj = {
            token,
            name,
            role: normalizedRole,
            network_address: networkAddress,
            wallet_created: !fabricResult.demo,
            demo_mode: fabricResult.demo
        };

        console.log('Registration successful for:', name);
        console.log('Network Address (Fabric identity):', networkAddress);
        console.log('Wallet created:', !fabricResult.demo);

        res.json(userObj);

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Helper function to check if user exists in wallet
async function checkUserExists(username) {
    try {
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const identity = await wallet.get(username);
        return !!identity;
    } catch (error) {
        console.error('Error checking user existence:', error);
        return false;
    }
}

// Get available users endpoint
app.get('/api/auth/users', async (req, res) => {
    try {
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const identities = await wallet.list();
        const users = await Promise.all(identities.map(async (identityInfo) => {
            if (typeof identityInfo === 'string') {
                const stored = await wallet.get(identityInfo);
                return {
                    label: identityInfo,
                    mspId: stored?.mspId || stored?.mspid || null,
                    type: stored?.type || null
                };
            }
            const label = identityInfo.label || identityInfo.name || identityInfo.id || 'unknown';
            if (identityInfo.mspId) {
                return { label, mspId: identityInfo.mspId, type: identityInfo.type || null };
            }
            const stored = await wallet.get(label);
            return {
                label,
                mspId: stored?.mspId || stored?.mspid || null,
                type: stored?.type || identityInfo.type || null
            };
        }));

        res.json({ success: true, users: users });

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Token integration guide
app.get('/api/token/:tokenId/integration', async (req, res) => {
    try {
        const tokenId = req.params.tokenId;
        const meta = readTokenMeta(tokenId) || {};
        const ownerUserId = meta.ownerUserId || meta.owner || null;
        const ownerNetworkAddress = meta.ownerNetworkAddress || meta.networkAddress || null;
        const base = req.protocol + '://' + req.get('host');
        const apiBase = base.replace(/:\d+$/, ':3001');

        const guide = {
            tokenId,
            ownerUserId,
            ownerNetworkAddress,
            endpoints: {
                registerCustomer: `${apiBase}/api/bank/register-customer`,
                pendingRegistrations: `${apiBase}/api/bank/pending-customer-registrations`,
                startRegister: `${apiBase}/api/token/${encodeURIComponent(tokenId)}/start-register`,
                testCall: `${apiBase}/api/token/${encodeURIComponent(tokenId)}/test-call`,
                getRegistrations: `${apiBase}/api/token/${encodeURIComponent(tokenId)}/registrations`
            },
            headers: {
                recommended: 'x-user-id: <ownerUserId> (or Authorization: Bearer <JWT>)',
                notes: 'Use header x-user-id with wallet label that exists on BetweenNetwork server'
            },
            examples: {
                curl_register: `curl -X POST ${apiBase}/api/bank/register-customer -H "Content-Type: application/json" -H "x-user-id: ${ownerUserId || '<ownerUserId>'}" -d '{"networkAddress":"<networkAddress>","name":"<name>","tokenID":"${tokenId}","userId":"${ownerUserId || '<ownerUserId>'}"}'`,
                node_fetch: `const fetch = require('node-fetch');\nawait fetch('${apiBase}/api/bank/register-customer',{method:'POST',headers:{'Content-Type':'application/json','x-user-id':'${ownerUserId || '<ownerUserId>'}'},body:JSON.stringify({networkAddress:'<networkAddress>',name:'<name>',tokenID:'${tokenId}',userId:'${ownerUserId || '<ownerUserId>'}'})})`
            }
        };

        res.json({ success: true, guide });
    } catch (err) {
        console.error('integration guide error:', err && err.message ? err.message : err);
        res.status(500).json({ success: false, detail: err.message || String(err) });
    }
});

// Test-call: attempt to perform a RegisterCustomer call using provided owner identity
app.post('/api/token/:tokenId/test-call', async (req, res) => {
    try {
        const tokenId = req.params.tokenId;
        const { ownerUserId, testNetworkAddress } = req.body || {};
        const meta = readTokenMeta(tokenId) || {};
        const userId = ownerUserId || meta.ownerUserId || meta.ownerUser || null;
        const networkAddress = testNetworkAddress || meta.ownerNetworkAddress || meta.networkAddress || null;
        if (!userId || !networkAddress) {
            return res.status(400).json({ success: false, detail: 'ownerUserId and testNetworkAddress required (or present in token meta)' });
        }

        const walletPath = path.resolve(__dirname, 'wallet');
        try {
            // use registerCustomer helper to attempt a registration (will be idempotent if chaincode checks)
            const name = `integration_test_${Date.now()}`;
            await submitWithRetry(
                () => registerCustomer(networkAddress, name, tokenId, walletPath, userId),
                3,
                `RegisterCustomer for ${userId}`
            );
            return res.json({ success: true, detail: 'Test RegisterCustomer submitted (check pending registrations)' });
        } catch (err) {
            console.warn('test-call failed:', err && err.message ? err.message : err);
            return res.status(500).json({ success: false, detail: err.message || String(err) });
        }
    } catch (err) {
        console.error('test-call error:', err && err.message ? err.message : err);
        res.status(500).json({ success: false, detail: err.message || String(err) });
    }
});

// List token-scoped registrations
app.get('/api/token/:tokenId/registrations', async (req, res) => {
    try {
        const tokenId = req.params.tokenId;
        const regs = listTokenRegistrations(tokenId);
        res.json({ success: true, registrations: regs });
    } catch (err) {
        console.error('list token registrations error:', err && err.message ? err.message : err);
        res.status(500).json({ success: false, detail: err.message || String(err) });
    }
});

// Import identity from a registration JSON into the file-system wallet
// Attempts to extract PEMs from registration fields or from a base64-encoded networkAddress
app.post('/api/wallet/import-registration/:username', async (req, res) => {
    try {
        const username = req.params.username;
        if (!username) {
            return res.status(400).json({ success: false, detail: 'Missing username parameter' });
        }

        const registrationPath = getRegistrationFilePath(username);
        if (!fs.existsSync(registrationPath)) {
            return res.status(404).json({ success: false, detail: `Registration snapshot not found for ${username}` });
        }

        const snapshot = JSON.parse(fs.readFileSync(registrationPath, 'utf8'));

        // Try direct fields first
        let certificate = snapshot.certificate || snapshot.cert || snapshot.certificatePem || null;
        let privateKey = snapshot.privateKey || snapshot.key || snapshot.privateKeyPem || null;

        // Helper to extract PEM blocks from a decoded networkAddress string
        function extractPemsFromString(str) {
            const certMatch = str.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
            const keyMatch = str.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/);
            return {
                certificate: certMatch ? certMatch[0] : null,
                privateKey: keyMatch ? keyMatch[0] : null
            };
        }

        // Attempt to decode networkAddress if PEMs not directly available
        if ((!certificate || !privateKey) && snapshot.networkAddress) {
            try {
                const decoded = Buffer.from(snapshot.networkAddress, 'base64').toString('utf8');
                const found = extractPemsFromString(decoded);
                certificate = certificate || found.certificate;
                privateKey = privateKey || found.privateKey;
            } catch (err) {
                // ignore decode errors
            }
        }

        if (!certificate) {
            return res.status(400).json({ success: false, detail: 'Certificate not found in registration snapshot. Add `certificate` (PEM) to registration JSON or include PEM in networkAddress.' });
        }
        if (!privateKey) {
            return res.status(400).json({ success: false, detail: 'Private key not found in registration snapshot. Add `privateKey` (PEM) to registration JSON or include PEM in networkAddress.' });
        }

        // Determine MSP ID heuristically or fall back to Org1MSP
        let mspId = 'Org1MSP';
        try {
            const lower = (certificate || '').toLowerCase();
            if (lower.includes('org1')) mspId = 'Org1MSP';
        } catch (e) { }

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        const identity = {
            credentials: { certificate: certificate, privateKey: privateKey },
            mspId: mspId,
            type: 'X.509'
        };

        await wallet.put(username, identity);

        res.json({ success: true, detail: `Imported identity for ${username} into wallet at ${walletPath}` });
    } catch (error) {
        console.error('Import registration identity error:', error && error.message ? error.message : error);
        res.status(500).json({ success: false, detail: error.message || String(error) });
    }
});

// Manual registration endpoint - accepts password hash directly
app.post('/api/auth/register-manual', async (req, res) => {
    try {
        const { name, passwordHash, role = 'customer' } = req.body;

        console.log('Manual registration request:', { name, role });

        if (!name || !passwordHash) {
            return res.status(400).json({
                success: false,
                detail: 'Missing name or passwordHash'
            });
        }

        const normalizedRole = normalizeStoredRole(role);

        // Try to register with Fabric network using dummy password
        let fabricResult;
        try {
            fabricResult = await registerUserWithFabric(name, 'dummy_password_for_fabric');
        } catch (error) {
            return res.status(500).json({
                success: false,
                detail: `Fabric registration failed: ${error.message}`
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const identity = await wallet.get(name);
        const derivedIdentity = identity ? buildChaincodeIdentityFromCert(identity.credentials.certificate) : null;
        const networkAddress = derivedIdentity?.chaincodeID || crypto.createHash('sha256').update(name).digest('hex');

        // Store registration data for future use
        const registrationData = {
            passwordHash: passwordHash,  // Use provided hash directly
            networkAddress: networkAddress,
            role: normalizedRole,
            timestamp: Date.now()
        };

        // Save to registration storage
        persistRegistrationSnapshot(name, registrationData);

        // Create session token
        const token = 'token-' + crypto.randomBytes(8).toString('hex');

        const userObj = {
            token,
            name,
            role: normalizedRole,
            network_address: networkAddress,
            wallet_created: !fabricResult.demo,
            demo_mode: fabricResult.demo
        };

        console.log('Manual registration successful for:', name);
        console.log('Network Address (Fabric identity):', networkAddress);

        res.json(userObj);

    } catch (error) {
        console.error('Manual registration error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Login endpoint - bcrypt + JWT
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, name, password } = req.body;
        const actualUsername = username || name;

        if (!actualUsername || !password) {
            return res.status(400).json({
                success: false,
                detail: 'Missing username or password'
            });
        }

        const walletUserExists = await checkUserExists(actualUsername);
        if (!walletUserExists) {
            return res.status(401).json({
                success: false,
                detail: 'Invalid credentials - wallet identity not found'
            });
        }

        const storedData = loadRegistrationSnapshot(actualUsername);
        if (!storedData || !storedData.passwordHash) {
            return res.status(401).json({
                success: false,
                detail: 'User registration data not found'
            });
        }

        let passwordsMatch = false;
        if (isBcryptHash(storedData.passwordHash)) {
            passwordsMatch = await bcrypt.compare(password, storedData.passwordHash);
        } else {
            const shaHash = crypto.createHash('sha256').update(password).digest('hex');
            passwordsMatch = shaHash === storedData.passwordHash;
        }

        if (!passwordsMatch) {
            return res.status(401).json({
                success: false,
                detail: 'Invalid credentials'
            });
        }

        const fallbackRole = actualUsername === 'admin' ? 'admin' : DEFAULT_ROLE;
        const resolvedRole = normalizeStoredRole(storedData?.role, fallbackRole);
        const networkAddress = storedData?.networkAddress || crypto.createHash('sha256').update(actualUsername).digest('hex');

        const token = jwt.sign(
            { username: actualUsername, networkAddress, role: resolvedRole },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true,
            token,
            username: actualUsername,
            name: actualUsername,
            role: resolvedRole,
            network_address: networkAddress,
            message: 'Login successful'
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            detail: 'Login failed: ' + error.message
        });
    }
});

// Enrollment endpoint - creates admin/user identities
app.post('/api/auth/enroll', async (req, res) => {
    try {
        const { name, password, enrollmentSecret } = req.body;

        if (!name || !password) {
            return res.status(400).json({
                success: false,
                detail: 'Missing name or password'
            });
        }

        // Load connection profile
        const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');

        // Check if connection profile exists
        if (!fs.existsSync(ccpPath)) {
            return res.status(500).json({
                success: false,
                detail: 'Fabric network not available - connection profile not found'
            });
        }

        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
        const caInfo = ccp.certificateAuthorities['ca.org1.example.com'];
        const caTLSCACerts = caInfo.tlsCACerts.pem;
        const ca = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);

        // Setup wallet
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        // Check if identity already exists
        const identity = await wallet.get(name);
        if (identity) {
            return res.status(409).json({
                success: false,
                detail: `Identity ${name} already exists in wallet`
            });
        }

        // Determine enrollment credentials
        let enrollmentID, secret;

        // Determine enrollment credentials: NEVER default to adminpw for security
        if (!enrollmentSecret) {
            return res.status(400).json({
                success: false,
                detail: 'enrollmentSecret is required for all identities'
            });
        }
        secret = enrollmentSecret;

        enrollmentID = name;

        console.log(`Attempting to enroll: ${enrollmentID} with secret: ${secret.substring(0, 3)}...`);

        // Enroll the identity
        const enrollment = await ca.enroll({
            enrollmentID: enrollmentID,
            enrollmentSecret: secret
        });

        // Create identity object
        const identityObj = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: 'Org1MSP',
            type: 'X.509',
        };

        // Store identity in wallet
        await wallet.put(name, identityObj);

        // Generate hashes
        const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
        const derivedIdentity = buildChaincodeIdentityFromCert(enrollment.certificate);
        const networkAddress = derivedIdentity?.chaincodeID || crypto.createHash('sha256').update(name).digest('hex');

        console.log(`Successfully enrolled ${name} and imported into wallet`);
        console.log(`Network Address (Fabric identity): ${networkAddress}`);
        const enrollmentRole = normalizeStoredRole(name === 'admin' ? 'admin' : 'bank', name === 'admin' ? 'admin' : DEFAULT_ROLE);
        persistRegistrationSnapshot(name, {
            passwordHash,
            networkAddress,
            role: enrollmentRole,
            timestamp: Date.now()
        });

        if (name === 'admin') {
            ensureEventListener(req.app.get('io'), WALLET_PATH, 'admin').catch((err) => {
                console.warn('Unable to start Event Listener after admin enrollment:', err && err.message ? err.message : err);
            });
        }

        // Issue JWT so UI can immediately call protected endpoints
        const token = jwt.sign(
            { username: name, networkAddress, role: enrollmentRole },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true,
            message: `Successfully enrolled ${name}`,
            network_address: networkAddress,
            username: name,
            role: enrollmentRole,
            token
        });

    } catch (error) {
        console.error('Enrollment error:', error);
        res.status(500).json({
            success: false,
            detail: `Enrollment failed: ${error.message}`
        });
    }
});

// Register participant endpoint
app.post('/api/participant/register', async (req, res) => {
    try {
        const { userId: rawUserId, password, passwordHash, country = 'US' } = req.body;

        // Trim whitespace from userId
        const userId = rawUserId ? rawUserId.trim() : rawUserId;
        console.log('Participant registration - Original userId:', `"${rawUserId}"`, 'Trimmed userId:', `"${userId}"`);

        if (!userId) {
            return res.status(400).json({
                success: false,
                detail: 'Missing userId'
            });
        }

        // Accept either passwordHash directly or generate from password (stored locally only)
        let finalPasswordHash = passwordHash;
        if (!finalPasswordHash && password) {
            finalPasswordHash = await bcrypt.hash(password, 12);
            console.log('Generated bcrypt password hash for participant registration');
        }

        const walletPath = path.join(process.cwd(), 'wallet');

        // Check if user identity exists in wallet
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const userIdentity = await wallet.get(userId);
        if (!userIdentity) {
            return res.status(400).json({
                success: false,
                error: `User '${userId}' not found in wallet. Please register the user first.`,
                message: 'User identity does not exist in wallet'
            });
        }

        // Connect to blockchain to ensure channel access (will rely on certificate identity)
        const gateway = new Gateway();
        const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        await gateway.connect(ccp, {
            wallet,
            identity: userId,
            discovery: { enabled: true, asLocalhost: true }
        });

        await gateway.getNetwork('mychannel');
        gateway.disconnect();

        // Register participant using app.js function and capture on-chain network address
        const ledgerNetworkAddress = await submitRegistration(userId, country, walletPath, userId);

        const existingSnapshot = loadRegistrationSnapshot(userId) || {};
        const updatedSnapshot = {
            passwordHash: finalPasswordHash || existingSnapshot.passwordHash,
            networkAddress: ledgerNetworkAddress || existingSnapshot.networkAddress || userId,
            role: existingSnapshot.role || DEFAULT_ROLE,
            timestamp: Date.now()
        };
        persistRegistrationSnapshot(userId, updatedSnapshot);
        if (ledgerNetworkAddress) {
            REGISTRATION_CACHE.set(ledgerNetworkAddress, userId);
        }

        res.json({
            success: true,
            message: `Participant ${userId} registered successfully in blockchain`,
            userId: userId,
            network_address: updatedSnapshot.networkAddress
        });

    } catch (error) {
        console.error('Participant registration error:', error);
        if (error.message && (error.message.includes('already registered') ||
            error.message.includes('already exists'))) {
            res.json({
                success: true,
                message: 'Participant already registered',
                userId: req.body.userId
            });
        } else {
            res.status(500).json({
                success: false,
                detail: `Participant registration failed: ${error.message}`
            });
        }
    }
});

// Check if participant exists endpoint
app.get('/api/participant/exists', async (req, res) => {
    try {
        const { networkAddress } = req.query;

        if (!networkAddress) {
            return res.status(400).json({
                success: false,
                error: 'Missing networkAddress parameter'
            });
        }

        const normalizedNetworkAddress = decodeURIComponent(networkAddress).replace(/ /g, '+');

        console.log('Checking participant existence for network address:', normalizedNetworkAddress);

        // Use participantExists function from app.js
        const walletPath = path.join(process.cwd(), 'wallet');
        const exists = await participantExists(normalizedNetworkAddress, walletPath, 'admin');

        console.log(`Participant exists result: ${exists}`);

        res.json({
            success: true,
            exists: exists,
            networkAddress: normalizedNetworkAddress
        });

    } catch (error) {
        console.error('Participant exists check error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            exists: false
        });
    }
});

// TestFunction API endpoint - RESTRICTED to admin users only
app.post('/api/test-function/:functionName', authenticateJWT, (req, res) => {
    const caller = req.user?.username;
    if (caller !== 'admin') {
        return res.status(403).json({ success: false, detail: 'Access denied: Requires admin identity' });
    }
    const { functionName } = req.params;
    const { args = [] } = req.body;

    console.log(`Executing testFunction: ${functionName} with args:`, args);

    const { exec } = require('child_process');
    const command = `node testFunction.js ${functionName} ${args.join(' ')}`;

    console.log('Executing command:', command);

    exec(command, { cwd: __dirname, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            console.error('TestFunction execution error:', error);
            return res.status(500).json({
                success: false,
                error: error.message,
                functionName: functionName
            });
        }

        if (stderr) {
            console.error('TestFunction stderr:', stderr);
        }

        console.log('TestFunction stdout:', stdout);

        res.json({
            success: true,
            result: stdout.trim() || 'Function executed successfully',
            functionName: functionName,
            args: args
        });
    });
});

// TestFunction API endpoint (variant) - RESTRICTED to admin users only
app.post('/api/testfunction/:functionName', authenticateJWT, (req, res) => {
    try {
        const caller = req.user?.username;
        if (caller !== 'admin') {
            return res.status(403).json({ success: false, detail: 'Access denied: Requires admin identity' });
        }
        const { functionName } = req.params;
        const { args = [] } = req.body;

        console.log(`TestFunction API call: ${functionName} with args:`, args);

        // Execute testFunction.js directly using spawn
        const { spawn } = require('child_process');

        // Build command arguments for testFunction.js
        const cmdArgs = [functionName, ...args];
        console.log('Executing testFunction with args:', cmdArgs);

        const child = spawn('node', ['testFunction.js', ...cmdArgs], {
            cwd: __dirname,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let responseSent = false;

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (responseSent) return;
            responseSent = true;

            console.log(`TestFunction ${functionName} completed with code ${code}`);
            console.log('Stdout:', stdout);

            if (code === 0) {
                res.json({
                    success: true,
                    result: stdout.trim() || 'Function executed successfully',
                    functionName: functionName,
                    args: args
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: stderr || 'Function execution failed',
                    functionName: functionName,
                    exitCode: code
                });
            }
        });

        child.on('error', (error) => {
            if (responseSent) return;
            responseSent = true;

            console.error(`TestFunction spawn error:`, error);
            res.status(500).json({
                success: false,
                error: error.message,
                functionName: functionName
            });
        });

    } catch (error) {
        console.error('TestFunction API error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Customer wallet endpoint
app.get('/api/customer/wallet', async (req, res) => {
    try {
        const { userId, networkAddress, tokenID } = req.query;
        const normalizedTokenID = tokenID ? decodeURIComponent(tokenID).trim() : '';
        console.log('Wallet request for:', {
            userId,
            networkAddress,
            tokenID: normalizedTokenID || '(auto)'
        });

        // SECURITY FIX #6: Require JWT authentication for wallet access
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Missing or invalid authorization header'
            });
        }
        const token = authHeader.substring('Bearer '.length);
        try {
            jwt.verify(token, process.env.JWT_SECRET || 'fabric-jwt-secret');
        } catch (tokenErr) {
            console.error('JWT verification failed:', tokenErr.message);
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired authentication token'
            });
        }

        if (!userId) {
            return res.status(400).json({
                success: false,
                detail: 'Missing required parameters: userId'
            });
        }

        // SECURITY FIX #9: Validate networkAddress format
        if (networkAddress && (typeof networkAddress !== 'string' || networkAddress.trim() === '')) {
            return res.status(400).json({
                success: false,
                detail: 'Invalid networkAddress format'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const resolvedNetworkAddress = requireNetworkAddressForUser(userId, networkAddress);
        const custumerUserId = userId;

        // Ensure the identity exists in the wallet
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const identity = await wallet.get(custumerUserId);
        if (!identity) {
            return res.status(400).json({
                success: false,
                detail: `Wallet identity '${custumerUserId}' not found. Login or enroll this user first.`,
                registration: {
                    status: 'not_registered',
                    message: `User '${custumerUserId}' not found in wallet.`
                },
                network_address: resolvedNetworkAddress,
                token_id: normalizedTokenID
            });
        }

        let walletData = null;
        let registrationStatus = 'pending';
        let effectiveTokenID = normalizedTokenID;

        // SECURITY FIX #7: Implement rate limiting per user (max 10 requests per minute)
        const rateLimitKey = `wallet_${userId}`;
        const rateLimitStore = global.walletRateLimits || {};
        global.walletRateLimits = rateLimitStore;
        const now = Date.now();
        if (!rateLimitStore[rateLimitKey]) {
            rateLimitStore[rateLimitKey] = [];
        }
        // Remove old entries (older than 1 minute)
        rateLimitStore[rateLimitKey] = rateLimitStore[rateLimitKey].filter(t => now - t < 60000);
        if (rateLimitStore[rateLimitKey].length >= 10) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded: maximum 10 requests per minute'
            });
        }
        rateLimitStore[rateLimitKey].push(now);

        // OPTIMIZATION: Skip token derivation if caller provided a valid tokenID
        // Only derive if tokenID is missing or empty
        if (!effectiveTokenID) {
            console.log('Token not provided; attempting derivation...');
            try {
                // SECURITY FIX #8: Add timeout to token resolution (5 second max)
                const derivationPromise = resolveCustomerTokenID(resolvedNetworkAddress, walletPath, custumerUserId);
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Token derivation timeout')), 5000)
                );
                const derivedToken = await Promise.race([derivationPromise, timeoutPromise]);
                if (derivedToken) {
                    effectiveTokenID = derivedToken;
                    console.log('Token resolved via derivation:', derivedToken);
                }
            } catch (deriveErr) {
                console.warn('Token derivation failed:', deriveErr?.message || deriveErr);
            }
        } else {
            console.log('Token provided by client; skipping derivation:', effectiveTokenID);
        }

        if (!effectiveTokenID) {
            return res.json({
                success: true,
                wallet: {
                    wallet_balance: 0,
                    wallet_balance_display: '$0.00',
                    currency: null,
                    currency_symbol: '$',
                    token: null,
                    registration: {
                        status: 'no_token_assigned',
                        message: 'Customer registered; token assignment/approval is pending.',
                        created_at: new Date().toISOString()
                    },
                    network_address: resolvedNetworkAddress,
                    token_id: null
                }
            });
        }

        // Validate that tokenID is not a currency code
        if (effectiveTokenID.toUpperCase() === effectiveTokenID && !effectiveTokenID.startsWith('BNET-') && !effectiveTokenID.includes('-ROOT-v1')) {
            console.warn('WARNING: tokenID appears to be a currency code, not a token ID. Expected format: 1BNET-currency-ROOT-v1 or HDFC-USD-8f2a3b4c-v1');
            return res.status(400).json({
                success: false,
                detail: 'tokenID looks like a currency code (e.g., USD) instead of a token ID. Use the full token ID returned after approval (e.g., HDFC-USD-8f2a3b4c-v1).'
            });
        }

        try {
            const data = await viewCustomerWallet(
                resolvedNetworkAddress,
                effectiveTokenID,
                walletPath,
                custumerUserId
            );
            walletData = data;
            registrationStatus = 'approved';
            console.log('Customer wallet retrieved successfully');
        } catch (walletError) {
            console.log('Failed to get wallet info:', walletError.message);
            const msg = walletError && walletError.message ? walletError.message : String(walletError);
            if (msg.includes('customer not found')) {
                return res.json({
                    success: true,
                    wallet: {
                        wallet_balance: 0,
                        wallet_balance_display: '$0.00',
                        currency: null,
                        currency_symbol: '$',
                        token: null,
                        registration: {
                            status: 'not_registered',
                            message: 'Customer not found on-chain. Register the customer and await approval.',
                            created_at: new Date().toISOString()
                        },
                        network_address: resolvedNetworkAddress,
                        token_id: effectiveTokenID
                    }
                });
            }
            if (msg.includes('token not found') || msg.includes('token mismatch') || msg.includes('has no token assigned')) {
                return res.json({
                    success: true,
                    wallet: {
                        wallet_balance: 0,
                        wallet_balance_display: '$0.00',
                        currency: null,
                        currency_symbol: '$',
                        token: null,
                        registration: {
                            status: 'no_token_assigned',
                            message: 'Customer registered; token assignment/approval is pending.',
                            created_at: new Date().toISOString()
                        },
                        network_address: resolvedNetworkAddress,
                        token_id: effectiveTokenID
                    }
                });
            }
            if (msg.includes('unauthorized')) {
                return res.status(403).json({
                    success: false,
                    detail: 'Unauthorized: wallet identity does not match customer identity'
                });
            }
            if (walletError.message.includes('unauthorized')) {
                console.warn('Identity resolution issue: resolved userId was', custumerUserId);
            }
        }

        if (!walletData) {
            walletData = { balance: 0 };
            registrationStatus = 'pending';
        }

        const participantTransferIDs = Array.isArray(walletData.participantTransferIDs)
            ? walletData.participantTransferIDs
            : (walletData.participant_transfer_ids || []);
        const tokenTransferIDs = Array.isArray(walletData.tokenTransferIDs)
            ? walletData.tokenTransferIDs
            : (walletData.token_transfer_ids || []);

        const walletBalanceValue =
            walletData.walletBalance ?? walletData.wallet_balance ?? walletData.balance ?? 0;

        // SECURITY FIX #10: Validate balance doesn't exceed maximum safe integer
        const MAX_SAFE_BALANCE = 999999999.99;
        if (typeof walletBalanceValue === 'number' && walletBalanceValue > MAX_SAFE_BALANCE) {
            console.error(`WARNING: Balance ${walletBalanceValue} exceeds maximum safe value ${MAX_SAFE_BALANCE}`);
            return res.status(400).json({
                success: false,
                error: 'Balance value exceeds system limit. Contact support.'
            });
        }

        const normalizedCurrency = walletData.currency || walletData.currencyCode || null;
        const currencySymbol =
            walletData.currencySymbol || walletData.currency_symbol || (normalizedCurrency ? `${normalizedCurrency} ` : '');
        const rawForeignCurrencies = Array.isArray(walletData.foreignCurrencies)
            ? walletData.foreignCurrencies
            : (walletData.foreign_currencies && Array.isArray(walletData.foreign_currencies)
                ? walletData.foreign_currencies
                : []);
        const normalizedForeignCurrencies = rawForeignCurrencies.map(entry => {
            const currencyCode = entry.currency || entry.currencyCode || entry.code || '';
            const amountValue = Number(entry.amount) || 0;
            const entrySymbol =
                entry.currencySymbol ||
                entry.currency_symbol ||
                (currencyCode ? `${currencyCode} ` : '');
            return {
                currency: currencyCode,
                amount: amountValue,
                display:
                    entry.display ||
                    (entrySymbol && amountValue
                        ? `${entrySymbol}${amountValue.toFixed(2)}`
                        : null),
                currency_symbol: entrySymbol
            };
        });
        const responsePayload = {
            wallet_balance: walletBalanceValue,
            wallet_balance_display:
                walletData.walletBalanceDisplay ||
                walletData.wallet_balance_display ||
                (currencySymbol && typeof walletBalanceValue === 'number'
                    ? `${currencySymbol}${walletBalanceValue.toFixed(2)}`
                    : null),
            registration: {
                status: registrationStatus,
                created_at: new Date().toISOString()
            },
            token_id: walletData.tokenID || effectiveTokenID,
            network_address: walletData.networkAddress || networkAddress,
            customer_id: walletData.customerID || walletData.customer_id || null,
            participant_transfer_id: walletData.participantTransferID || walletData.participant_transfer_id || null,
            token_transfer_id: walletData.tokenTransferID || walletData.token_transfer_id || null,
            participant_transfer_ids: participantTransferIDs,
            token_transfer_ids: tokenTransferIDs,
            currency: normalizedCurrency,
            currency_symbol: currencySymbol,
            balance_display:
                walletData.balanceDisplay ||
                walletData.balance_display ||
                (currencySymbol && typeof walletData.balance === 'number'
                    ? `${currencySymbol}${walletData.balance.toFixed(2)}`
                    : null)
        };

        res.json({
            success: true,
            wallet: responsePayload
        });
    } catch (error) {
        console.error('Wallet error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Customer token-level ID access endpoint
app.get('/api/customer/id-access', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const networkAddress = getNetworkAddressForUser(caller);
        const tokenID = (req.query.tokenID || req.query.tokenId || '').trim();

        if (!networkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Customer network address not found. Please register first.'
            });
        }
        if (!tokenID) {
            return res.status(400).json({
                success: false,
                detail: 'tokenID is required'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const access = await getCustomerIDAccess(networkAddress, tokenID, walletPath, caller);

        return res.json({
            success: true,
            access: {
                token_id: access.token_id || tokenID,
                network_address: access.network_address || networkAddress,
                customer_id: access.customer_id || null,
                approved: Boolean(access.approved),
                status: access.status || (access.approved ? 'approved' : 'pending')
            }
        });
    } catch (error) {
        console.error('Customer ID access error:', error);
        return res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Customer registration with bank endpoint
app.post('/api/customer-register', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { name, password, tokenID, kycId = '', kycStatus = '' } = req.body;

        // Derive networkAddress authoritatively from the authenticated session
        const networkAddress = getNetworkAddressForUser(caller);

        console.log('Customer bank registration:', { networkAddress, name, tokenID, kycId, kycStatus });

        if (!networkAddress || !name || !tokenID) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: networkAddress, name, tokenID',
                help: 'Provide customer blockchain address, name, and token ID (e.g., 1BNET-currency-ROOT-v1 or HDFC-USD-8f2a3b4c-v1)'
            });
        }

        // Validate tokenID format
        if (tokenID.toUpperCase() === tokenID && !tokenID.startsWith('BNET-') && !tokenID.includes('-ROOT-v1')) {
            console.warn('WARNING: tokenID appears to be a currency code, not token ID');
        }

        const walletPath = path.join(process.cwd(), 'wallet');

        // Use real blockchain function: registerCustomer(networkAddress, name, tokenID)
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const gateway = new Gateway();

        const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        const identityToUse = req.requestedIdentity || name;
        const storedIdentity = await wallet.get(identityToUse);
        if (!storedIdentity) {
            return res.status(400).json({ success: false, detail: `Wallet identity '${identityToUse}' not found. Import or enroll the identity before calling this API.` });
        }

        await gateway.connect(ccp, {
            wallet,
            identity: identityToUse,
            discovery: { enabled: true, asLocalhost: true }
        });

        const network = await gateway.getNetwork('mychannel');
        const contract = network.getContract('fabcar');
        try {
            console.log('Submitting RegisterCustomer transaction', { identity: identityToUse, networkAddress, name, tokenID, kycId, kycStatus });
            const tx = contract.createTransaction('RegisterCustomer');
            const result = await tx.submit(networkAddress, name, tokenID, kycId || '', kycStatus || '');
            console.log('RegisterCustomer transaction successful, result:', result && result.toString ? result.toString() : result);
        } catch (txErr) {
            console.error('RegisterCustomer transaction failed:', txErr && txErr.message ? txErr.message : txErr);
            throw txErr;
        } finally {
            try { gateway.disconnect(); } catch (dErr) { console.warn('Gateway disconnect error:', dErr && dErr.message ? dErr.message : dErr); }
        }

        res.json({
            success: true,
            message: 'Customer registration submitted to blockchain successfully',
            registration_id: 'REG' + crypto.randomBytes(4).toString('hex').toUpperCase()
        });
    } catch (error) {
        console.error('Customer registration error:', error);
        let errorDetail = error.message;
        if (error.message && error.message.includes('already exists')) {
            errorDetail = 'Customer is already registered for this token. Registration pending bank approval.';
        } else if (error.message && error.message.includes('token not found')) {
            errorDetail = 'Token not found on blockchain. Verify token ID is correct.';
        }
        res.status(500).json({
            success: false,
            detail: errorDetail,
            help: 'Contact the bank if issue persists'
        });
    }
});

// Customer endpoint to view all tokens
app.get('/api/customer/view-all-tokens', async (req, res) => {
    try {
        console.log('Customer view all tokens request received');

        const walletPath = path.join(process.cwd(), 'wallet');
        const userId = 'admin'; // Use admin to view all tokens

        // Call the viewAllTokens function from app.js
        const { viewAllTokens } = require('./app.js');
        const tokens = await viewAllTokens(walletPath, userId);

        // Ensure transfer_ids is always an array
        const normalizedTokens = Array.isArray(tokens)
            ? tokens.map(token => ({ ...token, transfer_ids: Array.isArray(token.transfer_ids) ? token.transfer_ids : [] }))
            : tokens;
        res.json({
            success: true,
            tokens: normalizedTokens
        });
    } catch (error) {
        console.error('Customer view tokens error:', error);
        res.status(500).json({
            success: false,
            detail: 'Failed to retrieve available tokens: ' + error.message,
            help: 'Ensure blockchain network is running and accessible'
        });
    }
});

// Customer endpoint to register customer with bank
app.post('/api/customer/register-with-bank', async (req, res) => {
    try {
        const { customer_name, customer_address, token_id } = req.body;
        console.log('Customer registering with bank:', { customer_name, customer_address, token_id });

        // SECURITY FIX #1: Validate customer_name is not empty
        const trimmedName = (customer_name || '').trim();
        if (!trimmedName) {
            return res.status(400).json({
                success: false,
                error: 'Customer name cannot be empty'
            });
        }

        // SECURITY FIX #2: Validate networkAddress is not empty and has correct format
        const trimmedAddress = (customer_address || '').trim();
        if (!trimmedAddress) {
            return res.status(400).json({
                success: false,
                error: 'Customer address cannot be empty',
                help: 'Provide: customer_address (blockchain network address)'
            });
        }

        // SECURITY FIX #3: Validate token_id exists and is not empty
        const trimmedTokenId = (token_id || '').trim();
        if (!trimmedTokenId) {
            return res.status(400).json({
                success: false,
                error: 'Token ID is required (e.g., 1BNET-currency-ROOT-v1 or HDFC-USD-8f2a3b4c-v1)',
                help: 'Specify which currency token you want to register for'
            });
        }

        // Validate token_id format
        if (trimmedTokenId.toUpperCase() === trimmedTokenId && !trimmedTokenId.startsWith('BNET-') && !trimmedTokenId.includes('-ROOT-v1')) {
            console.warn('WARNING: token_id appears to be a currency code, not token ID');
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const userId = trimmedName; // Use the customer name as userId
        const tokenID = trimmedTokenId || '1BNET-currency-ROOT-v1'; // Use provided token_id or default (root token)

        try {
            // Call the registerCustomer function from app.js
            const { registerCustomer } = require('./app.js');
            await submitWithRetry(
                () => registerCustomer(trimmedAddress, trimmedName, tokenID, walletPath, userId),
                3,
                `RegisterCustomer for ${trimmedName}`
            );

            res.json({
                success: true,
                message: 'Customer registration with bank submitted successfully. Awaiting approval from bank.',
                token_id: tokenID
            });
        } catch (error) {
            // If the registration already exists, treat it as success
            if (error.message && error.message.includes('already exists')) {
                console.log('Customer registration already exists, treating as success');
                res.json({
                    success: true,
                    message: 'Customer registration already submitted. Please check pending requests.',
                    token_id: tokenID
                });
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error('Customer bank registration error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Frontend requests the bank login redirect for a token/customer combination
app.post('/api/token/:tokenId/start-register', (req, res) => {
    try {
        const tokenId = req.params.tokenId;
        const { networkAddress } = req.body || {};
        if (!tokenId || !networkAddress) {
            return res.status(400).json({
                success: false,
                error: 'tokenId and networkAddress are required'
            });
        }
        const config = getBankTokenConfig(tokenId);
        if (!config) {
            return res.status(404).json({
                success: false,
                error: `Token ${tokenId} is not configured with a bank login URL yet`
            });
        }
        const loginURL = buildBankLoginURL(config, tokenId, networkAddress);
        res.json({
            success: true,
            token_id: tokenId,
            network_address: networkAddress,
            login_url: loginURL
        });
    } catch (error) {
        console.error('Failed to build bank login url:', error);
        res.status(500).json({
            success: false,
            error: 'Unable to start bank registration',
            detail: error.message
        });
    }
});

// Bank owners configure their external KYC API per token
app.post('/api/bank/token-config', (req, res) => {
    try {
        const { token_id, bank_api_base_url, bank_auth_key } = req.body || {};
        if (!token_id || !bank_api_base_url || !bank_auth_key) {
            return res.status(400).json({
                success: false,
                error: 'token_id, bank_api_base_url and bank_auth_key are required'
            });
        }
        const normalizedUrl = normalizeBankAPIBaseUrl(bank_api_base_url);
        const stored = upsertBankTokenConfig(token_id, {
            bank_api_base_url: normalizedUrl,
            bank_auth_key: bank_auth_key.trim()
        });
        res.json({
            success: true,
            message: 'Bank API configuration saved',
            config: sanitizeBankTokenConfig(stored)
        });
    } catch (error) {
        console.error('Failed to persist bank token config:', error);
        res.status(500).json({
            success: false,
            error: 'Unable to save bank token configuration',
            detail: error.message
        });
    }
});

// General endpoint to read sanitized bank config (no secrets)
app.get('/api/token/:tokenId/bank-config', (req, res) => {
    try {
        const tokenId = req.params.tokenId;
        const config = sanitizeBankTokenConfig(getBankTokenConfig(tokenId));
        if (!config) {
            return res.status(404).json({
                success: false,
                error: `Token ${tokenId} has no KYC configuration`
            });
        }
        res.json({
            success: true,
            config
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Unable to load bank configuration',
            detail: error.message
        });
    }
});

// Bank owner fetches all configured token mappings
app.get('/api/bank/token-configs', authenticateJWT, async (req, res) => {
    try {
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found. Please register bank wallet first.'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        let tokenId = await getTokenAccess(ownerNetworkAddress, walletPath, bankUserId);

        if (!tokenId) {
            return res.status(400).json({
                success: false,
                detail: 'No token assigned to this bank. Please request token assignment.'
            });
        }

        // Get all configs but filter to only this user's assigned token
        const allConfigs = listSanitizedBankTokenConfigs();
        const userTokenConfig = allConfigs.filter(config => config.token_id === tokenId);

        res.json({
            success: true,
            count: userTokenConfig.length,
            configs: userTokenConfig
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Unable to list bank token configurations',
            detail: error.message
        });
    }
});

// Bank backend notifies BetweenNetwork after login+KYC succeeds
app.post('/api/token/:tokenId/customers/register', async (req, res) => {
    try {
        const tokenId = req.params.tokenId || req.body.token_id;
        const config = getBankTokenConfig(tokenId);
        if (!config) {
            return res.status(404).json({
                success: false,
                error: `No bank configuration found for token ${tokenId}`
            });
        }
        const providedKey = (req.headers['x-bank-api-key'] || req.headers['x-bank-key'] || '').trim();
        if (!providedKey || providedKey !== (config.bank_auth_key || '').trim()) {
            return res.status(403).json({
                success: false,
                error: 'Invalid or missing bank API key'
            });
        }

        const { customerId, networkAddress, kycId, kycStatus, userId } = req.body || {};
        if (!customerId || !networkAddress || !kycId || typeof kycStatus === 'undefined') {
            return res.status(400).json({
                success: false,
                error: 'customerId, networkAddress, kycId and kycStatus are required'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const interpretedStatus = interpretKYCStatus(kycStatus);
        await upsertCustomerFromBank(
            networkAddress,
            customerId,
            tokenId,
            kycId,
            interpretedStatus,
            walletPath,
            userId || 'admin'
        );

        res.json({
            success: true,
            token_id: tokenId,
            network_address: networkAddress,
            kyc_id: kycId,
            kyc_status: interpretedStatus
        });
    } catch (error) {
        console.error('Failed to register bank customer via callback:', error);
        res.status(500).json({
            success: false,
            error: 'Unable to record bank customer registration',
            detail: error.message
        });
    }
});

// ==================== Commission Configuration Endpoints ====================

// POST /api/bank/commission - Set commission rate for a token (stored on blockchain)
app.post('/api/bank/commission', authenticateJWT, async (req, res) => {
    try {
        const { token_id, commission_percentage } = req.body || {};
        const bankUserId = req.user.username;
        
        if (!token_id || !token_id.trim()) {
            return res.status(400).json({
                success: false,
                error: 'token_id is required'
            });
        }
        
        if (commission_percentage === undefined || commission_percentage === null) {
            return res.status(400).json({
                success: false,
                error: 'commission_percentage is required'
            });
        }
        
        const percentage = parseFloat(commission_percentage);
        if (isNaN(percentage) || percentage < 0 || percentage > 100) {
            return res.status(400).json({
                success: false,
                error: 'commission_percentage must be a number between 0 and 100'
            });
        }
        
        const walletPath = path.join(process.cwd(), 'wallet');
        const config = await setTokenCommission(walletPath, bankUserId, token_id, percentage);
        
        res.json({
            success: true,
            message: `Commission rate configured successfully for token ${token_id}`,
            token_id: config.token_id,
            commission_percentage: config.commission_percentage,
            updated_at: config.updated_at
        });
    } catch (error) {
        console.error('Failed to set token commission:', error);
        res.status(500).json({
            success: false,
            error: 'Unable to set token commission',
            detail: error.message
        });
    }
});

// GET /api/bank/:tokenId/commission - Get commission rate for a token (from blockchain)
app.get('/api/bank/:tokenId/commission', async (req, res) => {
    try {
        const tokenId = req.params.tokenId;
        const { userId = 'admin' } = req.query;
        
        if (!tokenId || !tokenId.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Token ID is required'
            });
        }
        
        const walletPath = path.join(process.cwd(), 'wallet');
        const config = await getTokenCommission(walletPath, userId, tokenId);
        
        res.json({
            success: true,
            token_id: config.token_id,
            commission_percentage: config.commission_percentage,
            updated_at: config.updated_at || null,
            message: config.updated_at ? 'Commission configured' : 'No custom commission configured, using default rate of 0%'
        });
    } catch (error) {
        console.error('Failed to get token commission:', error);
        res.status(500).json({
            success: false,
            error: 'Unable to get token commission',
            detail: error.message
        });
    }
});

// (Removed) KYC result submission endpoint

// Transfer request endpoint allows JWT but can fall back to provided user identity
// Transfer request endpoints removed

// DEBUG: View raw token state (to check ForeignBalances directly)
app.get('/api/debug/token/:tokenID', async (req, res) => {
    try {
        const { tokenID } = req.params;
        const { userId = 'admin' } = req.query;
        const walletPath = path.join(process.cwd(), 'wallet');
        
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const gateway = new Gateway();
        const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
        
        await gateway.connect(ccp, {
            wallet,
            identity: userId,
            discovery: { enabled: true, asLocalhost: true }
        });
        
        const network = await gateway.getNetwork('mychannel');
        const contract = network.getContract('fabcar');
        
        try {
            const tokenBytes = await contract.evaluateTransaction('ReadToken', tokenID);
            const token = JSON.parse(tokenBytes.toString());
            
            res.json({
                success: true,
                tokenID,
                token: {
                    token_id: token.TokenID || token.token_id,
                    currency: token.Currency || token.currency,
                    minted_coins: token.Minted || token.minted_coins,
                    foreign_balances: token.ForeignBalances || token.foreign_balances || {},
                    raw_token: token
                }
            });
        } catch (readErr) {
            res.status(404).json({
                success: false,
                detail: `Token ${tokenID} not found: ${readErr.message}`
            });
        } finally {
            try { gateway.disconnect(); } catch (dErr) { console.warn('Gateway disconnect error:', dErr.message); }
        }
    } catch (error) {
        console.error('Debug token view error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Token-to-token transfer request
app.post('/api/token-transfer-request', authenticateJWT, async (req, res) => {
    try {
        const { senderTokenID, receiverTokenID, amount } = req.body;
        const callerId = getCallerFromJWT(req);
        const senderOwnerAddress = getNetworkAddressForUser(callerId);
        if (!senderOwnerAddress) {
            return res.status(400).json({
                success: false,
                detail: 'No registered network address for caller'
            });
        }
        if (!senderTokenID || !receiverTokenID || !amount) {
            return res.status(400).json({
                success: false,
                detail: 'senderTokenID, receiverTokenID, and amount are required'
            });
        }
        const parsedAmount = parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({
                success: false,
                detail: 'amount must be a positive number'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const resolvedUserId = callerId;

        console.log('Creating token transfer request with:', {
            senderTokenID,
            receiverTokenID,
            senderOwnerAddress,
            amount,
            resolvedUserId
        });

        const requestId = await createTokenTransferRequest(
            senderTokenID,
            receiverTokenID,
            senderOwnerAddress,
            parsedAmount,
            walletPath,
            resolvedUserId
        );

        res.json({
            success: true,
            request_id: requestId,
            message: 'Token transfer request created',
            transfer_details: {
                sender_token: senderTokenID,
                receiver_token: receiverTokenID,
                amount: parseFloat(amount),
                is_cross_token: senderTokenID !== receiverTokenID,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Token transfer request error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// View pending token transfer requests for receiver token owner
app.get('/api/token-transfer-requests/pending', async (req, res) => {
    try {
        const receiverTokenID = req.query.receiverTokenID || req.query.tokenID;
        const receiverOwnerAddress = req.query.receiverOwnerAddress || req.query.ownerAddress;
        const userId = req.query.userId || receiverOwnerAddress || 'admin';

        if (!receiverTokenID || !receiverOwnerAddress) {
            return res.status(400).json({
                success: false,
                detail: 'receiverTokenID and receiverOwnerAddress are required'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const pending = await viewPendingTokenTransferRequests(
            receiverTokenID,
            receiverOwnerAddress,
            walletPath,
            userId
        );

        res.json(Array.isArray(pending) ? pending : []);
    } catch (error) {
        console.error('View pending token transfer requests error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Create a cross-border transfer request (without FX conversion)
app.post('/api/customer-cross-border-transfer', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const {
            senderParticipantID,
            receiverParticipantID,
            senderTokenTransferID,
            receiverTokenTransferID,
            tokenID,
            toTokenID,
            amount
        } = req.body;

        if (!senderParticipantID || !receiverParticipantID || !senderTokenTransferID || !receiverTokenTransferID || !tokenID || !toTokenID || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: senderParticipantID, receiverParticipantID, senderTokenTransferID, receiverTokenTransferID, tokenID, toTokenID, amount'
            });
        }

        // Verify senderParticipantID belongs to the authenticated caller
        const callerNetworkAddress = getNetworkAddressForUser(caller);
        if (callerNetworkAddress && senderParticipantID !== callerNetworkAddress) {
            return res.status(403).json({
                success: false,
                detail: 'Forbidden: senderParticipantID does not match authenticated user'
            });
        }

        const sourceAmount = parseFloat(amount);
        if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'amount must be a positive number'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const resolvedUserId = caller;

        console.log('Creating cross-border transfer with:', {
            senderParticipantID,
            receiverParticipantID,
            tokenID,
            toTokenID,
            amount,
            resolvedUserId
        });

        // Fetch canonical token metadata to derive currencies on the server
        const allTokens = await viewAllTokens(walletPath, resolvedUserId);
        const tokensArray = Array.isArray(allTokens) ? allTokens : [];
        const sourceToken = tokensArray.find(t => t.token_id === tokenID);
        const targetToken = tokensArray.find(t => t.token_id === toTokenID);

        if (!sourceToken || !sourceToken.currency) {
            return res.status(400).json({
                success: false,
                error: `Source token ${tokenID} is missing or has no assigned currency`
            });
        }

        if (!targetToken || !targetToken.currency) {
            return res.status(400).json({
                success: false,
                error: `Target token ${toTokenID} is missing or has no assigned currency`
            });
        }

        // Server-side FX calculation; ignore any client-provided rates or amounts
        const sourceCurrency = sourceToken.currency;
        const targetCurrency = targetToken.currency;
        const fxRate = sourceCurrency === targetCurrency ? 1.0 : await getFXRate(sourceCurrency, targetCurrency);
        const feeAmount = sourceAmount * FX_FEE_PERCENTAGE;
        const targetAmount = sourceAmount * fxRate;

        // Call the transfer function with trusted, server-calculated FX values
        const transferRequestID = await createFXTransferRequest(
            senderParticipantID,
            receiverParticipantID,
            senderTokenTransferID,
            receiverTokenTransferID,
            tokenID,
            sourceAmount,
            targetAmount,
            sourceCurrency,
            targetCurrency,
            fxRate,
            feeAmount,
            walletPath,
            resolvedUserId
        );

        res.json({
            success: true,
            transfer_id: transferRequestID,
            message: 'Cross-border transfer request created successfully',
            transfer_details: {
                sender_token: tokenID,
                receiver_token: toTokenID,
                source_amount: sourceAmount,
                target_amount: parseFloat(targetAmount.toFixed(2)),
                fx_rate: fxRate,
                fee_amount: parseFloat(feeAmount.toFixed(2)),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Cross-border transfer request error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Approve token transfer request by receiver token owner (with FX commission)
app.post('/api/token-transfer-requests/:requestId/approve', async (req, res) => {
    try {
        const { requestId } = req.params;
        const { receiverOwnerAddress, fxCommission, userId } = req.body;
        if (!requestId || !receiverOwnerAddress) {
            return res.status(400).json({
                success: false,
                detail: 'requestId and receiverOwnerAddress are required'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const callerId = userId || receiverOwnerAddress;

        // If FX commission is provided, fetch full request details and calculate FX
        if (fxCommission !== undefined && fxCommission !== null && fxCommission !== '') {
            try {
                // Parse request to get token IDs and amount
                const { contract } = await connect(walletPath, callerId);
                const requestBytes = await contract.evaluateTransaction('ReadTokenTransferRequest', requestId);
                const request = JSON.parse(requestBytes.toString());

                const senderTokenID = request.SenderTokenID || request.sender_token_id;
                const receiverTokenID = request.ReceiverTokenID || request.receiver_token_id;
                const amount = request.Amount || request.amount;

                // Get all tokens to fetch currencies
                const allTokens = await viewAllTokens(walletPath, callerId);
                const senderToken = allTokens.find(t => t.token_id === senderTokenID);
                const receiverToken = allTokens.find(t => t.token_id === receiverTokenID);

                if (senderToken && receiverToken && senderToken.currency && receiverToken.currency) {
                    // Fetch FX rate
                    const fxRate = await getFXRate(senderToken.currency, receiverToken.currency);

                    // Calculate commission in USD
                    const commissionPercentage = parseFloat(fxCommission) / 100;
                    const commissionUSD = amount * commissionPercentage;
                    const netUSD = amount - commissionUSD;

                    // Calculate INR equivalent for net USD
                    const inrAmount = netUSD * fxRate;

                    console.log('FX Approval Details:', {
                        usdAmount: amount,
                        commissionPercentage: fxCommission,
                        commissionUSD: commissionUSD,
                        netUSD: netUSD,
                        fxRate: fxRate,
                        inrAmount: inrAmount,
                        senderCurrency: senderToken.currency,
                        receiverCurrency: receiverToken.currency
                    });

                    // Call approval with FX parameters
                    await approveTokenTransferRequestWithFX(
                        requestId,
                        receiverOwnerAddress,
                        fxRate.toString(),
                        inrAmount.toString(),
                        commissionUSD.toString(),
                        walletPath,
                        callerId
                    );

                    res.json({
                        success: true,
                        message: 'Token transfer request approved with FX conversion',
                        request_id: requestId,
                        fx_details: {
                            usd_amount: amount,
                            commission_percentage: fxCommission,
                            commission_usd: commissionUSD.toFixed(2),
                            net_usd: netUSD.toFixed(2),
                            fx_rate: fxRate,
                            inr_amount: inrAmount.toFixed(2)
                        }
                    });
                } else {
                    // Currencies not assigned, do simple approval
                    await approveTokenTransferRequest(requestId, receiverOwnerAddress, walletPath, callerId);
                    res.json({
                        success: true,
                        message: 'Token transfer request approved (no FX conversion - currencies not assigned)',
                        request_id: requestId
                    });
                }
            } catch (fxError) {
                console.warn('FX approval failed, attempting simple approval:', fxError.message);
                // Fallback to simple approval if FX calculation fails
                await approveTokenTransferRequest(requestId, receiverOwnerAddress, walletPath, callerId);
                res.json({
                    success: true,
                    message: 'Token transfer request approved (simple - FX calculation failed)',
                    request_id: requestId,
                    warning: fxError.message
                });
            }
        } else {
            // No FX commission provided, do simple approval
            await approveTokenTransferRequest(requestId, receiverOwnerAddress, walletPath, callerId);
            res.json({
                success: true,
                message: 'Token transfer request approved',
                request_id: requestId
            });
        }
    } catch (error) {
        console.error('Approve token transfer request error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Token-to-token transfer history endpoint
app.get('/api/token-transfer-history', async (req, res) => {
    try {
        const { tokenID, userId = 'admin' } = req.query;
        if (!tokenID) {
            return res.status(400).json({
                success: false,
                detail: 'tokenID is required'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const history = await listTokenToTokenTransferHistory(tokenID, walletPath, userId);
        res.json(Array.isArray(history) ? history : []);
    } catch (error) {
        console.error('Token-to-token history error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Token request endpoint (for bank dashboard)
app.post('/api/token-request', async (req, res) => {
    try {
        const { userId, name, networkAddress, country, currency } = req.body;
        console.log('Token request:', { userId, name, networkAddress, country, currency });

        if (!currency || !currency.trim()) {
            return res.status(400).json({
                success: false,
                detail: 'currency is required when submitting a token request'
            });
        }

        const normalizedCurrency = currency.trim().toUpperCase();

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const userIdentity = await wallet.get(userId);
        if (!userIdentity) {
            return res.status(400).json({
                success: false,
                error: `User '${userId}' not found in wallet. Please register the user first.`,
                message: 'User identity does not exist in wallet'
            });
        }

        let finalNetworkAddress = networkAddress;
        if (!finalNetworkAddress) {
            const registrationPath = path.join(__dirname, 'registrations', `${userId}.json`);
            if (fs.existsSync(registrationPath)) {
                try {
                    const storedData = JSON.parse(fs.readFileSync(registrationPath, 'utf8'));
                    finalNetworkAddress = storedData.networkAddress || finalNetworkAddress;
                } catch (snapshotError) {
                    console.log('Could not read stored registration snapshot:', snapshotError.message);
                }
            }
        }

        if (!finalNetworkAddress && userIdentity.credentials?.certificate) {
            const derivedIdentity = buildChaincodeIdentityFromCert(userIdentity.credentials.certificate);
            finalNetworkAddress = derivedIdentity?.chaincodeID || finalNetworkAddress;
        }

        if (!finalNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Unable to determine participant network address'
            });
        }

        // Only attempt on-chain registration if participant doesn't already exist
        let participantAlreadyRegistered = false;
        try {
            participantAlreadyRegistered = await participantExists(finalNetworkAddress, walletPath, userId);
        } catch (existsError) {
            console.log('participantExists check via user wallet failed, trying admin:', existsError.message);
            try {
                participantAlreadyRegistered = await participantExists(finalNetworkAddress, walletPath, 'admin');
            } catch (adminExistsError) {
                console.log('participantExists admin check failed:', adminExistsError.message);
            }
        }

        if (!participantAlreadyRegistered) {
            try {
                await submitWithRetry(
                    () => submitRegistration(userId, country, walletPath, userId),
                    3,
                    `SubmitRegistration for ${userId}`
                );
            } catch (regError) {
                if (regError.message && !(regError.message.includes('already registered') ||
                    regError.message.includes('already exists'))) {
                    console.log('Participant registration attempt failed:', regError.message);
                } else {
                    participantAlreadyRegistered = true;
                }
            }
        } else {
            console.log('Participant already registered. Skipping submitRegistration step.');
        }

        try {
            await submitWithRetry(
                () => requestTokenRequest(userId, finalNetworkAddress, country, normalizedCurrency, walletPath, userId),
                3,
                `RequestTokenRequest for ${userId}`
            );
            console.log('Token request submitted successfully to blockchain');
        } catch (error) {
            console.error('Token request failed:', error.message);
            return res.status(500).json({
                success: false,
                detail: `Token request failed: ${error.message}`
            });
        }

        res.json({
            success: true,
            message: 'Token request submitted to blockchain successfully',
            network_address: finalNetworkAddress,
            user_id: userId,
            currency: normalizedCurrency
        });
    } catch (error) {
        console.error('Token request error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Get pending token requests - Using app.js function
app.get('/api/token-requests/pending', async (req, res) => {
    try {
        console.log('Fetching pending token requests using app.js function');

        const walletPath = path.join(process.cwd(), 'wallet');
        const adminId = 'admin';

        // Use app.js function
        const pendingRequests = await getPendingTokenRequests(walletPath, adminId);
        console.log('Pending requests from app.js:', pendingRequests);

        let normalized = [];
        const normalizeEntry = req => ({
            request_id: req.request_id || req.RequestID || null,
            network_addr: req.network_addr || req.NetworkAddr || '',
            participant_address: req.participant_address || req.ParticipantAddress || '',
            caller_id: req.caller_id || req.CallerID || '',
            caller_msp: req.caller_msp || req.CallerMSP || '',
            status: req.status || req.Status || 'PENDING',
            token_id: req.token_id || req.TokenID || '',
            currency: req.currency || req.Currency || ''
        });

        if (Array.isArray(pendingRequests)) {
            normalized = pendingRequests.map(normalizeEntry);
        } else if (pendingRequests) {
            normalized = [normalizeEntry(pendingRequests)];
        }

        normalized = normalized.filter(item => item.request_id);

        console.log('Token requests (normalized raw data):', normalized);
        res.json(normalized);

    } catch (error) {
        console.error('Get pending token requests error:', error);
        res.status(500).json({
            error: 'Failed to fetch pending token requests from blockchain',
            message: error.message
        });
    }
});

// Get pending mint requests
// Dedicated endpoint for Admin Dashboard - Get pending mint requests
app.get('/api/admin/mint-requests/pending', async (req, res) => {
    try {
        console.log('Admin Dashboard: Fetching pending mint requests from blockchain via getPendingMintRequests function');

        const walletPath = path.join(process.cwd(), 'wallet');
        const adminId = req.query.adminId || 'admin';

        console.log(`Admin Dashboard: Using adminId: ${adminId}, walletPath: ${walletPath}`);

        // Call the exact getPendingMintRequests function from app.js
        const pendingRequests = await getPendingMintRequests(walletPath, adminId);

        console.log('Admin Dashboard: Pending mint requests from blockchain:', {
            count: pendingRequests?.length || 0,
            requests: pendingRequests
        });

        // Return exact blockchain data without additional wrapping
        res.json(pendingRequests || []);
    } catch (error) {
        console.error('Admin Dashboard: Get pending mint requests error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch pending mint requests from blockchain',
            message: error.message,
            data: []
        });
    }
});

// Legacy endpoint for backward compatibility
app.get('/api/mint-requests/pending', async (req, res) => {
    try {
        console.log('Legacy: Fetching pending mint requests from Fabric');

        const walletPath = path.join(process.cwd(), 'wallet');
        const adminId = 'admin';

        // Use real Fabric function
        const pendingRequests = await getPendingMintRequests(walletPath, adminId);
        console.log('Legacy: Pending mint requests from Fabric:', pendingRequests);

        res.json(pendingRequests);
    } catch (error) {
        console.error('Legacy: Get pending mint requests error:', error);
        res.status(500).json({
            error: 'Failed to fetch pending mint requests from blockchain',
            message: error.message
        });
    }
});

// Mint request endpoint - Using app.js requestMintCoins function
app.post('/api/mint-request', async (req, res) => {
    try {
        const { amount, userId, networkAddress } = req.body;
        console.log('Mint request submitted to Fabric:', { amount, userId, networkAddress });

        if (!amount || !userId || !networkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Missing required parameters: amount, userId, networkAddress'
            });
        }

        const parsedAmount = parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({
                success: false,
                detail: 'amount must be a positive number'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');

        console.log('Using requestMintCoins function from app.js with parameters:', {
            networkAddress,
            amount,
            walletPath,
            userId
        });

        await submitWithRetry(
            () => requestMintCoins(networkAddress, parsedAmount, walletPath, userId),
            3,
            `RequestMintCoins for ${userId}`
        );

        console.log('Mint request successfully submitted to blockchain via app.js function');

        res.json({
            success: true,
            message: 'Mint request submitted successfully to blockchain',
            request_details: {
                user_id: userId,
                network_address: networkAddress,
                amount: parseInt(amount)
            }
        });
    } catch (error) {
        console.error('Mint request error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Approve token requests
// Token owner approves token request - Restricted to admin for root tokens or token owner
app.post('/api/token-requests/:requestId/approve', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { requestId } = req.params;
        const { status, networkAddress: bodyNetworkAddress, network_addr: altNetworkAddr } = req.body;
        console.log('Approve token request:', { requestId, status });

        if (status === 'approved') {
            const walletPath = path.join(process.cwd(), 'wallet');
            const requestIdentifier = requestId || bodyNetworkAddress || altNetworkAddr;
            if (!requestIdentifier) {
                return res.status(400).json({
                    success: false,
                    detail: 'Missing request ID for approval'
                });
            }

            try {
                console.log('Approving token request:', requestIdentifier);
                console.log('Using admin identity to approve - blockchain already has all data');

                await submitWithRetry(
                    () => approveTokenRequest(requestIdentifier, walletPath, 'admin'),
                    3,
                    `ApproveTokenRequest for ${requestIdentifier}`
                );
                console.log('Token request approved successfully on blockchain!');

            } catch (approvalError) {
                console.error('Blockchain approval failed:', approvalError.message);
                console.log('This may be due to blockchain network issues or the request may already be processed');

                const noTokenAvailable = approvalError.message?.toLowerCase().includes('no tokens available');
                if (noTokenAvailable) {
                    try {
                        await ensureTokenPoolInitialized(walletPath);
                        console.log('Retrying token approval after initializing token pool...');
                        await submitWithRetry(
                            () => approveTokenRequest(requestIdentifier, walletPath, 'admin'),
                            3,
                            `ApproveTokenRequest (retry) for ${requestIdentifier}`
                        );
                        console.log('Token request approved successfully after initializing token pool');
                    } catch (recoveryError) {
                        console.error('Retry after token pool initialization failed:', recoveryError.message);
                        return res.status(500).json({
                            success: false,
                            detail: 'Blockchain approval failed: ' + recoveryError.message
                        });
                    }
                } else {
                    return res.status(500).json({
                        success: false,
                        detail: 'Blockchain approval failed: ' + approvalError.message
                    });
                }
            }
        }

        res.json({
            success: true,
            message: `Token request ${status} successfully`
        });
    } catch (error) {
        console.error('Approve token request error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Register endpoint (for participant registration)
app.post('/api/register', (req, res) => {
    try {
        const { userId, name, password, country } = req.body;
        console.log('Participant registration:', { userId, name, country });

        // Create network address (SHA256 hash of name)
        const networkAddress = crypto.createHash('sha256').update(name).digest('hex');

        res.json({
            success: true,
            networkAddress,
            message: 'Participant registered successfully'
        });
    } catch (error) {
        console.error('Participant registration error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// DEPRECATED: Wallet register user endpoint - redirects to proper auth/register
app.post('/api/wallet/register-user', (req, res) => {
    console.log('DEPRECATED ENDPOINT CALLED: /api/wallet/register-user');
    console.log('Frontend should use /api/auth/register instead');
    res.status(400).json({
        error: 'DEPRECATED_ENDPOINT',
        message: 'Please use /api/auth/register instead of /api/wallet/register-user',
        correct_endpoint: '/api/auth/register'
    });
});

// Bank wallet info endpoint
app.get('/api/bank/wallet', authenticateJWT, async (req, res) => {
    try {
        const { networkAddress } = req.query;
        const userId = req.user.username;
        console.log('Bank wallet info request:', {
            userId,
            networkAddress
        });

        let normalizedNetworkAddress;
        try {
            normalizedNetworkAddress = requireNetworkAddressForUser(userId, networkAddress);
        } catch (addrErr) {
            return res.status(400).json({
                success: false,
                detail: addrErr.message
            });
        }
        const walletPath = path.join(process.cwd(), 'wallet');
        const { Wallets } = require('fabric-network');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const userIdentity = await wallet.get(userId);

        if (!userIdentity) {
            console.log(`User '${userId}' not found in wallet - returning empty wallet`);
            res.json({
                wallet: {
                    wallet_balance: 0,
                    wallet_balance_display: '$0.00',
                    currency: null,
                    currency_symbol: '$',
                    token: null,
                    registration: {
                        status: 'not_registered',
                        message: `User '${userId}' not registered. Please register first.`,
                        created_at: new Date().toISOString()
                    },
                    network_address: normalizedNetworkAddress || ''
                }
            });
            return;
        }

        // Check participant existence on-chain before attempting to fetch wallet info
        const exists = await participantExists(normalizedNetworkAddress, walletPath, userId);
        if (!exists) {
            // User is not a participant, check if they own a token
            console.log('User is not a participant, checking if they own any tokens...');
            try {
                const tokens = await viewAllTokens(walletPath, userId);
                console.log('📊 Tokens returned:', tokens.length, 'tokens');
                if (tokens && tokens.length > 0) {
                    console.log('   First token object keys:', Object.keys(tokens[0]));
                    console.log('   First token full object:', JSON.stringify(tokens[0], null, 2).substring(0, 500));
                }
                const ownedTokens = Array.isArray(tokens) ? tokens.filter(t => {
                    const tokenOwner = t.owner || t.Owner;
                    const tokenId = t.token_id || t.TokenID;
                    const isOwned = tokenOwner && (tokenOwner === normalizedNetworkAddress || tokenOwner === userId);
                    console.log('  Checking token:', tokenId, '| owner:', tokenOwner, '| matches:', isOwned, '| full token keys:', Object.keys(t));
                    return isOwned;
                }) : [];
                console.log('✅ Owned tokens found:', ownedTokens.length);

                if (ownedTokens.length > 0) {
                    // User owns at least one token - fetch fresh data using GetTokenByID
                    const ownedToken = ownedTokens[0];
                    const tokenId = ownedToken.token_id || ownedToken.TokenID || ownedToken.id;
                    
                    console.log('✅ User also owns tokens:', ownedTokens.map(t => t.token_id || t.TokenID), '| Using first token:', tokenId, '- fetching fresh data...');
                    
                    // Get fresh token data from ledger to ensure ForeignBalances is current
                    let freshToken = ownedToken;
                    try {
                        console.log('🔄 About to fetch fresh token data for:', tokenId);
                        freshToken = await getTokenByID(walletPath, userId, tokenId);
                        console.log('✅ Fresh token data fetched:', { token_id: freshToken.token_id || freshToken.TokenID, foreign_balances: freshToken.foreign_balances || freshToken.ForeignBalances });
                    } catch (freshErr) {
                        console.log('❌ Could not fetch fresh token data:', freshErr.message);
                        console.log('Using cached token data instead');
                    }
                    
                    // Build foreign balances display
                    const foreignBalances = freshToken.foreign_balances || freshToken.ForeignBalances || {};
                    const foreignCurrencies = Object.entries(foreignBalances).map(([code, amount]) => ({
                        currency: code,
                        amount: amount,
                        display: formatCurrencyValue(code, amount),
                        currencySymbol: currencySymbol(code)
                    }));
                    
                    // Return token's wallet info directly
                    const tokenInfo = {
                        networkAddress: normalizedNetworkAddress,
                        tokenID: tokenId,
                        currency: freshToken.currency || freshToken.Currency || '',
                        currencySymbol: currencySymbol(freshToken.currency || freshToken.Currency || ''),
                        availableBalance: (freshToken.minted || 0),
                        availableBalanceDisplay: `${currencySymbol(freshToken.currency || '')}${(freshToken.minted || 0).toFixed(2)}`,
                        foreign_balances: foreignBalances,
                        foreignCurrencies: foreignCurrencies,
                        isTokenOwner: true
                    };
                    
                    return res.json(tokenInfo);
                } else {
                    // User is neither a participant nor a token owner
                    return res.json({
                        wallet: {
                            wallet_balance: 0,
                            wallet_balance_display: '$0.00',
                            currency: null,
                            currency_symbol: '$',
                            token: null,
                            registration: {
                                status: 'not_registered',
                                message: `User '${userId}' is neither a participant nor a token owner. Please register first.`,
                                created_at: new Date().toISOString()
                            },
                            network_address: normalizedNetworkAddress
                        }
                    });
                }
            } catch (tokenCheckErr) {
                console.log('Failed to check token ownership:', tokenCheckErr.message);
                return res.json({
                    wallet: {
                        wallet_balance: 0,
                        wallet_balance_display: '$0.00',
                        currency: null,
                        currency_symbol: '$',
                        token: null,
                        registration: {
                            status: 'not_registered',
                            message: `Participant '${userId}' not found on-chain. Please register again from the dashboard.`,
                            created_at: new Date().toISOString()
                        },
                        network_address: normalizedNetworkAddress
                    }
                });
            }
        }

        // CRITICAL FIX: Check if user also OWNS any tokens (even if they are a participant)
        // This handles participant-to-token transfers where receiver is the token owner
        console.log('🔍 Checking if user also owns any tokens (token owner check)...');
        try {
            const tokens = await viewAllTokens(walletPath, userId);
            console.log('📊 Token count:', tokens.length);
            const ownedTokens = Array.isArray(tokens) ? tokens.filter(t => {
                const tokenOwner = t.owner || t.Owner;
                const tokenId = t.token_id || t.TokenID;
                const isOwned = tokenOwner && (tokenOwner === normalizedNetworkAddress || tokenOwner === userId);
                console.log('  Checking token:', tokenId, '| owner:', tokenOwner, '| match:', isOwned);
                return isOwned;
            }) : [];
            
            if (ownedTokens.length > 0) {
                console.log('✅ User also owns tokens:', ownedTokens.map(t => t.token_id || t.TokenID));
                // Prioritize showing token owner wallet over participant wallet
                const ownedToken = ownedTokens[0];
                const tokenId = ownedToken.token_id || ownedToken.TokenID || ownedToken.id;
                
                let freshToken = ownedToken;
                try {
                    freshToken = await getTokenByID(walletPath, userId, tokenId);
                    console.log('✅ Fresh token data fetched for owned token:', { 
                        token_id: freshToken.token_id || freshToken.TokenID, 
                        minted: freshToken.minted || freshToken.Minted,
                        foreign_balances: freshToken.foreign_balances || freshToken.ForeignBalances 
                    });
                } catch (freshErr) {
                    console.log('⚠️ Could not fetch fresh token data for owned token:', freshErr.message);
                }
                
                // Build foreign balances display
                const foreignBalances = freshToken.foreign_balances || freshToken.ForeignBalances || {};
                const foreignCurrencies = Object.entries(foreignBalances).map(([code, amount]) => ({
                    currency: code,
                    amount: amount,
                    display: formatCurrencyValue(code, amount),
                    currencySymbol: currencySymbol(code)
                }));
                
                // Return token owner wallet info
                const tokenOwnerInfo = {
                    networkAddress: normalizedNetworkAddress,
                    tokenID: tokenId,
                    currency: freshToken.currency || freshToken.Currency || '',
                    currencySymbol: currencySymbol(freshToken.currency || freshToken.Currency || ''),
                    availableBalance: (freshToken.minted || freshToken.Minted || 0),
                    availableBalanceDisplay: `${currencySymbol(freshToken.currency || '')}${((freshToken.minted || freshToken.Minted || 0).toFixed(2))}`,
                    foreign_balances: foreignBalances,
                    foreignCurrencies: foreignCurrencies,
                    isTokenOwner: true
                };
                console.log('📊 Returning token owner wallet:', tokenOwnerInfo);
                return res.json(tokenOwnerInfo);
            }
        } catch (tokenCheckErr) {
            console.log('⚠️ Error checking for owned tokens:', tokenCheckErr.message);
            // Continue to check participant wallet
        }

        try {
            const walletInfo = await getWalletInfo(normalizedNetworkAddress, walletPath, userId);
            res.json(walletInfo);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            console.error('Bank wallet query error (mapped):', msg);
            if (msg.includes('not approved')) {
                return res.json({
                    wallet: {
                        wallet_balance: 0,
                        wallet_balance_display: '$0.00',
                        currency: null,
                        currency_symbol: '$',
                        token: null,
                        registration: {
                            status: 'pending_approval',
                            message: 'Participant is registered but pending admin approval.',
                            created_at: new Date().toISOString()
                        },
                        network_address: normalizedNetworkAddress
                    }
                });
            }
            if (msg.includes('has no token assigned') || msg.includes('token mismatch') || msg.includes('token not found')) {
                return res.json({
                    wallet: {
                        wallet_balance: 0,
                        wallet_balance_display: '$0.00',
                        currency: null,
                        currency_symbol: '$',
                        token: null,
                        registration: {
                            status: 'no_token_assigned',
                            message: 'Participant registered; token assignment/approval is pending.',
                            created_at: new Date().toISOString()
                        },
                        network_address: normalizedNetworkAddress
                    }
                });
            }
            if (msg.includes('unauthorized caller')) {
                return res.status(403).json({
                    success: false,
                    detail: 'Unauthorized: wallet identity does not match participant'
                });
            }
            throw err;
        }
    } catch (error) {
        console.error('Bank wallet error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Get token access endpoint (real Fabric query)
app.post('/api/bank/get-token-access', authenticateJWT, async (req, res) => {
    try {
        const { networkAddress } = req.body;
        const userId = req.user.username;
        console.log('Get token access request:', { userId, networkAddress });

        let normalizedNetworkAddress;
        try {
            normalizedNetworkAddress = requireNetworkAddressForUser(userId, networkAddress);
        } catch (addrErr) {
            return res.status(400).json({
                success: false,
                detail: addrErr.message
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        let ledgerTokenId = null;

        try {
            // Calls real chaincode GetTokenAccess which validates caller identity + approval
            ledgerTokenId = await getTokenAccess(normalizedNetworkAddress, walletPath, userId);
        } catch (fabricError) {
            console.error('Fabric GetTokenAccess error:', fabricError);
            return res.status(200).json({
                success: false,
                token_access: {
                    token_id: null,
                    network_address: normalizedNetworkAddress,
                    access_granted: false,
                    approved: false,
                    permissions: []
                },
                message: fabricError.message || 'Failed to verify token access on blockchain'
            });
        }

        const tokenAccess = {
            token_id: ledgerTokenId,
            network_address: normalizedNetworkAddress,
            access_granted: Boolean(ledgerTokenId),
            approved: Boolean(ledgerTokenId),
            permissions: ['mint', 'transfer', 'burn'],
            granted_at: new Date().toISOString()
        };

        // Enrich response with token metadata for currency check and display
        try {
            const tokens = await viewAllTokens(walletPath, userId);
            const matchedToken = Array.isArray(tokens)
                ? tokens.find(
                    t =>
                        t.token_id === ledgerTokenId ||
                        t.TokenID === ledgerTokenId ||
                        t.tokenID === ledgerTokenId
                )
                : null;

            if (matchedToken) {
                const currency = matchedToken.currency || matchedToken.Currency || null;
                tokenAccess.currency = currency;
                tokenAccess.token_display_id = matchedToken.display_token_id || ledgerTokenId;
                tokenAccess.assigned_at = matchedToken.assigned_at || matchedToken.AssignedAt || null;
            }
        } catch (metadataError) {
            console.warn('Unable to fetch token metadata for access response:', metadataError.message);
        }

        res.json({
            success: true,
            token_access: tokenAccess,
            message: tokenAccess.access_granted
                ? 'Token access verified on blockchain'
                : 'Token access not found for this wallet'
        });
    } catch (error) {
        console.error('Get token access error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Get pending customer registrations
app.get('/api/bank/customer-registrations/pending', async (req, res) => {
    try {
        // Accept both camelCase and snake_case parameters
        let tokenID = req.query.tokenID || req.query.tokenId;
        const customerAddress = req.query.customerAddress || req.query.customer_address;
        const walletPath = path.join(process.cwd(), 'wallet');

        let userId;
        let ownerNetworkAddress;
        try {
            ({ userId, ownerNetworkAddress } = getBankCallerContext(req));
        } catch (ctxErr) {
            return res.status(400).json({ success: false, error: ctxErr.message });
        }

        // Derive tokenID from assigned tokens if not provided
        if (!tokenID && userId) {
            try {
                const assigned = await listAssignedTokens(walletPath, userId);
                if (Array.isArray(assigned) && assigned.length > 0) {
                    const normalizeOwner = token =>
                        token.owner ||
                        token.Owner ||
                        token.owner_network_address ||
                        token.ownerNetworkAddress ||
                        null;
                    const normalizeTokenId = token =>
                        token.TokenID || token.tokenID || token.token_id || token.tokenId || null;

                    const ownedTokens = assigned.filter(token => normalizeOwner(token) === ownerNetworkAddress);
                    const selected = ownedTokens[0] || assigned.find(token => Boolean(normalizeTokenId(token)));

                    if (selected) {
                        tokenID = normalizeTokenId(selected) || tokenID;
                        console.log('Derived tokenID from assigned tokens:', {
                            tokenID,
                            ownerMatch: normalizeOwner(selected) === ownerNetworkAddress
                        });
                    }
                }
            } catch (deriveErr) {
                console.log('Could not derive tokenID from assigned tokens:', deriveErr.message);
            }
        }

        console.log('Fetching pending customer registrations from Fabric:', {
            tokenID,
            ownerNetworkAddress,
            customerAddress,
            userId
        });
        try {
            // If customer address is provided, we'll try multiple tokens
            if (customerAddress && !tokenID) {
                // Try to find registrations for this customer across tokens
                // For now, try common root tokens
                const commonTokens = ['1BNET-currency-ROOT-v1'];
                let allRegistrations = [];

                for (const token of commonTokens) {
                    try {
                        const regs = await viewPendingCustomerRegistrations(
                            token,
                            ownerNetworkAddress,
                            walletPath,
                            userId
                        );
                        if (Array.isArray(regs)) {
                            allRegistrations = allRegistrations.concat(regs);
                        }
                    } catch (err) {
                        // Continue to next token if this one fails
                        console.log(`Could not fetch registrations for ${token}:`, err.message);
                        continue;
                    }
                }

                console.log('Pending customer registrations across tokens:', allRegistrations);
                return res.json(allRegistrations);
            }

            // If no token ID provided and no customer address, return empty array
            if (!tokenID) {
                console.log('No tokenID or customerAddress provided, returning empty array');
                return res.json([]);
            }

            // Use real Fabric function with specific token
            let pendingRegistrations = [];
            try {
                const result = await viewPendingCustomerRegistrations(
                    tokenID,
                    ownerNetworkAddress,
                    walletPath,
                    userId
                );

                // Handle different response formats
                if (Array.isArray(result)) {
                    pendingRegistrations = result;
                } else if (result && typeof result === 'object') {
                    // If it's an object with data property
                    pendingRegistrations = result.data || result.registrations || [result];
                } else if (typeof result === 'string') {
                    // Try to parse if it's a string
                    try {
                        pendingRegistrations = JSON.parse(result);
                        if (!Array.isArray(pendingRegistrations)) {
                            pendingRegistrations = [pendingRegistrations];
                        }
                    } catch (parseErr) {
                        console.log('Could not parse result as JSON:', result);
                        pendingRegistrations = [];
                    }
                }

                console.log('Pending customer registrations from Fabric:', pendingRegistrations);
            } catch (fabricErr) {
                console.log('Error calling viewPendingCustomerRegistrations:', fabricErr.message);
                let errorDetail = fabricErr.message;
                if (fabricErr.message && fabricErr.message.includes('token not found')) {
                    errorDetail = 'Token not found on blockchain. Verify tokenID is correct.';
                } else if (fabricErr.message && fabricErr.message.includes('permission denied')) {
                    errorDetail = 'Permission denied. Only token owner can view registrations.';
                }
                return res.status(500).json({
                    success: false,
                    detail: `Failed to fetch pending customer registrations: ${errorDetail}`
                });
            }

            const normalized = Array.isArray(pendingRegistrations)
                ? pendingRegistrations.map(r => {
                    const { transfer_ids, transferIDs, ...rest } = r;
                    return {
                        ...rest,
                        kyc_id: (r.kyc_id || r.kycId) || '',
                        kyc_status: (r.kyc_status || r.kycStatus) || ''
                    };
                })
                : [];
            res.json(normalized);
        } catch (fabricError) {
            console.log('Fabric error:', fabricError.message);
            res.status(500).json({
                success: false,
                detail: `Failed to fetch pending customer registrations: ${fabricError.message}`
            });
        }
    } catch (error) {
        console.error('Get pending customer registrations error:', error);
        res.status(500).json({
            success: false,
            detail: 'Error fetching pending registrations: ' + error.message,
            help: 'Ensure tokenID and ownerNetworkAddress are provided and valid'
        });
    }
});

// List approved customer registrations for a token owner
app.get('/api/bank/customer-registrations/approved', async (req, res) => {
    try {
        const tokenID = req.query.tokenID || req.query.tokenId;
        let ownerNetworkAddress;
        let userId;
        try {
            ({ ownerNetworkAddress, userId } = getBankCallerContext(req));
        } catch (ctxErr) {
            return res.status(400).json({
                success: false,
                detail: ctxErr.message
            });
        }
        if (!tokenID) {
            return res.status(400).json({
                success: false,
                detail: 'tokenID is required',
                help: 'Provide tokenID (e.g., token_1)'
            });
        }
        const walletPath = path.join(process.cwd(), 'wallet');
        try {
            const approved = await listApprovedCustomers(tokenID, ownerNetworkAddress, walletPath, userId);
            const normalized = Array.isArray(approved)
                ? approved.map(r => ({
                    ...r,
                    kyc_id: (r.kyc_id || r.kycId) || '',
                    kyc_status: (r.kyc_status || r.kycStatus) || ''
                }))
                : [];
            res.json(normalized);
        } catch (fabricError) {
            console.error('Fabric list approved customers error:', fabricError.message);
            let errorDetail = fabricError.message;
            if (fabricError.message && fabricError.message.includes('token not found')) {
                errorDetail = 'Token not found on blockchain. Verify tokenID is correct.';
            } else if (fabricError.message && fabricError.message.includes('permission denied')) {
                errorDetail = 'Permission denied. Only token owner can view approved customers.';
            }
            res.status(500).json({
                success: false,
                detail: `Failed to fetch approved customers: ${errorDetail}`
            });
        }
    } catch (error) {
        console.error('List approved customer registrations error:', error);
        res.status(500).json({
            success: false,
            detail: 'Error fetching approved registrations: ' + error.message
        });
    }
});

// Approve customer registration
app.post('/api/bank/customer-registrations/:requestId/approve', authenticateJWT, async (req, res) => {
    try {
        const { requestId } = req.params;
        const { status } = req.body;

        // Authoritative bank identification from JWT
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);

        console.log('Approve customer registration by bank:', { requestId, status, bankUserId, ownerNetworkAddress });

        if (!requestId) {
            return res.status(400).json({
                success: false,
                error: 'Request ID is required',
                help: 'Provide the registration request ID from pending requests list'
            });
        }

        if (status !== 'approved' && status !== 'rejected') {
            return res.status(400).json({
                success: false,
                error: 'Status must be either "approved" or "rejected"'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const userId = bankUserId;

        try {
            // AUTHORIZATION: Verify that the registration request belongs to a token owned by this user
            // Fetch the registration request to check its token_id
            let registrationTokenId = null;
            try {
                const request = await queryChaincode(
                    walletPath,
                    userId,
                    'mychannel',
                    'fabcar',
                    'GetState',
                    [requestId]
                );
                if (request && request.TokenID) {
                    registrationTokenId = request.TokenID;
                }
            } catch (queryErr) {
                console.warn('Could not query registration request directly, proceeding:', queryErr?.message);
            }

            // Verify caller owns the token for this registration
            if (registrationTokenId && userId !== 'admin') {
                let userOwnedTokens = [];
                try {
                    const tokens = await listAssignedTokens(walletPath, userId);
                    if (Array.isArray(tokens)) {
                        userOwnedTokens = tokens.map(t => t.token_id || t.tokenID || t.tokenId);
                    }
                } catch (tokenErr) {
                    console.warn('Could not verify user token ownership:', tokenErr?.message);
                }

                if (userOwnedTokens.length > 0 && !userOwnedTokens.includes(registrationTokenId)) {
                    return res.status(403).json({
                        success: false,
                        detail: `Access denied. This customer registration belongs to token ${registrationTokenId}, which you do not own.`,
                        error: 'permission denied'
                    });
                }
            }

            // Call actual Fabric function to approve customer registration
            if (status === 'approved' && requestId && ownerNetworkAddress) {
                const result = await submitWithRetry(
                    () => approveCustomerRegistration(
                        requestId,
                        ownerNetworkAddress,
                        walletPath,
                        userId
                    ),
                    3,
                    `ApproveCustomerRegistration for ${requestId}`
                );
                console.log('Customer registration approved via Fabric:', result);
            }

            res.json({
                success: true,
                message: `Customer registration ${status} successfully`,
                request_id: requestId,
                status: status,
                approved_at: new Date().toISOString()
            });
        } catch (fabricError) {
            console.error('Fabric error during approval:', fabricError.message);
            let errorDetail = fabricError.message;
            if (fabricError.message && fabricError.message.includes('not found')) {
                errorDetail = 'Request not found. Check request ID and try again.';
            } else if (fabricError.message && fabricError.message.includes('already approved')) {
                errorDetail = 'Customer registration already approved.';
            } else if (fabricError.message && fabricError.message.includes('permission denied')) {
                errorDetail = 'Permission denied. Only token owner can approve registrations.';
            }
            res.status(500).json({
                success: false,
                message: `Failed to ${status} customer registration: ${errorDetail}`,
                request_id: requestId,
                status: status,
                error: fabricError.message
            });
        }
    } catch (error) {
        console.error('Approve customer registration error:', error);
        res.status(500).json({
            success: false,
            detail: 'Error approving registration: ' + error.message,
            help: 'Verify request ID and network address are correct'
        });
    }
});

// Get pending customer mint requests
app.get('/api/bank/customer-mint-requests/pending', authenticateJWT, async (req, res) => {
    try {
        // Accept both camelCase and snake_case parameters
        let tokenID = req.query.tokenID || req.query.tokenId || '';

        // Resolve bank identity from JWT
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);

        console.log('Fetching pending customer mint requests for bank:', { tokenID, ownerNetworkAddress, bankUserId });

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found for this user. Please register the bank wallet first.'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const resolvedUserId = bankUserId;
        const userId = resolvedUserId;

        try {
            // If tokenID not provided, fetch it from the bank's participant record
            if (!tokenID) {
                try {
                    tokenID = await getTokenAccess(ownerNetworkAddress, walletPath, userId);
                    console.log('Fetched bank tokenID:', tokenID);
                } catch (getTokenErr) {
                    console.warn('Could not auto-fetch tokenID:', getTokenErr.message);
                    // Continue without tokenID - the chaincode will filter by owner only
                }
            }

            // Use real Fabric function
            let pendingMintRequests = [];
            try {
                const result = await viewPendingCustomerMintRequests(
                    tokenID,
                    ownerNetworkAddress,
                    walletPath,
                    userId
                );

                // Handle different response formats
                if (Array.isArray(result)) {
                    pendingMintRequests = result;
                } else if (result && typeof result === 'object') {
                    // If it's an object with data property
                    pendingMintRequests = result.data || result.requests || [result];
                } else if (typeof result === 'string') {
                    // Try to parse if it's a string
                    try {
                        pendingMintRequests = JSON.parse(result);
                        if (!Array.isArray(pendingMintRequests)) {
                            pendingMintRequests = [pendingMintRequests];
                        }
                    } catch (parseErr) {
                        console.log('Could not parse result as JSON:', result);
                        pendingMintRequests = [];
                    }
                }

                console.log('Pending customer mint requests from Fabric:', pendingMintRequests);
            } catch (fabricErr) {
                console.log('Error calling viewPendingCustomerMintRequests:', fabricErr.message);
                let errorDetail = fabricErr.message;
                if (fabricErr.message && fabricErr.message.includes('token not found')) {
                    errorDetail = 'Token not found on blockchain. Verify tokenID is correct.';
                } else if (fabricErr.message && fabricErr.message.includes('permission denied')) {
                    errorDetail = 'Permission denied. Only token owner can view mint requests.';
                }
                return res.status(500).json({
                    success: false,
                    detail: `Failed to fetch pending customer mint requests: ${errorDetail}`
                });
            }

            const normalized = Array.isArray(pendingMintRequests)
                ? pendingMintRequests.map(req => ({
                    ...req,
                    customer_id: req.customer_id || req.CustomerID || req.customerId || req.requested_by_name || '',
                    name: req.name || req.customer_name || '',
                    kyc_id: (req.kyc_id || req.kycId) || '',
                    kyc_status: (req.kyc_status || req.kycStatus) || '',
                    token_id: req.token_id || req.tokenId || req.TokenID || req.tokenID || ''
                }))
                : [];
            res.json(normalized);
        } catch (fabricError) {
            console.log('Fabric error:', fabricError.message);
            res.status(500).json({
                success: false,
                detail: `Failed to fetch pending customer mint requests: ${fabricError.message}`
            });
        }
    } catch (error) {
        console.error('Get pending customer mint requests error:', error);
        res.status(500).json({
            success: false,
            detail: 'Error fetching pending mint requests: ' + error.message,
            help: 'Ensure the bank wallet is registered so the owner network address can be resolved'
        });
    }
});// Approve customer mint request
app.post('/api/bank/customer-mint-requests/:requestId/approve', authenticateJWT, async (req, res) => {
    try {
        const { requestId } = req.params;
        const { status, tokenID } = req.body;

        // Resolve bank identity from JWT
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);

        console.log('Approve customer mint request by bank:', { requestId, status, tokenID, ownerNetworkAddress });

        if (!requestId) {
            return res.status(400).json({
                success: false,
                error: 'Request ID is required',
                help: 'Provide the mint request ID from pending requests list'
            });
        }

        if (status !== 'approved' && status !== 'rejected') {
            return res.status(400).json({
                success: false,
                error: 'Status must be either "approved" or "rejected"'
            });
        }

        // Validate tokenID format if provided
        if (tokenID && tokenID.toUpperCase() === tokenID && !tokenID.startsWith('token_')) {
            console.warn('WARNING: tokenID appears to be a currency code, not token ID');
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const userId = bankUserId;

        try {
            // Call actual Fabric function to approve customer mint request
            if (status === 'approved' && requestId && ownerNetworkAddress) {
                const result = await submitWithRetry(
                    () => approveCustomerMint(
                        requestId,
                        ownerNetworkAddress,
                        walletPath,
                        userId
                    ),
                    3,
                    `ApproveCustomerMint for ${requestId}`
                );
                console.log('Customer mint request approved via Fabric:', result);
            }

            res.json({
                success: true,
                message: `Customer mint request ${status} successfully`,
                request_id: requestId,
                status: status,
                approved_at: new Date().toISOString()
            });
        } catch (fabricError) {
            console.error('Fabric error during approval:', fabricError.message);
            let errorDetail = fabricError.message;
            if (fabricError.message && fabricError.message.includes('not found')) {
                errorDetail = 'Mint request not found. Check request ID and try again.';
            } else if (fabricError.message && fabricError.message.includes('already approved')) {
                errorDetail = 'Mint request already approved.';
            } else if (fabricError.message && fabricError.message.includes('customer not registered')) {
                errorDetail = 'Customer not registered or approved for this token.';
            } else if (fabricError.message && fabricError.message.includes('permission denied')) {
                errorDetail = 'Permission denied. Only token owner can approve mint requests.';
            }
            res.status(500).json({
                success: false,
                message: `Failed to ${status} customer mint request: ${errorDetail}`,
                request_id: requestId,
                status: status,
                error: fabricError.message
            });
        }
    } catch (error) {
        console.error('Approve customer mint request error:', error);
        res.status(500).json({
            success: false,
            detail: 'Error approving mint request: ' + error.message,
            help: 'Verify request ID and network address are correct'
        });
    }
});

// Bank mint request endpoint - Submit new mint request
app.post('/api/bank/request-mint', async (req, res) => {
    try {
        const { amount, reason, networkAddress, tokenID, userId: bodyUserId } = req.body;
        console.log('Customer mint request:', { amount, reason, networkAddress, tokenID, userId: bodyUserId });

        // SECURITY FIX: Verify authentication - user must be logged in
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Missing or invalid authorization header'
            });
        }

        // Extract JWT token
        const token = authHeader.substring('Bearer '.length);
        try {
            // Verify token signature (if JWT secret is configured)
            jwt.verify(token, process.env.JWT_SECRET || 'fabric-jwt-secret');
        } catch (tokenErr) {
            console.error('JWT verification failed:', tokenErr.message);
            return res.status(401).json({
                error: 'Invalid or expired authentication token'
            });
        }

        // SECURITY FIX: Validate amount is a positive number
        const numAmount = parseInt(amount);
        if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({
                error: 'Amount must be a positive number'
            });
        }

        if (!tokenID) {
            return res.status(400).json({
                error: 'Missing required fields: amount, tokenID'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        let resolvedNetworkAddress;
        try {
            resolvedNetworkAddress = requireNetworkAddressForUser(bodyUserId, networkAddress);
        } catch (addrErr) {
            return res.status(400).json({
                success: false,
                error: addrErr.message
            });
        }
        const userId = bodyUserId;

        try {
            // Validate that tokenID is not a currency code (should be BNET- or bank format)
            if (tokenID.toUpperCase() === tokenID && !tokenID.startsWith('BNET-') && !tokenID.includes('-ROOT-v1')) {
                console.warn('WARNING: tokenID appears to be a currency code, not a token ID. Expected format: 1BNET-currency-ROOT-v1 or HDFC-USD-8f2a3b4c-v1');
            }

            // Use Fabric function: customerRequestMint(networkAddress, tokenID, amount, walletPath, userId)
            const result = await submitWithRetry(
                () => customerRequestMint(
                    resolvedNetworkAddress,
                    tokenID,
                    numAmount,
                    walletPath,
                    userId
                ),
                3,
                `CustomerRequestMint for ${userId}`
            );

            console.log('Customer mint request submitted to blockchain:', result);

            res.json({
                success: true,
                message: 'Mint request submitted successfully',
                amount: amount,
                reason: reason,
                tokenID: tokenID,
                networkAddress: resolvedNetworkAddress,
                submitted_at: new Date().toISOString()
            });
        } catch (fabricError) {
            console.error('Fabric customer mint request error:', fabricError.message);

            // Provide helpful error messages
            let errorMessage = fabricError.message;
            if (errorMessage.includes('customer not registered or approved for token')) {
                errorMessage = 'Customer is not registered or approved for this token. Please ensure: 1) Customer has registered for the currency, 2) Bank has approved the registration.';
            } else if (errorMessage.includes('token not found')) {
                errorMessage = 'Token not found. Please verify the token ID is correct.';
            }

            res.status(500).json({
                success: false,
                error: errorMessage
            });
        }
    } catch (error) {
        console.error('Bank request mint error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// Bank mint requests history endpoint - Get mint request history
app.get('/api/bank/mint-requests', async (req, res) => {
    try {
        console.log('Fetching bank mint requests history');

        const walletPath = path.join(process.cwd(), 'wallet');
        const adminId = 'admin';

        try {
            // Use real Fabric function to get pending mint requests
            const pendingRequests = await getPendingMintRequests(walletPath, adminId);

            console.log('Mint requests from blockchain:', pendingRequests);

            // Parse the result if it's a string
            let requestsList = [];
            if (pendingRequests && pendingRequests.result) {
                try {
                    requestsList = JSON.parse(pendingRequests.result);
                } catch (parseError) {
                    console.log('Result not JSON, using as is:', pendingRequests.result);
                    requestsList = pendingRequests.result;
                }
            } else if (Array.isArray(pendingRequests)) {
                requestsList = pendingRequests;
            }

            res.json(requestsList || []);
        } catch (fabricError) {
            console.error('Fabric get mint requests error:', fabricError.message);
            return res.status(500).json({
                success: false,
                detail: `Failed to fetch mint requests: ${fabricError.message}`
            });
        }
    } catch (error) {
        console.error('Bank mint requests fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch mint requests: ' + error.message
        });
    }
});

// Admin: Initialize/Reset root tokens
// Admin initializes root tokens - RESTRICTED to admin
app.post('/api/admin/init-root-tokens', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user?.username;
        if (caller !== 'admin') {
            return res.status(403).json({ success: false, detail: 'Access denied: Requires admin identity' });
        }
        console.log('Initializing root tokens...');

        const walletPath = path.join(process.cwd(), 'wallet');
        const adminId = 'admin';

        const result = await initRootTokens(walletPath, adminId);

        console.log('Root tokens initialized:', result);
        res.json({
            success: true,
            message: result
        });
    } catch (error) {
        console.error('Init root tokens error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initialize root tokens: ' + error.message
        });
    }
});

// KYC: submit anchor
// KYC endpoints removed (demo cleanup)

// KYC owner registration and publish endpoints removed (demo cleanup)

// Bank view all tokens endpoint (now returns only assigned/approved tokens)
app.get('/api/bank/view-all-tokens', async (req, res) => {
    try {
        console.log('Fetching available currencies for customer selection');

        const walletPath = path.join(process.cwd(), 'wallet');
        const adminId = 'admin';

        try {
            // Get simplified currency data
            const currencies = await viewAvailableCurrencies(walletPath, adminId);

            console.log('Available currencies fetched:', currencies);
            res.json(currencies || []);
        } catch (fabricError) {
            console.error('Fabric get available currencies error:', fabricError.message);
            return res.status(500).json({
                success: false,
                detail: `Failed to fetch available currencies: ${fabricError.message}`
            });
        }
    } catch (error) {
        console.error('Get available currencies error:', error);
        res.status(500).json({
            error: 'Failed to fetch available currencies: ' + error.message
        });
    }
});

// List assigned tokens (admin)
app.get('/api/bank/assigned-tokens', async (req, res) => {
    try {
        const { userId = 'admin' } = req.query;
        const walletPath = path.join(process.cwd(), 'wallet');
        const assigned = await listAssignedTokens(walletPath, userId);
        res.json(Array.isArray(assigned) ? assigned : []);
    } catch (error) {
        console.error('List assigned tokens error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// List tokens owned by a specific network address
app.get('/api/bank/tokens/owned', async (req, res) => {
    try {
        const { ownerNetworkAddress, userId = 'admin' } = req.query;
        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                error: 'ownerNetworkAddress is required'
            });
        }
        const walletPath = path.join(process.cwd(), 'wallet');
        const assigned = await listAssignedTokens(walletPath, userId);
        const tokens = (Array.isArray(assigned) ? assigned : []).filter(
            token => token.owner === ownerNetworkAddress
        );
        res.json({
            success: true,
            owner: ownerNetworkAddress,
            count: tokens.length,
            tokens
        });
    } catch (error) {
        console.error('Owned tokens lookup error:', error);
        res.status(500).json({
            success: false,
            error: 'Unable to fetch owned tokens',
            detail: error.message
        });
    }
});

// List approved participants (use approved customer mint requests to surface participant names/kyc)
app.get('/api/bank/participants/approved', async (req, res) => {
    try {
        const extractCN = id => {
            if (!id || typeof id !== 'string') return '';
            const match = id.match(/CN=([^,\\/]+)/i);
            if (match && match[1]) return match[1];
            const lastSlash = id.lastIndexOf('/');
            return lastSlash >= 0 ? id.slice(lastSlash + 1) : '';
        };

        const { networkAddress } = req.query;
        const walletPath = path.join(process.cwd(), 'wallet');

        // Resolve caller; if it fails, default to admin
        let ownerNetworkAddress = null;
        let userId = 'admin';
        try {
            ({ ownerNetworkAddress, userId } = getBankCallerContext(req));
        } catch (ctxErr) {
            console.warn('Approved participants: caller context failed, using admin:', ctxErr?.message || ctxErr);
        }

        const merged = [];
        // Primary source: approved mint requests (caller then admin) – matches the data that includes participant names
        let mintRecords = [];
        try {
            mintRecords = await listApprovedParticipantMintRequests(walletPath, userId);
            console.log(`Approved participants: Got ${Array.isArray(mintRecords) ? mintRecords.length : 0} mint records from ${userId}:`, mintRecords);
        } catch (callerErr) {
            console.log(`Approved participants: Chaincode call as ${userId} failed:`, callerErr?.message || callerErr);
            if (userId !== 'admin') {
                console.warn(`Approved participants: mint lookup as ${userId} failed, retrying as admin:`, callerErr?.message || callerErr);
                try {
                    mintRecords = await listApprovedParticipantMintRequests(walletPath, 'admin');
                    console.log(`Approved participants: Got ${Array.isArray(mintRecords) ? mintRecords.length : 0} mint records from admin:`, mintRecords);
                } catch (adminErr) {
                    console.warn('Approved participants: admin mint lookup failed:', adminErr?.message || adminErr);
                }
            } else {
                console.warn('Approved participants: mint lookup as admin failed:', callerErr?.message || callerErr);
            }
        }
        
        // FALLBACK: If no mint records found, try querying all approved customers directly
        if ((!mintRecords || mintRecords.length === 0) && userId) {
            console.log('Approved participants: No mint records found, trying listAllApprovedCustomers as fallback...');
            try {
                const approvedCustomers = await listAllApprovedCustomers(walletPath, userId);
                console.log(`Approved participants: Got ${Array.isArray(approvedCustomers) ? approvedCustomers.length : 0} approved customers from listAllApprovedCustomers:`, approvedCustomers);
                
                // Convert approved customers to the mint request format
                if (Array.isArray(approvedCustomers) && approvedCustomers.length > 0) {
                    approvedCustomers.forEach(c => {
                        const mintReq = {
                            requested_by: c.network_address || c.NetworkAddress,
                            RequestedBy: c.network_address || c.NetworkAddress,
                            name: c.name || c.Name,
                            Name: c.name || c.Name,
                            token_id: c.token_id || c.TokenID,
                            TokenID: c.token_id || c.TokenID,
                            kyc_id: c.kyc_id || c.KYCID,
                            KYCID: c.kyc_id || c.KYCID,
                            kyc_status: c.kyc_status || c.KYCStatus,
                            KYCStatus: c.kyc_status || c.KYCStatus,
                            approved: c.approved || c.Approved,
                            Approved: c.approved || c.Approved
                        };
                        mintRecords.push(mintReq);
                    });
                    console.log(`Approved participants: Converted ${approvedCustomers.length} customers to mint format`);
                }
            } catch (fallbackErr) {
                console.warn('Approved participants: listAllApprovedCustomers fallback also failed:', fallbackErr?.message || fallbackErr);
            }
        }
        
        (Array.isArray(mintRecords) ? mintRecords : []).forEach(m => {
            const netAddr = m.requested_by || m.RequestedBy || '';
            const regUser = resolveIdentityFromNetworkAddress(netAddr);
            const cnFallback = extractCN(netAddr);
            merged.push({
                name: m.name || m.Name || regUser || cnFallback,
                network_address: netAddr,
                token_id: m.token_id || m.TokenID || m.tokenId || '',
                kyc_id: m.kyc_id || m.KYCID || '',
                kyc_status: m.kyc_status || m.KYCStatus || '',
                approved_at: m.approved_at || m.ApprovedAt || '',
                transfer_ids: [],
                token_transfer_ids: []
            });
        });

        console.log(`Approved participants: returned=${merged.length}, mints_used=${Array.isArray(mintRecords) ? mintRecords.length : 0}, owner=${ownerNetworkAddress || 'admin/default'}`);

        // Deduplicate by network_address + token_id, prefer richer entries
        const seen = new Map();
        const deduped = [];
        const score = entry => {
            let s = 0;
            if (entry.kyc_id) s += 2;
            if (entry.kyc_status) s += 2;
            if (entry.name) s += 1;
            if (entry.transfer_ids && entry.transfer_ids.length) s += 1;
            if (entry._mintNamePreferred) s += 10;
            return s;
        };
        for (const entry of merged) {
            const key = `${entry.network_address || ''}::${entry.token_id || ''}`;
            const existingIdx = seen.get(key);
            if (existingIdx === undefined) {
                seen.set(key, deduped.length);
                deduped.push(entry);
            } else if (score(entry) > score(deduped[existingIdx])) {
                deduped[existingIdx] = entry;
            }
        }

        // Strip internal flags
        const cleaned = deduped.map(({ _mintNamePreferred, ...rest }) => rest);

        // ============================================
        // AUTHORIZATION: Filter by token ownership
        // ============================================
        // Get caller's owned tokens to determine what they can see
        let callerOwnedTokens = [];
        if (userId && userId !== 'admin') {
            try {
                const tokens = await listAssignedTokens(walletPath, userId);
                if (Array.isArray(tokens)) {
                    callerOwnedTokens = tokens.map(t => t.token_id || t.tokenID || t.tokenId);
                    console.log(`Approved participants: Caller ${userId} owns tokens:`, callerOwnedTokens);
                }
            } catch (tokenErr) {
                console.warn(`Approved participants: Failed to get caller's owned tokens:`, tokenErr?.message || tokenErr);
            }
        }

        // If caller is not admin and owns tokens, filter to ONLY show their own token's customers
        let filtered = cleaned;
        if (userId !== 'admin' && callerOwnedTokens.length > 0) {
            const beforeCount = cleaned.length;
            filtered = cleaned.filter(c => callerOwnedTokens.includes(c.token_id));
            console.log(`Approved participants: Authorization filtered ${beforeCount} → ${filtered.length} (only ${userId}'s tokens)`);
        } else if (userId === 'admin') {
            console.log(`Approved participants: Admin ${userId} can view all tokens`);
        }
        
        console.log(`Approved participants: After authorization - merged.length=${merged.length}, deduped.length=${deduped.length}, cleaned.length=${cleaned.length}, filtered.length=${filtered.length}`);
        
        // Return the data directly
        res.json(filtered);
    } catch (error) {
        console.error('List approved participants error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Approved participant mint requests - filtered to the caller's token ownership
app.get('/api/participant-mint-requests/approved', async (req, res) => {
    try {
        let ownerNetworkAddress;
        let userId;
        try {
            ({ ownerNetworkAddress, userId } = getBankCallerContext(req));
        } catch (ctxErr) {
            return res.status(400).json({
                success: false,
                detail: ctxErr.message
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');

        // Build token -> owner map to filter requests (using assigned tokens; fallback to admin)
        let tokenOwnerMap = new Map();
        const collectTokens = async (label, caller) => {
            try {
                const tokens = await listAssignedTokens(walletPath, caller);
                if (Array.isArray(tokens)) {
                    tokens.forEach(t => {
                        const tokenId = t.token_id || t.tokenID || t.tokenId || t.TokenID;
                        const owner = t.owner || t.Owner;
                        if (tokenId && owner) {
                            tokenOwnerMap.set(tokenId, owner);
                        }
                    });
                    console.log(`participant-mint-requests/approved: mapped ${tokenOwnerMap.size} tokens via ${label}`);
                }
            } catch (tokenErr) {
                console.warn(`participant-mint-requests/approved: unable to build token map via ${label}:`, tokenErr?.message || tokenErr);
            }
        };
        await collectTokens('caller', userId);
        if (!tokenOwnerMap.size) {
            await collectTokens('admin', 'admin');
        }

        const approved = await listApprovedParticipantMintRequests(walletPath, userId);
        const normalized = Array.isArray(approved)
            ? approved
                .filter(req => {
                    const tokenId = req.token_id || req.tokenID || req.TokenID || req.tokenId;
                    if (!tokenId) return false;
                    const owner = tokenOwnerMap.get(tokenId);
                    return owner ? owner === ownerNetworkAddress : true; // if map missing, keep for compatibility
                })
                .map(req => ({
                    ...req,
                    customer_id: req.customer_id || req.CustomerID || req.customerId || req.requested_by_name || '',
                    name: req.name || req.customer_name || '',
                    kyc_id: (req.kyc_id || req.kycId) || '',
                    kyc_status: (req.kyc_status || req.kycStatus) || ''
                }))
            : [];
        res.json(normalized);
    } catch (error) {
        console.error('Approved participant mint requests error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Approved mint requests endpoint
app.get('/api/mint-requests/approved', async (req, res) => {
    try {
        const { userId = 'admin' } = req.query;
        const walletPath = path.join(process.cwd(), 'wallet');
        const approved = await getApprovedMintRequests(walletPath, userId);
        res.json(Array.isArray(approved) ? approved : []);
    } catch (error) {
        console.error('Approved mint requests error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

async function processBankCustomerRegistration(req, res, options = {}) {
    try {
        const { tokenOverride, warnDeprecated } = options;
        const {
            networkAddress,
            name,
            tokenID,
            customerId,
            kycId,
            kycStatus,
            userId
        } = req.body || {};

        if (warnDeprecated) {
            console.warn('Deprecated endpoint /api/token/:tokenId/customers/register invoked. Please migrate to /api/bank/register-customer.');
        }

        const resolvedTokenID = tokenOverride || tokenID;

        if (!networkAddress || !resolvedTokenID) {
            return res.status(400).json({
                error: 'networkAddress and tokenID are required',
                help: 'Provide: networkAddress (customer blockchain identity) and tokenID (e.g., token_1)'
            });
        }
        if (!name && !customerId) {
            return res.status(400).json({
                error: 'name or customerId is required',
                help: 'Provide a display name or your internal customerId'
            });
        }

        // Allow ONLY JWT auth (removed insecure API Key check which relied on public key equality)
        const hasJwtAuth = !!req.user;
        if (!hasJwtAuth) {
            return res.status(401).json({
                error: 'Authorization token missing',
                help: 'Provide JWT auth token'
            });
        }

        const walletPath = path.resolve(__dirname, 'wallet');
        const resolvedCustomerId = customerId || name;
        const resolvedInvoker = req.requestedIdentity || userId || 'admin';
        // Optionally force an owner/system identity for customer upserts so customers can initiate without owner JWT
        const forcedOwnerInvoker = process.env.FABRIC_TOKEN_OWNER_USER || process.env.FABRIC_SERVICE_USER || null;
        const upsertInvoker = forcedOwnerInvoker || resolvedInvoker;
        const interpretedStatus = kycStatus === undefined ? '' : interpretKYCStatus(kycStatus);
        const autoApprove = String(process.env.BANK_REGISTER_CUSTOMER_AUTO_APPROVE || 'false').toLowerCase() === 'true';

        // Ensure the invoker identity actually exists in the wallet
        try {
            const wallet = await Wallets.newFileSystemWallet(walletPath);
            const invokerIdentity = await wallet.get(resolvedInvoker);
            console.log('Register-customer: walletPath=', walletPath, 'resolvedInvoker=', resolvedInvoker, 'identityFound=', !!invokerIdentity);
            if (!invokerIdentity) {
                return res.status(404).json({
                    error: 'Invoker identity not found in wallet',
                    detail: `Identity ${resolvedInvoker} not found in wallet at ${walletPath}`
                });
            }
        } catch (err) {
            console.error('Error checking wallet identity:', err && err.message ? err.message : err);
            return res.status(500).json({ error: 'Failed to access wallet', detail: err.message || String(err) });
        }

        try {
            if (autoApprove) {
                await upsertCustomerFromBank(
                    networkAddress,
                    resolvedCustomerId,
                    resolvedTokenID,
                    kycId || '',
                    interpretedStatus || '',
                    walletPath,
                    upsertInvoker
                );
                return res.json({
                    success: true,
                    mode: 'auto',
                    message: 'Customer recorded and approved automatically',
                    networkAddress,
                    tokenID: resolvedTokenID,
                    kycId: kycId || null,
                    kycStatus: interpretedStatus || ''
                });
            }

            await submitWithRetry(
                () => registerCustomer(
                    networkAddress,
                    resolvedCustomerId,
                    resolvedTokenID,
                    walletPath,
                    upsertInvoker,
                    kycId || '',
                    interpretedStatus || ''
                ),
                3,
                `RegisterCustomer for ${resolvedCustomerId}`
            );
            return res.json({
                success: true,
                mode: 'pending',
                message: 'Customer registration submitted for approval',
                networkAddress,
                tokenID: resolvedTokenID,
                kycId: kycId || null,
                kycStatus: interpretedStatus || ''
            });
        } catch (fabricError) {
            console.error('Upsert customer error:', fabricError);
            return res.status(500).json({
                error: 'Failed to store customer on blockchain: ' + fabricError.message,
                help: 'Verify token ID and network address are correct'
            });
        }
    } catch (error) {
        console.error('Bank register customer error:', error);
        res.status(500).json({
            error: 'Internal server error: ' + error.message
        });
    }
}

// [NEW] Secure Proxy: Fetch customer details from the SPECIFIC bank database linked to the token
app.get('/api/bank/customer-details', authenticateJWT, async (req, res) => {
    try {
        const { tokenID, customerID } = req.query;

        if (!tokenID || !customerID) {
            return res.status(400).json({ success: false, error: 'Missing tokenID or customerID' });
        }

        // 1. Dynamic Config Lookup: Find "Which Bank?" based on the Token ID
        // This solves the multi-tenant requirement: different tokens -> different banks/databases.
        const bankConfig = getBankTokenConfig(tokenID);

        if (!bankConfig || !bankConfig.bank_api_base_url || !bankConfig.bank_auth_key) {
            return res.status(404).json({
                success: false,
                error: `No bank configuration found for token: ${tokenID}. Cannot connect to bank database.`
            });
        }

        console.log(`Proxying customer lookup for Token ${tokenID} to Bank API: ${bankConfig.bank_api_base_url}`);

        // 2. Secure Call: Use the specific Bank's API Key
        const bankUrl = new URL(`/between/customer/${customerID}`, bankConfig.bank_api_base_url);
        const response = await fetch(bankUrl.toString(), {
            method: 'GET',
            headers: {
                'x-bank-api-key': bankConfig.bank_auth_key,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            console.warn('Bank API Error:', data);
            return res.status(response.status).json({
                success: false,
                error: data.error || 'Failed to fetch details from bank database'
            });
        }

        // 3. Success: Return the bank's data (Name, Phone, etc.) to the dashboard
        res.json({
            success: true,
            customer: data.customer
        });

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// Bank register customer endpoint (requires JWT so bank-service calls are authenticated)
app.post('/api/bank/register-customer', authenticateJWT, (req, res) => processBankCustomerRegistration(req, res));

// Deprecated endpoint kept for backwards compatibility
app.post('/api/token/:tokenId/customers/register', (req, res) =>
    processBankCustomerRegistration(req, res, { tokenOverride: req.params.tokenId, warnDeprecated: true })
);

// Bank pending customer registrations endpoint
app.get('/api/bank/pending-customer-registrations', authenticateJWT, async (req, res) => {
    try {
        const { tokenID } = req.query;
        console.log('Fetching pending customer registrations:', { tokenID });

        if (!tokenID) {
            return res.status(400).json({
                error: 'Missing required parameter: tokenID',
                help: 'Provide: tokenID (e.g., 1BNET-currency-ROOT-v1 or HDFC-USD-8f2a3b4c-v1)'
            });
        }

        // Validate tokenID format
        if (tokenID.toUpperCase() === tokenID && !tokenID.startsWith('BNET-') && !tokenID.includes('-ROOT-v1')) {
            console.warn('WARNING: tokenID appears to be a currency code, not token ID');
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        // Resolve bank identity from JWT
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);

        if (!ownerNetworkAddress) {
            return res.status(403).json({
                success: false,
                detail: 'Forbidden: Bank identity resolution failed'
            });
        }
        const resolvedUserId = bankUserId;

        try {
            // Use real Fabric function to get pending customer registrations
            // viewPendingCustomerRegistrations(tokenID, ownerNetworkAddress, walletPath, userId)
            const pendingRegs = await viewPendingCustomerRegistrations(
                tokenID,
                ownerNetworkAddress,
                walletPath,
                resolvedUserId
            );

            console.log('Pending customer registrations from blockchain:', pendingRegs);

            // Return the registrations array directly
            res.json(pendingRegs || []);
        } catch (fabricError) {
            console.error('Fabric pending customer registrations error:', fabricError.message);
            let errorDetail = fabricError.message;
            if (fabricError.message && fabricError.message.includes('token not found')) {
                errorDetail = 'Token not found on blockchain. Verify tokenID is correct.';
            } else if (fabricError.message && fabricError.message.includes('permission denied')) {
                errorDetail = 'Permission denied. Only token owner can fetch pending registrations.';
            }
            return res.status(500).json({
                success: false,
                detail: `Failed to fetch pending customer registrations: ${errorDetail}`
            });
        }
    } catch (error) {
        console.error('Bank pending customer registrations error:', error);
        res.status(500).json({
            error: 'Failed to fetch pending customer registrations: ' + error.message,
            help: 'Ensure tokenID and ownerNetworkAddress are valid'
        });
    }
});

// Initialize ledger endpoint
// Initialize ledger endpoint - RESTRICTED to admin
app.post('/api/admin/init-ledger', authenticateJWT, (req, res) => {
    try {
        const caller = req.user?.username;
        if (caller !== 'admin') {
            return res.status(403).json({ success: false, detail: 'Access denied: Requires admin identity' });
        }
        const { userId } = req.body;
        console.log('Initialize ledger request from:', userId);

        res.json({
            success: true,
            message: 'Ledger initialized successfully'
        });
    } catch (error) {
        console.error('Initialize ledger error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Get all tokens
app.get('/api/admin/tokens/all', async (req, res) => {
    try {
        console.log('Fetching all tokens');

        const walletPath = path.join(process.cwd(), 'wallet');
        const userId = 'admin';

        try {
            // Use REAL Fabric function - no mock data
            const walletPath = path.join(process.cwd(), 'wallet');
            const tokens = await viewAllTokens(walletPath, 'admin');
            console.log('REAL tokens from Hyperledger Fabric blockchain:', tokens);
            // Ensure transfer_ids is always an array
            const normalizedTokens = Array.isArray(tokens)
                ? tokens.map(token => ({ ...token, transfer_ids: Array.isArray(token.transfer_ids) ? token.transfer_ids : [] }))
                : tokens;
            res.json(normalizedTokens || []);
        } catch (fabricError) {
            console.error('FABRIC ERROR - ViewAllTokens failed:', fabricError.message);
            return res.status(500).json({
                success: false,
                detail: `Failed to fetch tokens: ${fabricError.message}`
            });
        }
    } catch (error) {
        console.error('Get all tokens error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Get token owners
app.get('/api/admin/tokens/:tokenId/owners', async (req, res) => {
    try {
        const { tokenId } = req.params;
        console.log('Fetching token owners for:', tokenId);

        // Owners listing not implemented in current chaincode
        res.status(501).json({
            success: false,
            detail: 'Token owners endpoint is not implemented in the chaincode yet'
        });
    } catch (error) {
        console.error('Get token owners error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Get token access information
app.get('/api/admin/tokens/:tokenId/access', async (req, res) => {
    try {
        const { tokenId } = req.params;
        console.log('Fetching token access for:', tokenId);

        const walletPath = path.join(process.cwd(), 'wallet');
        const userId = 'admin';

        try {
            // Use real Fabric function to get token access
            const accessInfo = await getTokenAccess(tokenId, walletPath, userId);
            console.log('Token access from Fabric:', accessInfo);
            res.json(JSON.parse(accessInfo));
        } catch (fabricError) {
            console.error('Get token access fabric error:', fabricError.message);
            res.status(500).json({
                success: false,
                detail: `Failed to fetch token access: ${fabricError.message}`
            });
        }
    } catch (error) {
        console.error('Get token access error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Approve mint requests
// Admin or token owner approves bank mint request
app.post('/api/mint-requests/:requestId/approve', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { requestId } = req.params;
        const { status } = req.body;
        console.log('Approve mint request:', { requestId, status });

        if (status === 'approved') {
            const walletPath = path.join(process.cwd(), 'wallet');
            const adminId = 'admin';

            // Use real Fabric function to approve mint request
            await submitWithRetry(
                () => approveMintRequest(requestId, walletPath, adminId),
                3,
                `ApproveMintRequest for ${requestId}`
            );
            console.log('Mint request approved in Fabric');
        }

        // Mint request approval completed on blockchain

        res.json({
            success: true,
            message: `Mint request ${status} successfully`
        });
    } catch (error) {
        console.error('Approve mint request error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// TestFunction integration endpoint - Direct access to blockchain functions
app.post('/api/test-function/:functionName', (req, res) => {
    const { functionName } = req.params;
    const { args = [] } = req.body;

    console.log(`TestFunction called: ${functionName} with args:`, args);

    const { exec } = require('child_process');
    const command = `node testFunction.js ${functionName} ${args.join(' ')}`;

    exec(command, {
        cwd: __dirname,
        timeout: 30000,
        maxBuffer: 1024 * 1024 // 1MB buffer
    }, (error, stdout, stderr) => {
        if (error) {
            console.error(`TestFunction error:`, error.message);
            return res.status(500).json({
                success: false,
                error: error.message,
                functionName: functionName
            });
        }

        if (stderr) {
            console.log(`TestFunction stderr:`, stderr);
        }

        console.log(`TestFunction result:`, stdout);

        res.json({
            success: true,
            result: stdout.trim(),
            functionName: functionName,
            args: args
        });
    });
});

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.set('io', io);

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
});

async function ensureEventListener(ioInstance, walletPath = WALLET_PATH, identity = 'admin') {
    if (!ioInstance) {
        console.warn('Socket.io instance not available; skipping event listener start.');
        return false;
    }
    try {
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const adminIdentity = await wallet.get(identity);
        if (!adminIdentity) {
            console.log(`Event Listener not started: wallet identity '${identity}' missing. Frontend enrollment must run first.`);
            return false;
        }
        if (eventListenerGateway) {
            return true;
        }

        eventListenerGateway = await startEventListener(walletPath, identity, (eventName, payload) => {
            ioInstance.emit(eventName, payload);
            ioInstance.emit('refresh', { source: eventName });
            console.log(`Socket.io broadcast: ${eventName}`);
        });

        if (!eventListenerGateway) {
            console.warn('Event Listener returned no gateway instance.');
            return false;
        }

        console.log('Event Listener started successfully.');
        return true;
    } catch (err) {
        eventListenerGateway = null;
        console.error('Failed to start Event Listener:', err && err.message ? err.message : err);
        return false;
    }
}

// ===== CUSTOMER-TO-TOKEN TRANSFER ENDPOINTS =====

// 1. Create Customer-to-Token Transfer Request
app.post('/api/customer-to-token-transfer', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const {
            senderTokenID,
            receiverTokenID,
            receiverCustomerNetworkAddress,
            amount
        } = req.body;

        console.log('Transfer request received:', {
            senderTokenID,
            receiverTokenID,
            receiverCustomerNetworkAddress,
            amount,
            caller
        });

        if (!senderTokenID || !receiverTokenID || !receiverCustomerNetworkAddress || !amount) {
            console.error('Missing required fields:', {
                senderTokenID: !!senderTokenID,
                receiverTokenID: !!receiverTokenID,
                receiverCustomerNetworkAddress: !!receiverCustomerNetworkAddress,
                amount: !!amount
            });
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['senderTokenID', 'receiverTokenID', 'receiverCustomerNetworkAddress', 'amount'],
                provided: {
                    senderTokenID: !!senderTokenID,
                    receiverTokenID: !!receiverTokenID,
                    receiverCustomerNetworkAddress: !!receiverCustomerNetworkAddress,
                    amount: !!amount
                },
                note: 'Commission is configured via "Set Commission Rate" endpoint. senderNetworkAddress is automatically set to the authenticated caller',
                example: {
                    senderTokenID: 'HDFC-USD-8f2a3b4c-v1',
                    receiverTokenID: 'SBI-INR-5a8c9f2d-v1',
                    receiverCustomerNetworkAddress: 'cust_2a4b8c9f-d3e2-4a5b-8c9f-2a4b8c9f',
                    amount: 100
                }
            });
        }

        // SECURITY FIX #1: Rate limiting (5 transfers per minute per user)
        const rateLimitKey = `transfer_${caller}`;
        const now = Date.now();
        const rateLimitData = transferInitiationCounts.get(rateLimitKey) || { count: 0, firstRequest: now };
        
        if (now - rateLimitData.firstRequest < TRANSFER_RATE_WINDOW) {
            rateLimitData.count++;
            if (rateLimitData.count > TRANSFER_RATE_LIMIT) {
                return res.status(429).json({
                    success: false,
                    error: 'Rate limit exceeded',
                    detail: `Maximum ${TRANSFER_RATE_LIMIT} transfer requests per minute`,
                    retryAfter: Math.ceil((rateLimitData.firstRequest + TRANSFER_RATE_WINDOW - now) / 1000)
                });
            }
        } else {
            rateLimitData.count = 1;
            rateLimitData.firstRequest = now;
        }
        transferInitiationCounts.set(rateLimitKey, rateLimitData);

        const parsedTransferAmount = parseFloat(amount);
        if (!Number.isFinite(parsedTransferAmount) || parsedTransferAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'amount must be a positive number'
            });
        }

        // SECURITY FIX #2: Amount validation - cannot exceed 1,000,000 (max transfer limit)
        const MAX_TRANSFER_AMOUNT = 1000000;
        if (parsedTransferAmount > MAX_TRANSFER_AMOUNT) {
            return res.status(400).json({
                success: false,
                error: 'amount exceeds maximum transfer limit',
                maximum: MAX_TRANSFER_AMOUNT,
                requested: parsedTransferAmount
            });
        }

        // SECURITY FIX #3: Network address format validation for receiver
        if (!receiverCustomerNetworkAddress || typeof receiverCustomerNetworkAddress !== 'string' || receiverCustomerNetworkAddress.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'receiverCustomerNetworkAddress must be a non-empty string'
            });
        }
        const trimmedReceiverAddress = receiverCustomerNetworkAddress.trim();
        // Allow base64 encoded addresses (with = padding) and alphanumeric with hyphens/underscores
        if (!/^[a-zA-Z0-9_\-=]+$/.test(trimmedReceiverAddress)) {
            return res.status(400).json({
                success: false,
                error: 'receiverCustomerNetworkAddress format invalid',
                detail: 'Must be base64 encoded (alphanumeric with =, hyphens, and underscores) or a network address identifier'
            });
        }

        // CRITICAL: Use caller's own network address from authentication (NOT from request body)
        // The chaincode validates that caller identity matches senderNetworkAddress
        // This ensures the caller can only send from their own account
        const senderNetworkAddress = req.callerNetworkAddress;
        if (!senderNetworkAddress) {
            return res.status(401).json({
                success: false,
                error: 'Caller network address not found. Please complete registration first.'
            });
        }

        // SECURITY FIX #5: Deduplication - prevent duplicate concurrent transfers (15 minute window)
        const dedupeKey = `${senderNetworkAddress}_${senderTokenID}_${receiverTokenID}_${trimmedReceiverAddress}_${parsedTransferAmount}`;
        if (recentTransfers.has(dedupeKey)) {
            return res.status(409).json({
                success: false,
                error: 'Duplicate transfer request',
                detail: 'Identical transfer request already submitted in the last 15 minutes',
                deduplicate_key: dedupeKey
            });
        }
        recentTransfers.set(dedupeKey, Date.now());

        // SECURITY FIX #6: Receiver token existence check (fail fast before chaincode)
        const walletPath = path.join(process.cwd(), 'wallet');
        let gateway = null;
        try {
            const connection = await connect(walletPath, caller);
            gateway = connection.gateway;
            const contract = connection.contract;
            const receiverTokenCheck = await contract.evaluateTransaction('GetTokenByID', receiverTokenID);
            if (gateway) gateway.disconnect();
            if (!receiverTokenCheck || receiverTokenCheck.toString().trim() === '') {
                return res.status(404).json({
                    success: false,
                    error: 'Receiver token not found',
                    token_id: receiverTokenID,
                    detail: 'The receiving token does not exist or is not accessible'
                });
            }
        } catch (tokenCheckError) {
            if (gateway) {
                try { gateway.disconnect(); } catch (e) { }
            }
            console.error('Token verification error:', tokenCheckError.message);
            return res.status(400).json({
                success: false,
                error: 'Failed to verify receiver token',
                detail: tokenCheckError.message
            });
        }

        // SECURITY FIX #7: Balance pre-check (fail fast before chaincode)
        try {
            const balanceResult = await viewCustomerWallet(senderNetworkAddress, senderTokenID, walletPath, caller);
            const balance = balanceResult.balance || 0;
            if (balance < parsedTransferAmount) {
                return res.status(403).json({
                    success: false,
                    error: 'Insufficient balance',
                    available_balance: balance,
                    required_amount: parsedTransferAmount,
                    shortfall: parsedTransferAmount - balance
                });
            }
        } catch (balanceError) {
            console.warn('Balance pre-check failed (will validate in chaincode):', balanceError.message);
            // Continue - chaincode will validate
        }

        const transferID = await createCustomerToTokenTransferRequest(
            walletPath,
            caller,
            senderNetworkAddress,
            senderTokenID,
            receiverTokenID,
            receiverCustomerNetworkAddress,
            parsedTransferAmount
        );

        // Fetch the created transfer to get actual commission and exchange rate details
        let transferDetails = {
            transfer_id: transferID,
            amount: parseInt(parsedTransferAmount),
            commission_amount: 0,
            commission_percentage: 0,
            receiver_net_amount: parseInt(parsedTransferAmount),
            exchange_rate: 1.0,
            converted_amount: parseInt(parsedTransferAmount),
            status: 'PendingSenderTokenApproval'
        };

        try {
            const { gateway, contract } = await connect(walletPath, caller);
            try {
                const transferBytes = await contract.evaluateTransaction('GetCustomerToTokenTransferRequestByID', transferID);
                const transfer = JSON.parse(transferBytes.toString());
                transferDetails = {
                    transfer_id: transferID,
                    amount: transfer.Amount || parseInt(parsedTransferAmount),
                    commission_amount: transfer.CommissionAmount || transfer.commission_amount || 0,
                    commission_percentage: transfer.CommissionPercentage || transfer.commission_percentage || 0,
                    receiver_net_amount: (transfer.Amount || parseInt(parsedTransferAmount)) - (transfer.CommissionAmount || 0),
                    exchange_rate: transfer.ExchangeRate || transfer.exchange_rate || 1.0,
                    converted_amount: transfer.ConvertedAmount || transfer.converted_amount || (transfer.Amount || parseInt(parsedTransferAmount)),
                    status: transfer.Status || 'PendingSenderTokenApproval'
                };
            } catch (readErr) {
                console.warn('Could not fetch transfer details after creation:', readErr.message);
            } finally {
                gateway.disconnect();
            }
        } catch (detailErr) {
            console.warn('Failed to fetch transfer details:', detailErr.message);
        }

        console.log('Transfer creation successful, response details:', {
            transfer_id: transferDetails.transfer_id,
            amount: transferDetails.amount,
            commission_amount: transferDetails.commission_amount,
            commission_percentage: transferDetails.commission_percentage,
            receiver_net_amount: transferDetails.receiver_net_amount,
            exchange_rate: transferDetails.exchange_rate,
            converted_amount: transferDetails.converted_amount,
            status: transferDetails.status
        });

        res.json({
            success: true,
            message: 'Customer-to-token transfer initiated successfully',
            transfer_id: transferDetails.transfer_id,
            sender_network_address: senderNetworkAddress,
            sender_token_id: senderTokenID,
            receiver_token_id: receiverTokenID,
            receiver_customer_network_address: receiverCustomerNetworkAddress,
            amount: transferDetails.amount,
            commission_amount: transferDetails.commission_amount,
            commission_percentage: transferDetails.commission_percentage,
            receiver_net_amount: transferDetails.receiver_net_amount,
            exchange_rate: transferDetails.exchange_rate,
            converted_amount: transferDetails.converted_amount,
            status: transferDetails.status
        });
    } catch (error) {
        console.error('Customer-to-token transfer creation error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message,
            detail: error.message.includes('handshake')
                ? 'Tokens must have an approved handshake before transfer'
                : 'Failed to create transfer request'
        });
    }
});

// 2. Approve/Reject by Sender Token Owner
// 4a. View Pending Customer-to-Token Transfers (SENDER perspective)
// View pending customer-to-token transfers (auto-fetch tokenId from bank - SENDER perspective)
app.get('/api/bank/customer-to-token-transfers/pending-as-sender', authenticateJWT, async (req, res) => {
    try {
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);
        const walletPath = path.join(process.cwd(), 'wallet');

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found for this user. Please register the bank wallet first.'
            });
        }

        try {
            // Auto-fetch tokenId from bank's participant record
            let tokenId = await getTokenAccess(ownerNetworkAddress, walletPath, bankUserId);
            console.log('Fetched bank tokenId for C-to-T transfers (sender):', tokenId);

            const pendingTransfers = await viewPendingCustomerToTokenTransfersAsSender(
                walletPath,
                bankUserId,
                tokenId,
                ownerNetworkAddress
            );

            res.json({
                success: true,
                perspective: 'sender',
                token_id: tokenId,
                owner_network_address: ownerNetworkAddress,
                pending_count: Array.isArray(pendingTransfers) ? pendingTransfers.length : 0,
                pending_transfers: Array.isArray(pendingTransfers) ? pendingTransfers : []
            });
        } catch (error) {
            console.error('Bank C-to-T transfers (sender) error:', error);
            res.status(500).json({
                success: false,
                detail: error.message
            });
        }
    } catch (error) {
        console.error('Bank C-to-T transfers (sender) error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// View pending customer-to-token transfers (auto-fetch tokenId from bank - RECEIVER perspective)
app.get('/api/bank/customer-to-token-transfers/pending-as-receiver', authenticateJWT, async (req, res) => {
    try {
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);
        const walletPath = path.join(process.cwd(), 'wallet');

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found for this user. Please register the bank wallet first.'
            });
        }

        try {
            // Auto-fetch tokenId from bank's participant record
            let tokenId = await getTokenAccess(ownerNetworkAddress, walletPath, bankUserId);
            console.log('Fetched bank tokenId for C-to-T transfers (receiver):', tokenId);

            const pendingTransfers = await viewPendingCustomerToTokenTransfersAsReceiver(
                walletPath,
                bankUserId,
                tokenId,
                ownerNetworkAddress
            );

            res.json({
                success: true,
                perspective: 'receiver',
                token_id: tokenId,
                owner_network_address: ownerNetworkAddress,
                pending_count: Array.isArray(pendingTransfers) ? pendingTransfers.length : 0,
                pending_transfers: Array.isArray(pendingTransfers) ? pendingTransfers : [],
                transfers: Array.isArray(pendingTransfers) ? pendingTransfers : []
            });
        } catch (error) {
            console.error('Bank C-to-T transfers (receiver) error:', error);
            res.status(500).json({
                success: false,
                detail: error.message
            });
        }
    } catch (error) {
        console.error('Bank C-to-T transfers (receiver) error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// View pending customer-to-token transfers (explicit tokenId - SENDER perspective)
app.get('/api/customer-to-token-transfers/pending-as-sender/:tokenId', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { tokenId } = req.params;
        const { ownerNetworkAddress } = req.query;

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                error: 'ownerNetworkAddress query parameter is required',
                example: '/api/customer-to-token-transfers/pending-as-sender/HDFC-USD-8f2a3b4c-v1?ownerNetworkAddress=<base64_cert>'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const pendingTransfers = await viewPendingCustomerToTokenTransfersAsSender(
            walletPath,
            caller,
            tokenId,
            ownerNetworkAddress
        );

        res.json({
            success: true,
            perspective: 'sender',
            token_id: tokenId,
            owner_network_address: ownerNetworkAddress,
            pending_count: Array.isArray(pendingTransfers) ? pendingTransfers.length : 0,
            pending_transfers: Array.isArray(pendingTransfers) ? pendingTransfers : []
        });
    } catch (error) {
        console.error('View pending transfers (SENDER) error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4b. View Pending Customer-to-Token Transfers (RECEIVER perspective)
app.get('/api/customer-to-token-transfers/pending-as-receiver/:tokenId', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { tokenId } = req.params;
        const { ownerNetworkAddress } = req.query;

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                error: 'ownerNetworkAddress query parameter is required',
                example: '/api/customer-to-token-transfers/pending-as-receiver/HDFC-USD-8f2a3b4c-v1?ownerNetworkAddress=<base64_cert>'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const pendingTransfers = await viewPendingCustomerToTokenTransfersAsReceiver(
            walletPath,
            caller,
            tokenId,
            ownerNetworkAddress
        );

        res.json({
            success: true,
            perspective: 'receiver',
            token_id: tokenId,
            owner_network_address: ownerNetworkAddress,
            pending_count: Array.isArray(pendingTransfers) ? pendingTransfers.length : 0,
            pending_transfers: Array.isArray(pendingTransfers) ? pendingTransfers : []
        });
    } catch (error) {
        console.error('View pending transfers (RECEIVER) error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4c. View Pending Customer-to-Token Transfers (LEGACY - shows all pending transfers)
app.get('/api/customer-to-token-transfers/pending/:tokenId', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { tokenId } = req.params;
        const { ownerNetworkAddress } = req.query;

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                error: 'ownerNetworkAddress query parameter is required',
                example: '/api/customer-to-token-transfers/pending/HDFC-USD-8f2a3b4c-v1?ownerNetworkAddress=<base64_cert>'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        
        // Get both sender and receiver perspective transfers
        const [senderTransfers, receiverTransfers] = await Promise.all([
            viewPendingCustomerToTokenTransfersAsSender(
                walletPath,
                caller,
                tokenId,
                ownerNetworkAddress
            ).catch(() => []),
            viewPendingCustomerToTokenTransfersAsReceiver(
                walletPath,
                caller,
                tokenId,
                ownerNetworkAddress
            ).catch(() => [])
        ]);

        // Combine both views
        const allPendingTransfers = [...senderTransfers, ...receiverTransfers];

        res.json({
            success: true,
            token_id: tokenId,
            owner_network_address: ownerNetworkAddress,
            pending_count: Array.isArray(allPendingTransfers) ? allPendingTransfers.length : 0,
            pending_transfers: Array.isArray(allPendingTransfers) ? allPendingTransfers : [],
            transfers: Array.isArray(allPendingTransfers) ? allPendingTransfers : [],
            note: 'This endpoint shows all pending transfers (both sender and receiver perspectives). Use pending-as-sender or pending-as-receiver for specific views.'
        });
    } catch (error) {
        console.error('View pending transfers (LEGACY) error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5. Get Customer-to-Token Transfer History
app.get('/api/customer-to-token-transfers/history/:tokenId', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { tokenId } = req.params;

        const walletPath = path.join(process.cwd(), 'wallet');
        const transferHistory = await getCustomerToTokenTransferHistory(
            walletPath,
            caller,
            tokenId
        );

        res.json({
            success: true,
            token_id: tokenId,
            completed_count: Array.isArray(transferHistory) ? transferHistory.length : 0,
            completed_transfers: Array.isArray(transferHistory) ? transferHistory : [],
            history: Array.isArray(transferHistory) ? transferHistory : []
        });
    } catch (error) {
        console.error('View transfer history error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5.1 Get Customer-to-Token Transfer History (Auto-fetch tokenId)
app.get('/api/bank/customer-to-token-transfers/history', authenticateJWT, async (req, res) => {
    try {
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found. Please register bank wallet first.'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        let tokenId = await getTokenAccess(ownerNetworkAddress, walletPath, bankUserId);

        if (!tokenId) {
            return res.status(400).json({
                success: false,
                detail: 'No token assigned to this bank. Please request token assignment.'
            });
        }

        const transferHistory = await getCustomerToTokenTransferHistory(
            walletPath,
            bankUserId,
            tokenId
        );

        res.json({
            success: true,
            token_id: tokenId,
            completed_count: Array.isArray(transferHistory) ? transferHistory.length : 0,
            completed_transfers: Array.isArray(transferHistory) ? transferHistory : []
        });
    } catch (error) {
        console.error('View transfer history error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 5.2 Get Customer-to-Token Transfer History for Customer Dashboard
app.get('/api/customer/transfer-history', authenticateJWT, async (req, res) => {
    try {
        const customerId = req.user.username;
        const customerNetworkAddress = getNetworkAddressForUser(customerId);
        const { from_date, to_date, limit = '50', offset = '0', type = 'all' } = req.query;

        console.log(`[REST API] Customer transaction history request (unified):`);
        console.log(`  - customerId: ${customerId}`);
        console.log(`  - customerNetworkAddress: ${customerNetworkAddress}`);
        console.log(`  - from_date: ${from_date || 'all'}, to_date: ${to_date || 'all'}`);
        console.log(`  - type: ${type}, limit: ${limit}, offset: ${offset}`);

        if (!customerNetworkAddress) {
            console.warn(`[REST API] No network address found for customer: ${customerId}`);
            return res.status(400).json({
                success: false,
                detail: 'Customer network address not found. Please register first.'
            });
        }

        // SECURITY: Add rate limiting per user (max 20 requests per minute)
        const rateLimitKey = `transfer_history_${customerId}`;
        const rateLimitStore = global.transferHistoryRateLimits || {};
        global.transferHistoryRateLimits = rateLimitStore;
        const now = Date.now();
        if (!rateLimitStore[rateLimitKey]) {
            rateLimitStore[rateLimitKey] = [];
        }
        rateLimitStore[rateLimitKey] = rateLimitStore[rateLimitKey].filter(t => now - t < 60000);
        if (rateLimitStore[rateLimitKey].length >= 20) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded: maximum 20 requests per minute'
            });
        }
        rateLimitStore[rateLimitKey].push(now);

        // Validate pagination and date range parameters
        const pageLimit = Math.min(Math.max(1, parseInt(limit) || 50), 500);
        const pageOffset = Math.max(0, parseInt(offset) || 0);
        
        let fromDate = null;
        let toDate = null;
        if (from_date) {
            fromDate = new Date(from_date);
            if (isNaN(fromDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid from_date format (use ISO 8601: YYYY-MM-DDTHH:mm:ssZ)'
                });
            }
        }
        if (to_date) {
            toDate = new Date(to_date);
            if (isNaN(toDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid to_date format (use ISO 8601: YYYY-MM-DDTHH:mm:ssZ)'
                });
            }
        }

        // Validate type filter
        if (!['all', 'transfer', 'mint'].includes(type.toLowerCase())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid type filter. Use: all, transfer, or mint'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        let allTransactions = [];

        try {
            // Get transfer history if requested
            if (type === 'all' || type === 'transfer') {
                const transferHistory = await getCustomerToTokenTransferHistoryByCustomer(
                    walletPath,
                    customerId,
                    customerNetworkAddress
                );

                // Map transfers to transaction format
                const mappedTransfers = (Array.isArray(transferHistory) ? transferHistory : []).map(transfer => {
                    const isSender = transfer.SenderCustomerID === customerNetworkAddress || transfer.sender_customer_id === customerNetworkAddress;
                    const isReceiver = transfer.ReceiverCustomerID === customerNetworkAddress || transfer.receiver_customer_id === customerNetworkAddress;
                    const grossAmount = transfer.Amount || transfer.amount || 0;
                    const commissionAmount = transfer.CommissionAmount || transfer.commission_amount || 0;
                    const netReceived = isReceiver ? (grossAmount - commissionAmount) : grossAmount;
                    const completedAt = transfer.CompletedAt || transfer.completed_at || '';

                    return {
                        transaction_id: transfer.TransferRequestID || transfer.transfer_request_id || '',
                        transaction_category: 'TRANSFER', // Category label
                        transaction_type: isSender ? 'DEBIT' : 'CREDIT',
                        transaction_type_description: isSender 
                            ? `Transfer sent to ${transfer.ReceiverCustomerName || 'Customer'}` 
                            : `Transfer received from ${transfer.SenderCustomerName || 'Customer'}`,
                        amount: grossAmount,
                        currency: transfer.SenderCurrency || transfer.sender_currency || '',
                        commission_amount: commissionAmount,
                        commission_description: `${(transfer.CommissionPercentage || 0).toFixed(2)}% commission (${commissionAmount} ${transfer.ReceiverCurrency || ''})`,
                        net_amount: netReceived,
                        sender: transfer.SenderCustomerName || transfer.sender_customer_name || '',
                        receiver: transfer.ReceiverCustomerName || transfer.receiver_customer_name || '',
                        sender_customer_token_id: transfer.SenderCustomerTokenID || transfer.sender_customer_token_id || '',
                        receiver_customer_token_id: transfer.ReceiverCustomerTokenID || transfer.receiver_customer_token_id || '',
                        status: transfer.Status || transfer.status || 'Completed',
                        timestamp: completedAt,
                        sort_timestamp: completedAt ? new Date(completedAt).getTime() : 0,
                        // Receiver currency and amount information
                        receiver_currency: transfer.ReceiverCurrency || transfer.receiver_currency || '',
                        receiver_amount: transfer.ReceiverCustomerAmount || transfer.receiver_customer_amount || netReceived,
                        exchange_rate: transfer.ExchangeRate || transfer.exchange_rate || 1.0,
                        converted_amount: transfer.ConvertedAmount || transfer.converted_amount || (transfer.Amount || grossAmount) * (transfer.ExchangeRate || 1.0)
                    };
                });

                allTransactions.push(...mappedTransfers);
            }

            // Get mint history if requested
            if (type === 'all' || type === 'mint') {
                try {
                    // SECURITY: Use caller-only chaincode function (no customer input parameter)
                    const approvedMintRequests = await getMyApprovedMintRequests(
                        walletPath,
                        customerId
                    );

                    const mappedMints = (Array.isArray(approvedMintRequests) ? approvedMintRequests : []).map(mintReq => ({
                        transaction_id: mintReq.RequestID || mintReq.request_id || '',
                        transaction_category: 'MINT', // Category label
                        customer_id: mintReq.CustomerID || mintReq.customer_id || '',
                        transaction_type: 'CREDIT',
                        transaction_type_description: 'Funds added to account (Mint approved)',
                        amount: mintReq.Amount || mintReq.amount || 0,
                        currency: mintReq.Currency || mintReq.currency || '',
                        commission_amount: 0,
                        commission_description: 'No commission',
                        net_amount: mintReq.Amount || mintReq.amount || 0,
                        sender: 'Bank',
                        receiver: customerId,
                        status: mintReq.Approved ? 'APPROVED' : 'PENDING',
                        timestamp: mintReq.ApprovedAt || mintReq.approved_at || '',
                        sort_timestamp: (mintReq.ApprovedAt || mintReq.approved_at) 
                            ? new Date(mintReq.ApprovedAt || mintReq.approved_at).getTime() 
                            : 0
                    }));

                    allTransactions.push(...mappedMints);
                } catch (mintErr) {
                    console.warn('Failed to fetch mint history:', mintErr?.message);
                    // Continue with transfer history even if mint fetch fails
                }
            }

            console.log(`[REST API] Total transactions: ${allTransactions.length} (transfers + mints)`);

            // Validate and filter by timestamp
            allTransactions = allTransactions.filter(tx => {
                if (!tx.timestamp) return true; // Keep if no timestamp
                const txDate = new Date(tx.timestamp);
                if (isNaN(txDate.getTime())) return false; // Filter out invalid dates
                
                // Check reasonable timestamp (within 1 year past or 1 day future)
                const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
                const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
                if (txDate < oneYearAgo || txDate > futureDate) {
                    console.warn(`WARNING: Transaction ${tx.transaction_id} has suspicious timestamp: ${tx.timestamp}`);
                    return false;
                }

                // Apply date range filter
                if (fromDate && txDate < fromDate) return false;
                if (toDate && txDate > toDate) return false;
                return true;
            });

            // Sort by timestamp descending (newest first)
            allTransactions.sort((a, b) => b.sort_timestamp - a.sort_timestamp);

            // Apply pagination
            const totalCount = allTransactions.length;
            const paginatedTransactions = allTransactions.slice(pageOffset, pageOffset + pageLimit);

            console.log(`[REST API] Returned transactions: ${paginatedTransactions.length} (total: ${totalCount})`);

            res.json({
                success: true,
                customer_id: customerId,
                customer_network_address: customerNetworkAddress,
                pagination: {
                    limit: pageLimit,
                    offset: pageOffset,
                    total_count: totalCount,
                    returned_count: paginatedTransactions.length,
                    has_more: (pageOffset + pageLimit) < totalCount
                },
                filters: {
                    from_date: from_date || null,
                    to_date: to_date || null,
                    type: type
                },
                summary: {
                    total_transactions: totalCount,
                    transfers: allTransactions.filter(t => t.transaction_category === 'TRANSFER').length,
                    mints: allTransactions.filter(t => t.transaction_category === 'MINT').length,
                    total_debits: allTransactions.filter(t => t.transaction_type === 'DEBIT').reduce((sum, t) => sum + (t.amount || 0), 0),
                    total_credits: allTransactions.filter(t => t.transaction_type === 'CREDIT').reduce((sum, t) => sum + (t.amount || 0), 0)
                },
                transactions: paginatedTransactions
            });
        } catch (error) {
            console.error('[REST API] Error retrieving transaction history:', error);
            // Fallback: Return empty history if chaincode functions fail
            res.json({
                success: true,
                customer_id: customerId,
                customer_network_address: customerNetworkAddress,
                transactions: [],
                note: 'Transaction history currently unavailable'
            });
        }
    } catch (error) {
        console.error('[REST API] Customer transaction history error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// SECURITY FIX #3: Add mint request history endpoint showing all add funds transactions
app.get('/api/customer/mint-history', authenticateJWT, async (req, res) => {
    try {
        const customerId = req.user.username;
        const customerNetworkAddress = getNetworkAddressForUser(customerId);
        const { from_date, to_date, limit = '50', offset = '0' } = req.query;

        console.log(`[REST API] Customer mint history request:`);
        console.log(`  - customerId: ${customerId}`);
        console.log(`  - customerNetworkAddress: ${customerNetworkAddress}`);

        if (!customerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Customer network address not found. Please register first.'
            });
        }

        // Rate limiting (max 15 requests per minute)
        const rateLimitKey = `mint_history_${customerId}`;
        const rateLimitStore = global.mintHistoryRateLimits || {};
        global.mintHistoryRateLimits = rateLimitStore;
        const now = Date.now();
        if (!rateLimitStore[rateLimitKey]) {
            rateLimitStore[rateLimitKey] = [];
        }
        rateLimitStore[rateLimitKey] = rateLimitStore[rateLimitKey].filter(t => now - t < 60000);
        if (rateLimitStore[rateLimitKey].length >= 15) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded: maximum 15 requests per minute'
            });
        }
        rateLimitStore[rateLimitKey].push(now);

        // Validate pagination parameters
        const pageLimit = Math.min(Math.max(1, parseInt(limit) || 50), 500);
        const pageOffset = Math.max(0, parseInt(offset) || 0);

        try {
            const walletPath = path.join(process.cwd(), 'wallet');
            
            // Get approved mint requests for caller only.
            // Chaincode derives caller identity from certificate and ignores external customer inputs.
            const approvedMintRequests = await getMyApprovedMintRequests(
                walletPath,
                customerId
            );

            // Map to response format with transaction type
            let mappedMintRequests = (Array.isArray(approvedMintRequests) ? approvedMintRequests : []).map(mintReq => ({
                request_id: mintReq.RequestID || mintReq.request_id || '',
                customer_id: mintReq.CustomerID || mintReq.customer_id || '',
                transaction_type: 'CREDIT',
                transaction_type_description: 'Funds added to account (Mint approved)',
                token_id: mintReq.TokenID || mintReq.token_id || '',
                currency: mintReq.Currency || mintReq.currency || '',
                amount: mintReq.Amount || mintReq.amount || 0,
                status: mintReq.Status || mintReq.status || 'PENDING',
                approved: mintReq.Approved !== undefined ? mintReq.Approved : (mintReq.approved || false),
                approved_at: mintReq.ApprovedAt || mintReq.approved_at || '',
                name: mintReq.Name || mintReq.name || '',
                kyc_id: mintReq.KycId || mintReq.kyc_id || '',
                kyc_status: mintReq.KycStatus || mintReq.kyc_status || ''
            }));

            // Filter by date range if provided
            if (from_date || to_date) {
                const fromDate = from_date ? new Date(from_date) : null;
                const toDate = to_date ? new Date(to_date) : null;
                
                if (fromDate && isNaN(fromDate.getTime())) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid from_date format (use ISO 8601: YYYY-MM-DDTHH:mm:ssZ)'
                    });
                }
                if (toDate && isNaN(toDate.getTime())) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid to_date format (use ISO 8601: YYYY-MM-DDTHH:mm:ssZ)'
                    });
                }

                mappedMintRequests = mappedMintRequests.filter(m => {
                    if (!m.approved_at) return true;
                    const txDate = new Date(m.approved_at);
                    if (fromDate && txDate < fromDate) return false;
                    if (toDate && txDate > toDate) return false;
                    return true;
                });
            }

            // Sort by approved_at descending (newest first)
            mappedMintRequests.sort((a, b) => {
                const timeA = a.approved_at ? new Date(a.approved_at).getTime() : 0;
                const timeB = b.approved_at ? new Date(b.approved_at).getTime() : 0;
                return timeB - timeA;
            });

            // Apply pagination
            const totalCount = mappedMintRequests.length;
            const paginatedMints = mappedMintRequests.slice(pageOffset, pageOffset + pageLimit);

            res.json({
                success: true,
                customer_id: customerId,
                customer_network_address: customerNetworkAddress,
                pagination: {
                    limit: pageLimit,
                    offset: pageOffset,
                    total_count: totalCount,
                    returned_count: paginatedMints.length,
                    has_more: (pageOffset + pageLimit) < totalCount
                },
                mint_requests: paginatedMints
            });
        } catch (error) {
            console.error('[REST API] Error retrieving mint history:', error);
            res.json({
                success: true,
                customer_id: customerId,
                customer_network_address: customerNetworkAddress,
                mint_requests: [],
                note: 'Mint history currently unavailable'
            });
        }
    } catch (error) {
        console.error('[REST API] Customer mint history error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Approve customer-to-token transfer by sender token owner
app.post('/api/bank/customer-to-token-transfers/approve-sender', authenticateJWT, async (req, res) => {
    try {
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);
        const { transferRequestID } = req.body;

        if (!transferRequestID) {
            return res.status(400).json({
                success: false,
                error: 'transferRequestID is required'
            });
        }

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found. Please register bank wallet first.'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');

        const result = await submitWithRetry(
            () => approveSenderTokenTransfer(
                walletPath,
                bankUserId,
                transferRequestID,
                ownerNetworkAddress,
                true  // approved = true
            ),
            3,
            `ApproveSenderTokenTransfer for ${transferRequestID}`
        );

        res.json({
            success: true,
            message: 'Transfer approved by sender token owner',
            transfer_request_id: transferRequestID
        });
    } catch (error) {
        console.error('Approve sender token transfer error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Approve customer-to-token transfer by receiver token owner
app.post('/api/bank/customer-to-token-transfers/approve-receiver', authenticateJWT, async (req, res) => {
    try {
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);
        const { transferRequestID } = req.body;

        if (!transferRequestID) {
            return res.status(400).json({
                success: false,
                error: 'transferRequestID is required'
            });
        }

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found. Please register bank wallet first.'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');

        // Before approval, fetch transfer details to get currencies and calculate exchange rate
        try {
            const { gateway, contract } = await connect(walletPath, bankUserId);
            const transferData = await contract.evaluateTransaction(
                'GetCustomerToTokenTransferRequestByID',
                transferRequestID
            );
            await gateway.disconnect();

            const transfer = JSON.parse(transferData.toString());
            const senderCurrency = transfer.sender_currency || transfer.SenderCurrency;
            const receiverCurrency = transfer.receiver_currency || transfer.ReceiverCurrency;
            const amount = transfer.amount || transfer.Amount || transfer.EscrowedAmount;

            console.log(`Transfer currencies: ${senderCurrency} -> ${receiverCurrency}, Amount: ${amount}`);

            // If different currencies, fetch exchange rate and calculate converted amount
            if (senderCurrency !== receiverCurrency) {
                const exchangeRate = await getFXRate(senderCurrency, receiverCurrency);
                
                // Commission deducted from sender amount FIRST (in sender's currency)
                const commissionInSender = amount * 0.02; // 2% commission in sender currency (float)
                const remainingAfterCommission = amount - commissionInSender; // Full precision
                
                // Convert remaining amount at exact exchange rate (full precision)
                const convertedAmountExact = remainingAfterCommission * exchangeRate;
                const convertedAmount = Math.round(convertedAmountExact); // Round only for storage
                
                console.log(`Exchange rate: ${senderCurrency}/${receiverCurrency} = ${exchangeRate}`);
                console.log(`Commission (2% of ${amount}): ${commissionInSender.toFixed(2)} ${senderCurrency}`);
                console.log(`Remaining after commission: ${remainingAfterCommission.toFixed(2)} ${senderCurrency}`);
                console.log(`Exact conversion: ${remainingAfterCommission.toFixed(2)} × ${exchangeRate} = ${convertedAmountExact.toFixed(2)} ${receiverCurrency}`);
                console.log(`Rounded converted amount: ${convertedAmount} ${receiverCurrency}`);

                // Store exchange rate and converted amount in transfer for chaincode to use
                // These will be passed to the chaincode during approval
                req.body.exchangeRate = exchangeRate;
                req.body.convertedAmount = convertedAmount;
            }
        } catch (fetchError) {
            console.warn('Could not pre-fetch transfer details for FX rate:', fetchError.message);
            // Continue with approval without exchange rate - chaincode will use fallback
        }

        const result = await submitWithRetry(
            () => approveReceiverTokenTransfer(
                walletPath,
                bankUserId,
                transferRequestID,
                ownerNetworkAddress,
                true,  // approved = true
                req.body.exchangeRate,  // exchange rate if calculated
                req.body.convertedAmount  // converted amount if calculated
            ),
            3,
            `ApproveReceiverTokenTransfer for ${transferRequestID}`
        );

        res.json({
            success: true,
            message: 'Transfer approved by receiver token owner and completed',
            transfer_request_id: transferRequestID,
            exchange_rate: req.body.exchangeRate,
            converted_amount: req.body.convertedAmount
        });
    } catch (error) {
        console.error('Approve receiver token transfer error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. Update Exchange Rate (Admin Function)
app.post('/api/exchange-rates/update', authenticateJWT, async (req, res) => {
    try {
        const caller = req.user.username;
        const { currency, rate } = req.body;

        // Verify caller is admin
        if (!req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                error: 'Only admin users can update exchange rates'
            });
        }

        if (!currency || rate === undefined || rate === null) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['currency', 'rate'],
                example: {
                    currency: 'USD',
                    rate: 1.0
                }
            });
        }

        if (typeof rate !== 'number' || rate <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Exchange rate must be a positive number'
            });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const result = await updateExchangeRate(
            walletPath,
            caller,
            currency.toUpperCase(),
            rate
        );

        res.json({
            success: true,
            message: `Exchange rate for ${currency.toUpperCase()} updated successfully`,
            currency: currency.toUpperCase(),
            rate: rate,
            updated_by: caller,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Update exchange rate error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Auto-sync blockchain exchange rates with real-time API
async function syncExchangeRatesToBlockchain() {
    try {
        console.log('🔄 Starting exchange rate sync to blockchain...');
        const supportedCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'NGN', 'KES', 'CNY', 'AUD', 'CAD'];
        const walletPath = path.join(process.cwd(), 'wallet');
        
        let successCount = 0;
        let failCount = 0;

        for (const currency of supportedCurrencies) {
            try {
                // Fetch live rate from API
                const rate = await getFXRate('USD', currency);
                
                // Update blockchain with the rate
                await updateExchangeRate(
                    walletPath,
                    'admin',
                    currency,
                    rate
                );
                
                console.log(`✅ Updated ${currency}: 1 USD = ${rate.toFixed(6)} ${currency}`);
                successCount++;
            } catch (err) {
                console.warn(`⚠️  Failed to update ${currency}: ${err.message}`);
                failCount++;
            }
        }

        console.log(`🔄 Exchange rate sync complete: ${successCount} updated, ${failCount} failed`);
    } catch (error) {
        console.error('❌ Exchange rate sync error:', error.message);
    }
}

server.listen(PORT, async () => {
    console.log(`Fabric Backend Server running on http://localhost:${PORT}`);
    console.log('Socket.io enabled for real-time updates');
    console.log('Available endpoints:');
    console.log(`  GET  http://localhost:${PORT}/api/health`);
    console.log(`  POST http://localhost:${PORT}/api/auth/register`);
    console.log(`  POST http://localhost:${PORT}/api/auth/login`);
    console.log(`  POST http://localhost:${PORT}/api/test-function/:functionName`);
    console.log('');
    console.log('This server will create actual wallet identities when Fabric network is available.');

    // Start listening to Chaincode Events (only after admin is enrolled from frontend)
    ensureEventListener(io, WALLET_PATH, 'admin');

    // Sync exchange rates immediately on startup (after admin is available)
    setTimeout(() => {
        syncExchangeRatesToBlockchain();
    }, 2000); // Wait 2 seconds for admin wallet to be ready

    // Schedule periodic sync every 1 hour
    setInterval(() => {
        syncExchangeRatesToBlockchain();
    }, 3600000); // 1 hour = 3600000 milliseconds
    
    console.log('📊 Exchange rates will sync every 1 hour');
});

// DEBUG: Check participant approval status
app.get('/api/debug/participant-status/:networkAddress', authenticateJWTOptional, async (req, res) => {
    try {
        const { networkAddress } = req.params;
        if (!networkAddress) {
            return res.status(400).json({ error: 'networkAddress required' });
        }

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const gateway = new Gateway();
        const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        const userId = req.user?.username || 'admin';
        await gateway.connect(ccp, { wallet, identity: userId, discovery: { enabled: true, asLocalhost: true } });
        const network = await gateway.getNetwork('mychannel');
        const contract = network.getContract('fabcar');

        try {
            // Query ledger for participant record
            const participantBytes = await contract.evaluateTransaction('GetParticipant', networkAddress);
            const participant = JSON.parse(participantBytes.toString());
            res.json({ found: true, type: 'Participant', data: participant });
        } catch (participantErr) {
            try {
                // Try to get as customer (need token ID)
                const listAllCustomers = await contract.evaluateTransaction('ListAllApprovedCustomers');
                const allCustomers = JSON.parse(listAllCustomers.toString());
                const matching = allCustomers.filter(c => c.network_address === networkAddress);
                if (matching.length > 0) {
                    res.json({ found: true, type: 'Customer', data: matching });
                } else {
                    res.json({ found: false, error: 'Participant or Customer not found', networkAddress });
                }
            } catch (customerErr) {
                res.json({ found: false, error: 'Query failed', details: customerErr.message, networkAddress });
            }
        }
    } catch (error) {
        console.error('Debug endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

// TOKEN HANDSHAKE ENDPOINTS ===================================================

// Request handshake between two tokens
// Request token handshake (auto-fetch myTokenID from bank)
app.post('/api/bank/handshake/request', authenticateJWT, async (req, res) => {
    try {
        const { otherTokenID } = req.body;
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);
        const walletPath = path.join(process.cwd(), 'wallet');

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found for this user. Please register the bank wallet first.'
            });
        }

        if (!otherTokenID) {
            return res.status(400).json({
                success: false,
                detail: 'otherTokenID is required'
            });
        }

        try {
            // Auto-fetch myTokenID from bank's participant record
            let myTokenID = await getTokenAccess(ownerNetworkAddress, walletPath, bankUserId);
            console.log(`[HANDSHAKE] Auto-fetched bank tokenID: ${myTokenID}, requesting handshake with: ${otherTokenID}`);

            const handshakeID = await requestTokenHandshake(walletPath, bankUserId, myTokenID, otherTokenID);
            
            res.json({
                success: true,
                message: `Handshake request created: ${myTokenID} → ${otherTokenID}`,
                myTokenID,
                otherTokenID,
                handshakeID,
                status: 'PENDING'
            });
        } catch (error) {
            console.error('Bank handshake request error:', error);
            res.status(500).json({
                success: false,
                detail: error.message
            });
        }
    } catch (error) {
        console.error('Bank handshake request error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Request token handshake (explicit myTokenID)
app.post('/api/handshake/request', authenticateJWT, async (req, res) => {
    try {
        const { myTokenID, otherTokenID } = req.body;
        const caller = req.user.username;
        const walletPath = path.join(process.cwd(), 'wallet');

        console.log(`[HANDSHAKE] Received request - caller: ${caller}, myTokenID: ${myTokenID}, otherTokenID: ${otherTokenID}`);

        if (!myTokenID || !otherTokenID) {
            return res.status(400).json({
                success: false,
                detail: 'myTokenID and otherTokenID are required'
            });
        }

        console.log(`[HANDSHAKE] Calling chaincode RequestTokenHandshake...`);
        // Chaincode now auto-generates and returns the handshakeID
        const handshakeID = await requestTokenHandshake(walletPath, caller, myTokenID, otherTokenID);
        
        console.log(`[HANDSHAKE] Chaincode call successful, generated handshakeID: ${handshakeID}`);
        res.json({
            success: true,
            message: `Handshake request created: ${myTokenID} → ${otherTokenID}`,
            handshakeID,
            status: 'PENDING'
        });
    } catch (error) {
        console.error('Handshake request error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// View pending handshake requests (auto-fetch tokenID from bank)
app.get('/api/bank/handshakes/pending', authenticateJWT, async (req, res) => {
    try {
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);
        const walletPath = path.join(process.cwd(), 'wallet');

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found for this user. Please register the bank wallet first.'
            });
        }

        try {
            // Auto-fetch tokenID from bank's participant record
            let tokenID = await getTokenAccess(ownerNetworkAddress, walletPath, bankUserId);
            console.log('Fetched bank tokenID for handshakes:', tokenID);

            const pending = await viewPendingTokenHandshakes(walletPath, bankUserId, tokenID);
            res.json({
                success: true,
                tokenID,
                pending: Array.isArray(pending) ? pending : [],
                count: (Array.isArray(pending) ? pending.length : 0)
            });
        } catch (error) {
            console.error('Auto-fetch handshakes error:', error);
            res.status(500).json({
                success: false,
                detail: error.message
            });
        }
    } catch (error) {
        console.error('Bank handshakes pending error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// View approved handshake requests (auto-fetch tokenID from bank)
app.get('/api/bank/handshakes', authenticateJWT, async (req, res) => {
    try {
        const bankUserId = req.user.username;
        const ownerNetworkAddress = getNetworkAddressForUser(bankUserId);
        const walletPath = path.join(process.cwd(), 'wallet');

        if (!ownerNetworkAddress) {
            return res.status(400).json({
                success: false,
                detail: 'Owner network address not found for this user. Please register the bank wallet first.'
            });
        }

        try {
            // Auto-fetch tokenID from bank's participant record
            let tokenID = await getTokenAccess(ownerNetworkAddress, walletPath, bankUserId);
            console.log('Fetched bank tokenID for approved handshakes:', tokenID);

            const handshakes = await viewTokenHandshakes(walletPath, bankUserId, tokenID);
            res.json({
                success: true,
                tokenID,
                handshakes: Array.isArray(handshakes) ? handshakes : [],
                count: (Array.isArray(handshakes) ? handshakes.length : 0)
            });
        } catch (error) {
            console.error('Auto-fetch approved handshakes error:', error);
            res.status(500).json({
                success: false,
                detail: error.message
            });
        }
    } catch (error) {
        console.error('Bank approved handshakes error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// View pending handshake requests for a token (with explicit tokenID)
app.get('/api/handshakes/pending/:tokenID', authenticateJWT, async (req, res) => {
    try {
        const { tokenID } = req.params;
        const caller = req.user.username;
        const walletPath = path.join(process.cwd(), 'wallet');

        const pending = await viewPendingTokenHandshakes(walletPath, caller, tokenID);
        res.json({
            success: true,
            tokenID,
            pending: Array.isArray(pending) ? pending : [],
            count: (Array.isArray(pending) ? pending.length : 0)
        });
    } catch (error) {
        console.error('View pending handshakes error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Approve a pending handshake request
app.post('/api/handshake/approve', authenticateJWT, async (req, res) => {
    try {
        const { handshakeID } = req.body;
        const caller = req.user.username;
        const walletPath = path.join(process.cwd(), 'wallet');

        if (!handshakeID) {
            return res.status(400).json({
                success: false,
                detail: 'handshakeID is required'
            });
        }

        await tokenHandshakeApprove(walletPath, caller, handshakeID);
        res.json({
            success: true,
            message: `Handshake approved`,
            handshakeID,
            status: 'APPROVED'
        });
    } catch (error) {
        console.error('Handshake approval error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// Check if two tokens have approved handshake
app.get('/api/handshake/check/:tokenA/:tokenB', authenticateJWT, async (req, res) => {
    try {
        const { tokenA, tokenB } = req.params;
        const caller = req.user.username;
        const walletPath = path.join(process.cwd(), 'wallet');

        const approved = await checkHandshake(walletPath, caller, tokenA, tokenB);
        res.json({
            success: true,
            tokenA,
            tokenB,
            approved,
            message: approved ? `${tokenA} and ${tokenB} have approved handshake` : `No handshake approved between ${tokenA} and ${tokenB}`
        });
    } catch (error) {
        console.error('Handshake check error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});

// View all handshakes for a token
app.get('/api/handshakes/:tokenID', authenticateJWT, async (req, res) => {
    try {
        const { tokenID } = req.params;
        const caller = req.user.username;
        const walletPath = path.join(process.cwd(), 'wallet');

        const handshakes = await viewTokenHandshakes(walletPath, caller, tokenID);
        res.json({
            success: true,
            tokenID,
            handshakes: Array.isArray(handshakes) ? handshakes : [],
            count: (Array.isArray(handshakes) ? handshakes.length : 0)
        });
    } catch (error) {
        console.error('View handshakes error:', error);
        res.status(500).json({
            success: false,
            detail: error.message
        });
    }
});
