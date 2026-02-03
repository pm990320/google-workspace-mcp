// src/serverWrapper.ts - Server wrapper for read-only mode enforcement and error handling
import type { Tool, ToolParameters, Context } from 'fastmcp';
import { type FastMCP } from 'fastmcp';
import type { FastMCPSessionAuth } from './types.js';

export interface ServerConfig {
  /** When true, tools with readOnlyHint: false will be blocked at runtime */
  readOnly: boolean;
}

const HELP_MESSAGE = `

For help, see: https://github.com/zueai/google-workspace-mcp#troubleshooting
To report an issue: https://github.com/zueai/google-workspace-mcp/issues`;

/**
 * Enhances error messages with help links
 */
function enhanceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${message}${HELP_MESSAGE}`;
}

/**
 * Tool definition with annotations for read-only detection
 */
interface ToolWithAnnotations<T extends FastMCPSessionAuth, Params extends ToolParameters>
  extends Tool<T, Params> {
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
    streamingHint?: boolean;
  };
}

/**
 * Wraps a tool's execute function with error handling that adds help links
 */
function wrapExecuteWithErrorHandler<T extends FastMCPSessionAuth, Params extends ToolParameters>(
  tool: ToolWithAnnotations<T, Params>
): ToolWithAnnotations<T, Params> {
  const originalExecute = tool.execute;

  const wrappedExecute = async (
    args: unknown,
    context: Context<T>
  ): Promise<unknown> => {
    try {
      return await (originalExecute as (args: unknown, context: Context<T>) => Promise<unknown>)(
        args,
        context
      );
    } catch (error) {
      throw new Error(enhanceErrorMessage(error));
    }
  };

  return {
    ...tool,
    execute: wrappedExecute as unknown as typeof tool.execute,
  };
}

/**
 * Wraps a FastMCP server to:
 * 1. Add global error handling with help links to all tools
 * 2. Enforce read-only mode based on tool annotations (if enabled)
 *
 * @param server - The FastMCP server instance
 * @param config - Server configuration
 * @returns The same server instance with addTool wrapped
 */
export function createServerWithConfig<T extends FastMCPSessionAuth>(
  server: FastMCP<T>,
  config: ServerConfig
): FastMCP<T> {
  // Store original addTool method
  const originalAddTool = server.addTool.bind(server);

  // Override addTool to wrap all tools with error handling (and read-only enforcement if configured)
  server.addTool = function <Params extends ToolParameters>(
    tool: ToolWithAnnotations<T, Params>
  ): void {
    const isReadOnly = tool.annotations?.readOnlyHint === true;

    // In read-only mode, block non-read-only tools
    if (config.readOnly && !isReadOnly) {
      const toolName = tool.name;
      const blockedExecute = (
        _args: unknown,
        _context: Context<T>
      ): Promise<string> => {
        return Promise.reject(
          new Error(
            `Tool "${toolName}" is disabled: server is running in read-only mode. ` +
              `This tool would modify data. Restart the server without --read-only to enable write operations.${HELP_MESSAGE}`
          )
        );
      };

      const blockedTool: ToolWithAnnotations<T, Params> = {
        ...tool,
        execute: blockedExecute as typeof tool.execute,
        description: `[READ-ONLY MODE - DISABLED] ${tool.description || ''}`,
      };

      originalAddTool(blockedTool);
      return;
    }

    // Wrap tool with error handler
    const wrappedTool = wrapExecuteWithErrorHandler(tool);
    originalAddTool(wrappedTool);
  };

  return server;
}

/**
 * Parse server config from environment variables
 */
export function getServerConfigFromEnv(): ServerConfig {
  return {
    readOnly: process.env.GOOGLE_MCP_READ_ONLY === 'true',
  };
}
