import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './shared/logger.js';
import { connectMongo, disconnectMongo } from './infrastructure/persistance/mongo/connection.js';
import { JunctionRepository, HistoryRepository, ProcessedEventRepository } from './infrastructure/persistance/mongo/repositories.js';
import { RestSimulatorController } from './infrastructure/controller/rest-simulator.js';
import { JunctionService } from './application/junction-service.js';

async function main() {
  await connectMongo(config.mongoUri);

  // Composition root: the only place where concrete adapters are chosen.
  // To use MQTT later: replace `simulator` by an MqttController implementing send().
  const simulator = new RestSimulatorController({ autoAck: config.simAutoAck, ackDelayMs: config.simAckDelayMs });
  const service = new JunctionService({
    junctionRepo: new JunctionRepository(),
    historyRepo: new HistoryRepository(),
    eventRepo: new ProcessedEventRepository(),
    controller: simulator,
    defaultTiming: config.timing,
    newId: () => `cmd-${randomUUID().slice(0, 8)}`, // unique command ids for ACK correlation
  });
  simulator.onAck((ev) => service.ingestControllerEvent(ev));

  await service.init();

  // Timers are driven by this loop, never by sleep() inside request handlers.
  const ticker = setInterval(() => service.tickAll(), config.tickMs);

  const app = createApp({ service, simulator });
  const server = app.listen(config.port, () => logger.info('HTTP server listening', { port: config.port }));

  const shutdown = (signal) => {
    logger.info('Shutting down', { signal });
    clearInterval(ticker);
    server.close(async () => {
      await disconnectMongo();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { message: err.message, stack: err.stack });
  process.exit(1);
});