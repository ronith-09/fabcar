/**
 * Wallet Wrapper - Handles encryption/decryption transparently
 * Wraps fabric-network Wallets to add encryption support
 */

const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');
const { decryptWalletContent, getMasterPassword } = require('./wallet-encryption');

/**
 * Create an encrypted file system wallet
 * Wraps standard Wallets.newFileSystemWallet to add decryption on read
 * @param {string} walletPath - Path to wallet directory
 * @returns {Promise<object>} Encrypted wallet instance
 */
async function newEncryptedFileSystemWallet(walletPath) {
    const baseWallet = await Wallets.newFileSystemWallet(walletPath);
    const masterPassword = getMasterPassword();

    // Wrap the wallet's get() method to decrypt on read
    const originalGet = baseWallet.get.bind(baseWallet);
    
    baseWallet.get = async function(label) {
        try {
            const identity = await originalGet(label);
            if (!identity) return identity;

            // Check if wallet is encrypted and decrypt if needed
            if (identity.credentials && 
                typeof identity.credentials.privateKey === 'object' && 
                identity.credentials.privateKey.isEncrypted) {
                
                return decryptWalletContent(identity, masterPassword);
            }

            return identity;
        } catch (error) {
            console.error(`Failed to get identity ${label}:`, error.message);
            throw error;
        }
    };

    // Wrap the wallet's list() method to handle decryption
    const originalList = baseWallet.list.bind(baseWallet);
    
    baseWallet.list = async function() {
        const labels = await originalList();
        return labels; // Return list as-is, decryption happens on get()
    };

    return baseWallet;
}

module.exports = {
    newEncryptedFileSystemWallet,
};
