/** Converts an engine snapshot into the public status DTO (snake_case, derived alerts). */
export function toStatusDto(state, config, now) {
  const sensors = Object.entries(state.devices.sensors);
  const signalDevices = Object.entries(state.devices.signals);
  const pending = Object.values(state.commands).filter((c) => c.status === 'PENDING');
  const emergencyVehicles = Object.entries(state.queues).flatMap(([direction, q]) =>
    q.filter((v) => v.type === 'EMERGENCY').map((v) => ({ vehicle_id: v.vehicleId, direction })),
  );

  // Controller status shown to operators: OFFLINE beats DEGRADED beats the raw reported value.
  let controllerStatus = state.devices.controller;
  if (controllerStatus !== 'OFFLINE' && (signalDevices.some(([, s]) => s === 'OFFLINE') || sensors.some(([, s]) => s === 'OFFLINE'))) {
    controllerStatus = 'DEGRADED';
  }

  const alerts = [];
  if (state.failure) alerts.push({ level: 'CRITICAL', code: state.failure.reason, message: `Junction in FAILURE mode: ${state.failure.reason}. Signals held at all-RED (best effort).` });
  if (state.devices.controller === 'OFFLINE') alerts.push({ level: 'CRITICAL', code: 'CONTROLLER_OFFLINE', message: 'Controller is OFFLINE' });
  if (state.devices.controller === 'UNKNOWN') alerts.push({ level: 'WARNING', code: 'CONTROLLER_UNKNOWN', message: 'Controller state unknown (no confirmation received)' });
  for (const [dir, s] of signalDevices) if (s === 'OFFLINE') alerts.push({ level: 'CRITICAL', code: 'SIGNAL_FAILURE', direction: dir, message: `${dir} signal is OFFLINE` });
  for (const [dir, s] of sensors) if (s === 'OFFLINE') alerts.push({ level: 'WARNING', code: 'SENSOR_FAILURE', direction: dir, message: `${dir} sensor is OFFLINE; queue data unreliable` });
  for (const c of Object.values(state.commands)) if (c.status === 'TIMED_OUT') alerts.push({ level: 'WARNING', code: 'COMMAND_TIMEOUT', direction: c.direction, message: `Command ${c.commandId} (${c.requestedState}) was never acknowledged` });
  for (const dir of Object.keys(state.desired)) {
    if (state.desired[dir] !== state.actual[dir]) {
      const inFlight = pending.some((c) => c.direction === dir);
      alerts.push({ level: inFlight ? 'INFO' : 'WARNING', code: state.actual[dir] === 'UNKNOWN' ? 'UNKNOWN_DEVICE_STATE' : 'STATE_MISMATCH', direction: dir, message: `${dir}: desired ${state.desired[dir]}, confirmed ${state.actual[dir]}${inFlight ? ' (command in flight)' : ''}` });
    }
  }
  if (emergencyVehicles.length) alerts.push({ level: 'CRITICAL', code: 'EMERGENCY_ACTIVE', message: `Emergency vehicle(s): ${emergencyVehicles.map((e) => `${e.vehicle_id}@${e.direction}`).join(', ')}` });
  if (state.manual) alerts.push({ level: 'INFO', code: 'MANUAL_OVERRIDE', message: `Manual override: ${state.manual.direction} GREEN (by ${state.manual.requestedBy}), expires ${new Date(state.manual.expiresAt).toISOString()}` });

  return {
    junction_id: state.junctionId,
    name: config.name,
    mode: state.mode,
    stage: state.stage,
    phase: state.phase,
    stage_elapsed_seconds: Math.round((now - state.stageStartedAt) / 1000),
    controller_status: controllerStatus,
    failure: state.failure && { reason: state.failure.reason, since: new Date(state.failure.since).toISOString() },
    desired_signals: state.desired,
    actual_signals: state.actual,
    queues: Object.fromEntries(Object.entries(state.queues).map(([d, q]) => [d, q.length])),
    queue_vehicles: Object.fromEntries(Object.entries(state.queues).map(([d, q]) => [d, q.map((v) => ({ vehicle_id: v.vehicleId, vehicle_type: v.type, waiting_seconds: Math.round((now - v.arrivedAt) / 1000) }))])),
    emergency: { active: emergencyVehicles.length > 0, vehicles: emergencyVehicles },
    manual: state.manual && { direction: state.manual.direction, requested_by: state.manual.requestedBy, expires_at: new Date(state.manual.expiresAt).toISOString() },
    pending_commands: pending.map((c) => ({ command_id: c.commandId, direction: c.direction, requested_state: c.requestedState, attempts: c.attempts, sent_at: new Date(c.sentAt).toISOString() })),
    devices: state.devices,
    alerts,
    updated_at: new Date(state.updatedAt).toISOString(),
  };
}