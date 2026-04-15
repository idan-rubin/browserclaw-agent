import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getMinioConfig } from './config.js';
import type { AgentStep } from './types.js';
import { logger } from './logger.js';

let s3: S3Client;
let bucket: string;

export function initTrajectoryStore(): void {
  const config = getMinioConfig();
  bucket = config.bucket;

  s3 = new S3Client({
    endpoint: config.endpoint,
    region: 'us-east-1',
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: true,
  });

  logger.info('Trajectory store ready');
}

export const TRAJECTORY_STATUS = {
  completed: 'completed',
  failed: 'failed',
} as const;
export type TrajectoryStatus = (typeof TRAJECTORY_STATUS)[keyof typeof TRAJECTORY_STATUS];

export interface TrajectoryRecord {
  session_id: string;
  prompt: string;
  status: TrajectoryStatus;
  steps: AgentStep[];
  answer?: string;
  error?: string;
  duration_ms: number;
  saved_at: string;
}

function key(sessionId: string): string {
  return `trajectories/${sessionId}.json`;
}

async function streamToString(body: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function saveTrajectory(record: TrajectoryRecord): Promise<void> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key(record.session_id),
        Body: JSON.stringify(record),
        ContentType: 'application/json',
      }),
    );
    logger.info(
      { sessionId: record.session_id, steps: record.steps.length, status: record.status },
      'Saved trajectory',
    );
  } catch (err) {
    logger.warn({ err, sessionId: record.session_id }, 'Failed to save trajectory');
  }
}

export async function loadTrajectory(sessionId: string): Promise<TrajectoryRecord | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key(sessionId) }));
    const body = await streamToString(res.Body);
    return JSON.parse(body) as TrajectoryRecord;
  } catch {
    return null;
  }
}
