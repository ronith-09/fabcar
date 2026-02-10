/**
 * Wallet Encryption Utility
 * Encrypts/decrypts private keys in wallet files for security
 * Uses AES-256-GCM encryption with argon2 key derivation
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Encryption configuration
const ENCRYPTION_CONFIG = {
    algorithm: 'aes-256-gcm',
    saltLength: 32,
    ivLength: 16,
    tagLength: 16,
    keyLength: 32,
    iterations: 3, // argon2i iterations (fast for demo, increase for production)
};

/**
 * Derive encryption key from master password using PBKDF2
 * @param {string} masterPassword - Master encryption password
 * @param {Buffer} salt - Salt for key derivation
 * @returns {Buffer} Derived encryption key
 */
function deriveKey(masterPassword, salt) {
    return crypto.pbkdf2Sync(
        masterPassword,
        salt,
        100000, // iterations
        ENCRYPTION_CONFIG.keyLength,
        'sha256'
    );
}

/**
 * Encrypt a private key
 * @param {string} privateKey - PEM-formatted private key
 * @param {string} masterPassword - Master encryption password
 * @returns {object} Encrypted data with salt, iv, encrypted key, and tag
 */
function encryptPrivateKey(privateKey, masterPassword) {
    if (!privateKey || !masterPassword) {
        throw new Error('Private key and master password are required');
    }

    // Generate random salt and IV
    const salt = crypto.randomBytes(ENCRYPTION_CONFIG.saltLength);
    const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);

    // Derive encryption key from password
    const key = deriveKey(masterPassword, salt);

    // Create cipher and encrypt
    const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.algorithm, key, iv);
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get authentication tag
    const tag = cipher.getAuthTag();

    return {
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        encrypted: encrypted,
        tag: tag.toString('hex'),
        algorithm: ENCRYPTION_CONFIG.algorithm,
    };
}

/**
 * Decrypt a private key
 * @param {object} encryptedData - Encrypted data object with salt, iv, encrypted, tag
 * @param {string} masterPassword - Master encryption password
 * @returns {string} Decrypted PEM-formatted private key
 */
function decryptPrivateKey(encryptedData, masterPassword) {
    if (!encryptedData || !masterPassword) {
        throw new Error('Encrypted data and master password are required');
    }

    try {
        // Reconstruct buffers from hex strings
        const salt = Buffer.from(encryptedData.salt, 'hex');
        const iv = Buffer.from(encryptedData.iv, 'hex');
        const tag = Buffer.from(encryptedData.tag, 'hex');
        const encrypted = encryptedData.encrypted;

        // Derive key using same salt
        const key = deriveKey(masterPassword, salt);

        // Create decipher
        const decipher = crypto.createDecipheriv(encryptedData.algorithm || ENCRYPTION_CONFIG.algorithm, key, iv);
        decipher.setAuthTag(tag);

        // Decrypt
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (error) {
        throw new Error(`Failed to decrypt private key: ${error.message}`);
    }
}

/**
 * Encrypt wallet file
 * @param {string} walletFilePath - Path to wallet file
 * @param {string} masterPassword - Master encryption password
 * @returns {boolean} True if encryption successful
 */
function encryptWalletFile(walletFilePath, masterPassword) {
    try {
        if (!fs.existsSync(walletFilePath)) {
            console.warn(`Wallet file not found: ${walletFilePath}`);
            return false;
        }

        // Read wallet file
        const walletContent = fs.readFileSync(walletFilePath, 'utf8');
        const wallet = JSON.parse(walletContent);

        // Skip if already encrypted
        if (wallet.credentials.privateKey && typeof wallet.credentials.privateKey === 'object' && wallet.credentials.privateKey.isEncrypted) {
            console.log(`Wallet already encrypted: ${path.basename(walletFilePath)}`);
            return true;
        }

        // Encrypt private key
        const privateKey = wallet.credentials.privateKey;
        if (!privateKey) {
            console.warn(`No private key found in: ${walletFilePath}`);
            return false;
        }

        const encryptedData = encryptPrivateKey(privateKey, masterPassword);
        encryptedData.isEncrypted = true; // Mark as encrypted (preserves 'encrypted' hex data)

        // Update wallet
        wallet.credentials.privateKey = encryptedData;
        wallet.encrypted = true;
        wallet.encryptedAt = new Date().toISOString();

        // Write encrypted wallet back
        fs.writeFileSync(walletFilePath, JSON.stringify(wallet, null, 2));
        console.log(`✓ Encrypted wallet: ${path.basename(walletFilePath)}`);
        return true;
    } catch (error) {
        console.error(`Failed to encrypt wallet file ${walletFilePath}:`, error.message);
        return false;
    }
}

/**
 * Decrypt wallet file content (for reading)
 * @param {object} wallet - Wallet object (parsed JSON)
 * @param {string} masterPassword - Master encryption password
 * @returns {object} Wallet with decrypted private key
 */
function decryptWalletContent(wallet, masterPassword) {
    try {
        if (!wallet.credentials.privateKey) {
            return wallet;
        }

        // Check if already decrypted (string = plaintext, object = encrypted)
        if (typeof wallet.credentials.privateKey === 'string') {
            return wallet; // Already plaintext
        }

        if (!wallet.credentials.privateKey.isEncrypted) {
            return wallet; // Not encrypted
        }

        // Decrypt private key
        const decrypted = decryptPrivateKey(wallet.credentials.privateKey, masterPassword);
        
        // Create copy with decrypted key
        const decryptedWallet = JSON.parse(JSON.stringify(wallet));
        decryptedWallet.credentials.privateKey = decrypted;

        return decryptedWallet;
    } catch (error) {
        console.error('Failed to decrypt wallet:', error.message);
        throw error;
    }
}

/**
 * Get master password from environment or prompt
 * @returns {string} Master password
 */
function getMasterPassword() {
    // Priority: env var > default (for demo)
    const password = process.env.FABRIC_WALLET_PASSWORD || 
                    process.env.WALLET_ENCRYPTION_PASSWORD || 
                    'fabric-default-password-change-me'; // ⚠️ CHANGE IN PRODUCTION
    
    if (password === 'fabric-default-password-change-me') {
        console.warn('⚠️  WARNING: Using default wallet encryption password!');
        console.warn('   Set FABRIC_WALLET_PASSWORD environment variable for production.');
    }

    return password;
}

/**
 * Encrypt all wallet files in directory
 * @param {string} walletDir - Wallet directory path
 * @param {string} masterPassword - Master encryption password
 * @returns {number} Number of successfully encrypted wallets
 */
function encryptAllWallets(walletDir, masterPassword) {
    try {
        if (!fs.existsSync(walletDir)) {
            console.warn(`Wallet directory not found: ${walletDir}`);
            return 0;
        }

        const files = fs.readdirSync(walletDir);
        let encrypted = 0;

        for (const file of files) {
            if (file.endsWith('.id') || file.endsWith('.json')) {
                const filePath = path.join(walletDir, file);
                if (encryptWalletFile(filePath, masterPassword)) {
                    encrypted++;
                }
            }
        }

        return encrypted;
    } catch (error) {
        console.error('Failed to encrypt wallets:', error.message);
        return 0;
    }
}

module.exports = {
    encryptPrivateKey,
    decryptPrivateKey,
    encryptWalletFile,
    decryptWalletContent,
    getMasterPassword,
    encryptAllWallets,
    ENCRYPTION_CONFIG,
};
