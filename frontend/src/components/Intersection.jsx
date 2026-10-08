import { SIGNAL_BG } from './ui.jsx';

// One lamp. Colour = CONFIRMED (actual) state. Text shows what the backend wants.
function Lamp({ dir, status }) {
  const actual = status.actual_signals[dir];
  const desired = status.desired_signals[dir];
  return (
    <div className="flex flex-col items-center text-xs">
      <span className="font-bold">{dir}</span>
      <span className={`my-1 h-10 w-10 rounded-full ring-2 ${SIGNAL_BG[actual]} ${actual !== desired ? 'ring-yellow-300' : 'ring-slate-700'}`} />
      <span className="text-slate-400">want {desired}</span>
      <span className="text-slate-300">queue {status.queues[dir]}</span>
    </div>
  );
}

/** Visual intersection. It only renders backend state; it never decides sequencing. */
export default function Intersection({ status }) {
  return (
    <div className="mx-auto grid w-72 grid-cols-3 items-center gap-2">
      <div /><Lamp dir="NORTH" status={status} /><div />
      <Lamp dir="WEST" status={status} />
      <div className="flex h-16 items-center justify-center rounded bg-slate-700 text-center text-[10px] text-slate-300">
        {status.stage}<br />{status.phase ?? '-'}
      </div>
      <Lamp dir="EAST" status={status} />
      <div /><Lamp dir="SOUTH" status={status} /><div />
    </div>
  );
}