## Architecture
Layers (dependencies point inward): interfaces/http → application → domain; infrastructure implements ports.
- domain: `JunctionEngine` pure state machine (no Express/Mongo/MQTT), unit-tested with `node --test`.
- application: `JunctionService` serializes work per junction, persists state+history before dispatching commands.
- infrastructure: Mongo repositories, `RestSimulatorController` (controller port; MQTT adapter can replace it).
- Consistency: serialized per-junction mailbox (no DB transactions needed, so no replica set). Single backend instance assumed; multi-instance would need a lease/lock per junction or optimistic versioning.
- Desired vs actual: engine tracks both. Commands carry unique ids; ACKs correlate by command_id.
- Refresh: UI polls every second (simple, robust). SSE/WebSocket = next step.

## Traffic algorithm
(see ASSUMPTIONS.md: score, min/max green, hysteresis, starvation)

## State transitions
GREEN(P) → YELLOW(P) [5s] → ALL_RED [≥2s and all four signals confirmed RED] → GREEN(next).
Mode (derived): FAILURE > EMERGENCY > MANUAL > AUTOMATIC.
FAILURE entered on: command timeout after retries, NACK, state mismatch, controller/signal OFFLINE.
FAILURE left on: controller ONLINE event or RETURN_TO_AUTOMATIC (re-sync via ALL_RED).

## Demo scenarios
1. Normal: send 3× EMPLOYEE_VEHICLE NORTH and 2× EAST; after min green (8s) the phase serves the higher score.
2. Priority: TRUCK on EAST vs 2 EMPLOYEE_VEHICLE on NORTH → EAST wins sooner.
3. Emergency: while NORTH_SOUTH is green click "Emergency @ EAST" → YELLOW → ALL_RED → EAST/WEST green, mode EMERGENCY. Clear it with VEHICLE_CLEARED.
4. Manual: request WEST green → manual badge; "Return to automatic".
5. Duplicate: send an event, click "Resend last (duplicate)" → 200 DUPLICATE, queue unchanged.
6. Clearance: send VEHICLE_CLEARED with the vehicle id (datalist suggests queued ids).
7. Controller failure: tick "drop ACKs" → ~9s later FAILURE (COMMAND_TIMEOUT, all RED). Untick it, send device status SIGNAL_CONTROLLER ONLINE (or Return to automatic) → recovery.
   Also: send SIGNAL_CONTROLLER OFFLINE → immediate FAILURE.
8. Restart: `docker compose restart backend` → queues/history remain, RECOVERY event, signals re-synchronised via ALL_RED.
9. Concurrency:
   for i in 1 2 3 4 5; do curl -s -X POST localhost:4000/api/sensor-events -H 'Content-Type: application/json' \
     -d '{"event_id":"evt-c1","junction_id":"A","direction":"EAST","event_type":"VEHICLE_ARRIVED","vehicle_id":"AMB-9","vehicle_type":"EMERGENCY","sequence_no":9,"timestamp":"'$(date -u +%FT%TZ)'"}' & done; wait
   → one 201, four 200 DUPLICATE; no conflicting GREEN (check history).

## Next steps with more time
SSE live updates, MQTT adapter, auth for manual control, flashing-red failure state, true demand estimate for offline sensors, multi-instance locking, more engine tests (property-based), metrics.

## AI / Tool Usage
Claude (Anthropic) was used for design discussion and code drafting; I reviewed, ran and can explain all code.