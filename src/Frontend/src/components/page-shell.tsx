import Link from 'next/link';

interface NavLink {
  label: string;
  href: string;
}

const NAV_LINKS: NavLink[] = [
  { label: 'Skills', href: '/skills' },
  { label: 'Docs', href: '/docs' },
  { label: 'Changelog', href: '/changelog' },
];

interface PageShellProps {
  activePath: string;
  children: React.ReactNode;
}

export function PageShell({ activePath, children }: PageShellProps) {
  return (
    <div className="relative min-h-screen flex flex-col">
      <nav className="flex items-center justify-between border-b border-border/50 px-6 py-5 sm:px-10">
        <Link href="/" className="font-[family-name:var(--font-heading)] text-xl tracking-tight">
          browserclaw
        </Link>
        <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={link.href === activePath ? 'text-foreground' : 'transition-colors hover:text-foreground'}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
