import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Entrypoint of the video-worker container: a Nest application context
 * without an HTTP listener (phase-03-videos/TD-05). Shutdown hooks let
 * BullMQ workers finish the active job before the process exits.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Video worker started', 'VideoWorker');
}
void bootstrap();
