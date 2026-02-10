const ApprovalColumn = ({ title, subtitle, actions = [], cards = [] }) => (
  <div className="glass-panel p-4 flex flex-col">
    <div className="mb-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-white/60">{subtitle}</p>
    </div>
    <div className="space-y-3 flex-1 overflow-y-auto">
      {cards.map(card => (
        <div key={card.id} className="border border-white/10 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{card.primary}</p>
            <span className="text-xs text-white/50">{card.amount}</span>
          </div>
          <p className="text-xs text-white/60">{card.meta}</p>
          <div className="text-[11px] text-white/40 font-mono">{card.hash}</div>
          <div className="flex flex-wrap gap-2 pt-2">
            {actions.map(action => (
              <button
                key={action.label}
                className={`px-3 py-1 rounded-full text-xs ${
                  action.intent === 'approve'
                    ? 'bg-accent/15 text-accent'
                    : action.intent === 'reject'
                      ? 'bg-red-500/20 text-red-300'
                      : 'bg-white/10 text-white'
                }`}
                onClick={() => action.onClick?.(card)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!cards.length && (
        <p className="text-xs text-white/30">Clean lane. Awaiting new entries.</p>
      )}
    </div>
  </div>
);

export default ApprovalColumn;

