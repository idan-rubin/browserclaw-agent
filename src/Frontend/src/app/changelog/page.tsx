import type { Metadata } from 'next';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = {
  title: 'Changelog',
  description: "What's new in BrowserClaw. All releases synced from OpenClaw's browser module.",
};

export default function ChangelogPage() {
  return (
    <PageShell activePath="/changelog">
      <main className="flex-1 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Changelog</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            What&apos;s new in BrowserClaw. All releases synced from{' '}
            <a
              href="https://openclaw.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              OpenClaw
            </a>
            &apos;s browser module.
          </p>

          <div className="mt-12 space-y-0">
            <Release
              version="0.4.0"
              date="March 2, 2026"
              highlights={[
                "Chrome stderr capture in launch failure errors — see exactly why Chrome didn't start",
                'Linux no-sandbox hint in error messages for Docker/CI environments',
                'isChromeCdpReady() — validates CDP websocket readiness via Browser.getVersion, not just HTTP reachability',
              ]}
            />
            <Release
              version="0.3.9"
              date="March 1, 2026"
              highlights={[
                'assertBrowserNavigationResultAllowed — post-navigation redirect SSRF guard, validates final URL after redirects',
                'allowRfc2544BenchmarkRange added to SsrfPolicy — RFC 2544 benchmark range (198.18.0.0/15) blocked by default in strict mode',
              ]}
            />
            <Release
              version="0.3.8"
              date="February 26, 2026"
              highlights={[
                'FormField.type now optional — defaults to "text" when missing or empty instead of throwing',
              ]}
            />
            <Release
              version="0.3.7"
              date="February 25, 2026"
              highlights={[
                'IPv6 multicast (ff00::/8) blocked in isInternalIP',
                'assertSafeOutputPath made async with realpath/lstat symlink-escape checks',
                'Upload paths validated via assertSafeUploadPaths before setFiles',
              ]}
            />
            <Release
              version="0.3.6"
              date="February 24, 2026"
              highlights={[
                '/json/version body shape validation in isChromeReachable and getChromeWebSocketUrl — catches wrong-port returning HTTP 200 with non-JSON',
              ]}
            />
            <Release
              version="0.3.5"
              date="February 23, 2026"
              breaking
              highlights={[
                'SSRF policy now defaults to trusted-network mode',
                'allowPrivateNetwork renamed to dangerouslyAllowPrivateNetwork (old field kept for compat)',
                'Default flipped from block-private to allow-private — most users run on trusted networks',
              ]}
            />
            <Release
              version="0.3.3"
              date="February 22, 2026"
              highlights={['Simplified tab-not-found error message in connection handling']}
            />
            <Release
              version="0.3.2"
              date="February 21, 2026"
              highlights={[
                'Block non-network protocols (file:, data:, javascript:) in navigation — only http:/https: and about:blank allowed',
              ]}
            />
            <Release
              version="0.3.1"
              date="February 21, 2026"
              highlights={[
                'Full browser SDK sync — SsrfPolicy, BrowserNavigationPolicyOptions, withBrowserNavigationPolicy',
                'ControlOrMeta modifier support for cross-platform keyboard shortcuts',
                'evaluate() with timeoutMs and signal support',
                'refsMode in snapshot for flexible ref assignment',
              ]}
            />
            <Release
              version="0.2.6"
              date="February 17, 2026"
              highlights={[
                'SSRF IPv6 transition bypass fix — blocks IPv4-mapped IPv6 addresses',
                'chromeArgs validation — prevents conflicting flags',
              ]}
            />
            <Release
              version="0.2.5"
              date="February 14, 2026"
              highlights={[
                'CDP attach hang fix — connection timeout instead of hanging indefinitely',
                'Snapshot parsing dedup — deduplicate refs when same element appears multiple times',
              ]}
            />
          </div>

          <div className="mt-12 rounded-2xl border border-border/50 bg-card/40 p-8 text-center">
            <p className="text-muted-foreground">Full release history on GitHub</p>
            <a
              href="https://github.com/idan-rubin/browserclaw/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              View all releases
            </a>
          </div>
        </div>
      </main>
    </PageShell>
  );
}

function Release({
  version,
  date,
  highlights,
  breaking = false,
}: {
  version: string;
  date: string;
  highlights: string[];
  breaking?: boolean;
}) {
  return (
    <div className="relative border-l-2 border-border/50 pb-10 pl-8 last:pb-0">
      <div
        className={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${breaking ? 'bg-destructive' : 'bg-primary'}`}
      />

      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight">v{version}</h2>
        {breaking && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            Breaking
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground/60">{date}</p>
      <ul className="mt-3 space-y-1.5">
        {highlights.map((h, i) => (
          <li key={i} className="text-sm text-muted-foreground">
            <span className="mr-2 text-primary">—</span>
            {h}
          </li>
        ))}
      </ul>
    </div>
  );
}
