import Image from 'next/image';
import Link from 'next/link';
import { BrowserClawWordmark } from '@/components/browserclaw-wordmark';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavLink {
  label: string;
  href: string;
  external?: boolean;
}

const NAV_LINKS: NavLink[] = [
  { label: 'GitHub', href: 'https://github.com/idan-rubin/browserclaw-agent', external: true },
  { label: 'Docs', href: '/docs' },
  { label: 'Blog', href: 'https://mrrubin.substack.com', external: true },
];

const NAV_LINK_CLASS = 'rounded-full px-3.5 py-1.5 transition-colors hover:bg-foreground/5 hover:text-foreground';

interface SiteHeaderProps {
  activePath?: string;
  cta?: boolean;
}

export function SiteHeader({ activePath, cta = true }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-30 px-3 py-3 sm:px-6 sm:py-4">
      <nav className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3 rounded-full border border-border bg-card/80 pl-4 pr-2 shadow-[0_10px_30px_-18px_rgb(15_23_42/0.45)] backdrop-blur-xl sm:h-14 sm:pl-6 sm:pr-2.5">
        <Link href="/" className="display flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
          <Image src="/logo.png" alt="" width={224} height={280} className="h-5 w-auto sm:h-6 dark:hidden" />
          <Image src="/logo-dark.png" alt="" width={224} height={280} className="hidden h-5 w-auto sm:h-6 dark:block" />
          <span>
            <BrowserClawWordmark />
          </span>
        </Link>
        <div className="hidden items-center gap-1 text-sm font-medium text-muted-foreground sm:flex">
          {NAV_LINKS.map((link) => {
            const isActive = activePath !== undefined && link.href === activePath;
            if (link.external === true) {
              return (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={NAV_LINK_CLASS}
                >
                  {link.label}
                </a>
              );
            }
            return (
              <Link
                key={link.href}
                href={link.href}
                className={isActive ? 'rounded-full bg-foreground/8 px-3.5 py-1.5 text-foreground' : NAV_LINK_CLASS}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          {cta && (
            <Link
              href="/try"
              className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition-transform hover:scale-[1.03] active:scale-[0.97]"
            >
              Try it live
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
