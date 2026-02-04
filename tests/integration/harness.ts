/**
 * Integration test harness
 *
 * Spawns `claude -p` with MCP config pointing to our server.
 * Also provides Google API clients for assertions and cleanup.
 */

import { execa, type ResultPromise } from 'execa';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { google, type docs_v1, type drive_v3 } from 'googleapis';
import { initializeAccounts, getAccountClients } from '../../src/accounts.js';

export interface TestContext {
  /** Run a prompt through Claude with MCP tools */
  runPrompt: (prompt: string, options?: PromptOptions) => Promise<PromptResult>;

  /** The account being used */
  account: string;

  /** Google Docs client for assertions */
  docs: docs_v1.Docs;

  /** Google Drive client for assertions/cleanup */
  drive: drive_v3.Drive;

  /** Clean up temp directory */
  cleanup: () => Promise<void>;
}

export interface PromptOptions {
  /** Override model for this prompt */
  model?: string;

  /** Timeout in ms (default: 120000) */
  timeout?: number;
}

export interface PromptResult {
  /** Whether Claude completed without errors */
  success: boolean;

  /** The text output from Claude */
  output: string;

  /** Exit code */
  exitCode: number;

  /** Full JSON result if available */
  raw?: ClaudeJsonOutput;

  /** Error message if failed */
  error?: string;

  /** Duration in ms */
  durationMs: number;
}

interface ClaudeJsonOutput {
  type: string;
  subtype: string;
  cost_usd: number;
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
}

export interface SetupOptions {
  /** Google account to use for tools */
  account: string;

  /** Default Claude model (omit to use Claude's default) */
  model?: string;

  /** System prompt to prepend */
  systemPrompt?: string;

  /** Default timeout in ms (default: 120000) */
  timeout?: number;
}

let accountsInitialized = false;

/**
 * Set up a test context with isolated MCP config and Google API clients
 */
export async function setupTest(options: SetupOptions): Promise<TestContext> {
  const { account, model, timeout = 120_000 } = options;

  // Initialize accounts if needed
  if (!accountsInitialized) {
    await initializeAccounts();
    accountsInitialized = true;
  }

  // Get Google API clients for assertions
  const clients = await getAccountClients(account);

  // Create temp directory for MCP config
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwmcp-test-'));

  // Get the path to our MCP server
  const serverPath = path.resolve(process.cwd(), 'dist/cli.js');

  // Create MCP config
  const mcpConfig = {
    mcpServers: {
      'google-workspace': {
        command: 'node',
        args: [serverPath, 'serve'],
      },
    },
  };

  const mcpConfigPath = path.join(tempDir, '.mcp.json');
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  // Build system prompt
  const systemPrompt =
    options.systemPrompt ||
    `You are running an integration test. Use account "${account}" for ALL tool calls that require an account parameter. Be concise.`;

  const runPrompt = async (
    prompt: string,
    promptOptions?: PromptOptions
  ): Promise<PromptResult> => {
    const startTime = Date.now();
    const useModel = promptOptions?.model || model;
    const useTimeout = promptOptions?.timeout || timeout;

    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--mcp-config',
      mcpConfigPath,
      '--strict-mcp-config',
      '--system-prompt',
      systemPrompt,
      '--dangerously-skip-permissions',
    ];

    if (useModel) {
      args.push('--model', useModel);
    }

    try {
      console.error(`[harness] Running: claude ${args.slice(0, 3).join(' ')}...`);

      // Stream output to console for visibility
      console.error(`[harness] Full args: ${JSON.stringify(args)}`);
      console.error(`[harness] MCP config: ${mcpConfigPath}`);
      const subprocess = execa('claude', args, {
        cwd: tempDir,
        timeout: useTimeout,
        reject: false, // Don't throw on non-zero exit
        stdin: 'ignore', // Critical: prevents Claude CLI from hanging
      });

      // Stream stderr in real-time (Claude streams progress to stderr)
      subprocess.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk);
      });

      // Also stream stdout for debugging
      subprocess.stdout?.on('data', (chunk: Buffer) => {
        console.error(`[claude stdout] ${chunk.toString().substring(0, 100)}`);
      });

      const result = await subprocess;
      console.error(`[harness] Command finished with exit code: ${result.exitCode}`);

      // Parse JSON output
      let raw: ClaudeJsonOutput | undefined;
      try {
        const lines = result.stdout.trim().split('\n');
        for (const line of lines) {
          if (line.startsWith('{')) {
            const parsed = JSON.parse(line);
            if (parsed.type === 'result') {
              raw = parsed;
            }
          }
        }
      } catch {
        // JSON parse failed
      }

      return {
        success: result.exitCode === 0 && !raw?.is_error,
        output: raw?.result || result.stdout,
        exitCode: result.exitCode ?? -1,
        raw,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        exitCode: -1,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  };

  const cleanup = async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  };

  return {
    runPrompt,
    account,
    docs: clients.docs,
    drive: clients.drive,
    cleanup,
  };
}

// ============================================================================
// Google API Assertion Helpers
// ============================================================================

/**
 * Check if a document exists
 */
export async function documentExists(
  drive: drive_v3.Drive,
  documentId: string
): Promise<boolean> {
  try {
    await drive.files.get({ fileId: documentId, fields: 'id' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get document title
 */
export async function getDocumentTitle(
  docs: docs_v1.Docs,
  documentId: string
): Promise<string | null> {
  try {
    const res = await docs.documents.get({ documentId });
    return res.data.title || null;
  } catch {
    return null;
  }
}

/**
 * Get document content as plain text
 */
export async function getDocumentText(
  docs: docs_v1.Docs,
  documentId: string
): Promise<string | null> {
  try {
    const res = await docs.documents.get({ documentId });
    const content = res.data.body?.content || [];

    let text = '';
    for (const element of content) {
      if (element.paragraph?.elements) {
        for (const el of element.paragraph.elements) {
          if (el.textRun?.content) {
            text += el.textRun.content;
          }
        }
      }
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * Delete a file (move to trash)
 */
export async function deleteFile(
  drive: drive_v3.Drive,
  fileId: string
): Promise<boolean> {
  try {
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find files by name pattern (for cleanup)
 */
export async function findFilesByName(
  drive: drive_v3.Drive,
  namePattern: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const res = await drive.files.list({
      q: `name contains '${namePattern}' and trashed = false`,
      fields: 'files(id, name)',
    });
    return (res.data.files || []).map((f) => ({
      id: f.id!,
      name: f.name!,
    }));
  } catch {
    return [];
  }
}

/**
 * Delete all files matching a name pattern (for cleanup)
 */
export async function deleteFilesByPattern(
  drive: drive_v3.Drive,
  namePattern: string
): Promise<number> {
  const files = await findFilesByName(drive, namePattern);
  let deleted = 0;
  for (const file of files) {
    if (await deleteFile(drive, file.id)) {
      deleted++;
    }
  }
  return deleted;
}

// ============================================================================
// Output Assertion Helpers
// ============================================================================

/**
 * Assert output contains expected text (case-insensitive)
 */
export function assertOutputContains(
  result: PromptResult,
  expected: string,
  message?: string
): void {
  const output = result.output.toLowerCase();
  const search = expected.toLowerCase();
  if (!output.includes(search)) {
    throw new Error(
      message ||
        `Expected output to contain "${expected}"\nGot: ${result.output.slice(0, 500)}${result.output.length > 500 ? '...' : ''}`
    );
  }
}

/**
 * Assert output does NOT contain text (case-insensitive)
 */
export function assertOutputNotContains(
  result: PromptResult,
  unexpected: string,
  message?: string
): void {
  const output = result.output.toLowerCase();
  const search = unexpected.toLowerCase();
  if (output.includes(search)) {
    throw new Error(message || `Expected output NOT to contain "${unexpected}"`);
  }
}
