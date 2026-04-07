import Image from 'next/image';
import Link from 'next/link';
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
      className={`relative z-10 flex items-center justify-between px-4 py-4 sm:px-10 sm:py-5${border ? ' border-b border-border/50' : ''}`}
    >
      <Link
        href="/"
        className="flex items-center gap-2 font-[family-name:var(--font-heading)] text-lg sm:text-xl tracking-tight"
      >
        <Image src="/logo.png" alt="" width={28} height={28} className="h-7 w-7 sm:h-8 sm:w-8 dark:hidden" />
        <Image src="/logo-dark.png" alt="" width={28} height={28} className="hidden h-7 w-7 sm:h-8 sm:w-8 dark:block" />
        <span className="hidden sm:inline">
          browserclaw<sup className="text-[0.5em] align-super">&#8482;</sup>
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
