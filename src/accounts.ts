// src/accounts.ts
// Multi-account management for Google Docs MCP Server

import { google, docs_v1, drive_v3, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';
import { fileURLToPath } from 'url';

// --- Configuration paths ---
const CONFIG_DIR = path.join(process.env.HOME || '~', '.google-mcp');
const ACCOUNTS_CONFIG_PATH = path.join(CONFIG_DIR, 'accounts.json');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');
const TOKENS_DIR = path.join(CONFIG_DIR, 'tokens');

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];

// --- Types ---
export interface AccountConfig {
  name: string;
  email?: string;
  tokenPath: string;
  addedAt: string;
}

export interface AccountsConfig {
  accounts: Record<string, AccountConfig>;
  credentialsPath: string;
}

export interface AccountClients {
  authClient: OAuth2Client;
  docs: docs_v1.Docs;
  drive: drive_v3.Drive;
  sheets: sheets_v4.Sheets;
}

// --- Account Registry (in-memory cache) ---
const accountClients: Map<string, AccountClients> = new Map();
let accountsConfig: AccountsConfig | null = null;

// --- Helper Functions ---

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.mkdir(TOKENS_DIR, { recursive: true });
}

async function loadAccountsConfig(): Promise<AccountsConfig> {
  if (accountsConfig) return accountsConfig;

  try {
    const content = await fs.readFile(ACCOUNTS_CONFIG_PATH, 'utf8');
    accountsConfig = JSON.parse(content);
    return accountsConfig!;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // Create default config
      accountsConfig = {
        accounts: {},
        credentialsPath: CREDENTIALS_PATH
      };
      await saveAccountsConfig();
      return accountsConfig;
    }
    throw err;
  }
}

async function saveAccountsConfig(): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(ACCOUNTS_CONFIG_PATH, JSON.stringify(accountsConfig, null, 2));
}

async function loadCredentials(): Promise<{ client_id: string; client_secret: string; redirect_uris: string[] }> {
  const config = await loadAccountsConfig();
  const credPath = config.credentialsPath || CREDENTIALS_PATH;

  try {
    const content = await fs.readFile(credPath, 'utf8');
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    if (!key) throw new Error("Could not find client secrets in credentials.json.");
    return {
      client_id: key.client_id,
      client_secret: key.client_secret,
      redirect_uris: key.redirect_uris || ['http://localhost:3000']
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Credentials file not found at ${credPath}. Please copy your OAuth credentials.json to this location.`);
    }
    throw err;
  }
}

async function loadTokenForAccount(accountName: string): Promise<OAuth2Client | null> {
  const config = await loadAccountsConfig();
  const account = config.accounts[accountName];

  if (!account) {
    return null;
  }

  try {
    const tokenContent = await fs.readFile(account.tokenPath, 'utf8');
    const credentials = JSON.parse(tokenContent);
    const { client_id, client_secret, redirect_uris } = await loadCredentials();

    const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    client.setCredentials(credentials);
    return client;
  } catch (err) {
    return null;
  }
}

async function saveTokenForAccount(accountName: string, client: OAuth2Client): Promise<string> {
  await ensureConfigDir();
  const tokenPath = path.join(TOKENS_DIR, `${accountName}.json`);

  const { client_id, client_secret } = await loadCredentials();
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id,
    client_secret,
    refresh_token: client.credentials.refresh_token,
  });

  await fs.writeFile(tokenPath, payload);
  return tokenPath;
}

// --- Public API ---

/**
 * Initialize the accounts system - loads config and existing account tokens
 */
export async function initializeAccounts(): Promise<void> {
  await ensureConfigDir();
  const config = await loadAccountsConfig();

  // Try to load all configured accounts
  for (const [name, account] of Object.entries(config.accounts)) {
    try {
      const authClient = await loadTokenForAccount(name);
      if (authClient) {
        accountClients.set(name, {
          authClient,
          docs: google.docs({ version: 'v1', auth: authClient }),
          drive: google.drive({ version: 'v3', auth: authClient }),
          sheets: google.sheets({ version: 'v4', auth: authClient })
        });
        console.error(`Loaded account: ${name}${account.email ? ` (${account.email})` : ''}`);
      } else {
        console.error(`Warning: Could not load token for account "${name}" - may need re-authentication`);
      }
    } catch (err) {
      console.error(`Warning: Failed to load account "${name}": ${err}`);
    }
  }

  console.error(`Accounts initialized: ${accountClients.size} account(s) loaded`);
}

/**
 * Get the API clients for a specific account
 */
export async function getAccountClients(accountName: string): Promise<AccountClients> {
  // Check cache first
  const cached = accountClients.get(accountName);
  if (cached) return cached;

  // Try to load from config
  const config = await loadAccountsConfig();
  if (!config.accounts[accountName]) {
    const available = Object.keys(config.accounts);
    if (available.length === 0) {
      throw new Error(`Account "${accountName}" not found. No accounts configured. Use the addAccount tool to add an account.`);
    }
    throw new Error(`Account "${accountName}" not found. Available accounts: ${available.join(', ')}`);
  }

  const authClient = await loadTokenForAccount(accountName);
  if (!authClient) {
    throw new Error(`Account "${accountName}" exists but token is invalid or missing. Use addAccount to re-authenticate.`);
  }

  const clients: AccountClients = {
    authClient,
    docs: google.docs({ version: 'v1', auth: authClient }),
    drive: google.drive({ version: 'v3', auth: authClient }),
    sheets: google.sheets({ version: 'v4', auth: authClient })
  };

  accountClients.set(accountName, clients);
  return clients;
}

/**
 * List all configured accounts
 */
export async function listAccounts(): Promise<AccountConfig[]> {
  const config = await loadAccountsConfig();
  return Object.values(config.accounts);
}

/**
 * Check if any accounts are configured
 */
export async function hasAccounts(): Promise<boolean> {
  const config = await loadAccountsConfig();
  return Object.keys(config.accounts).length > 0;
}

/**
 * Add a new account via OAuth flow
 * Returns the auth URL that user needs to visit
 */
export async function startAddAccount(accountName: string): Promise<{ authUrl: string; port: number }> {
  const config = await loadAccountsConfig();

  // Validate account name
  if (!/^[a-zA-Z0-9_-]+$/.test(accountName)) {
    throw new Error('Account name must contain only letters, numbers, underscores, and hyphens');
  }

  if (config.accounts[accountName]) {
    throw new Error(`Account "${accountName}" already exists. Use removeAccount first if you want to re-add it.`);
  }

  const { client_id, client_secret } = await loadCredentials();

  // Find an available port
  const port = 3000 + Math.floor(Math.random() * 1000);
  const redirectUri = `http://localhost:${port}`;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES.join(' '),
    prompt: 'consent' // Force consent to get refresh token
  });

  return { authUrl, port };
}

/**
 * Complete the OAuth flow by listening for the callback
 */
export async function completeAddAccount(
  accountName: string,
  port: number,
  onAuthUrl?: (url: string) => void
): Promise<AccountConfig> {
  const { client_id, client_secret } = await loadCredentials();
  const redirectUri = `http://localhost:${port}`;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES.join(' '),
    prompt: 'consent'
  });

  if (onAuthUrl) {
    onAuthUrl(authUrl);
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '', redirectUri);
        const code = url.searchParams.get('code');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication successful for "${accountName}"!</h1><p>You can close this window.</p></body></html>`);

          server.close();

          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);

          // Get user email
          const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
          let email: string | undefined;
          try {
            const userInfo = await oauth2.userinfo.get();
            email = userInfo.data.email || undefined;
          } catch (e) {
            // Email fetch failed, continue without it
          }

          // Save token
          const tokenPath = await saveTokenForAccount(accountName, oAuth2Client);

          // Update config
          const config = await loadAccountsConfig();
          const accountConfig: AccountConfig = {
            name: accountName,
            email,
            tokenPath,
            addedAt: new Date().toISOString()
          };
          config.accounts[accountName] = accountConfig;
          await saveAccountsConfig();

          // Add to cache
          accountClients.set(accountName, {
            authClient: oAuth2Client,
            docs: google.docs({ version: 'v1', auth: oAuth2Client }),
            drive: google.drive({ version: 'v3', auth: oAuth2Client }),
            sheets: google.sheets({ version: 'v4', auth: oAuth2Client })
          });

          resolve(accountConfig);
        } else {
          const error = url.searchParams.get('error');
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication failed</h1><p>${error || 'No code received'}</p></body></html>`);
          server.close();
          reject(new Error(error || 'No authorization code received'));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Authentication failed</h1></body></html>');
        server.close();
        reject(err);
      }
    });

    server.listen(port, () => {
      console.error(`OAuth callback server listening on port ${port}`);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is in use. Please try again.`));
      } else {
        reject(err);
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out after 5 minutes'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Remove an account
 */
export async function removeAccount(accountName: string): Promise<void> {
  const config = await loadAccountsConfig();

  if (!config.accounts[accountName]) {
    throw new Error(`Account "${accountName}" not found`);
  }

  // Remove token file
  const tokenPath = config.accounts[accountName].tokenPath;
  try {
    await fs.unlink(tokenPath);
  } catch (err) {
    // Ignore if file doesn't exist
  }

  // Remove from config
  delete config.accounts[accountName];
  await saveAccountsConfig();

  // Remove from cache
  accountClients.delete(accountName);
}

/**
 * Get the config directory path (for display purposes)
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Get credentials path (for setup instructions)
 */
export function getCredentialsPath(): string {
  return CREDENTIALS_PATH;
}
