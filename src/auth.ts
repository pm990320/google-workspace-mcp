// src/auth.ts
import { google } from 'googleapis';
import type { OAuth2Client, Credentials } from 'google-auth-library';
import { JWT } from 'google-auth-library'; // ADDED: Import for Service Account client
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline/promises';
import * as http from 'http';
import { fileURLToPath } from 'url';
import { type OAuthCredentialsFile, type ServiceAccountKey } from './types.js';

// --- Calculate paths relative to this script file (ESM way) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRootDir = path.resolve(__dirname, '..');

const TOKEN_PATH = path.join(projectRootDir, 'token.json');
const CREDENTIALS_PATH = path.join(projectRootDir, 'credentials.json');
// --- End of path calculation ---

const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive', // Full Drive access for listing, searching, and document discovery
  'https://www.googleapis.com/auth/spreadsheets', // Google Sheets API access
];

// --- NEW FUNCTION: Handles Service Account Authentication ---
// This entire function is new. It is called only when the
// SERVICE_ACCOUNT_PATH environment variable is set.
// Supports domain-wide delegation via GOOGLE_IMPERSONATE_USER env var.
async function authorizeWithServiceAccount(): Promise<JWT> {
  const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH!; // We know this is set if we are in this function
  const impersonateUser = process.env.GOOGLE_IMPERSONATE_USER; // Optional: email of user to impersonate
  try {
    const keyFileContent = await fs.readFile(serviceAccountPath, 'utf8');
    const serviceAccountKey = JSON.parse(keyFileContent) as ServiceAccountKey;

    const auth = new JWT({
      email: serviceAccountKey.client_email,
      key: serviceAccountKey.private_key,
      scopes: SCOPES,
      subject: impersonateUser, // Enables domain-wide delegation when set
    });
    await auth.authorize();
    if (impersonateUser) {
      console.error(`Service Account authentication successful, impersonating: ${impersonateUser}`);
    } else {
      console.error('Service Account authentication successful!');
    }
    return auth;
  } catch (error: unknown) {
    const isNodeError = (e: unknown): e is NodeJS.ErrnoException =>
      e instanceof Error && 'code' in e;
    if (isNodeError(error) && error.code === 'ENOENT') {
      console.error(`FATAL: Service account key file not found at path: ${serviceAccountPath}`);
      throw new Error(
        `Service account key file not found. Please check the path in SERVICE_ACCOUNT_PATH.`
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('FATAL: Error loading or authorizing the service account key:', message);
    throw new Error(
      'Failed to authorize using the service account. Ensure the key file is valid and the path is correct.'
    );
  }
}
// --- END OF NEW FUNCTION---

async function loadSavedCredentialsIfExist(): Promise<OAuth2Client | null> {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content.toString()) as Credentials;
    const { client_secret, client_id, redirect_uris } = await loadClientSecrets();
    const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    client.setCredentials(credentials);
    return client;
  } catch {
    return null;
  }
}

interface ClientSecrets {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  client_type: 'web' | 'installed';
}

async function loadClientSecrets(): Promise<ClientSecrets> {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content.toString()) as OAuthCredentialsFile;
  const key = keys.installed ?? keys.web;
  if (!key) throw new Error('Could not find client secrets in credentials.json.');
  return {
    client_id: key.client_id,
    client_secret: key.client_secret,
    redirect_uris: key.redirect_uris ?? ['http://localhost:3000/'], // Default for web clients
    client_type: keys.web ? 'web' : 'installed',
  };
}

async function saveCredentials(client: OAuth2Client): Promise<void> {
  const { client_secret, client_id } = await loadClientSecrets();
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: client_id,
    client_secret: client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
  console.error('Token stored to', TOKEN_PATH);
}

async function authenticate(): Promise<OAuth2Client> {
  const { client_secret, client_id, redirect_uris, client_type } = await loadClientSecrets();
  // Use localhost redirect for desktop apps (OOB flow is deprecated)
  const redirectUri = client_type === 'web' ? redirect_uris[0] : 'http://localhost:3000';
  console.error(`DEBUG: Using redirect URI: ${redirectUri}`);
  console.error(`DEBUG: Client type: ${client_type}`);
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES.join(' '),
  });

  console.error('DEBUG: Generated auth URL:', authorizeUrl);
  console.error('Authorize this app by visiting this url:', authorizeUrl);

  // For desktop apps, start a local server to receive the OAuth callback
  if (client_type === 'installed') {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void (async () => {
        try {
          const url = new URL(req.url || '', `http://localhost:3000`);
          const code = url.searchParams.get('code');

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(
              '<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>'
            );

            server.close();

            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            if (tokens.refresh_token) {
              await saveCredentials(oAuth2Client);
            } else {
              console.error('Did not receive refresh token. Token might expire.');
            }
            console.error('Authentication successful!');
            resolve(oAuth2Client);
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Error: No code received</h1></body></html>');
          }
        } catch (err) {
          console.error('Error retrieving access token', err);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication failed</h1></body></html>');
          server.close();
          reject(new Error('Authentication failed'));
        }
        })();
      });

      server.listen(3000, () => {
        console.error('Local server started on http://localhost:3000');
        console.error('Waiting for OAuth callback...');
      });

      server.on('error', (err) => {
        console.error('Server error:', err);
        reject(err);
      });
    });
  } else {
    // For web clients, use readline to get the code manually
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await rl.question('Enter the code from that page here: ');
    rl.close();

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);
      if (tokens.refresh_token) {
        await saveCredentials(oAuth2Client);
      } else {
        console.error('Did not receive refresh token. Token might expire.');
      }
      console.error('Authentication successful!');
      return oAuth2Client;
    } catch (err) {
      console.error('Error retrieving access token', err);
      throw new Error('Authentication failed');
    }
  }
}

// --- MODIFIED: The Main Exported Function ---
// This function now acts as a router. It checks for the environment
// variable and decides which authentication method to use.
export async function authorize(): Promise<OAuth2Client | JWT> {
  // Check if the Service Account environment variable is set.
  if (process.env.SERVICE_ACCOUNT_PATH) {
    console.error('Service account path detected. Attempting service account authentication...');
    return authorizeWithServiceAccount();
  } else {
    // If not, execute the original OAuth 2.0 flow exactly as it was.
    console.error('No service account path detected. Falling back to standard OAuth 2.0 flow...');
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      // Optional: Add token refresh logic here if needed, though library often handles it.
      console.error('Using saved credentials.');
      return client;
    }
    console.error('Starting authentication flow...');
    client = await authenticate();
    return client;
  }
}
// --- END OF MODIFIED: The Main Exported Function ---
