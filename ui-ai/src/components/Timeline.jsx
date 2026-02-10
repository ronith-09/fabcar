const Timeline = ({ events = [] }) => (
  <div className="glass-panel p-4 space-y-4">
    <div className="flex items-center justify-between">
      <p className="text-sm font-semibold">Ledger Activity</p>
      <span className="text-xs text-white/40">real-time</span>
    </div>
    <div className="space-y-3">
      {events.map(event => (
        <div key={`${event.hash}-${event.timestamp}`} className="flex gap-3">
          <div className="w-1 rounded-full bg-gradient-to-b from-accent to-accentSecondary" />
          <div className="flex-1">
            <p className="text-sm font-medium">{event.title}</p>
            <p className="text-xs text-white/50">{event.subtitle}</p>
            <p className="text-[11px] text-white/35 mt-1 font-mono">
              {event.hash}
            </p>
          </div>
          <div className="text-xs text-white/50 whitespace-nowrap">
            {new Date(event.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default Timeline;

