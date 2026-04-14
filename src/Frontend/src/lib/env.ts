export function isLocalBrowserMode(): boolean {
  return process.env.NEXT_PUBLIC_LOCAL_MODE === 'true';
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === '') throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function backendHeaders(): Record<string, string> {
  const token = process.env.BROWSER_INTERNAL_TOKEN;
  if (token == null || token === '') return {};
  return { Authorization: `Bearer ${token}` };
}
