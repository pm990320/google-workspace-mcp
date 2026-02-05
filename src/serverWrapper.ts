// src/serverWrapper.ts - Server wrapper for read-only mode enforcement, third-party blocking, and error handling
import type { Tool, ToolParameters, Context } from 'fastmcp';
import { type FastMCP } from 'fastmcp';
import type { FastMCPSessionAuth } from './types.js';
import {
  type PathSecurityConfig,
  DEFAULT_PATH_SECURITY_CONFIG,
  checkThirdPartyAction,
} from './securityHelpers.js';

export interface ServerConfig {
  /** When true, tools with readOnlyHint: false will be blocked at runtime */
  readOnly: boolean;
  /** When true, tools that communicate with third parties are blocked */
  noThirdParty: boolean;
  /** Path security configuration for file system operations */
  pathSecurity: PathSecurityConfig;
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
interface ToolWithAnnotations<
  T extends FastMCPSessionAuth,
  Params extends ToolParameters,
> extends Tool<T, Params> {
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
  tool: ToolWithAnnotations<T, Params>,
  config: ServerConfig
): ToolWithAnnotations<T, Params> {
  const originalExecute = tool.execute;

  const wrappedExecute = async (args: unknown, context: Context<T>): Promise<unknown> => {
    // Check for third-party actions at runtime if noThirdParty mode is enabled
    if (config.noThirdParty) {
      const thirdPartyCheck = checkThirdPartyAction(tool.name, args as Record<string, unknown>);
      if (thirdPartyCheck.blocked) {
        throw new Error(
          `${thirdPartyCheck.reason}\n\nRestart the server without --no-third-party to enable external communications.${HELP_MESSAGE}`
        );
      }
    }

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
 * 3. Block third-party communications (if enabled)
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

  // Override addTool to wrap all tools with error handling (and mode enforcement if configured)
  server.addTool = function <Params extends ToolParameters>(
    tool: ToolWithAnnotations<T, Params>
  ): void {
    const isReadOnly = tool.annotations?.readOnlyHint === true;

    // In read-only mode, block non-read-only tools
    if (config.readOnly && !isReadOnly) {
      const toolName = tool.name;
      const blockedExecute = (_args: unknown, _context: Context<T>): Promise<string> => {
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

    // Wrap tool with error handler and third-party checking
    const wrappedTool = wrapExecuteWithErrorHandler(tool, config);
    originalAddTool(wrappedTool);
  };

  return server;
}

/**
 * Parse server config from environment variables and optional config file
 */
export function getServerConfigFromEnv(): ServerConfig {
  // Start with defaults
  const config: ServerConfig = {
    readOnly: process.env.GOOGLE_MCP_READ_ONLY === 'true',
    noThirdParty: process.env.GOOGLE_MCP_NO_THIRD_PARTY === 'true',
    pathSecurity: { ...DEFAULT_PATH_SECURITY_CONFIG },
  };

  // Allow overriding allowed paths via environment variables (comma-separated)
  if (process.env.GOOGLE_MCP_ALLOWED_WRITE_PATHS) {
    config.pathSecurity.allowedWritePaths = process.env.GOOGLE_MCP_ALLOWED_WRITE_PATHS.split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  if (process.env.GOOGLE_MCP_ALLOWED_READ_PATHS) {
    config.pathSecurity.allowedReadPaths = process.env.GOOGLE_MCP_ALLOWED_READ_PATHS.split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  // Allow adding additional forbidden patterns via environment variable (comma-separated)
  if (process.env.GOOGLE_MCP_FORBIDDEN_PATHS) {
    const additionalPatterns = process.env.GOOGLE_MCP_FORBIDDEN_PATHS.split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    config.pathSecurity.forbiddenPathPatterns = [
      ...config.pathSecurity.forbiddenPathPatterns,
      ...additionalPatterns,
    ];
  }

  return config;
}

/**
 * Get the current server configuration (for use in tool modules)
 */
let currentConfig: ServerConfig | null = null;

export function setServerConfig(config: ServerConfig): void {
  currentConfig = config;
}

export function getServerConfig(): ServerConfig {
  if (!currentConfig) {
    currentConfig = getServerConfigFromEnv();
  }
  return currentConfig;
}
