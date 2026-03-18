import type { CrawlPage } from 'browserclaw';
import { logger } from '../logger.js';

export async function detectPopup(page: CrawlPage): Promise<boolean> {
  return await page.evaluate(`
    (function() {
      var all = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="popup"], [class*="overlay"], [class*="banner"], [class*="consent"], form[action*="consent"]');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        var rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 50) return true;
      }
      return false;
    })()
  `) as boolean;
}

export async function dismissPopup(page: CrawlPage): Promise<boolean> {
  try {
    const dismissed = await page.evaluate(`
      (function() {
        var closePatterns = [
          '[aria-label="Close"]',
          '[aria-label="close"]',
          '[aria-label="Dismiss"]',
          '[aria-label="dismiss"]',
          'button[class*="close"]',
          'button[class*="Close"]',
          'button[class*="dismiss"]',
          '[class*="close-button"]',
          '[class*="closeButton"]',
          '[class*="modal-close"]',
          '[class*="popup-close"]',
          '[class*="banner-close"]',
          '[data-dismiss]',
          '[data-testid="dialog-close"]',
          '[data-testid="modal-close"]',
        ];

        for (var i = 0; i < closePatterns.length; i++) {
          var btns = document.querySelectorAll(closePatterns[i]);
          for (var j = 0; j < btns.length; j++) {
            var btn = btns[j];
            var style = window.getComputedStyle(btn);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            var rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              btn.click();
              return true;
            }
          }
        }

        var dismissPattern = /^(no|not|skip|close|dismiss|got it|later|cancel|x|✕|✖|×|continue|don.t|decline|reject|deny|nah|pass|ignore|maybe|never|nope|accept|agree)\\b|\\b(thanks|thank|no thanks|not now|not interested|maybe later|skip this|close this|hide|opt out|accept all|reject all|i agree)$/i;
        var modals = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="popup"], [class*="overlay"]');
        var searchRoot = modals.length > 0 ? modals[modals.length - 1] : document.body;
        var clickables = searchRoot.querySelectorAll('button, a, [role="button"], [onclick], span[class*="close"], div[class*="close"]');
        for (var k = 0; k < clickables.length; k++) {
          var b = clickables[k];
          var text = (b.textContent || '').trim();
          if (text.length > 30) continue;
          var bStyle = window.getComputedStyle(b);
          if (bStyle.display === 'none' || bStyle.visibility === 'hidden') continue;
          var rect = b.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (text.length <= 2 || dismissPattern.test(text)) {
            b.click();
            return true;
          }
        }

        var consent = document.querySelector('form[action*="consent"], [class*="consent"], [id*="consent"], [id*="cookie"]');
        if (consent) {
          var consentBtns = consent.querySelectorAll('button');
          for (var m = consentBtns.length - 1; m >= 0; m--) {
            var cb = consentBtns[m];
            var cbStyle = window.getComputedStyle(cb);
            if (cbStyle.display === 'none' || cbStyle.visibility === 'hidden') continue;
            var cbRect = cb.getBoundingClientRect();
            if (cbRect.width > 50 && cbRect.height > 20) {
              cb.click();
              return true;
            }
          }
        }

        return false;
      })()
    `) as boolean;

    if (dismissed) {
      logger.debug('dismiss-popup: closed a popup');
      await page.waitFor({ timeMs: 500 });
    }
    return dismissed;
  } catch (err) {
    logger.error({ err }, 'dismiss-popup failed');
    return false;
  }
}