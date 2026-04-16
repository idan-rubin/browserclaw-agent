import { S3Client, GetObjectCommand, PutObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import { getMinioConfig } from './config.js';
import type { AgentStep } from './types.js';
import { logger } from './logger.js';

const KEY_PREFIX = 'trajectories/';
const CONTENT_TYPE = 'application/json';

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

let s3: S3Client;
let bucket: string;

export function initTrajectoryStore(): void {
  const config = getMinioConfig();
  bucket = config.bucket;
  s3 = new S3Client({
    endpoint: config.endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    forcePathStyle: true,
  });
  logger.info('Trajectory store ready');
}

function keyFor(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}.json`;
}

export async function saveTrajectory(record: TrajectoryRecord): Promise<void> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: keyFor(record.session_id),
        Body: JSON.stringify(record),
        ContentType: CONTENT_TYPE,
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
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: keyFor(sessionId) }));
    const raw = await res.Body?.transformToString();
    if (raw === undefined || raw === '') return null;
    return JSON.parse(raw) as TrajectoryRecord;
  } catch (err) {
    if (err instanceof NoSuchKey) return null;
    logger.warn({ err, sessionId }, 'Failed to load trajectory');
    return null;
  }
}
