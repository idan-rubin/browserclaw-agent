import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getMinioConfig } from './config.js';
import type { AgentStep, DomainLesson, TaskLesson } from './types.js';
import { extractDomain } from './skill-store.js';
import { logger } from './logger.js';

let s3: S3Client;
let bucket: string;

export function initLessonStore(): void {
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

  logger.info('Lesson store ready');
}

// ── Task hashing ───────────────────────────────────────────────────────────────
// Produces a semantic hash so similar prompts ("find apartments in Chelsea" and
// "search for rentals in Chelsea") map to the same lesson key.

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'in',
  'at',
  'on',
  'to',
  'for',
  'from',
  'of',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'with',
  'and',
  'or',
  'but',
  'not',
  'no',
  'it',
  'its',
  'my',
  'your',
  'his',
  'her',
  'their',
  'our',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'we',
  'us',
  'you',
  'he',
  'she',
  'they',
  'them',
  'some',
  'any',
  'all',
  'each',
  'every',
  'most',
  'more',
  'less',
  'very',
  'just',
  'only',
  'also',
  'than',
  'then',
  'so',
  'if',
  'when',
  'where',
  'how',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'much',
  'many',
  'few',
  'little',
  'lot',
  'lots',
  'get',
  'go',
  'come',
  'make',
  'take',
  'give',
  'show',
  'tell',
  'please',
  'want',
  'need',
  'like',
  'about',
  'up',
  'out',
  'down',
  'into',
  'over',
  'under',
  'between',
  'through',
  'after',
  'before',
  'during',
  'near',
  'best',
  'good',
  'great',
  'top',
]);

const SYNONYMS: Record<string, string> = {
  apartments: 'apartment',
  rental: 'apartment',
  rentals: 'apartment',
  flat: 'apartment',
  flats: 'apartment',
  condo: 'apartment',
  condos: 'apartment',
  housing: 'apartment',
  hotels: 'hotel',
  motel: 'hotel',
  motels: 'hotel',
  accommodation: 'hotel',
  resort: 'hotel',
  resorts: 'hotel',
  flights: 'flight',
  airline: 'flight',
  airfare: 'flight',
  tickets: 'flight',
  ticket: 'flight',
  search: 'find',
  look: 'find',
  browse: 'find',
  explore: 'find',
  discover: 'find',
  comparison: 'compare',
  purchase: 'buy',
  order: 'buy',
  shop: 'buy',
  shopping: 'buy',
  booking: 'book',
  reserve: 'book',
  reservation: 'book',
  prices: 'price',
  cost: 'price',
  costs: 'price',
  rate: 'price',
  rates: 'price',
  cheap: 'price',
  cheapest: 'price',
  affordable: 'price',
  cars: 'car',
  vehicle: 'car',
  vehicles: 'car',
  auto: 'car',
  jobs: 'job',
  career: 'job',
  careers: 'job',
  hiring: 'job',
  position: 'job',
  positions: 'job',
  restaurants: 'restaurant',
  dining: 'restaurant',
  laptops: 'laptop',
  computer: 'laptop',
  computers: 'laptop',
};

export function hashTaskCategory(prompt: string): { hash: string; terms: string[] } {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const terms = words
    .filter((w) => !STOP_WORDS.has(w))
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w, i, arr) => arr.indexOf(w) === i)
    .sort();

  const key = terms.join('-');
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return { hash, terms };
}

// ── Load / save ────────────────────────────────────────────────────────────────

export async function getLesson(prompt: string): Promise<TaskLesson | null> {
  const { hash } = hashTaskCategory(prompt);
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `lessons/${hash}.json` }));
    const raw = await res.Body?.transformToString();
    if (raw === undefined || raw === '') return null;
    return JSON.parse(raw) as TaskLesson;
  } catch (err) {
    logger.error({ err, hash }, 'Failed to fetch lesson from S3');
    return null;
  }
}

async function putLesson(lesson: TaskLesson): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `lessons/${lesson.task_hash}.json`,
      Body: JSON.stringify(lesson, null, 2),
      ContentType: 'application/json',
    }),
  );
}

export async function saveLesson(prompt: string, domains: DomainLesson[]): Promise<void> {
  if (domains.length === 0) return;

  const { hash, terms } = hashTaskCategory(prompt);
  const now = new Date().toISOString();

  // Merge with existing lesson
  let existing: TaskLesson | null = null;
  try {
    existing = await getLesson(prompt);
  } catch {
    // fresh lesson
  }

  const merged = new Map<string, DomainLesson>();

  // Load existing domains
  if (existing !== null) {
    for (const d of existing.domains) {
      merged.set(d.domain, d);
    }
  }

  // Merge new domains — newer observations win
  for (const d of domains) {
    merged.set(d.domain, d);
  }

  const lesson: TaskLesson = {
    task_hash: hash,
    task_terms: terms,
    domains: [...merged.values()],
    updated_at: now,
  };

  await putLesson(lesson);
  logger.info({ hash, terms, domainCount: lesson.domains.length }, 'Saved lesson');
}

// ── Extract lessons from step history ──────────────────────────────────────────

const BLOCKED_PATTERNS =
  /anti-bot|blocked|access denied|captcha|verify.*human|press.*hold|cloudflare|security check|forbidden|\b403\b|bot detected|rate limit/i;

export function extractDomainLessons(steps: AgentStep[], success: boolean): DomainLesson[] {
  const now = new Date().toISOString();
  const domainInfo = new Map<string, { actions: number; errors: number; blocked: boolean }>();

  for (const step of steps) {
    const url = step.url;
    if (url === undefined || url === '') continue;
    const domain = extractDomain(url);
    if (domain === '') continue;

    const info = domainInfo.get(domain) ?? { actions: 0, errors: 0, blocked: false };

    // Count meaningful actions
    if (!['done', 'fail', 'wait', 'ask_user'].includes(step.action.action)) {
      info.actions++;
    }

    // Detect blocking signals
    if (step.action.error_feedback !== undefined && BLOCKED_PATTERNS.test(step.action.error_feedback)) {
      info.blocked = true;
      info.errors++;
    }
    if (BLOCKED_PATTERNS.test(step.action.reasoning)) {
      info.blocked = true;
    }
    // Anti-bot actions are strong blocking signals
    if (step.action.action === 'press_and_hold' || step.action.action === 'click_cloudflare') {
      info.blocked = true;
    }

    if (step.action.error_feedback !== undefined) {
      info.errors++;
    }

    domainInfo.set(domain, info);
  }

  const lessons: DomainLesson[] = [];
  for (const [domain, info] of domainInfo) {
    if (info.blocked) {
      lessons.push({
        domain,
        status: 'blocked',
        reason: 'anti-bot detection',
        last_seen: now,
      });
    } else if (success && info.actions >= 2 && info.errors === 0) {
      lessons.push({
        domain,
        status: 'worked',
        reason: `completed task successfully (${String(info.actions)} actions)`,
        last_seen: now,
      });
    }
  }

  return lessons;
}

// ── Format for injection into agent prompt ─────────────────────────────────────

export function formatLessonForPrompt(lesson: TaskLesson): string {
  const blocked = lesson.domains.filter((d) => d.status === 'blocked');
  const worked = lesson.domains.filter((d) => d.status === 'worked');

  if (blocked.length === 0 && worked.length === 0) return '';

  const lines: string[] = ['LESSONS FROM PREVIOUS RUNS:'];

  for (const d of blocked) {
    lines.push(`  AVOID ${d.domain} (${d.reason})`);
  }
  for (const d of worked) {
    lines.push(`  USE ${d.domain} instead (${d.reason})`);
  }

  return lines.join('\n');
}
