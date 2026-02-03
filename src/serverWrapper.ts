// src/serverWrapper.ts - Server wrapper for read-only mode enforcement
import type { Tool, ToolParameters, Context } from 'fastmcp';
import { type FastMCP } from 'fastmcp';
import type { FastMCPSessionAuth } from './types.js';

export interface ServerConfig {
  /** When true, tools with readOnlyHint: false will be blocked at runtime */
  readOnly: boolean;
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
 * Wraps a FastMCP server to enforce read-only mode based on tool annotations.
 * Tools with readOnlyHint: false (or undefined) will be blocked at runtime.
 *
 * @param server - The FastMCP server instance
 * @param config - Server configuration
 * @returns The same server instance with addTool wrapped (if read-only mode is enabled)
 */
export function createServerWithConfig<T extends FastMCPSessionAuth>(
  server: FastMCP<T>,
  config: ServerConfig
): FastMCP<T> {
  if (!config.readOnly) {
    return server; // No wrapping needed
  }

  // Store original addTool method
  const originalAddTool = server.addTool.bind(server);

  // Override addTool to wrap non-read-only tools
  server.addTool = function <Params extends ToolParameters>(
    tool: ToolWithAnnotations<T, Params>
  ): void {
    const isReadOnly = tool.annotations?.readOnlyHint === true;

    if (!isReadOnly) {
      // Wrap the execute function to block write operations at runtime
      const toolName = tool.name;
      const blockedExecute = (
        _args: unknown,
        _context: Context<T>
      ): Promise<string> => {
        return Promise.reject(
          new Error(
            `Tool "${toolName}" is disabled: server is running in read-only mode. ` +
              `This tool would modify data. Restart the server without --read-only to enable write operations.`
          )
        );
      };

      // Create a new tool object with the blocked execute function
      const blockedTool: ToolWithAnnotations<T, Params> = {
        ...tool,
        execute: blockedExecute as typeof tool.execute,
        description: `[READ-ONLY MODE - DISABLED] ${tool.description || ''}`,
      };

      originalAddTool(blockedTool); return;
    }

    originalAddTool(tool);
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
