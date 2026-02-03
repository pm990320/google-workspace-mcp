// src/accounts.ts
// Multi-account management for Google Workspace MCP Server

import {
  google,
  type docs_v1,
  type drive_v3,
  type sheets_v4,
  type gmail_v1,
  type calendar_v3,
  type slides_v1,
  type forms_v1,
} from 'googleapis';
import { type OAuth2Client, type Credentials } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';
import {
  type OAuthCredentialsFile,
  type ParsedOAuthCredentials,
} from './types.js';

// --- Configuration paths ---
const CONFIG_DIR = path.join(process.env.HOME || '~', '.google-mcp');
const ACCOUNTS_CONFIG_PATH = path.join(CONFIG_DIR, 'accounts.json');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');
const CREDENTIALS_DIR = path.join(CONFIG_DIR, 'credentials');
const TOKENS_DIR = path.join(CONFIG_DIR, 'tokens');

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
];

// --- Types ---
export interface AccountConfig {
  name: string;
  email?: string;
  tokenPath: string;
  credentialsPath?: string; // Optional per-account credentials file
  addedAt: string;
}

export interface AccountsConfig {
  accounts: Record<string, AccountConfig | undefined>;
  credentialsPath: string;
}

export interface AccountClients {
  authClient: OAuth2Client;
  docs: docs_v1.Docs;
  drive: drive_v3.Drive;
  sheets: sheets_v4.Sheets;
  gmail: gmail_v1.Gmail;
  calendar: calendar_v3.Calendar;
  slides: slides_v1.Slides;
  forms: forms_v1.Forms;
}

// --- No in-memory caching - always read fresh from disk ---

// --- Helper Functions ---

async function ensureConfigDir(): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CONFIG_DIR and TOKENS_DIR are derived from known safe paths
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- TOKENS_DIR is derived from known safe paths
  await fs.mkdir(TOKENS_DIR, { recursive: true });
}

/** Type guard for Node.js file system errors */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function loadAccountsConfig(): Promise<AccountsConfig> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ACCOUNTS_CONFIG_PATH is derived from known safe paths
    const content = await fs.readFile(ACCOUNTS_CONFIG_PATH, 'utf8');
    return JSON.parse(content) as AccountsConfig;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      // Create default config
      const defaultConfig: AccountsConfig = {
        accounts: {},
        credentialsPath: CREDENTIALS_PATH,
      };
      await saveAccountsConfig(defaultConfig);
      return defaultConfig;
    }
    throw err;
  }
}

async function saveAccountsConfig(config: AccountsConfig): Promise<void> {
  await ensureConfigDir();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ACCOUNTS_CONFIG_PATH is derived from known safe paths
  await fs.writeFile(ACCOUNTS_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Parse OAuth credentials from a file path */
async function parseCredentialsFile(
  credPath: string
): Promise<{ client_id: string; client_secret: string }> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- credPath is validated or from known config paths
  const content = await fs.readFile(credPath, 'utf8');
  const keys = JSON.parse(content) as OAuthCredentialsFile;
  const key = keys.installed ?? keys.web;
  if (!key) throw new Error(`Could not find client secrets in ${credPath}.`);
  return {
    client_id: key.client_id,
    client_secret: key.client_secret,
  };
}

async function loadCredentials(accountName?: string): Promise<ParsedOAuthCredentials> {
  const config = await loadAccountsConfig();
  let credPath: string;

  // Priority: 1) Account-specific credentials, 2) Global credentials
  if (accountName) {
    // eslint-disable-next-line security/detect-object-injection -- accountName is validated with regex /^[a-zA-Z0-9_-]+$/
    const account = config.accounts[accountName];

    // Check for explicit per-account credentials path in config
    if (account?.credentialsPath && (await fileExists(account.credentialsPath))) {
      credPath = account.credentialsPath;
    }
    // Check for credentials in the credentials directory by account name
    else {
      const accountCredPath = path.join(CREDENTIALS_DIR, `${accountName}.json`);
      if (await fileExists(accountCredPath)) {
        credPath = accountCredPath;
      } else {
        // Fall back to global credentials
        credPath = config.credentialsPath || CREDENTIALS_PATH;
      }
    }
  } else {
    // No account specified, use global credentials
    credPath = config.credentialsPath || CREDENTIALS_PATH;
  }

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- credPath is from validated config or known paths
    const content = await fs.readFile(credPath, 'utf8');
    const keys = JSON.parse(content) as OAuthCredentialsFile;
    const key = keys.installed ?? keys.web;
    if (!key) throw new Error(`Could not find client secrets in ${credPath}.`);
    return {
      client_id: key.client_id,
      client_secret: key.client_secret,
      redirect_uris: key.redirect_uris ?? ['http://localhost:3000'],
    };
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(
        `Credentials file not found at ${credPath}. Please copy your OAuth credentials.json to this location.`
      );
    }
    throw err;
  }
}

async function loadTokenForAccount(accountName: string): Promise<OAuth2Client | null> {
  const config = await loadAccountsConfig();
  // eslint-disable-next-line security/detect-object-injection -- accountName is validated with regex /^[a-zA-Z0-9_-]+$/
  const account = config.accounts[accountName];

  if (!account) {
    return null;
  }

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- tokenPath is from validated account config
    const tokenContent = await fs.readFile(account.tokenPath, 'utf8');
    const credentials = JSON.parse(tokenContent) as Credentials;
    // Use account-specific credentials if available
    const { client_id, client_secret, redirect_uris } = await loadCredentials(accountName);

    const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    client.setCredentials(credentials);
    return client;
  } catch {
    return null;
  }
}

async function saveTokenForAccount(accountName: string, client: OAuth2Client): Promise<string> {
  await ensureConfigDir();
  const tokenPath = path.join(TOKENS_DIR, `${accountName}.json`);

  // Use account-specific credentials if available
  const { client_id, client_secret } = await loadCredentials(accountName);
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id,
    client_secret,
    refresh_token: client.credentials.refresh_token,
  });

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- tokenPath is constructed from validated accountName and known TOKENS_DIR
  await fs.writeFile(tokenPath, payload);
  return tokenPath;
}

// --- Public API ---

/**
 * Initialize the accounts system - validates config and tokens exist
 */
export async function initializeAccounts(): Promise<void> {
  await ensureConfigDir();
  const config = await loadAccountsConfig();

  let validCount = 0;
  // Validate all configured accounts have valid tokens
  for (const [name, account] of Object.entries(config.accounts)) {
    if (!account) continue;
    try {
      const authClient = await loadTokenForAccount(name);
      if (authClient) {
        validCount++;
        console.error(`Loaded account: ${name}${account.email ? ` (${account.email})` : ''}`);
      } else {
        console.error(
          `Warning: Could not load token for account "${name}" - may need re-authentication`
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Warning: Failed to load account "${name}": ${message}`);
    }
  }

  console.error(`Accounts initialized: ${validCount} account(s) loaded`);
}

/**
 * Get the API clients for a specific account
 */
export async function getAccountClients(accountName: string): Promise<AccountClients> {
  // Always load fresh from disk - no caching
  const config = await loadAccountsConfig();
  // eslint-disable-next-line security/detect-object-injection -- accountName is validated by caller
  if (!config.accounts[accountName]) {
    const available = Object.keys(config.accounts);
    if (available.length === 0) {
      throw new Error(
        `Account "${accountName}" not found. No accounts configured. Use the addAccount tool to add an account.`
      );
    }
    throw new Error(
      `Account "${accountName}" not found. Available accounts: ${available.join(', ')}`
    );
  }

  const authClient = await loadTokenForAccount(accountName);
  if (!authClient) {
    throw new Error(
      `Account "${accountName}" exists but token is invalid or missing. Use addAccount to re-authenticate.`
    );
  }

  return {
    authClient,
    docs: google.docs({ version: 'v1', auth: authClient }),
    drive: google.drive({ version: 'v3', auth: authClient }),
    sheets: google.sheets({ version: 'v4', auth: authClient }),
    gmail: google.gmail({ version: 'v1', auth: authClient }),
    calendar: google.calendar({ version: 'v3', auth: authClient }),
    slides: google.slides({ version: 'v1', auth: authClient }),
    forms: google.forms({ version: 'v1', auth: authClient }),
  };
}

/**
 * List all configured accounts
 */
export async function listAccounts(): Promise<AccountConfig[]> {
  const config = await loadAccountsConfig();
  return Object.values(config.accounts).filter((a): a is AccountConfig => a !== undefined);
}

/**
 * Check if any accounts are configured
 */
export async function hasAccounts(): Promise<boolean> {
  const config = await loadAccountsConfig();
  return Object.keys(config.accounts).length > 0;
}

/**
 * Get token info including scopes for an account
 */
export async function getTokenInfo(accountName: string): Promise<{
  email?: string;
  scopes?: string[];
  expiry_date?: number;
  access_token_preview?: string;
}> {
  const clients = await getAccountClients(accountName);
  const authClient = clients.authClient;

  // Get the current credentials
  const credentials = authClient.credentials;

  // Try to get token info from Google
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: authClient });
    const tokenInfo = await oauth2.tokeninfo({
      access_token: credentials.access_token || undefined,
    });

    return {
      email: tokenInfo.data.email || undefined,
      scopes: tokenInfo.data.scope?.split(' ') ?? [],
      expiry_date: credentials.expiry_date || undefined,
      access_token_preview: credentials.access_token ?
        `${credentials.access_token.substring(0, 20)}...` : undefined,
    };
  } catch (_error: unknown) {
    // If tokeninfo fails, return what we have from credentials
    return {
      expiry_date: credentials.expiry_date || undefined,
      access_token_preview: credentials.access_token ?
        `${credentials.access_token.substring(0, 20)}...` : undefined,
      scopes: [], // Can't determine scopes without tokeninfo
    };
  }
}

/**
 * Add a new account via OAuth flow
 * Returns the auth URL that user needs to visit
 * @param accountName - Name for the account
 * @param credentialsPath - Optional path to a credentials.json file for this account
 */
export async function startAddAccount(
  accountName: string,
  credentialsPath?: string
): Promise<{ authUrl: string; port: number; credentialsPath?: string }> {
  const config = await loadAccountsConfig();

  // Validate account name
  if (!/^[a-zA-Z0-9_-]+$/.test(accountName)) {
    throw new Error('Account name must contain only letters, numbers, underscores, and hyphens');
  }

  // eslint-disable-next-line security/detect-object-injection -- accountName is validated above with regex
  if (config.accounts[accountName]) {
    throw new Error(
      `Account "${accountName}" already exists. Use removeAccount first if you want to re-add it.`
    );
  }

  // If credentials path provided, verify it exists
  if (credentialsPath && !(await fileExists(credentialsPath))) {
    throw new Error(`Credentials file not found at ${credentialsPath}`);
  }

  // Temporarily store the credentials path for this account so loadCredentials can find it
  // We'll do this by checking the credentials path directly or using account-name based lookup
  let client_id: string, client_secret: string;

  if (credentialsPath) {
    // Load from the specified path
    const parsed = await parseCredentialsFile(credentialsPath);
    client_id = parsed.client_id;
    client_secret = parsed.client_secret;
  } else {
    // Check for account-specific credentials in the credentials directory
    const accountCredPath = path.join(CREDENTIALS_DIR, `${accountName}.json`);
    if (await fileExists(accountCredPath)) {
      const parsed = await parseCredentialsFile(accountCredPath);
      client_id = parsed.client_id;
      client_secret = parsed.client_secret;
      credentialsPath = accountCredPath;
    } else {
      // Fall back to global credentials
      const creds = await loadCredentials();
      client_id = creds.client_id;
      client_secret = creds.client_secret;
    }
  }

  // Find an available port
  const port = 3000 + Math.floor(Math.random() * 1000);
  const redirectUri = `http://localhost:${port}`;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES.join(' '),
    prompt: 'consent', // Force consent to get refresh token
  });

  return { authUrl, port, credentialsPath };
}

/**
 * Complete the OAuth flow by listening for the callback
 * @param accountName - Name for the account
 * @param port - Port number for the OAuth callback server
 * @param credentialsPath - Optional path to a credentials.json file for this account
 * @param onAuthUrl - Optional callback to receive the auth URL
 */
export async function completeAddAccount(
  accountName: string,
  port: number,
  credentialsPath?: string,
  onAuthUrl?: (url: string) => void
): Promise<AccountConfig> {
  // Load credentials for this account (using per-account if available)
  let client_id: string, client_secret: string;

  if (credentialsPath) {
    const parsed = await parseCredentialsFile(credentialsPath);
    client_id = parsed.client_id;
    client_secret = parsed.client_secret;
  } else {
    // Check for account-specific credentials
    const accountCredPath = path.join(CREDENTIALS_DIR, `${accountName}.json`);
    if (await fileExists(accountCredPath)) {
      const parsed = await parseCredentialsFile(accountCredPath);
      client_id = parsed.client_id;
      client_secret = parsed.client_secret;
      credentialsPath = accountCredPath;
    } else {
      const creds = await loadCredentials();
      client_id = creds.client_id;
      client_secret = creds.client_secret;
    }
  }

  const redirectUri = `http://localhost:${port}`;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES.join(' '),
    prompt: 'consent',
  });

  if (onAuthUrl) {
    onAuthUrl(authUrl);
  }

  return new Promise((resolve, reject) => {
    // Track connections so we can destroy them when closing
    const connections = new Set<import('net').Socket>();
    // Timeout ID will be assigned after server is created
    // Using object wrapper to allow const declaration while still being mutable inside closure
    const timeout: { id?: NodeJS.Timeout } = {};

    const server = http.createServer((req, res) => {
      void (async () => {
      try {
        const url = new URL(req.url ?? '', redirectUri);
        const code = url.searchParams.get('code');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Connection': 'close' });
          res.end(
            `<html><body><h1>Authentication successful for "${accountName}"!</h1><p>You can close this window.</p></body></html>`
          );

          // Close server, clear timeout, and destroy all connections
          clearTimeout(timeout.id);
          server.close();
          connections.forEach((conn) => conn.destroy());

          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);

          // Get user email
          const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
          let email: string | undefined;
          try {
            const userInfo = await oauth2.userinfo.get();
            email = userInfo.data.email || undefined;
          } catch {
            // Email fetch failed, continue without it
          }

          // Save token
          const tokenPath = await saveTokenForAccount(accountName, oAuth2Client);

          // Update config - include credentialsPath if it was specified
          const config = await loadAccountsConfig();
          const accountConfig: AccountConfig = {
            name: accountName,
            email,
            tokenPath,
            ...(credentialsPath && { credentialsPath }),
            addedAt: new Date().toISOString(),
          };
          // eslint-disable-next-line security/detect-object-injection -- accountName validated at function entry
          config.accounts[accountName] = accountConfig;
          await saveAccountsConfig(config);

          resolve(accountConfig);
        } else {
          const error = url.searchParams.get('error');
          res.writeHead(400, { 'Content-Type': 'text/html', 'Connection': 'close' });
          res.end(
            `<html><body><h1>Authentication failed</h1><p>${error || 'No code received'}</p></body></html>`
          );
          clearTimeout(timeout.id);
          server.close();
          connections.forEach((conn) => conn.destroy());
          reject(new Error(error || 'No authorization code received'));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html', 'Connection': 'close' });
        res.end('<html><body><h1>Authentication failed</h1></body></html>');
        clearTimeout(timeout.id);
        server.close();
        connections.forEach((conn) => conn.destroy());
        reject(err instanceof Error ? err : new Error(String(err)));
      }
      })();
    });

    // Track connections so we can properly close them
    server.on('connection', (conn) => {
      connections.add(conn);
      conn.on('close', () => connections.delete(conn));
    });

    server.listen(port, () => {
      console.error(`OAuth callback server listening on port ${port}`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is in use. Please try again.`));
      } else {
        reject(err);
      }
    });

    // Timeout after 5 minutes
    timeout.id = setTimeout(
      () => {
        server.close();
        connections.forEach((conn) => conn.destroy());
        reject(new Error('Authentication timed out after 5 minutes'));
      },
      5 * 60 * 1000
    );
  });
}

/**
 * Remove an account
 */
export async function removeAccount(accountName: string): Promise<void> {
  const config = await loadAccountsConfig();

  // eslint-disable-next-line security/detect-object-injection -- accountName comes from user input but is used safely
  const accountToRemove = config.accounts[accountName];
  if (!accountToRemove) {
    throw new Error(`Account "${accountName}" not found`);
  }

  // Remove token file
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- tokenPath is from validated account config
    await fs.unlink(accountToRemove.tokenPath);
  } catch {
    // Ignore if file doesn't exist
  }

  // Remove from config using object rest spread instead of delete
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [accountName]: _removed, ...remainingAccounts } = config.accounts;
  config.accounts = remainingAccounts;
  await saveAccountsConfig(config);
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
