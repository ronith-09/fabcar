const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;
const FABRIC_SERVER = process.env.FABRIC_SERVER || 'http://localhost:3001';
const DEFAULT_APP_BASE = 'http://localhost:3000';
const BETWEEN_APP_BASE = process.env.BETWEEN_APP_BASE || process.env.BETWEEN_UI_BASE || DEFAULT_APP_BASE;
const ENABLE_AUTO_REDIRECT = String(process.env.BETWEEN_AUTO_REDIRECT || 'true').toLowerCase() === 'true';
const BETWEEN_API_BASE = process.env.BETWEEN_API_BASE || FABRIC_SERVER;
const BANK_API_KEY = process.env.BANK_API_KEY;
if (!BANK_API_KEY) {
  console.error('CRITICAL: BANK_API_KEY environment variable is not set. Exiting.');
  process.exit(1);
}
const JWT_SECRET = process.env.FABRIC_JWT_SECRET;
if (!JWT_SECRET) {
  console.error('CRITICAL: FABRIC_JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}
const FABRIC_SERVICE_USER = process.env.FABRIC_SERVICE_USER || process.env.FABRIC_BANK_USER || 'admin';
const DB_PATH = path.join(__dirname, 'db.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Home page - Login/Signup entry
app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Bank - Customer Portal</title>
    <style>
      body { font-family: system-ui, Arial; margin: 0; color: #0f172a; background: linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
      .container { width: 100%; max-width: 400px; padding: 32px; }
      .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
      h1 { margin: 0 0 8px; text-align: center; color: #0284c7; }
      .subtitle { text-align: center; color: #475569; margin-bottom: 32px; font-size: 14px; }
      .tabs { display: flex; gap: 0; margin-bottom: 24px; }
      .tab { flex: 1; padding: 12px; text-align: center; border: none; background: #e2e8f0; cursor: pointer; font-size: 14px; font-weight: 500; }
      .tab.active { background: #0284c7; color: white; }
      .form { display: none; }
      .form.active { display: block; }
      label { display: block; margin-top: 16px; font-size: 13px; text-transform: uppercase; color: #475569; letter-spacing: 0.05em; }
      input { width: 100%; padding: 12px; margin-top: 6px; border-radius: 8px; border: 1px solid #cbd5f5; font-size: 15px; box-sizing: border-box; }
      button { width: 100%; padding: 12px; margin-top: 24px; background: #0284c7; color: white; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: 500; }
      button:hover { background: #0162a6; }
      .error { background: #fee2e2; color: #7f1d1d; padding: 12px; border-radius: 8px; margin-top: 16px; font-size: 13px; display: none; }
      .success { background: #dcfce7; color: #166534; padding: 12px; border-radius: 8px; margin-top: 16px; font-size: 13px; display: none; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="card">
        <h1>🏦 Bank Portal</h1>
        <p class="subtitle">Customer Account Management</p>
        
        <div class="tabs">
          <button class="tab active" onclick="switchTab('login')">Login</button>
          <button class="tab" onclick="switchTab('signup')">Sign Up</button>
        </div>
        
        <form id="loginForm" class="form active">
          <label>Phone<input id="loginPhone" type="tel" required placeholder="+1 555 1234567" /></label>
          <label>Password<input id="loginPassword" type="password" required placeholder="Password" /></label>
          <button type="submit">Login →</button>
          <div id="loginError" class="error"></div>
        </form>
        
        <form id="signupForm" class="form">
          <label>Full Name<input id="signupName" type="text" required placeholder="John Doe" /></label>
          <label>Phone<input id="signupPhone" type="tel" required placeholder="+1 555 1234567" /></label>
          <label>Email<input id="signupEmail" type="email" required placeholder="john@example.com" /></label>
          <label>Password<input id="signupPassword" type="password" required placeholder="Create a strong password" /></label>
          <button type="submit">Create Account →</button>
          <div id="signupError" class="error"></div>
          <div id="signupSuccess" class="success">Account created! Please login.</div>
        </form>
      </div>
    </div>
    
    <script>
      function switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
        event.target.classList.add('active');
        document.getElementById(tab + 'Form').classList.add('active');
      }
      
      document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = document.getElementById('loginPhone').value;
        const password = document.getElementById('loginPassword').value;
        const errorDiv = document.getElementById('loginError');
        
        try {
          const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
          });
          
          const data = await response.json();
          
          if (!response.ok) {
            errorDiv.textContent = data.error || 'Login failed';
            errorDiv.style.display = 'block';
            return;
          }
          
          // Store token and redirect to token selection
          localStorage.setItem('authToken', data.token);
          errorDiv.style.display = 'none';
          window.location.href = data.redirectUrl || '/customer-tokens';
        } catch (error) {
          errorDiv.textContent = 'Error: ' + error.message;
          errorDiv.style.display = 'block';
        }
      });
      
      document.getElementById('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('signupName').value;
        const phone = document.getElementById('signupPhone').value;
        const password = document.getElementById('signupPassword').value;
        const email = document.getElementById('signupEmail').value;
        const errorDiv = document.getElementById('signupError');
        const successDiv = document.getElementById('signupSuccess');
        
        try {
          const response = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, password, email })
          });
          
          const data = await response.json();
          
          if (!response.ok) {
            errorDiv.textContent = data.error || 'Signup failed';
            errorDiv.style.display = 'block';
            successDiv.style.display = 'none';
            return;
          }
          
          // Auto-login after signup and redirect to tokens page
          if (data.token) {
            localStorage.setItem('authToken', data.token);
            errorDiv.style.display = 'none';
            successDiv.style.display = 'block';
            document.getElementById('signupForm').reset();
            
            setTimeout(() => {
              window.location.href = '/customer-tokens';
            }, 1000);
          } else {
            // Fallback to login tab if no token returned
            errorDiv.style.display = 'none';
            successDiv.style.display = 'block';
            document.getElementById('signupForm').reset();
            setTimeout(() => {
              switchTab('login');
              successDiv.style.display = 'none';
            }, 2000);
          }
        } catch (error) {
          errorDiv.textContent = 'Error: ' + error.message;
          errorDiv.style.display = 'block';
        }
      });
    </script>
  </body>
</html>`);
});

const BANK_SIGNUP_FIELDS = [
  { key: 'name', label: 'Full Name', type: 'text', required: true, placeholder: 'Jane Doe' },
  { key: 'phone', label: 'Phone Number', type: 'tel', required: true, placeholder: '+1 555 123 4567' },
  { key: 'password', label: 'Password', type: 'password', required: true, placeholder: 'Create a strong password' },
  { key: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'jane@example.com' },
  { key: 'nationalId', label: 'National ID', type: 'text', required: true, placeholder: 'ID12345678' },
  { key: 'address', label: 'Residential Address', type: 'text', required: false, placeholder: '123 Main St, City' }
];

// Ensure db exists
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ anchors: [], users: [], kycEvents: [] }, null, 2));
}

function readDB() {
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  data.users = data.users || [];
  data.kycEvents = data.kycEvents || [];
  data.anchors = data.anchors || [];
  return data;
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Simple auth: register & login (demo only — do NOT use in production)
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function escapeHTML(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function recordKYCEvent(event) {
  const db = readDB();
  db.kycEvents = db.kycEvents || [];
  db.kycEvents.push(event);
  writeDB(db);
  return event;
}

function resolveFabricInvoker(user) {
  // Prefer explicit mapping from user attributes, then username, then fallback env
  return (
    user?.attributes?.fabricUserId ||
    user?.attributes?.ownerUserId ||
    user?.name ||
    FABRIC_SERVICE_USER
  );
}

function buildFabricAuthToken(identity) {
  const invoker = identity || FABRIC_SERVICE_USER;
  return jwt.sign(
    { username: invoker, sub: invoker, role: 'bank' },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
}

async function notifyBetweenNetwork(tokenId, payload, fabricUserId) {
  const url = new URL('/api/bank/register-customer', BETWEEN_API_BASE);
  const authToken = buildFabricAuthToken(fabricUserId);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bank-api-key': BANK_API_KEY,
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      ...payload,
      tokenID: tokenId
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.detail || `BetweenNetwork responded with ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function findUserByPhone(phone) {
  const db = readDB();
  return (db.users || []).find(u => u.phone === phone);
}

function createUserRecord({ name, phone, password, attributes = {} }) {
  if (!name || !phone || !password) {
    throw new Error('name, phone, password are required');
  }
  const db = readDB();
  db.users = db.users || [];
  if (db.users.find(u => u.phone === phone)) {
    throw new Error('user already exists');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);
  const user = {
    id: `u_${Date.now()}`,
    name,
    phone,
    salt,
    passwordHash,
    attributes,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeDB(db);
  return user;
}

app.post('/register', (req, res) => {
  const { name, phone, password, email } = req.body;
  try {
    const user = createUserRecord({ name, phone, password, email });
    // Return JWT token for auto-login
    const jwtToken = jwt.sign({ sub: user.id, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ ok: true, id: user.id, token: jwtToken, redirectUrl: '/customer-tokens' });
  } catch (error) {
    const status = error.message === 'user already exists' ? 409 : 400;
    res.status(status).json({ ok: false, error: error.message });
  }
});

app.post('/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'phone and password required' });
  const db = readDB();
  db.users = db.users || [];
  const user = db.users.find(u => u.phone === phone);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const attempted = hashPassword(password, user.salt);
  if (attempted !== user.passwordHash) return res.status(401).json({ error: 'invalid credentials' });
  const jwtToken = jwt.sign({ sub: user.id, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
  // Redirect to token selection/registration page instead of returning token directly
  res.json({ ok: true, token: jwtToken, redirectUrl: '/customer-tokens' });
});

// Customer token selection & registration page (after login/signup)
app.get('/customer-tokens', (req, res) => {
  res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Select Token - Customer Dashboard</title>
    <style>
      body { font-family: system-ui, Arial; margin: 0; color: #0f172a; background: #f1f5f9; padding: 32px; }
      main { max-width: 800px; margin: auto; }
      h1 { margin-bottom: 8px; }
      .info { background: #dbeafe; border-left: 4px solid #0284c7; padding: 16px; border-radius: 8px; margin-bottom: 24px; color: #0c4a6e; }
      .token-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
      .token-card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 4px 12px rgba(15,23,42,0.1); cursor: pointer; transition: all 0.3s; }
      .token-card:hover { box-shadow: 0 12px 24px rgba(15,23,42,0.15); transform: translateY(-2px); }
      .token-card h3 { margin: 0 0 12px; color: #1e40af; }
      .token-card p { margin: 8px 0; font-size: 14px; color: #475569; }
      .token-card button { width: 100%; padding: 12px; background: #0ea5e9; color: white; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; margin-top: 16px; }
      .token-card button:hover { background: #0284c7; }
      .loading { text-align: center; padding: 32px; color: #475569; }
      .error { background: #fee2e2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 8px; color: #7f1d1d; }
    </style>
  </head>
  <body>
    <main>
      <h1>Select a Token to Register</h1>
      <div class="info">
        <strong>Step 1 of 2:</strong> Choose a currency token to register with. You'll then be able to access your customer dashboard and manage your account.
      </div>
      <div id="tokenContainer" class="loading">Loading available tokens...</div>
      <div id="errorContainer"></div>
    </main>
    <script>
      const token = localStorage.getItem('authToken');
      
      async function loadTokens() {
        try {
          const response = await fetch('/api/available-tokens', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const data = await response.json();
          
          if (!response.ok) {
            document.getElementById('tokenContainer').innerHTML = '';
            document.getElementById('errorContainer').innerHTML = '<div class="error">Failed to load tokens: ' + (data.error || 'Unknown error') + '</div>';
            return;
          }
          
          const tokens = data.tokens || [];
          if (tokens.length === 0) {
            document.getElementById('tokenContainer').innerHTML = '<div class="error">No tokens available at this time. Please try again later.</div>';
            return;
          }
          
          const html = tokens.map(t => \`
            <div class="token-card">
              <h3>\${t.TokenID || t.token_id || 'Unknown'}</h3>
              <p><strong>Currency:</strong> \${t.Currency || 'N/A'}</p>
              <p>\${t.Description || 'Available digital currency token'}</p>
              <button onclick="registerToken('\${t.TokenID || t.token_id}')">
                Register with this Token →
              </button>
            </div>
          \`).join('');
          
          document.getElementById('tokenContainer').innerHTML = html;
        } catch (error) {
          document.getElementById('tokenContainer').innerHTML = '';
          document.getElementById('errorContainer').innerHTML = '<div class="error">Error loading tokens: ' + error.message + '</div>';
        }
      }
      
      function registerToken(tokenId) {
        localStorage.setItem('selectedToken', tokenId);
        
        // Auto-register and go straight to dashboard (skip registration form)
        const authToken = localStorage.getItem('authToken');
        if (!authToken) {
          window.location.href = '/';
          return;
        }
        
        // Get user info from JWT
        const parts = authToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          const userName = payload.name || 'Customer';
          
          // Register to token automatically
          fetch('/api/register-customer-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({
              tokenId: tokenId,
              name: userName,
              email: '',
              kycId: ''
            })
          }).then(res => res.json())
            .then(data => {
              if (data.ok) {
                // Directly go to dashboard
                window.location.href = '/customer-dashboard';
              } else {
                alert('Registration error: ' + (data.error || 'Unknown error'));
              }
            })
            .catch(err => {
              console.error('Registration error:', err);
              // Still go to dashboard even if registration fails
              window.location.href = '/customer-dashboard';
            });
        }
      }
      
      // Load tokens on page load
      if (!token) {
        window.location.href = '/';
      } else {
        loadTokens();
      }
    </script>
  </body>
</html>`);
});

// Customer token registration page
app.get('/customer-register', (req, res) => {
  const tokenId = req.query.tokenId || '';
  const token = req.query.token || '';
  
  res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Register Token - Customer Dashboard</title>
    <style>
      body { font-family: system-ui, Arial; margin: 0; color: #0f172a; background: #f1f5f9; padding: 32px; }
      main { max-width: 520px; margin: auto; background: white; padding: 32px; border-radius: 16px; box-shadow: 0 4px 12px rgba(15,23,42,0.1); }
      h1 { margin: 0 0 8px; }
      .info { background: #dbeafe; border-left: 4px solid #0284c7; padding: 16px; border-radius: 8px; margin: 20px 0; color: #0c4a6e; font-size: 14px; }
      .progress { display: flex; gap: 12px; margin: 24px 0; }
      .step { flex: 1; padding: 12px; background: #e2e8f0; text-align: center; border-radius: 8px; font-size: 13px; color: #475569; }
      .step.active { background: #0ea5e9; color: white; }
      .step.done { background: #10b981; color: white; }
      label { display: block; margin-top: 16px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; }
      label span { display: block; margin-bottom: 6px; }
      input, textarea { width: 100%; padding: 12px; margin-top: 6px; border-radius: 8px; border: 1px solid #cbd5f5; font-size: 15px; box-sizing: border-box; }
      button { width: 100%; padding: 14px; margin-top: 24px; background: #10b981; border: none; color: white; font-size: 16px; border-radius: 8px; cursor: pointer; }
      button:hover { background: #059669; }
      .result { background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 8px; margin-top: 24px; max-height: 200px; overflow: auto; font-size: 12px; display: none; }
      .success { background: #dcfce7; border: 1px solid #86efac; color: #166534; padding: 16px; border-radius: 8px; margin-top: 24px; display: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>Register to Token</h1>
      <div class="progress">
        <div class="step done">1. Login</div>
        <div class="step active">2. Register Token</div>
        <div class="step">3. Dashboard</div>
      </div>
      <div class="info">
        Complete your token registration to unlock your customer dashboard and start managing your account.
      </div>
      
      <form id="registerForm">
        <label>
          <span>Token ID</span>
          <input type="text" id="tokenId" value="${escapeHTML(tokenId)}" readonly />
        </label>
        
        <label>
          <span>Full Name</span>
          <input type="text" id="name" required placeholder="Your full name" />
        </label>
        
        <label>
          <span>Email (Optional)</span>
          <input type="email" id="email" placeholder="your@email.com" />
        </label>
        
        <label>
          <span>KYC ID (if available)</span>
          <input type="text" id="kycId" placeholder="Your KYC identification number" />
        </label>
        
        <button type="submit">Complete Registration →</button>
      </form>
      
      <div id="result" class="result"></div>
      <div id="success" class="success">
        <strong>Registration Complete!</strong> Redirecting to your dashboard...
      </div>
    </main>
    <script>
      const form = document.getElementById('registerForm');
      const result = document.getElementById('result');
      const success = document.getElementById('success');
      const authToken = localStorage.getItem('authToken');
      
      if (!authToken) {
        window.location.href = '/';
      }
      
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        result.style.display = 'block';
        result.textContent = 'Registering to token...';
        
        try {
          const response = await fetch('/api/register-customer-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({
              tokenId: document.getElementById('tokenId').value,
              name: document.getElementById('name').value,
              email: document.getElementById('email').value,
              kycId: document.getElementById('kycId').value
            })
          });
          
          const data = await response.json();
          
          if (!response.ok) {
            result.textContent = 'Error: ' + (data.error || 'Registration failed');
            result.style.color = '#dc2626';
            return;
          }
          
          result.style.display = 'none';
          success.style.display = 'block';
          localStorage.setItem('selectedToken', document.getElementById('tokenId').value);
          
          setTimeout(() => {
            window.location.href = '/customer-dashboard';
          }, 2000);
        } catch (error) {
          result.textContent = 'Error: ' + error.message;
          result.style.color = '#dc2626';
        }
      });
    </script>
  </body>
</html>`);
});

// API endpoint: Get available tokens
app.get('/api/available-tokens', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  // Return sample tokens - in production, fetch from blockchain
  const tokens = [
    { TokenID: 'token_1', Currency: 'USD', Description: 'US Dollar Token' },
    { TokenID: 'token_2', Currency: 'EUR', Description: 'Euro Token' },
    { TokenID: 'token_3', Currency: 'GBP', Description: 'British Pound Token' },
  ];
  
  res.json({ ok: true, tokens });
});

// API endpoint: Register customer to token
app.post('/api/register-customer-token', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const { tokenId, name, email, kycId } = req.body;
  
  if (!tokenId || !name) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Store token registration for user
  const db = readDB();
  if (!db.tokenRegistrations) {
    db.tokenRegistrations = [];
  }
  
  db.tokenRegistrations.push({
    userId: user.sub,
    tokenId,
    name,
    email,
    kycId,
    registeredAt: new Date().toISOString()
  });
  
  writeDB(db);
  
  res.json({ 
    ok: true, 
    message: 'Successfully registered to token',
    tokenId,
    redirectUrl: '/customer-dashboard'
  });
});

// Customer Dashboard (protected route)
app.get('/customer-dashboard', (req, res) => {
  res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Customer Dashboard</title>
    <style>
      body { font-family: system-ui, Arial; margin: 0; color: #0f172a; background: #f1f5f9; }
      header { background: white; padding: 20px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center; }
      header h1 { margin: 0; font-size: 24px; }
      .logout-btn { padding: 10px 20px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; }
      main { max-width: 1200px; margin: auto; padding: 32px; }
      .welcome { background: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
      .welcome h2 { margin: 0 0 12px; }
      .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-top: 24px; }
      .stat-card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); text-align: center; }
      .stat-card .label { font-size: 13px; color: #475569; text-transform: uppercase; }
      .stat-card .value { font-size: 32px; font-weight: bold; color: #0ea5e9; margin: 8px 0; }
      .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
      .action-btn { background: #0ea5e9; color: white; padding: 16px; border-radius: 12px; text-align: center; text-decoration: none; cursor: pointer; border: none; font-size: 15px; }
      .action-btn:hover { background: #0284c7; }
    </style>
  </head>
  <body>
    <header>
      <h1>💰 Customer Dashboard</h1>
      <button class="logout-btn" onclick="logout()">Logout</button>
    </header>
    <main>
      <div class="welcome">
        <h2>Welcome back!</h2>
        <p id="userInfo">Loading...</p>
        <div class="stats">
          <div class="stat-card">
            <div class="label">Selected Token</div>
            <div class="value" id="tokenValue">-</div>
          </div>
          <div class="stat-card">
            <div class="label">Account Status</div>
            <div class="value" id="statusValue">✓</div>
          </div>
          <div class="stat-card">
            <div class="label">Registration Date</div>
            <div class="value" id="dateValue">Today</div>
          </div>
        </div>
      </div>
      
      <div class="actions">
        <button class="action-btn">View Balance →</button>
        <button class="action-btn">Send Transfer →</button>
        <button class="action-btn">Transaction History →</button>
        <button class="action-btn">Account Settings →</button>
      </div>
    </main>
    <script>
      const authToken = localStorage.getItem('authToken');
      const selectedToken = localStorage.getItem('selectedToken');
      
      if (!authToken) {
        window.location.href = '/';
      }
      
      document.getElementById('userInfo').textContent = 'Welcome to your customer portal';
      document.getElementById('tokenValue').textContent = selectedToken || 'N/A';
      document.getElementById('statusValue').textContent = 'Active ✓';
      document.getElementById('dateValue').textContent = new Date().toLocaleDateString();
      
      function logout() {
        localStorage.removeItem('authToken');
        localStorage.removeItem('selectedToken');
        window.location.href = '/';
      }
    </script>
  </body>
</html>`);
});
app.get('/between/signup', (req, res) => {
  const tokenId = req.query.tokenId || '';
  const networkAddress = req.query.networkAddress || '';
  const fieldInputs = BANK_SIGNUP_FIELDS.map(field => {
    const attrs = [
      `id="${field.key}"`,
      `name="${field.key}"`,
      `type="${field.type || 'text'}"`,
      field.placeholder ? `placeholder="${escapeHTML(field.placeholder)}"` : '',
      field.required ? 'required' : ''
    ].filter(Boolean).join(' ');
    return `
        <label>
          <span>${escapeHTML(field.label || field.key)}</span>
          <input ${attrs} />
        </label>`;
  }).join('\n');
  res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Bank Signup · ${escapeHTML(tokenId)}</title>
    <style>
      body{font-family:system-ui,Arial;margin:32px;color:#0f172a;background:#f1f5f9}
      main{max-width:520px;margin:auto;background:white;padding:32px;border-radius:20px;box-shadow:0 20px 55px rgba(15,23,42,0.15)}
      h1{margin-bottom:8px}
      label{display:block;margin-top:16px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#475569}
      label span{display:block;margin-bottom:6px}
      input{width:100%;padding:12px;border-radius:12px;border:1px solid #cbd5f5;font-size:15px}
      button{width:100%;margin-top:24px;padding:14px;background:#0ea5e9;border:none;color:white;font-size:16px;border-radius:12px;cursor:pointer}
      pre{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:12px;margin-top:24px;max-height:220px;overflow:auto;font-size:12px}
    </style>
  </head>
  <body>
    <main>
      <h1>Create Bank Profile</h1>
      <p style="margin:0 0 20px;color:#475569">
        Provide the required information so the bank can link <strong>${escapeHTML(networkAddress)}</strong> to token <strong>${escapeHTML(tokenId)}</strong>.
      </p>
      <form id="bankSignupForm">
        ${fieldInputs}
        <input type="hidden" id="tokenId" name="tokenId" value="${escapeHTML(tokenId)}" />
        <input type="hidden" id="networkAddress" name="networkAddress" value="${escapeHTML(networkAddress)}" />
        <button type="submit">Submit for Approval</button>
      </form>
      <pre id="signupResult">Fill the form to begin.</pre>
    </main>
    <script>
      const form = document.getElementById('bankSignupForm');
      const result = document.getElementById('signupResult');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        result.textContent = 'Submitting...';
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());
        try {
          const response = await fetch('/between/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await response.json();
          result.textContent = JSON.stringify(data, null, 2);
        } catch (error) {
          result.textContent = error.message || 'Unexpected error';
        }
      });
    </script>
  </body>
</html>`);
});

app.post('/between/signup', (req, res) => {
  try {
    const payload = req.body || {};
    const missing = BANK_SIGNUP_FIELDS
      .filter(f => f.required && !payload[f.key])
      .map(f => f.key);
    if (missing.length > 0) {
      return res.status(400).json({ ok: false, error: `Missing fields: ${missing.join(', ')}` });
    }
    const attributes = BANK_SIGNUP_FIELDS
      .filter(f => !['name', 'phone', 'password'].includes(f.key))
      .reduce((acc, field) => {
        if (payload[field.key]) {
          acc[field.key] = payload[field.key];
        }
        return acc;
      }, {});
    const user = createUserRecord({
      name: payload.name,
      phone: payload.phone,
      password: payload.password,
      attributes
    });
    res.json({
      ok: true,
      userId: user.id,
      message: 'Signup complete. Bank review pending before KYC approval.',
      tokenId: payload.tokenId || null,
      networkAddress: payload.networkAddress || null
    });
  } catch (error) {
    const status = error.message === 'user already exists' ? 409 : 400;
    res.status(status).json({ ok: false, error: error.message });
  }
});

// Render login page that receives tokenId + networkAddress from BetweenNetwork
app.get('/between/login', (req, res) => {
  const tokenId = req.query.tokenId || '';
  const networkAddress = req.query.networkAddress || '';
  res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Bank Login · ${escapeHTML(tokenId)}</title>
    <style>
      body{font-family:system-ui,Arial;margin:32px;color:#0f172a;background:#f8fafc}
      main{max-width:480px;margin:auto;background:white;padding:32px;border-radius:16px;box-shadow:0 10px 40px rgba(15,23,42,0.1)}
      label{display:block;margin-top:16px;font-size:14px;text-transform:uppercase;color:#475569;letter-spacing:0.05em}
      input,button{width:100%;padding:12px;margin-top:6px;border-radius:10px;border:1px solid #cbd5f5;font-size:16px}
      button{background:#2563eb;color:white;border:none;margin-top:20px;cursor:pointer}
      pre{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:12px;margin-top:24px;max-height:240px;overflow:auto;font-size:12px}
    </style>
  </head>
  <body>
    <main>
      <h1 style="margin:0;">Bank Login</h1>
      <p style="color:#475569;margin:8px 0 20px;">Connect account <strong>${escapeHTML(networkAddress)}</strong> to token <strong>${escapeHTML(tokenId)}</strong>.</p>
      <form id="bankLoginForm">
        <label>Phone Number<input id="phone" required placeholder="Registered phone" /></label>
        <label>Password<input id="password" type="password" required placeholder="Password" /></label>
        <input id="tokenId" type="hidden" value="${escapeHTML(tokenId)}" />
        <input id="networkAddress" type="hidden" value="${escapeHTML(networkAddress)}" />
        <button type="submit">Login &amp; Approve KYC</button>
      </form>
      <pre id="result">Waiting for submission…</pre>
      <div id="redirectNotice" style="display:none;margin-top:16px;">
        <p style="margin:0;color:#475569">Return to BetweenNetwork:</p>
        <a id="redirectLink" href="#" target="_blank" rel="noopener" style="color:#2563eb;"></a>
      </div>
    </main>
    <script>
      const form = document.getElementById('bankLoginForm');
      const result = document.getElementById('result');
      const redirectNotice = document.getElementById('redirectNotice');
      const redirectLink = document.getElementById('redirectLink');
      const shouldAutoRedirect = ${ENABLE_AUTO_REDIRECT ? 'true' : 'false'};
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        result.textContent = 'Submitting...';
        const payload = {
          phone: document.getElementById('phone').value,
          password: document.getElementById('password').value,
          tokenId: document.getElementById('tokenId').value,
          networkAddress: document.getElementById('networkAddress').value
        };
        try {
          const response = await fetch('/between/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await response.json();
          result.textContent = JSON.stringify(data, null, 2);
          if (data?.redirectUrl) {
            redirectNotice.style.display = 'block';
            redirectLink.textContent = data.redirectUrl;
            redirectLink.href = data.redirectUrl;
            if (response.ok && shouldAutoRedirect) {
              window.location = data.redirectUrl;
            }
          }
        } catch (error) {
          result.textContent = error.message || 'Unexpected error';
        }
      });
    </script>
  </body>
</html>`);
});

// Verify login, run KYC, and notify BetweenNetwork
app.post('/between/login', async (req, res) => {
  try {
    const { phone, password, tokenId, networkAddress } = req.body || {};
    if (!phone || !password || !tokenId || !networkAddress) {
      return res.status(400).json({ ok: false, error: 'phone, password, tokenId, networkAddress required' });
    }

    let user = findUserByPhone(phone);
    if (!user) {
      try {
        user = createUserRecord({
          name: req.body?.name || phone,
          phone,
          password,
          attributes: {
            autoProvisioned: true,
            provisionedAt: new Date().toISOString(),
            tokenId,
            networkAddress
          }
        });
      } catch (provisionError) {
        console.error('Auto-provision failed:', provisionError);
        return res.status(400).json({ ok: false, error: provisionError.message || 'user not found' });
      }
    }
    const attempted = hashPassword(password, user.salt);
    if (attempted !== user.passwordHash) {
      return res.status(401).json({ ok: false, error: 'invalid credentials' });
    }

    const kycId = `kyc_${Date.now()}`;
    const event = recordKYCEvent({
      eventId: `kyc_evt_${Date.now()}`,
      tokenId,
      networkAddress,
      customerId: user.id,
      customerName: user.name,
      kycId,
      kycStatus: true,
      createdAt: new Date().toISOString()
    });

    const fabricUserId = resolveFabricInvoker(user);
    const betweenPayload = {
      customerId: user.id,
      networkAddress,
      kycId,
      kycStatus: true,
      name: user.name,
      // Ensure the invoked user matches the JWT subject sent to Fabric server
      userId: fabricUserId
    };

    let betweenResponse = null;
    try {
      betweenResponse = await notifyBetweenNetwork(tokenId, betweenPayload, fabricUserId);
    } catch (error) {
      return res.status(502).json({
        ok: false,
        error: 'Failed to notify BetweenNetwork',
        detail: error.message,
        event
      });
    }

    const redirectBase = (BETWEEN_APP_BASE || FABRIC_SERVER || '').replace(/\/$/, '');
    const redirectUrl = `${redirectBase}/token/${encodeURIComponent(tokenId)}/registered?status=success&networkAddress=${encodeURIComponent(networkAddress)}`;

    res.json({
      ok: true,
      event,
      between: betweenResponse,
      redirectUrl
    });
  } catch (error) {
    console.error('Bank login processing failed:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// SECURED: Simple audit endpoint restricted to local dev or authorized users only (disabled for public demo)
app.get('/between/kyc-events', (req, res) => {
  // In a real app, verify admin JWT here. For demo security, we disable the public dump.
  res.status(403).json({
    ok: false,
    error: 'Access denied: Public PII dump disabled for security.'
  });
});

// SECURED: Get customer details (PII) for the Dashboard.
// Requires VALID x-bank-api-key to prevent unauthorized access.
app.get('/between/customer/:id', (req, res) => {
  const apiKey = req.headers['x-bank-api-key'];
  if (!apiKey || apiKey !== BANK_API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid API Key' });
  }

  const customerId = req.params.id;
  const db = readDB();
  const user = (db.users || []).find(u => u.id === customerId);

  if (!user) {
    return res.status(404).json({ ok: false, error: 'Customer not found' });
  }

  // Return only necessary PII
  res.json({
    ok: true,
    customer: {
      id: user.id,
      name: user.name,
      email: user.email || 'N/A',
      phone: user.phone,
      nationalId: user.nationalId || 'N/A',
      address: user.address || 'N/A',
      joinedAt: user.createdAt
    }
  });
});

app.listen(PORT, () => {
  console.log(`Bank demo server running on http://localhost:${PORT}`);
  console.log(`Demo UI: http://localhost:${PORT}/`);
  console.log(`Between login endpoint: http://localhost:${PORT}/between/login?tokenId=BNET-USD-ROOT-v1&networkAddress=example`);
});
