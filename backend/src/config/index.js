const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

// Optional env overrides for signal timings (handy to shorten the 30s green during a demo).
const timingEnv = {
  greenMs: process.env.GREEN_MS,
  minGreenMs: process.env.MIN_GREEN_MS,
  yellowMs: process.env.YELLOW_MS,
  allRedMs: process.env.ALL_RED_MS,
  ackTimeoutMs: process.env.ACK_TIMEOUT_MS,
};

export const config = Object.freeze({
  port: toInt(process.env.PORT, 4000),
  mongoUri: process.env.MONGO_URI ?? 'mongodb://localhost:27017/factory_traffic',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  tickMs: toInt(process.env.TICK_MS, 250),                 // scheduler resolution
  simAutoAck: process.env.SIM_AUTO_ACK !== 'false',        // simulated controller ACKs by itself
  simAckDelayMs: toInt(process.env.SIM_ACK_DELAY_MS, 300),
  timing: Object.fromEntries(
    Object.entries(timingEnv).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toInt(v, undefined)]),
  ),
});