import { QueueEvents } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';

export interface AddedJobEvent {
  jobId: string;
  name: string;
}

export interface QueueEventsCapture {
  added: AddedJobEvent[];
  close: () => Promise<void>;
}

/**
 * Listens to `added` events on the video-processing queue. The running
 * video-worker may consume a job right away (and `removeOnComplete` deletes
 * it), so tests observe the queue through events instead of `getJob`.
 * Start the capture BEFORE the request that enqueues.
 */
export async function captureAddedJobs(): Promise<QueueEventsCapture> {
  const queueEvents = new QueueEvents(VIDEO_PROCESSING_QUEUE, {
    connection: {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  });
  const added: AddedJobEvent[] = [];
  queueEvents.on('added', ({ jobId, name }) => {
    added.push({ jobId, name });
  });
  await queueEvents.waitUntilReady();

  return {
    added,
    close: () => queueEvents.close(),
  };
}

/** Polls until `predicate` holds or `timeoutMs` elapses. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
