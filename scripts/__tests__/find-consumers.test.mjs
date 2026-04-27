import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findConsumers } from '../find-consumers.mjs';

let root;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-consumers-'));
  fs.mkdirSync(path.join(root, 'a'));
  fs.mkdirSync(path.join(root, 'b', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'browserclaw-agent'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'a', 'package.json'),
    JSON.stringify({ dependencies: { 'browserclaw-agent': '^0.1.0' } }),
  );
  fs.writeFileSync(
    path.join(root, 'b', 'nested', 'package.json'),
    JSON.stringify({ devDependencies: { 'browserclaw-agent': '^0.5.0' } }),
  );
  fs.writeFileSync(
    path.join(root, 'node_modules', 'browserclaw-agent', 'package.json'),
    JSON.stringify({ dependencies: { 'browserclaw-agent': '0.5.1' } }),
  );
  fs.writeFileSync(
    path.join(root, 'b', 'package.json'),
    JSON.stringify({ dependencies: { lodash: '*' } }),
  );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('findConsumers', () => {
  it('finds package.json files declaring the dep', () => {
    const result = findConsumers(root, 'browserclaw-agent');
    expect(result.sort()).toEqual([
      path.join(root, 'a', 'package.json'),
      path.join(root, 'b', 'nested', 'package.json'),
    ]);
  });

  it('skips node_modules', () => {
    const result = findConsumers(root, 'browserclaw-agent');
    expect(result.some((r) => r.includes('node_modules'))).toBe(false);
  });

  it('returns empty when no consumer exists', () => {
    expect(findConsumers(root, 'nonexistent-package')).toEqual([]);
  });
});
