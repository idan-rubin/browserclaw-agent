import type { CrawlPage } from 'browserclaw';
import { logger } from '../logger.js';

export interface InfiniteScrollSnapshot {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  visibleText: string;
  lastItemText: string;
  itemCount: number;
  url: string;
}

export interface InfiniteScrollOptions {
  containerSelector?: string;
  itemSplitPattern?: string;
  stepDelayMs?: number;
  boundaryPushPx?: number;
  maxRounds?: number;
}

export interface InfiniteScrollRound {
  round: number;
  before: InfiniteScrollSnapshot;
  after: InfiniteScrollSnapshot;
  changed: boolean;
}

export interface InfiniteScrollResult {
  ok: boolean;
  selector: string;
  rounds: InfiniteScrollRound[];
  advanced: boolean;
  reason: string;
}

const DEFAULT_CONTAINER_SELECTOR = 'main#workspace';
const DEFAULT_ITEM_SPLIT_PATTERN = 'Feed po.t|Feed post';
const DEFAULT_STEP_DELAY_MS = 2500;
const DEFAULT_BOUNDARY_PUSH_PX = 5000;
const DEFAULT_MAX_ROUNDS = 3;

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureSnapshot(
  page: CrawlPage,
  selector: string,
  itemSplitPattern: string,
): Promise<InfiniteScrollSnapshot> {
  return (await page.evaluate(`(() => {
      const selector = ${JSON.stringify(selector)};
      const itemSplitPattern = ${JSON.stringify(itemSplitPattern)};
      const text = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim() : '';
      const container = document.querySelector(selector);
      if (!container) {
        throw new Error('infinite_scroll_container_not_found:' + selector);
      }

      const visibleText = text(container.innerText || container.textContent || '');
      const splitRe = new RegExp(itemSplitPattern, 'i');
      const parts = visibleText
        .split(splitRe)
        .map((part) => part.trim())
        .filter(Boolean);

      return {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        visibleText: visibleText.slice(0, 4000),
        lastItemText: (parts.length ? parts[parts.length - 1] : visibleText).slice(0, 1600),
        itemCount: parts.length,
        url: window.location.href,
      };
    })()`)) as InfiniteScrollSnapshot;
}

async function pushPastBottom(page: CrawlPage, selector: string, boundaryPushPx: number): Promise<void> {
  await page.evaluate(`(() => {
      const selector = ${JSON.stringify(selector)};
      const boundaryPushPx = ${JSON.stringify(boundaryPushPx)};
      const container = document.querySelector(selector);
      if (!container) {
        throw new Error('infinite_scroll_container_not_found:' + selector);
      }
      container.scrollTop = container.scrollHeight + boundaryPushPx;
    })()`);
}

export async function advanceInfiniteScroll(
  page: CrawlPage,
  opts: InfiniteScrollOptions = {},
): Promise<InfiniteScrollResult> {
  const selector = opts.containerSelector ?? DEFAULT_CONTAINER_SELECTOR;
  const itemSplitPattern = opts.itemSplitPattern ?? DEFAULT_ITEM_SPLIT_PATTERN;
  const stepDelayMs = opts.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;
  const boundaryPushPx = opts.boundaryPushPx ?? DEFAULT_BOUNDARY_PUSH_PX;
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const rounds: InfiniteScrollRound[] = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    const before = await captureSnapshot(page, selector, itemSplitPattern);
    await pushPastBottom(page, selector, boundaryPushPx);
    await wait(stepDelayMs);
    const after = await captureSnapshot(page, selector, itemSplitPattern);
    const changed = before.lastItemText !== after.lastItemText;

    rounds.push({ round, before, after, changed });

    logger.info(
      {
        selector,
        round,
        changed,
        beforeScrollTop: before.scrollTop,
        afterScrollTop: after.scrollTop,
        beforeScrollHeight: before.scrollHeight,
        afterScrollHeight: after.scrollHeight,
        beforeLastItem: before.lastItemText.slice(0, 160),
        afterLastItem: after.lastItemText.slice(0, 160),
      },
      'infinite-scroll round result',
    );

    if (changed) {
      return {
        ok: true,
        selector,
        rounds,
        advanced: true,
        reason: 'last_visible_item_changed',
      };
    }
  }

  return {
    ok: false,
    selector,
    rounds,
    advanced: false,
    reason: 'last_visible_item_unchanged',
  };
}
