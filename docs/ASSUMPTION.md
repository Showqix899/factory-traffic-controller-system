# Assumptions / Questions / Requirement Issues

| Topic | Issue | Decision |
|---|---|---|
| Conflicting movements | Not defined | Two different phases always conflict (NORTH_SOUTH vs EAST_WEST). Phases are junction config. No turning-movement modelling. |
| Safety gate | "Never GREEN together" is not enough if a controller lags | GREEN is only requested when all conflicting signals are CONFIRMED RED (actual state). UNKNOWN is not RED. Also asserted in code (`assertSafeDesired`, `canGrantGreen`). |
| Timestamps | Sensor vs server time | Sensor time = real arrival (waiting time, staleness); server time = when received (audit, timers). Future sensor times are clamped to now (clock-skew protection). |
| Duplicates | event_id vs sequence_no | `event_id` is authoritative for idempotency (unique index per junction). `vehicle_id` is a second guard against double-queuing. |
| Out-of-order | sequence_no regressions | sequence_no is per direction (one sensor). Regressions are logged (OUT_OF_ORDER_EVENT) but processed, because arrive/clear are applied by vehicle_id. CLEARED before ARRIVED is remembered and the late ARRIVED is ignored. |
| Stale events | Delay limit unspecified | Older than 5 min rejected (422); emergencies older than 2 min rejected. |
| CLEARED without arrival | Unspecified | Ignored (queue never negative), audited. |
| Sequence number scope | Unspecified | Per junction + direction. |
| Scheduling | Weights unspecified | score = Σ(type weight + 0.1·waiting seconds) per phase. Min green 8s, max 30s, switch early only if rival > 1.5× current, no switching when nobody waits, starvation: wait > 90s forces a switch. |
| Emergency vs manual | Unspecified | Emergency overrides manual (manual state is kept but suspended; commands during an emergency get 409). |
| Competing emergencies | Unspecified | FIFO by arrival; the first emergency's phase is served, the conflicting one waits. Same-phase emergencies are served together. Emergency never skips YELLOW/ALL_RED. |
| Emergency cleared | Unspecified | By VEHICLE_CLEARED, or after 2 min (EMERGENCY_TIMEOUT). |
| Manual duration | Unspecified | Expires after 5 min (configurable). Disconnect is irrelevant (command-based API), TTL covers it. |
| Two admins | Unspecified | Serialized per junction: last accepted command wins; both audited. |
| ACK timeout / retry | Unspecified | 3 s timeout, 2 retries with the same command_id (3 attempts), then FAILURE. |
| Duplicate / late ACK | Unspecified | Duplicate: ignored. Late ACK (after timeout/supersede): actual state is recorded (truth), mode unchanged. Unknown command_id: 404, audited. |
| Failure behaviour | Safe state unspecified | FAILURE: scheduling stops, desired = all RED (best effort). Real deployments need flashing red / hardware conflict monitor. Recovery on controller ONLINE event or RETURN_TO_AUTOMATIC (409 if controller OFFLINE); signals are re-synchronised through ALL_RED. |
| Sensor failure | Unspecified | Not a junction failure. Alert + small baseline demand so the direction is still served. Limitation: demand is not truly known. |
| Restart | Timers/physical state | Persisted: config, full engine state, processed ids, history. After restart: physical state treated as UNKNOWN, pending commands dropped, ALL_RED re-requested, GREEN only after RED is confirmed. Stage timers restart (conservative). |
| Spec issue | Allowing admins to "request" green quickly may feel like a bypass | Manual and emergency requests only choose the *target*; they always pass through YELLOW → ALL_RED. |
| Spec issue | "ALL_RED" is not a physical state | It is an internal stage; physically all four signals are RED. |
| Auth | Manual control unauthenticated | Out of scope; `requested_by` is a free-text audit label. |