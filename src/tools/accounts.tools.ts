// accounts.tools.ts - Account management tool module
import { UserError } from 'fastmcp';
import { z } from 'zod';
import {
  listAccounts as listAccountsFromRegistry,
  completeAddAccount,
  removeAccount as removeAccountFromRegistry,
  getConfigDir,
  getCredentialsPath,
  type AccountConfig,
} from '../accounts.js';
import { getErrorMessage } from '../errorHelpers.js';
import { type FastMCPServer } from '../types.js';

// Store pending OAuth sessions
const pendingOAuthSessions = new Map<
  string,
  {
    port: number;
    authUrl: string;
    resolve: (config: AccountConfig) => void;
    reject: (err: Error) => void;
  }
>();

export function registerAccountsTools(
  server: FastMCPServer,
  ensureAccountsInitialized: () => Promise<void>
) {
  // --- List Accounts ---
  server.addTool({
    name: 'listAccounts',
    description: 'Lists all configured Google accounts that can be used with this MCP server.',
    parameters: z.object({}),
    annotations: {
      title: 'List Accounts',
      readOnlyHint: true,
      openWorldHint: false,
    },
    execute: async (args, { log }) => {
      log.info('Listing configured accounts');
      await ensureAccountsInitialized();

      try {
        const accounts = await listAccountsFromRegistry();

        if (accounts.length === 0) {
          return `No accounts configured.\n\nTo add an account, use the addAccount tool with a unique name.\n\nCredentials file location: ${getCredentialsPath()}\nConfig directory: ${getConfigDir()}`;
        }

        let result = `**Configured Accounts (${accounts.length}):**\n\n`;
        accounts.forEach((account, index) => {
          result += `${index + 1}. **${account.name}**\n`;
          if (account.email) {
            result += `   Email: ${account.email}\n`;
          }
          result += `   Added: ${account.addedAt}\n\n`;
        });

        result += `\nUse the account name (e.g., "${accounts[0].name}") as the 'account' parameter in other tools.`;

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error listing accounts: ${message}`);
        throw new UserError(`Failed to list accounts: ${message}`);
      }
    },
  });

  // --- Add Account ---
  server.addTool({
    name: 'addAccount',
    description:
      'Starts the OAuth flow to add a new Google account. Returns an authorization URL that must be opened in a browser. After authorizing, the account will be added automatically. The account name must be unique and contain only letters, numbers, underscores, and hyphens. Optionally, you can specify a custom credentials file to use a different OAuth app for this account.',
    annotations: {
      title: 'Add Account',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      name: z
        .string()
        .min(1)
        .regex(
          /^[a-zA-Z0-9_-]+$/,
          'Account name must contain only letters, numbers, underscores, and hyphens'
        )
        .describe('A unique name for this account (e.g., "work", "personal", "client-abc")'),
      credentialsPath: z
        .string()
        .optional()
        .describe(
          'Optional: Path to a custom credentials.json file for this account. Use this to authenticate with a different OAuth app. If not specified, looks for ~/.google-mcp/credentials/{name}.json, then falls back to the global credentials.'
        ),
    }),
    execute: async (args, { log }) => {
      log.info(
        `Starting OAuth flow for account: ${args.name}${args.credentialsPath ? ` with custom credentials: ${args.credentialsPath}` : ''}`
      );
      await ensureAccountsInitialized();

      try {
        // Check if account already exists
        const accounts = await listAccountsFromRegistry();
        if (accounts.some((a) => a.name === args.name)) {
          throw new UserError(
            `Account "${args.name}" already exists. Use removeAccount first if you want to re-add it.`
          );
        }

        const port = 3000 + Math.floor(Math.random() * 1000);

        // Start the OAuth flow in the background, passing the optional credentials path
        const oauthPromise = completeAddAccount(
          args.name,
          port,
          args.credentialsPath,
          (authUrl) => {
            // Store the session info
            pendingOAuthSessions.set(args.name, {
              port,
              authUrl,
              resolve: () => {},
              reject: () => {},
            });
          }
        );

        // Give it a moment to start the server and generate the URL
        await new Promise((resolve) => setTimeout(resolve, 500));

        const session = pendingOAuthSessions.get(args.name);
        if (!session) {
          throw new UserError('Failed to start OAuth flow');
        }

        // Set up the promise handlers
        oauthPromise
          .then(() => {
            pendingOAuthSessions.delete(args.name);
            log.info(`OAuth completed for account: ${args.name}`);
          })
          .catch((err: unknown) => {
            pendingOAuthSessions.delete(args.name);
            const message = err instanceof Error ? err.message : String(err);
            log.error(`OAuth failed for account: ${args.name}: ${message}`);
          });

        let response = `ACTION REQUIRED: Open this URL to authorize account "${args.name}":

${session.authUrl}

^^^^ COPY AND OPEN THE URL ABOVE IN YOUR BROWSER ^^^^

After authorizing, the account will be added automatically. Server listening on port ${port}.`;

        if (args.credentialsPath) {
          response += `\n\nUsing custom credentials: ${args.credentialsPath}`;
        }

        return response;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error starting OAuth: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to start OAuth flow: ${message}`);
      }
    },
  });

  // --- Remove Account ---
  server.addTool({
    name: 'removeAccount',
    description:
      'Removes a Google account from the MCP server. This deletes the stored credentials for the account.',
    annotations: {
      title: 'Remove Account',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    parameters: z.object({
      name: z.string().min(1).describe('The name of the account to remove'),
    }),
    execute: async (args, { log }) => {
      log.info(`Removing account: ${args.name}`);
      await ensureAccountsInitialized();

      try {
        await removeAccountFromRegistry(args.name);
        return `Successfully removed account "${args.name}".`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error removing account: ${message}`);
        throw new UserError(`Failed to remove account: ${message}`);
      }
    },
  });
}
