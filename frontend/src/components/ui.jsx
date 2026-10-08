// Small shared presentational helpers. Colours only reflect backend state.
export const SIGNAL_BG = {
  GREEN: 'bg-green-500', YELLOW: 'bg-yellow-400', RED: 'bg-red-600', UNKNOWN: 'bg-slate-500',
};
const MODE_STYLE = { AUTOMATIC: 'bg-emerald-700', MANUAL: 'bg-blue-700', EMERGENCY: 'bg-orange-600', FAILURE: 'bg-red-700' };
const STATUS_STYLE = { ONLINE: 'bg-emerald-700', OFFLINE: 'bg-red-700', DEGRADED: 'bg-yellow-600', WARNING: 'bg-yellow-600', UNKNOWN: 'bg-slate-600' };

export const Badge = ({ text, style = 'bg-slate-600' }) => (
  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${style}`}>{text}</span>
);
export const ModeBadge = ({ mode }) => <Badge text={mode} style={MODE_STYLE[mode]} />;
export const StatusBadge = ({ status }) => <Badge text={status} style={STATUS_STYLE[status]} />;

export const Card = ({ title, children, className = '' }) => (
  <section className={`rounded-lg bg-slate-800 p-4 ${className}`}>
    {title && <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{title}</h2>}
    {children}
  </section>
);

export const ErrorBanner = ({ error }) =>
  error ? <div className="mb-4 rounded bg-red-900 p-3 text-sm text-red-100">⚠ {error.message}</div> : null;