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

interface SiteHeaderProps {
  activePath?: string;
  border?: boolean;
}

export function SiteHeader({ activePath, border = false }: SiteHeaderProps) {
  return (
    <nav
      className={`relative z-10 flex items-center justify-between px-4 py-6 sm:px-10 sm:py-7${border ? ' border-b border-border/50' : ''}`}
    >
      <Link
        href="/"
        className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-lg sm:text-xl tracking-tight"
      >
        <Image src="/logo.png" alt="" width={224} height={280} className="h-5 w-auto sm:h-6 dark:hidden" />
        <Image src="/logo-dark.png" alt="" width={224} height={280} className="hidden h-5 w-auto sm:h-6 dark:block" />
        <span>
          <BrowserClawWordmark />
        </span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-8">
        <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => {
            const isActive = activePath !== undefined && link.href === activePath;
            if (link.external === true) {
              return (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-foreground"
                >
                  {link.label}
                </a>
              );
            }
            return (
              <Link
                key={link.href}
                href={link.href}
                className={isActive ? 'text-foreground' : 'transition-colors hover:text-foreground'}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}
