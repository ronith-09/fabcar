/*
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';



const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

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
        console.error('Usage: node registerUser.js <name> <password>');
        process.exit(1);
    }

    try {

        // Load connection profile
        const ccpPath = path.resolve(__dirname, '..', '..', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');

        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        // Setup Fabric CA client
        const caURL = ccp.certificateAuthorities['ca.org1.example.com'].url;
        const ca = new FabricCAServices(caURL);

        // Setup wallet to hold identities
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        // Check if user already exists
        if (await wallet.get(name)) {
            console.log(`User identity ${name} already exists in wallet`);
            return;
        }

        // Check admin identity for registration
        const adminIdentity = await wallet.get('admin');
        if (!adminIdentity) {
            console.error('Admin identity not found in wallet. Please enroll admin first.');
            return;
        }
        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        // Register the user (enrollment secret)
        const secret = await ca.register({ affiliation: 'org1.department1', enrollmentID: name, role: 'client' }, adminUser);

        // Enroll the user using secret
        const enrollment = await ca.enroll({ enrollmentID: name, enrollmentSecret: secret });

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

        // Compute bcrypt password hash
        const passwordHash = await bcrypt.hash(password, 12);

        // Build Fabric ClientIdentity references from the enrollment certificate
        const { chaincodeID, subjectDN, issuerDN } = buildChaincodeIdentity(enrollment.certificate);

        // Human-friendly network address for UI / DB layers
        const networkAddress = `fabric://${name}@${identity.mspId}`;

        console.log(`User "${name}" registered and enrolled successfully.`);
        console.log(`Wallet identity created for user "${name}".`);
        console.log(`Network Address (Fabric URI): ${networkAddress}`);
        console.log(`ClientIdentity Subject DN: ${subjectDN}`);
        console.log(`ClientIdentity Issuer DN: ${issuerDN}`);
        console.log(`Chaincode Identity (base64 x509::subject::issuer): ${chaincodeID}`);

    } catch (error) {
        console.error(`Error in registration: ${error}`);
    }
}

main();
