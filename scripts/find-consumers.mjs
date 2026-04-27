import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function findConsumers(root, pkg) {
  const targets = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'package.json') {
        try {
          const json = JSON.parse(fs.readFileSync(p, 'utf8'));
          const all = { ...(json.dependencies || {}), ...(json.devDependencies || {}) };
          if (Object.prototype.hasOwnProperty.call(all, pkg)) targets.push(p);
        } catch {}
      }
    }
  };
  walk(root);
  return targets;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [root, pkg] = process.argv.slice(2);
  if (!root || !pkg) {
    console.error('usage: find-consumers.mjs <root> <package>');
    process.exit(2);
  }
  for (const t of findConsumers(root, pkg)) console.log(t);
}
