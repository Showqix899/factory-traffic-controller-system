## Project set up 
- start docker desktop
- `docker compose up --build` it will build and start backend, mongo, and frontend (React) dev server.
**Factory Traffic Control System**

Operator guide: how to control traffic from the web dashboard

Think of this as a small control room. **You never set a signal directly.** You send vehicles and requests, and the backend decides when it is safe to change the lights.

### 1. Reading the screen

Open **Junction A** from the front page. The detail view has these parts:

| **Part** | **What it tells you** |
| --- | --- |
| **Intersection (left)** | The circle color is the signal the controller has **confirmed**. "want GREEN" underneath is what the backend **requested**. A yellow ring means the two do not match yet, which is normal for a moment after a change. |
| **Center text** | The current stage (GREEN, YELLOW or ALL_RED) and the active phase (NORTH_SOUTH or EAST_WEST). |
| **Status panel** | Mode badge, controller status, a table of desired vs confirmed signals and queues, and alerts. |
| **Simulation panel** | Where you create vehicles and play the controller. |
| **Recent activity** | Every decision the system made, newest first. |

#### Modes

- AUTOMATIC: the scheduler decides.

- MANUAL: an admin holds one phase green.

- EMERGENCY: an emergency vehicle is waiting or passing.

- FAILURE: something broke, and everything is held at all-RED.

#### Phases

NORTH+SOUTH go together, and EAST+WEST go together. They are never green at the same time.

### 2. Normal traffic (NORTH/SOUTH)

The system starts with NORTH/SOUTH green and all queues at 0. Nothing changes while nobody is waiting.

- In the Simulation panel choose EAST, VEHICLE_ARRIVED and EMPLOYEE_VEHICLE. Leave the vehicle id empty (it is generated) and click **Send event**.

- The EAST queue becomes 1, and VEHICLE_DETECTED appears in the activity list.

- Wait. NORTH/SOUTH must stay green for at least 8 seconds. Because the green phase has no vehicles, the system then switches: NORTH/SOUTH turn **YELLOW** for 5 s, then **all RED** for at least 2 s, then EAST/WEST turn **GREEN**.

The whole sequence takes about 15 seconds and is always in this order, so you will never see a direct jump from green to a conflicting green.

**Clearing a vehicle:** choose VEHICLE_CLEARED, click the vehicle id box (it suggests the ids currently queued), pick one, and click **Send event**. The queue drops by 1. You can never get a negative queue.

### 3. Priority

Add 2 EMPLOYEE_VEHICLE on NORTH, then 1 TRUCK on EAST while NORTH is green. A truck counts more than an ordinary vehicle, and waiting time adds to the score, so the heavier or longer-waiting side is served first. A vehicle waiting more than 90 s forces its phase to be served.

### 4. ACK (what the controller does)

Each signal change is sent to the controller as a **command** with an id such as cmd-5320c924. The command only counts as done when the controller replies with an **ACK**.

- **Auto-ACK is ticked by default.** The simulated controller replies by itself after 0.3 s, so you rarely see this.

- **To do it by hand:** untick **auto-ACK**. New commands then appear under "Controller simulator" as cmd-xxxx NORTH→YELLOW with **ACK** and **NACK** buttons.

- Click **ACK** to confirm. The lamp changes to the confirmed color.

- **NACK** means the controller refused. The junction goes to FAILURE.

- If you click nothing, the system retries the same command 2 times (every 3 s), then goes to FAILURE.

- The system will not give GREEN to a direction until all conflicting signals are **confirmed** RED. If you refuse to ACK a RED, the green never comes.

### 5. Manual control (administrator)

In the **Manual control** box:

- Pick a direction, for example WEST, and click **Request GREEN**.

- A blue "Manual override active" banner appears. The system still goes YELLOW → ALL_RED → EAST/WEST GREEN, and it **stays** there even if other vehicles are waiting.

- Click **Return to automatic** to hand control back to the scheduler.

#### Rules

- Manual control expires by itself after 5 minutes.

- If two admins click at the same time, the last accepted request wins, and both are recorded.

- Manual requests are **refused** (red error text) while an emergency is active or the junction is in FAILURE.

### 6. Emergency

- Make sure NORTH/SOUTH is green.

- Click **🚨 Emergency @ EAST**. For another direction, set the form to type EMERGENCY and that direction.

- Within the same second, mode becomes **EMERGENCY** and NORTH/SOUTH turn **YELLOW**. EAST is still red at this moment. Then comes ALL_RED, then EAST/WEST turn **GREEN**.

- The emergency phase stays green while the emergency vehicle is still queued.

- To end it: choose VEHICLE_CLEARED, EAST, pick the emergency vehicle id from the suggestions, and click **Send event**. Mode returns to AUTOMATIC (or MANUAL, if a manual override was active before). If you forget, it times out after 2 minutes.

If two emergencies come from different phases, the **first one** is served and the other waits its turn. Emergencies on the same phase are served together.

### 7. Duplicates and bad events

- **Resend last (duplicate)** sends the exact same event again. The result says DUPLICATE and the queue does not change.

- If a clear arrives for a vehicle that was never queued, it is ignored and recorded in the history.

### 8. Failures

#### Dead controller

- Tick **drop ACKs (dead controller)**.

- Wait about 10 seconds. You will see command retries in the history, then mode **FAILURE** with all signals RED.

- To recover: untick **drop ACKs** (keep auto-ACK on), then set Device status to SIGNAL_CONTROLLER, (whole controller), ONLINE and click **Send status**. Clicking **Return to automatic** also works. The system re-synchronises through ALL_RED and resumes.

#### Controller offline

Set Device status to SIGNAL_CONTROLLER, OFFLINE and click **Send status**. FAILURE is immediate. **Return to automatic** is refused while the controller is OFFLINE, so send ONLINE first.

#### Sensor failure

Choose SENSOR, a direction, OFFLINE. This only adds a warning. The junction keeps running, but queue data for that direction is unreliable.

### 9. Restart test

Run docker compose restart backend. Queues and history remain. The history shows a RECOVERY event, and the signals go through ALL_RED again before any green is allowed, because the system never assumes the old physical state is still true.

### Quick cheat sheet

| **I want to...** | **Do this** |
| --- | --- |
| Add traffic | Simulation → direction + type → **Send event** |
| Remove traffic | VEHICLE_CLEARED + pick the vehicle id |
| Force a direction | Manual control → **Request GREEN** |
| Give control back | **Return to automatic** |
| Trigger an emergency | **🚨 Emergency @ EAST** |
| Test duplicates | **Resend last (duplicate)** |
| Test controller failure | Tick **drop ACKs**, wait about 10 s |
| Recover | Untick drop ACKs, then send device status ONLINE |
| Understand why something happened | Read **Recent activity** from the bottom up |

The status panel shows the junction's **alerts**. Check there first when something looks wrong, because the cause is usually named there (for example COMMAND_TIMEOUT or CONTROLLER_OFFLINE).


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