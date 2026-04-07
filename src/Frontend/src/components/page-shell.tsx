import { SiteHeader } from '@/components/site-header';

interface PageShellProps {
  activePath: string;
  children: React.ReactNode;
}

export function PageShell({ activePath, children }: PageShellProps) {
  return (
    <div className="relative min-h-screen flex flex-col">
      <SiteHeader activePath={activePath} border />
      {children}
    </div>
  );
}
