#!/usr/bin/env npx tsx
/**
 * OpenAI OAuth login script.
 * Runs the Codex PKCE flow to get an OAuth token from your ChatGPT subscription.
 * Paste the resulting OPENAI_OAUTH_TOKEN into your .env.local file.
 *
 * Usage: npx tsx scripts/openai-login.ts
 */

import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPES = 'openid profile email offline_access';

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildAuthURL(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'opencode',
  });
  return `${AUTH_URL}?${params}`;
}

async function exchangeCode(code: string, verifier: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function main() {
  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge } = generatePKCE();
  const authURL = buildAuthURL(state, challenge);

  console.log('\nOpen this URL in your browser to sign in with your ChatGPT account:\n');
  console.log(authURL);
  console.log('\nWaiting for callback on http://localhost:1455 ...\n');

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:1455`);
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Login failed</h1><p>You can close this tab.</p>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (returnedState !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>State mismatch</h1><p>You can close this tab.</p>');
        server.close();
        reject(new Error('State mismatch'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Login successful!</h1><p>You can close this tab.</p>');
      server.close();
      resolve(code!);
    });

    server.listen(1455, () => {});
  });

  console.log('Got authorization code, exchanging for token...\n');
  const token = await exchangeCode(code, verifier);

  console.log('Add these to your .env.local:\n');
  console.log(`OPENAI_OAUTH_TOKEN=${token.access_token}`);
  console.log(`OPENAI_REFRESH_TOKEN=${token.refresh_token}`);
  console.log(`\nToken expires in ${Math.round(token.expires_in / 3600)} hours. It will auto-refresh using the refresh token.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
