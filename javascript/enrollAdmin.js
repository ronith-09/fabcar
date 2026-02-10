/*
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { encryptWalletFile, getMasterPassword } = require('./wallet-encryption');

function formatDistinguishedName(dn) {
    return (dn || '')
        .split(/\r?\n/)
        .map(part => part.trim())
        .map(part => part.replace(/\s*\+\s*/g, '+'))
        .filter(Boolean)
        .reverse()
        .join(',');
}

function buildChaincodeIdentity(certificate) {
    const certificateInfo = new crypto.X509Certificate(certificate);
    const subjectDN = formatDistinguishedName(certificateInfo.subject);
    const issuerDN = formatDistinguishedName(certificateInfo.issuer);
    const rawIdentity = `x509::${subjectDN}::${issuerDN}`;
    const chaincodeID = Buffer.from(rawIdentity, 'utf8').toString('base64');
    return { chaincodeID, subjectDN, issuerDN };
}

async function main() {
    const name = process.argv[2];
    const password = process.argv[3];

    if (!name || !password) {
        console.error('Usage: node enrollAdmin.js <name> <password>');
        process.exit(1);
    }

    try {

        console.log('Loading connection profile...');
        const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');

        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        const caURL = ccp.certificateAuthorities['ca.org1.example.com'].url;
        const ca = new FabricCAServices(caURL);

        console.log('Setting up wallet...');
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        const adminIdentity = await wallet.get(name);
        if (adminIdentity) {
            console.log(`Admin identity ${name} already exists in wallet`);
            return;
        }
        console.log(`Enrolling admin ${name}...`);
        const enrollment = await ca.enroll({ enrollmentID: name, enrollmentSecret: password });

        const identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: 'Org1MSP',
            type: 'X.509',
        };

        await wallet.put(name, identity);

        // Encrypt wallet file
        const walletFilePath = path.join(walletPath, `${name}.id`);
        const masterPassword = getMasterPassword();
        
        try {
            encryptWalletFile(walletFilePath, masterPassword);
        } catch (encryptError) {
            console.warn(`⚠️  Warning: Failed to encrypt wallet file:`, encryptError.message);
            console.warn('   Wallet saved but NOT encrypted. Set FABRIC_WALLET_PASSWORD env var.');
        }

        // Compute bcrypt password hash
        const passwordHash = await bcrypt.hash(password, 12);

        // Build Fabric ClientIdentity references from the enrollment certificate
        const { chaincodeID, subjectDN, issuerDN } = buildChaincodeIdentity(enrollment.certificate);

        const networkAddress = chaincodeID;

        console.log(`Successfully enrolled admin "${name}" and imported into wallet`);
        console.log(`Network Address (Fabric identity): ${networkAddress}`);
        console.log(`ClientIdentity Subject DN: ${subjectDN}`);
        console.log(`ClientIdentity Issuer DN: ${issuerDN}`);
        console.log(`Chaincode Identity (base64 x509::subject::issuer): ${chaincodeID}`);
    } catch (error) {
        console.error(`Error enrolling admin "${name}":`, error);
    }
}

main();
