export function isLocalBrowserMode(): boolean {
  return process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Returns auth headers for backend requests.
 * Includes the internal token when BROWSER_INTERNAL_TOKEN is set.
 */
export function backendHeaders(): Record<string, string> {
  const token = process.env["BROWSER_INTERNAL_TOKEN"];
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
