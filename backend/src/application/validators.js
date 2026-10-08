import { badRequest } from '../shared/errors.js';
import { ALL_DIRECTIONS, VEHICLE_TYPES, DEVICE_TYPES, DEVICE_STATUSES, DEFAULT_TIMING } from '../domain/constants.js';

// Restricted id charset: ids become Mongo object keys, so no dots/dollars/spaces allowed.
const ID_RE = /^[A-Za-z0-9_\-:]{1,64}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function assertBody(raw) {
  if (!isObject(raw)) throw badRequest('Request body must be a JSON object');
}
function finish(problems, message) {
  if (problems.length) throw badRequest(message, problems);
}
const oneOf = (list) => `one of ${list.join(', ')}`;

export function validateSensorEvent(raw) {
  assertBody(raw);
  const p = [];
  for (const k of ['event_id', 'junction_id', 'vehicle_id']) {
    if (typeof raw[k] !== 'string' || !ID_RE.test(raw[k])) p.push(`${k} is required (letters, digits, - _ : up to 64 chars)`);
  }
  if (!ALL_DIRECTIONS.includes(raw.direction)) p.push(`direction must be ${oneOf(ALL_DIRECTIONS)}`);
  if (!['VEHICLE_ARRIVED', 'VEHICLE_CLEARED'].includes(raw.event_type)) p.push('event_type must be VEHICLE_ARRIVED or VEHICLE_CLEARED');
  if (raw.event_type === 'VEHICLE_ARRIVED' && !VEHICLE_TYPES.includes(raw.vehicle_type)) p.push(`vehicle_type must be ${oneOf(VEHICLE_TYPES)}`);
  if (!Number.isInteger(raw.sequence_no) || raw.sequence_no < 0) p.push('sequence_no must be a non-negative integer');
  const ts = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : NaN;
  if (Number.isNaN(ts)) p.push('timestamp must be an ISO-8601 string');
  finish(p, 'Invalid sensor event');

  return {
    eventId: raw.event_id,
    junctionId: raw.junction_id,
    direction: raw.direction,
    eventType: raw.event_type,
    vehicleId: raw.vehicle_id,
    vehicleType: raw.vehicle_type,
    sequenceNo: raw.sequence_no,
    sensorTimeMs: ts,
  };
}

/** Controller events are either an ACK/NACK (has command_id) or a device status (has device_type). */
export function validateControllerEvent(raw) {
  assertBody(raw);
  const p = [];
  if (typeof raw.junction_id !== 'string' || !ID_RE.test(raw.junction_id)) p.push('junction_id is required');

  if (raw.device_type !== undefined) {
    if (!DEVICE_TYPES.includes(raw.device_type)) p.push(`device_type must be ${oneOf(DEVICE_TYPES)}`);
    if (!DEVICE_STATUSES.includes(raw.status)) p.push(`status must be ${oneOf(DEVICE_STATUSES)}`);
    if (raw.direction !== undefined && !ALL_DIRECTIONS.includes(raw.direction)) p.push(`direction must be ${oneOf(ALL_DIRECTIONS)}`);
    if (raw.device_type === 'SENSOR' && raw.direction === undefined) p.push('direction is required for SENSOR');
    finish(p, 'Invalid device status event');
    return { kind: 'STATUS', junctionId: raw.junction_id, deviceType: raw.device_type, direction: raw.direction, status: raw.status };
  }

  if (typeof raw.command_id !== 'string' || !ID_RE.test(raw.command_id)) p.push('command_id is required (or device_type for status events)');
  if (!['ACK', 'NACK'].includes(raw.status)) p.push('status must be ACK or NACK');
  if (raw.status === 'ACK' && !['RED', 'YELLOW', 'GREEN'].includes(raw.actual_state)) p.push('actual_state (RED|YELLOW|GREEN) is required for ACK');
  finish(p, 'Invalid controller event');
  return { kind: 'ACK', junctionId: raw.junction_id, commandId: raw.command_id, status: raw.status, actualState: raw.actual_state };
}

export function validateCommand(raw) {
  assertBody(raw);
  const p = [];
  if (!['MANUAL_GREEN_REQUEST', 'RETURN_TO_AUTOMATIC'].includes(raw.command)) p.push('command must be MANUAL_GREEN_REQUEST or RETURN_TO_AUTOMATIC');
  if (raw.command === 'MANUAL_GREEN_REQUEST' && !ALL_DIRECTIONS.includes(raw.direction)) p.push(`direction must be ${oneOf(ALL_DIRECTIONS)}`);
  if (raw.requested_by !== undefined && (typeof raw.requested_by !== 'string' || raw.requested_by.length > 50)) p.push('requested_by must be a string up to 50 chars');
  finish(p, 'Invalid command');
  return { command: raw.command, direction: raw.direction, requestedBy: raw.requested_by };
}

export function validateJunctionInput(raw) {
  assertBody(raw);
  const p = [];
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(raw.id)) p.push('id is required (letters, digits, - _ up to 20 chars)');
  if (raw.name !== undefined && (typeof raw.name !== 'string' || raw.name.length > 80)) p.push('name must be a string up to 80 chars');

  let phases;
  if (raw.phases !== undefined) {
    const used = new Set();
    const entries = isObject(raw.phases) ? Object.entries(raw.phases) : [];
    if (entries.length < 2) p.push('phases must define at least two phases');
    for (const [name, dirs] of entries) {
      if (!Array.isArray(dirs) || dirs.length === 0 || dirs.some((d) => !ALL_DIRECTIONS.includes(d) || used.has(d))) {
        p.push(`phase ${name} must list unique, valid directions`);
      } else dirs.forEach((d) => used.add(d));
    }
    phases = raw.phases;
  }
  let timing;
  if (raw.timing !== undefined) {
    timing = {};
    for (const [k, v] of Object.entries(isObject(raw.timing) ? raw.timing : {})) {
      if (!(k in DEFAULT_TIMING) || typeof v !== 'number' || v <= 0) p.push(`timing.${k} must be a positive number and a known key`);
      else timing[k] = v;
    }
  }
  finish(p, 'Invalid junction');
  return { id: raw.id, name: raw.name, phases, timing };
}