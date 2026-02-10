const WalletCard = ({ title, balance, address, tags = [] }) => (
  <div className="glass-panel p-4 space-y-2">
    <div className="flex items-center justify-between">
      <h4 className="font-semibold">{title}</h4>
      <span className="text-xs text-white/60">Wallet</span>
    </div>
    <p className="text-3xl font-semibold">{balance}</p>
    <p className="text-[11px] text-white/40 font-mono break-all">{address}</p>
    <div className="flex flex-wrap gap-2 pt-2">
      {tags.map(tag => (
        <span key={tag} className="px-3 py-1 text-[11px] rounded-full bg-white/10 text-white/70">
          {tag}
        </span>
      ))}
    </div>
  </div>
);

export default WalletCard;

