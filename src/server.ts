// src/server.ts - Google Workspace MCP Server
import { FastMCP } from 'fastmcp';
import {
  type docs_v1,
  type drive_v3,
  type sheets_v4,
  type gmail_v1,
  type calendar_v3,
  type slides_v1,
  type forms_v1,
} from 'googleapis';

// Import tool modules
import { registerDocsTools } from './tools/docs.tools.js';
import { registerDriveTools } from './tools/drive.tools.js';
import { registerSheetsTools } from './tools/sheets.tools.js';
import { registerAccountsTools } from './tools/accounts.tools.js';
import { registerGmailTools } from './tools/gmail.tools.js';
import { registerCalendarTools } from './tools/calendar.tools.js';
import { registerSlidesTools } from './tools/slides.tools.js';
import { registerFormsTools } from './tools/forms.tools.js';

// Import multi-account management
import { initializeAccounts, getAccountClients } from './accounts.js';

// Import server wrapper for read-only mode
import { createServerWithConfig, getServerConfigFromEnv } from './serverWrapper.js';

// --- Initialization ---
let accountsInitialized = false;

async function ensureAccountsInitialized(): Promise<void> {
  if (!accountsInitialized) {
    await initializeAccounts();
    accountsInitialized = true;
  }
}

// Set up process-level unhandled error/rejection handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, _promise) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// --- Server Configuration ---
const serverConfig = getServerConfigFromEnv();

const baseServer = new FastMCP({
  name: 'Google Workspace MCP Server',
  version: '2.0.0',
});

// Wrap server to enforce read-only mode if configured
const server = createServerWithConfig(baseServer, serverConfig);

// --- Client Getters for each service ---
async function getDocsClient(accountName: string): Promise<docs_v1.Docs> {
  await ensureAccountsInitialized();
  const clients = await getAccountClients(accountName);
  return clients.docs;
}

async function getDriveClient(accountName: string): Promise<drive_v3.Drive> {
  await ensureAccountsInitialized();
  const clients = await getAccountClients(accountName);
  return clients.drive;
}

async function getSheetsClient(accountName: string): Promise<sheets_v4.Sheets> {
  await ensureAccountsInitialized();
  const clients = await getAccountClients(accountName);
  return clients.sheets;
}

async function getGmailClient(accountName: string): Promise<gmail_v1.Gmail> {
  await ensureAccountsInitialized();
  const clients = await getAccountClients(accountName);
  return clients.gmail;
}

async function getCalendarClient(accountName: string): Promise<calendar_v3.Calendar> {
  await ensureAccountsInitialized();
  const clients = await getAccountClients(accountName);
  return clients.calendar;
}

async function getSlidesClient(accountName: string): Promise<slides_v1.Slides> {
  await ensureAccountsInitialized();
  const clients = await getAccountClients(accountName);
  return clients.slides;
}

async function getFormsClient(accountName: string): Promise<forms_v1.Forms> {
  await ensureAccountsInitialized();
  const clients = await getAccountClients(accountName);
  return clients.forms;
}

// ===========================================
// === REGISTER ALL TOOL MODULES ===
// ===========================================

// Register Account management tools
registerAccountsTools(server, ensureAccountsInitialized);

// Register Google Docs tools
registerDocsTools(server, getDocsClient, getDriveClient);

// Register Google Drive tools
registerDriveTools(server, getDriveClient, getDocsClient);

// Register Google Sheets tools
registerSheetsTools(server, getSheetsClient, getDriveClient);

// Register Gmail tools
registerGmailTools(server, getGmailClient);

// Register Calendar tools
registerCalendarTools(server, getCalendarClient);

// Register Slides tools (also needs Drive client for listing)
registerSlidesTools(server, getSlidesClient, getDriveClient);

// Register Forms tools (also needs Drive client for listing)
registerFormsTools(server, getFormsClient, getDriveClient);

// --- Server Startup ---
async function startServer() {
  try {
    await ensureAccountsInitialized();

    if (serverConfig.readOnly) {
      console.error('⚠️  Starting Google Workspace MCP server in READ-ONLY mode...');
      console.error(
        '   Write operations are disabled. Use --read-only=false or remove the flag to enable writes.'
      );
    } else {
      console.error('Starting Google Workspace MCP server...');
    }

    const configToUse = {
      transportType: 'stdio' as const,
    };

    await server.start(configToUse);
    console.error(
      `MCP Server running using ${configToUse.transportType}. Awaiting client connection...`
    );

    console.error(
      'Process-level error handling configured to prevent crashes from timeout errors.'
    );
  } catch (startError: unknown) {
    const message = startError instanceof Error ? startError.message : String(startError);
    console.error('FATAL: Server failed to start:', message);
    process.exit(1);
  }
}

void startServer();
