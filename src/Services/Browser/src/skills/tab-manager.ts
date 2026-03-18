import type { CrawlPage } from 'browserclaw';
import { getCdpBaseUrl, activateCdpTarget } from './cdp-utils.js';
import { logger } from '../logger.js';

interface PageTarget {
  id: string;
  type: string;
  url: string;
  title: string;
}

export class TabManager {
  private knownTabIds: Set<string>;
  private cdpBaseUrl: string;

  constructor(page: CrawlPage) {
    this.knownTabIds = new Set([page.id]);
    this.cdpBaseUrl = getCdpBaseUrl(page);
  }

  async getPageTargets(): Promise<PageTarget[]> {
    const res = await fetch(this.cdpBaseUrl + '/json');
    const targets = await res.json() as PageTarget[];
    return targets.filter(t => t.type === 'page');
  }

  async checkForNewTab(browser: { page: (id: string) => CrawlPage }): Promise<CrawlPage | null> {
    try {
      const targets = await this.getPageTargets();
      const newTab = targets.find(t => !this.knownTabIds.has(t.id));

      if (!newTab) {
        this.knownTabIds = new Set(targets.map(t => t.id));
        return null;
      }

      const newPage = browser.page(newTab.id);

      await activateCdpTarget(this.cdpBaseUrl, newTab.id);

      this.knownTabIds = new Set(targets.map(t => t.id));
      logger.info({ title: newTab.title, url: newTab.url }, 'tab-manager: switched to new tab');
      return newPage;
    } catch (err) {
      logger.error({ err }, 'tab-manager error');
      return null;
    }
  }
}
