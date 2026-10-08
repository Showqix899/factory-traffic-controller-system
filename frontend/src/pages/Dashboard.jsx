import { Badge, Card, ModeBadge, SIGNAL_BG, StatusBadge } from '../components/ui.jsx';

/** Overview: one card per junction with signals, queues, mode, phase, emergency and failure flags. */
export default function Dashboard({ junctions, onOpen }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {junctions.map((j) => (
        <Card key={j.junction_id} className="cursor-pointer hover:bg-slate-700">
          {/* Clicking anywhere on the card opens the junction detail view */}
          <div onClick={() => onOpen(j.junction_id)}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold">{j.name}</h3>
              <ModeBadge mode={j.mode} />
            </div>
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              <Badge text={`${j.stage} / ${j.phase ?? '-'}`} />
              <StatusBadge status={j.controller_status} />
              {j.emergency.active && <Badge text="🚨 EMERGENCY" style="bg-orange-600" />}
              {j.failure && <Badge text="⛔ FAILURE" style="bg-red-700" />}
            </div>
            <div className="flex justify-between">
              {Object.keys(j.actual_signals).map((d) => (
                <div key={d} className="text-center text-xs">
                  <div>{d[0]}</div>
                  <div className={`mx-auto h-4 w-4 rounded-full ${SIGNAL_BG[j.actual_signals[d]]}`} />
                  <div>{j.queues[d]}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}