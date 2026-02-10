const { generateKeyPairSync } = require('crypto');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, 'keys');
if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync(path.join(keysDir, 'BankAuth_private.pem'), privateKey, { mode: 0o600 });
fs.writeFileSync(path.join(keysDir, 'BankAuth_public.pem'), publicKey);

const dbPath = path.join(__dirname, 'db.json');
let db;
try {
	db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
} catch (e) {
	console.error('Failed to read db.json:', e.message);
	process.exit(1);
}

if (db.owners && db.owners.length) {
	db.owners[0].publicKeyPem = publicKey;
	fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
	console.log('Updated db.json with publicKeyPem for owner', db.owners[0].ownerID);
} else {
	console.log('No owners found in db.json; keys written to', keysDir);
}

console.log('\nPublic key:\n');
console.log(publicKey);
console.log('\nPrivate key written to', path.join(keysDir, 'BankAuth_private.pem'));

