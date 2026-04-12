interface BrowserClawWordmarkProps {
  capitalized?: boolean;
}

/**
 * Renders the browserclaw brand name with a superscript ™.
 * Use for any visible wordmark, heading, or brand label.
 * Do NOT use in URLs, code examples, npm package names, or config keys.
 */
export function BrowserClawWordmark({ capitalized = false }: BrowserClawWordmarkProps) {
  return (
    <>
      {capitalized ? 'BrowserClaw' : 'browserclaw'}
      <sup className="text-[0.5em] align-super">&#8482;</sup>
    </>
  );
}
