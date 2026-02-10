import { useState, useEffect } from 'react';
import { CustomerToTokenTransfer } from '../components';

export default function TransferHub({ userRole, userId }) {
  const [userNetworkAddress, setUserNetworkAddress] = useState('');
  const [selectedTokenId, setSelectedTokenId] = useState('');
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // In a real app, fetch user's network address from localStorage or auth context
    const storedAddress = localStorage.getItem('userNetworkAddress');
    if (storedAddress) {
      setUserNetworkAddress(storedAddress);
    }

    // Fetch available tokens
    fetchTokens();
  }, []);

  const fetchTokens = async () => {
    setLoading(true);
    try {
      // This would call the real backend endpoint
      // const response = await fetch('/api/customer/view-all-tokens');
      // const data = await response.json();
      // setTokens(data.tokens || []);
      
      // For now, use mock data
      setTokens([
        { token_id: 'HDFC-USD-8f2a3b4c-v1', currency: 'USD' },
        { token_id: 'SBI-INR-5a8c9f2d-v1', currency: 'INR' },
        { token_id: 'ICICI-EUR-2d5e7a1c-v1', currency: 'EUR' }
      ]);
    } catch (error) {
      console.error('Failed to fetch tokens:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel p-6 border border-white/5">
        <h1 className="text-4xl font-bold mb-2">💸 Token Transfer Hub</h1>
        <p className="text-white/70">
          Initiate and manage customer-to-token transfers with real-time approvals
        </p>
      </div>

      {/* User Info */}
      {userNetworkAddress && (
        <div className="glass-panel p-4 bg-blue-500/10 border border-blue-500/20">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-white/50">Role</p>
              <p className="font-semibold capitalize">{userRole}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">User ID</p>
              <p className="font-mono text-sm">{userId}</p>
            </div>
            <div>
              <p className="text-xs text-white/50">Network Address</p>
              <p className="font-mono text-sm truncate">{userNetworkAddress}</p>
            </div>
          </div>
        </div>
      )}

      {/* Token Selector */}
      {(userRole === 'bank' || userRole === 'admin') && (
        <div className="glass-panel p-6">
          <h2 className="text-xl font-bold mb-4">Select Token</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {tokens.length === 0 ? (
              <p className="text-white/60 col-span-full">Loading tokens...</p>
            ) : (
              tokens.map((token) => (
                <button
                  key={token.token_id}
                  onClick={() => setSelectedTokenId(token.token_id)}
                  className={`p-4 rounded-lg transition ${
                    selectedTokenId === token.token_id
                      ? 'bg-blue-600 border border-blue-400'
                      : 'bg-white/10 border border-white/20 hover:bg-white/15'
                  }`}
                >
                  <p className="font-semibold">{token.currency}</p>
                  <p className="text-xs text-white/60 mt-1">{token.token_id}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Customer-to-Token Transfer Component */}
      <CustomerToTokenTransfer
        userRole={userRole}
        userNetworkAddress={userNetworkAddress}
        tokenId={selectedTokenId}
      />

      {/* Info Section */}
      <div className="glass-panel p-6 border border-white/10">
        <h2 className="text-xl font-bold mb-4">ℹ️ How It Works</h2>
        <div className="space-y-3 text-sm text-white/70">
          <div className="flex gap-3">
            <span className="font-bold text-blue-400">1️⃣</span>
            <span>
              <strong>Customer Initiates:</strong> Customer enters their ID, source token, destination token, and amount
            </span>
          </div>
          <div className="flex gap-3">
            <span className="font-bold text-yellow-400">2️⃣</span>
            <span>
              <strong>Sender Bank Approves:</strong> The bank owning the source token reviews and approves/rejects the debit
            </span>
          </div>
          <div className="flex gap-3">
            <span className="font-bold text-purple-400">3️⃣</span>
            <span>
              <strong>Receiver Bank Credits:</strong> The bank owning the destination token reviews and credits/rejects the transfer
            </span>
          </div>
          <div className="flex gap-3">
            <span className="font-bold text-green-400">4️⃣</span>
            <span>
              <strong>Complete:</strong> Upon receiver approval, funds are credited to the receiver token's wallet
            </span>
          </div>
        </div>
      </div>

      {/* Technical Details */}
      <div className="glass-panel p-6 border border-white/10">
        <h2 className="text-xl font-bold mb-4">⚙️ Technical Details</h2>
        <div className="space-y-2 text-xs text-white/60 font-mono">
          <p>
            <span className="text-green-400">Backend:</span> 5 REST endpoints for C-to-T transfers
          </p>
          <p>
            <span className="text-blue-400">Security:</span> JWT authentication + certificate verification
          </p>
          <p>
            <span className="text-yellow-400">Currency:</span> Same-currency (native) or cross-currency (foreign)
          </p>
          <p>
            <span className="text-purple-400">State:</span> Immediate debit in step 1, conditional credit in step 3
          </p>
        </div>
      </div>
    </div>
  );
}
