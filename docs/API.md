## Conventions
Errors: `{ "error": { "code", "message", "details" } }`.
400 validation | 404 unknown junction/route | 409 state conflict | 422 stale event | 202 accepted (async).

## Junctions
- `GET /api/junctions` → array of status objects (200)
- `POST /api/junctions` → 201 status. Body: `{ "id": "B", "name": "Junction B", "phases"?: {...}, "timing"?: {...} }`. 409 if id exists.
- `GET /api/junctions/:id` → `{ config, status }` (404 if unknown)

## Status
`GET /api/junctions/:id/status`
```json
{
  "junction_id": "A", "mode": "AUTOMATIC", "stage": "GREEN", "phase": "NORTH_SOUTH",
  "stage_elapsed_seconds": 12, "controller_status": "ONLINE", "failure": null,
  "desired_signals": {"NORTH":"GREEN","SOUTH":"GREEN","EAST":"RED","WEST":"RED"},
  "actual_signals":  {"NORTH":"GREEN","SOUTH":"GREEN","EAST":"RED","WEST":"RED"},
  "queues": {"NORTH":3,"SOUTH":1,"EAST":7,"WEST":2},
  "queue_vehicles": {"NORTH":[{"vehicle_id":"VH-1","vehicle_type":"TRUCK","waiting_seconds":4}]},
  "emergency": {"active": false, "vehicles": []},
  "manual": null,
  "pending_commands": [],
  "alerts": [], "devices": {}, "updated_at": "..."
}
```
`mode`: AUTOMATIC | MANUAL | EMERGENCY | FAILURE. `stage`: GREEN | YELLOW | ALL_RED.
Alert codes: EMERGENCY_ACTIVE, MANUAL_OVERRIDE, CONTROLLER_OFFLINE, CONTROLLER_UNKNOWN, SIGNAL_FAILURE, SENSOR_FAILURE, COMMAND_TIMEOUT, STATE_MISMATCH, UNKNOWN_DEVICE_STATE.

## Sensor events
`POST /api/sensor-events`
```json
{ "event_id":"evt-10001","junction_id":"A","direction":"NORTH","event_type":"VEHICLE_ARRIVED",
  "vehicle_id":"VH-501","vehicle_type":"TRUCK","sequence_no":1501,"timestamp":"2026-10-05T10:15:20Z" }
```
`VEHICLE_CLEARED` needs no `vehicle_type`.
| Result | HTTP | Body status |
|---|---|---|
| Applied | 201 | ACCEPTED |
| Same event_id again | 200 | DUPLICATE (state unchanged) |
| Ignored (cleared w/o arrival, arrival after clear, vehicle already queued) | 200 | IGNORED |
| Too old | 422 | STALE |
| Malformed / unknown vehicle_type / bad direction | 400 | error |
| Unknown junction | 404 | error |

## Commands
`POST /api/junctions/:id/commands` → 202
- `{ "command": "MANUAL_GREEN_REQUEST", "direction": "WEST", "requested_by": "admin1" }`
- `{ "command": "RETURN_TO_AUTOMATIC" }`

409 when an emergency is active, the junction is in FAILURE, or (return) the controller is OFFLINE.

## Controller events
`POST /api/controller-events`
- ACK: `{ "command_id":"cmd-ab12", "junction_id":"A", "status":"ACK", "actual_state":"GREEN" }` (`status` ACK|NACK)
  → 200 `APPLIED` | `DUPLICATE`; 404 `UNKNOWN_COMMAND`
- Device status: `{ "event_id":"status-301","junction_id":"A","device_type":"SIGNAL_CONTROLLER","direction":"SOUTH","status":"OFFLINE" }`
  (`device_type` SIGNAL_CONTROLLER|SENSOR, `direction` optional for the controller, required for SENSOR)

## History
`GET /api/junctions/:id/history?limit=50&type=SIGNAL_CHANGED` → `{ junction_id, events: [...] }`, newest first.
Event types: JUNCTION_STARTED, VEHICLE_DETECTED, VEHICLE_CLEARED, DUPLICATE_EVENT, EVENT_REJECTED, EVENT_IGNORED, OUT_OF_ORDER_EVENT, TRANSITION_STARTED, SIGNAL_REQUESTED, SIGNAL_CHANGED, CONTROLLER_ACK, ACK_DUPLICATE, ACK_UNKNOWN_COMMAND, COMMAND_RETRY, COMMAND_FAILED, CONTROLLER_TIMEOUT, EMERGENCY_DETECTED, EMERGENCY_CLEARED, EMERGENCY_TIMEOUT, MANUAL_OVERRIDE, MANUAL_EXPIRED, RETURN_TO_AUTOMATIC, MODE_CHANGED, DEVICE_FAILURE, DEVICE_STATUS_CHANGED, FAILURE_ENTERED, FAILURE_CLEARED, RECOVERY, SAFETY_GUARD.

## Simulator
- `GET /api/simulator` → `{ auto_ack, ack_delay_ms, drop_acks, recent_commands }`
- `PUT /api/simulator` → body any of `{ auto_ack, ack_delay_ms, drop_acks }`