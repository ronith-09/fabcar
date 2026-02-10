const StatGrid = ({ stats = [] }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {stats.map(stat => (
      <div key={stat.label} className="glass-panel px-4 py-4">
        <p className="text-xs uppercase tracking-widest text-white/60">{stat.label}</p>
        <p className="text-3xl font-semibold mt-2">{stat.value}</p>
        {stat.delta && (
          <p className="text-xs mt-1 text-accent">
            {stat.delta} vs last 24h
          </p>
        )}
        {stat.subtext && (
          <p className="text-xs text-white/45 mt-2">{stat.subtext}</p>
        )}
      </div>
    ))}
  </div>
);

export default StatGrid;

