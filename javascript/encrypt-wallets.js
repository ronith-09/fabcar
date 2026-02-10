#!/usr/bin/env node

/**
 * Encrypt Wallets Script
 * Encrypts all wallet files in the wallet directory
 * Usage: node encrypt-wallets.js [password]
 */

const path = require('path');
const { encryptAllWallets, getMasterPassword } = require('./wallet-encryption');

async function main() {
    const walletDir = path.join(process.cwd(), 'wallet');
    
    // Get master password
    let masterPassword = process.argv[2];
    
    if (!masterPassword) {
        masterPassword = getMasterPassword();
        console.log('Using password from environment: FABRIC_WALLET_PASSWORD or default');
    } else {
        console.log('Using password from command line argument');
    }

    if (masterPassword === 'fabric-default-password-change-me') {
        console.warn('\n⚠️  WARNING: Using default encryption password!');
        console.warn('   Set FABRIC_WALLET_PASSWORD environment variable for production:');
        console.warn('   export FABRIC_WALLET_PASSWORD="your-secure-password"');
        console.warn('\n   Proceeding with default password for now...\n');
    }

    console.log(`Encrypting wallets in: ${walletDir}`);
    console.log('-------------------------------------------');

    const encrypted = encryptAllWallets(walletDir, masterPassword);

    console.log('-------------------------------------------');
    console.log(`✓ Successfully encrypted ${encrypted} wallet(s)`);
    
    if (encrypted > 0) {
        console.log('\n✅ Wallet encryption complete!');
        console.log('   All private keys are now encrypted at rest.');
        console.log('   Make sure to set FABRIC_WALLET_PASSWORD when starting the application.');
    } else {
        console.warn('\n⚠️  No wallets were encrypted. Check the wallet directory.');
    }
}

main().catch(error => {
    console.error('Error encrypting wallets:', error.message);
    process.exit(1);
});
