import type { CrawlPage } from 'browserclaw';
import { logger } from '../logger.js';

export async function detectPopup(page: CrawlPage): Promise<boolean> {
  return (await page.evaluate(`
    (function() {
      function isActuallyVisible(el) {
        if (typeof el.checkVisibility === 'function') {
          if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        }
        if (el.getAttribute('aria-hidden') === 'true') return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (parseFloat(style.opacity) < 0.1) return false;
        if (style.pointerEvents === 'none' && parseFloat(style.opacity) < 0.5) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 100 || rect.height <= 50) return false;
        if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
        return true;
      }

      var all = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="popup"], [class*="overlay"], [class*="banner"], [class*="consent"], form[action*="consent"]');
      for (var i = 0; i < all.length; i++) {
        if (isActuallyVisible(all[i])) return true;
      }
      return false;
    })()
  `)) as boolean;
}

export async function dismissPopup(page: CrawlPage): Promise<boolean> {
  try {
    const dismissed = (await page.evaluate(`
      (function() {
        function isBtnVisible(el) {
          if (typeof el.checkVisibility === 'function') {
            if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
          }
          if (el.getAttribute('aria-hidden') === 'true') return false;
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (parseFloat(style.opacity) < 0.1) return false;
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
          return true;
        }

        function isModalVisible(el) {
          if (typeof el.checkVisibility === 'function') {
            if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
          }
          if (el.getAttribute('aria-hidden') === 'true') return false;
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (parseFloat(style.opacity) < 0.1) return false;
          var rect = el.getBoundingClientRect();
          if (rect.width <= 100 || rect.height <= 50) return false;
          if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
          return true;
        }

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
            if (isBtnVisible(btns[j])) {
              btns[j].click();
              return true;
            }
          }
        }

        var dismissPattern = /^(no|not|skip|close|dismiss|got it|later|cancel|x|✕|✖|×|continue|don.t|decline|reject|deny|nah|pass|ignore|maybe|never|nope|accept|agree)\\b|\\b(thanks|thank|no thanks|not now|not interested|maybe later|skip this|close this|hide|opt out|accept all|reject all|i agree)$/i;
        var modals = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="popup"], [class*="overlay"]');
        var visibleModal = null;
        for (var mi = modals.length - 1; mi >= 0; mi--) {
          if (isModalVisible(modals[mi])) { visibleModal = modals[mi]; break; }
        }
        var searchRoot = visibleModal || document.body;
        var clickables = searchRoot.querySelectorAll('button, a, [role="button"], [onclick], span[class*="close"], div[class*="close"]');
        for (var k = 0; k < clickables.length; k++) {
          var b = clickables[k];
          var text = (b.textContent || '').trim();
          if (text.length > 30) continue;
          if (!isBtnVisible(b)) continue;
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
            if (!isBtnVisible(cb)) continue;
            var cbRect = cb.getBoundingClientRect();
            if (cbRect.width > 50 && cbRect.height > 20) {
              cb.click();
              return true;
            }
          }
        }

        return false;
      })()
    `)) as boolean;

    if (dismissed) {
      logger.info('dismiss-popup: closed a popup via click');
      await page.waitFor({ timeMs: 500 });
      return true;
    }

    // Fallback: press Escape to dismiss popups/date pickers/overlays that have no close button
    logger.info('dismiss-popup: no close button found, trying Escape key');
    await page.press('Escape');
    await page.waitFor({ timeMs: 500 });

    // Check if the popup was dismissed
    const stillOpen = await detectPopup(page);
    if (!stillOpen) {
      logger.info('dismiss-popup: closed popup via Escape key');
      return true;
    }

    logger.info('dismiss-popup: Escape did not close the popup');
    return false;
  } catch (err) {
    logger.error({ err }, 'dismiss-popup failed');
    return false;
  }
}
