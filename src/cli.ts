#!/usr/bin/env node
// src/cli.ts - CLI entrypoint for Google Workspace MCP Server
import { Command } from 'commander';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import {
  initializeAccounts,
  listAccounts,
  completeAddAccount,
  removeAccount,
  getConfigDir,
  getCredentialsPath,
  getAccountClients,
  type AccountClients,
} from './accounts.js';

/** Type guard for errors with a message property */
function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

/** Type guard for Google API errors with a code property */
function isGoogleApiError(error: unknown): error is { code: number; message: string } {
  return (
    isErrorWithMessage(error) &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'number'
  );
}

/** Get error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}

// Helper to open URL in browser (cross-platform)
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;

  if (platform === 'darwin') {
    command = `open "${url}"`;
  } else if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  // eslint-disable-next-line security/detect-child-process -- command is constructed from known safe platform-specific openers with URL-encoded input
  exec(command, (error) => {
    if (error) {
      console.error('Could not open browser automatically. Please open the URL manually.');
    }
  });
}

interface PackageJson {
  version: string;
  name?: string;
  description?: string;
}

const program = new Command();

// Version from package.json
const packageJsonPath = new URL('../package.json', import.meta.url);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- packageJsonPath is a known safe path relative to this file
const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as PackageJson;

program
  .name('google-workspace-mcp')
  .description('Google Workspace MCP Server - Manage Google Docs, Sheets, Drive, Gmail, Calendar, Slides, and Forms')
  .version(packageJson.version);

// === MCP Server Command ===
program
  .command('serve')
  .alias('mcp')
  .description('Start the MCP server (for use with Claude Desktop, VS Code, etc.)')
  .option('--read-only', 'Run in read-only mode (block all write operations)')
  .action(async (options: { readOnly?: boolean }) => {
    // Set env var for server.ts to pick up
    if (options.readOnly) {
      process.env.GOOGLE_MCP_READ_ONLY = 'true';
    }
    // Dynamically import and start the server
    await import('./server.js');
  });

// === Setup Command ===
program
  .command('setup')
  .description('Interactive setup wizard for configuring the MCP server')
  .action(async () => {
    console.log('\n🚀 Google Workspace MCP Server Setup\n');
    console.log('This wizard will help you set up the MCP server.\n');

    const configDir = getConfigDir();
    const credPath = getCredentialsPath();

    console.log('📁 Configuration directory:', configDir);
    console.log('🔑 Credentials file path:', credPath);
    console.log('');

    // Check if credentials exist
    try {
      await fs.access(credPath);
      console.log('✅ Credentials file found at', credPath);
    } catch {
      console.log('❌ Credentials file NOT found at', credPath);
      console.log('');
      console.log('To set up credentials:');
      console.log('1. Go to https://console.cloud.google.com/');
      console.log('2. Create a new project (or select an existing one)');
      console.log('3. Enable the following APIs:');
      console.log('   - Google Docs API');
      console.log('   - Google Drive API');
      console.log('   - Google Sheets API');
      console.log('   - Gmail API');
      console.log('   - Google Calendar API');
      console.log('   - Google Slides API');
      console.log('   - Google Forms API');
      console.log('4. Create OAuth 2.0 credentials (Desktop application)');
      console.log('5. Download the credentials JSON file');
      console.log(`6. Copy it to: ${credPath}`);
      console.log('');
      console.log('After setting up credentials, run this command again or use:');
      console.log('  google-workspace-mcp accounts add <account-name>');
      return;
    }

    // Initialize and check accounts
    await initializeAccounts();
    const accounts = await listAccounts();

    if (accounts.length === 0) {
      console.log('');
      console.log('No accounts configured yet.');
      console.log('');
      console.log('To add an account, run:');
      console.log('  google-workspace-mcp accounts add <account-name>');
      console.log('');
      console.log('Example:');
      console.log('  google-workspace-mcp accounts add personal');
      console.log('  google-workspace-mcp accounts add work');
    } else {
      console.log('');
      console.log(`✅ Found ${accounts.length} configured account(s):`);
      accounts.forEach((acc, i) => {
        console.log(`   ${i + 1}. ${acc.name}${acc.email ? ` (${acc.email})` : ''}`);
      });
      console.log('');
      console.log('Your MCP server is ready to use!');
      console.log('');
      console.log('To start the server:');
      console.log('  google-workspace-mcp serve');
    }

    console.log('');
    console.log('📚 For more information, see the README.md');
  });

// === Accounts Commands ===
const accountsCmd = program
  .command('accounts')
  .description('Manage Google account authentication');

accountsCmd
  .command('list')
  .description('List all configured Google accounts')
  .action(async () => {
    await initializeAccounts();
    const accounts = await listAccounts();

    if (accounts.length === 0) {
      console.log('No accounts configured.');
      console.log('');
      console.log('To add an account, run:');
      console.log('  google-workspace-mcp accounts add <account-name>');
      return;
    }

    console.log(`\nConfigured accounts (${accounts.length}):\n`);
    accounts.forEach((account, index) => {
      console.log(`${index + 1}. ${account.name}`);
      if (account.email) {
        console.log(`   Email: ${account.email}`);
      }
      console.log(`   Added: ${account.addedAt}`);
      console.log('');
    });
  });

accountsCmd
  .command('add <name>')
  .description('Add a new Google account')
  .option('-c, --credentials <path>', 'Path to custom credentials.json file for this account')
  .option('--open', 'Automatically open the authorization URL in browser (default)')
  .option('--no-open', 'Do not automatically open browser, just print the URL')
  .action(async (name: string, options: { credentials?: string; open?: boolean }) => {
    console.log(`\nAdding account: ${name}\n`);

    // Validate name
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      console.error('Error: Account name must contain only letters, numbers, underscores, and hyphens.');
      process.exit(1);
    }

    await initializeAccounts();

    // Check if account already exists
    const accounts = await listAccounts();
    if (accounts.some(a => a.name === name)) {
      console.error(`Error: Account "${name}" already exists.`);
      console.error('Use "google-workspace-mcp auth remove <name>" first if you want to re-add it.');
      process.exit(1);
    }

    const port = 3000;
    console.log(`Starting OAuth flow on port ${port}...`);
    console.log('');

    // Default to opening browser unless --no-open is specified
    const shouldOpenBrowser = options.open !== false;

    try {
      // This will block until OAuth is complete
      await completeAddAccount(name, port, options.credentials, (authUrl) => {
        console.log('╔════════════════════════════════════════════════════════════════════╗');
        console.log('║                    AUTHORIZATION REQUIRED                          ║');
        console.log('╚════════════════════════════════════════════════════════════════════╝');
        console.log('');
        if (shouldOpenBrowser) {
          console.log('Opening browser for authorization...');
          console.log('');
          console.log('If the browser does not open, visit this URL manually:');
        } else {
          console.log('Open this URL in your browser to authorize:');
        }
        console.log(authUrl);
        console.log('');
        console.log('Waiting for authorization...');

        // Open the URL in the default browser (unless --no-open)
        if (shouldOpenBrowser) {
          openBrowser(authUrl);
        }
      });

      console.log('');
      console.log(`✅ Account "${name}" added successfully!`);
      console.log('');
      console.log('You can now use this account with the MCP server.');
    } catch (error: unknown) {
      console.error('');
      console.error(`❌ Failed to add account: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

accountsCmd
  .command('remove <name>')
  .description('Remove a Google account')
  .action(async (name: string) => {
    await initializeAccounts();

    try {
      await removeAccount(name);
      console.log(`✅ Account "${name}" removed successfully.`);
    } catch (error: unknown) {
      console.error(`❌ Failed to remove account: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  });

accountsCmd
  .command('test-permissions [name]')
  .description('Test API permissions for account(s). Tests all accounts if no name specified.')
  .action(async (name?: string) => {
    await initializeAccounts();
    const accounts = await listAccounts();

    if (accounts.length === 0) {
      console.log('No accounts configured.');
      console.log('');
      console.log('To add an account, run:');
      console.log('  google-workspace-mcp accounts add <account-name>');
      return;
    }

    // Filter to specific account if name provided
    const accountsToTest = name
      ? accounts.filter((a) => a.name === name)
      : accounts;

    if (name && accountsToTest.length === 0) {
      console.error(`Account "${name}" not found.`);
      process.exit(1);
    }

    console.log(`\n🔍 Testing API permissions for ${accountsToTest.length} account(s)...\n`);

    /** Helper to handle 404 errors as success (resource doesn't exist but we have access) */
    const handle404 = (promise: Promise<unknown>): Promise<unknown> =>
      promise.catch((e: unknown) => {
        if (isGoogleApiError(e) && e.code === 404) return { status: 200 };
        throw e;
      });

    const services: { name: string; test: (clients: AccountClients) => Promise<unknown> }[] = [
      { name: 'Drive', test: async (clients) => await clients.drive.files.list({ pageSize: 1 }) },
      { name: 'Docs', test: async (clients) => await handle404(clients.docs.documents.get({ documentId: 'test' })) },
      { name: 'Sheets', test: async (clients) => await handle404(clients.sheets.spreadsheets.get({ spreadsheetId: 'test' })) },
      { name: 'Gmail', test: async (clients) => await clients.gmail.users.labels.list({ userId: 'me' }) },
      { name: 'Calendar', test: async (clients) => await clients.calendar.calendarList.list({ maxResults: 1 }) },
      { name: 'Slides', test: async (clients) => await handle404(clients.slides.presentations.get({ presentationId: 'test' })) },
      { name: 'Forms', test: async (clients) => await handle404(clients.forms.forms.get({ formId: 'test' })) },
    ];

    let totalIssues = 0;

    for (const account of accountsToTest) {
      console.log(`📧 ${account.name}${account.email ? ` (${account.email})` : ''}`);

      try {
        const clients = await getAccountClients(account.name);
        let accountIssues = 0;

        for (const service of services) {
          try {
            await service.test(clients);
            console.log(`   ✅ ${service.name}`);
          } catch (error: unknown) {
            accountIssues++;
            const message = getErrorMessage(error);
            if (message.includes('insufficient') || message.includes('permission') || message.includes('403')) {
              console.log(`   ❌ ${service.name}: Permission denied`);
            } else if (message.includes('401') || message.includes('invalid_grant')) {
              console.log(`   ❌ ${service.name}: Token expired or revoked`);
            } else {
              console.log(`   ❌ ${service.name}: ${message.substring(0, 60)}`);
            }
          }
        }

        if (accountIssues > 0) {
          totalIssues += accountIssues;
          console.log(`   ⚠️  ${accountIssues} service(s) need attention`);
        }
      } catch (error: unknown) {
        console.log(`   ❌ Failed to load account: ${getErrorMessage(error)}`);
        totalIssues++;
      }

      console.log('');
    }

    if (totalIssues === 0) {
      console.log('✅ All API permissions verified successfully!');
    } else {
      console.log(`⚠️  ${totalIssues} issue(s) found.`);
      console.log('');
      console.log('To fix permission issues, remove and re-add the account:');
      console.log('  google-workspace-mcp accounts remove <name>');
      console.log('  google-workspace-mcp accounts add <name>');
    }
  });

// === Config Commands ===
const configCmd = program
  .command('config')
  .description('View configuration information');

configCmd
  .command('path')
  .description('Show the configuration directory path')
  .action(() => {
    console.log(getConfigDir());
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(async () => {
    const configDir = getConfigDir();
    const credPath = getCredentialsPath();

    console.log('\nGoogle Workspace MCP Server Configuration\n');
    console.log('Configuration directory:', configDir);
    console.log('Credentials file:', credPath);
    console.log('');

    // Check credentials
    try {
      await fs.access(credPath);
      console.log('Credentials status: ✅ Found');
    } catch {
      console.log('Credentials status: ❌ Not found');
    }

    // List accounts
    await initializeAccounts();
    const accounts = await listAccounts();
    console.log('');
    console.log(`Accounts configured: ${accounts.length}`);
    if (accounts.length > 0) {
      accounts.forEach((acc, i) => {
        console.log(`  ${i + 1}. ${acc.name}${acc.email ? ` (${acc.email})` : ''}`);
      });
    }
  });

// === Status Command ===
program
  .command('status')
  .description('Check if the server is properly configured and ready')
  .action(async () => {
    console.log('\n🔍 Checking Google Workspace MCP Server status...\n');

    let issues = 0;

    // Check credentials
    const credPath = getCredentialsPath();
    try {
      await fs.access(credPath);
      console.log('✅ Credentials file found');
    } catch {
      console.log('❌ Credentials file NOT found');
      console.log(`   Expected at: ${credPath}`);
      issues++;
    }

    // Check accounts
    await initializeAccounts();
    const accounts = await listAccounts();
    if (accounts.length > 0) {
      console.log(`✅ ${accounts.length} account(s) configured`);
      accounts.forEach((acc) => {
        console.log(`   - ${acc.name}${acc.email ? ` (${acc.email})` : ''}`);
      });
    } else {
      console.log('⚠️  No accounts configured');
      console.log('   Run: google-workspace-mcp accounts add <account-name>');
      issues++;
    }

    console.log('');
    if (issues === 0) {
      console.log('✅ Server is ready to use!');
      console.log('');
      console.log('Start the server with:');
      console.log('  google-workspace-mcp serve');
    } else {
      console.log(`⚠️  ${issues} issue(s) found. Please resolve them before using the server.`);
    }
  });

// Default command is 'serve' if no command is specified
program.action(() => {
  // If no command provided, show help
  program.help();
});

// Parse arguments
program.parse();
