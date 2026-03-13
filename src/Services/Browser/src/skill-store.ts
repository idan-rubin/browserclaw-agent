import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getMinioConfig } from './config.js';
import type { CatalogSkill, SkillOutput } from './types.js';

let s3: S3Client;
let bucket: string;

export async function initSkillStore(): Promise<void> {
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

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Skill store ready (bucket: ${bucket})`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created skill store bucket: ${bucket}`);
  }
}

export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function getSkillForDomain(domain: string): Promise<CatalogSkill | null> {
  if (!domain) return null;

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `skills/${domain}.json` }));
    const raw = await res.Body?.transformToString();
    if (!raw) return null;
    return JSON.parse(raw) as CatalogSkill;
  } catch {
    return null;
  }
}

export async function saveSkill(
  domain: string,
  skill: SkillOutput,
  tags: string[],
  runCount?: number,
): Promise<void> {
  if (!domain) return;

  const now = new Date().toISOString();

  const catalogSkill: CatalogSkill = {
    id: crypto.randomUUID(),
    domain,
    skill,
    tags,
    created_at: now,
    run_count: runCount ?? 1,
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `skills/${domain}.json`,
      Body: JSON.stringify(catalogSkill, null, 2),
      ContentType: 'application/json',
    }),
  );

  console.log(`Saved skill "${skill.title}" for ${domain} (run #${catalogSkill.run_count})`);
}
