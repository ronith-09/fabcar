import React from 'react';
import { Globe, Copy } from 'lucide-react';

const AvailableCurrenciesDisplay = ({ data, onRegister, registerLabel = 'Register' }) => {
  const availableCurrencies = Array.isArray(data)
    ? data.filter(currency => currency && currency.currency && currency.token_id)
    : [];

  if (!availableCurrencies || availableCurrencies.length === 0) {
    return (
      <div className="rounded-xl border border-white/20 bg-white/5 p-8 text-center">
        <p className="text-white/60">No currencies available</p>
      </div>
    );
  }

  const handleCopyTokenId = (tokenId) => {
    navigator.clipboard.writeText(tokenId);
    // Show brief success feedback
    const event = window.event;
    if (event?.target) {
      const btn = event.target.closest('button');
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied';
        btn.classList.add('text-green-400');
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('text-green-400');
        }, 2000);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Globe className="w-6 h-6 text-accent" />
        <h3 className="text-2xl font-bold text-white">Available Currencies</h3>
      </div>

      {/* Summary */}
      <div className="glass-panel p-4 border border-white/10 rounded-lg mb-6">
        <p className="text-sm text-white/60">
          {data.length} currency {data.length === 1 ? 'option' : 'options'} available for registration
        </p>
      </div>

      {/* Currencies Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {availableCurrencies.map((currency, index) => (
          <div
            key={currency.token_id || index}
            className="glass-panel border border-white/10 rounded-xl p-6 hover:border-accent/40 transition hover:shadow-lg hover:bg-white/5"
          >
            {/* Currency Code */}
            <div className="mb-4">
              <p className="text-xs uppercase text-white/50 tracking-wide mb-2">Currency</p>
              <p className="text-3xl font-bold text-accent">{currency.currency || 'N/A'}</p>
            </div>

            {/* Token ID */}
            <div className="mb-4 space-y-2">
              <p className="text-xs uppercase text-white/50 tracking-wide">Token ID</p>
              <div className="bg-black/30 rounded-lg p-3 flex items-center justify-between gap-3">
                <p className="text-xs text-white/70 font-mono break-all flex-1">
                  {currency.token_id || 'N/A'}
                </p>
                <button
                  onClick={() => handleCopyTokenId(currency.token_id)}
                  className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition text-white/70 hover:text-white text-xs font-medium whitespace-nowrap flex items-center gap-1"
                  title="Copy token ID"
                >
                  <Copy className="w-3 h-3" />
                  Copy
                </button>
              </div>
            </div>

            {/* Display Token ID (if available) */}
            {currency.display_token_id && (
              <div className="space-y-2 pt-3 border-t border-white/10">
                <p className="text-xs uppercase text-white/50 tracking-wide">Display ID</p>
                <p className="text-sm text-white/80 font-semibold">{currency.display_token_id}</p>
              </div>
            )}

            {onRegister && (
              <div className="pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => onRegister(currency)}
                  className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-accent/90 transition"
                >
                  {registerLabel}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Info Box */}
      <div className="mt-6 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
        <p className="text-sm text-blue-300">
          <span className="font-semibold">ℹ️ Tip:</span> Copy the Token ID to register for a currency in your account.
        </p>
      </div>
    </div>
  );
};

export default AvailableCurrenciesDisplay;
