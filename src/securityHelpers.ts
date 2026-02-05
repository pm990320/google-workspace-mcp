// src/securityHelpers.ts - Security utilities for input sanitization and path validation

import * as path from 'path';
import * as os from 'os';
import { realpathSync, existsSync } from 'fs';

// --- Query String Sanitization ---

/**
 * Escapes a string for safe use in Google Drive API query strings.
 * Prevents query injection by escaping single quotes and backslashes.
 *
 * @param input - The user-provided string to escape
 * @returns Escaped string safe for use in Drive API queries
 */
export function escapeDriveQuery(input: string): string {
  // Escape backslashes first, then single quotes
  // Google Drive API uses single quotes for string literals
  return input.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// --- File System Path Security ---

/** Configuration for allowed and forbidden paths */
export interface PathSecurityConfig {
  /** Directories where file writes are allowed (absolute paths) */
  allowedWritePaths: string[];
  /** Directories where file reads are allowed (absolute paths) */
  allowedReadPaths: string[];
  /** Path patterns that are always forbidden (applies to both read and write) */
  forbiddenPathPatterns: string[];
  /** Whether to follow symlinks when validating paths */
  followSymlinks: boolean;
}

/** Default security configuration */
export const DEFAULT_PATH_SECURITY_CONFIG: PathSecurityConfig = {
  allowedWritePaths: [
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Desktop'),
    os.tmpdir(),
  ],
  allowedReadPaths: [
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Pictures'),
    path.join(os.homedir(), 'Videos'),
    os.tmpdir(),
  ],
  forbiddenPathPatterns: [
    // SSH and GPG keys
    '**/.ssh/**',
    '**/.gnupg/**',
    '**/.gpg/**',
    // Cloud credentials
    '**/.aws/**',
    '**/.azure/**',
    '**/.gcloud/**',
    '**/.config/gcloud/**',
    '**/.kube/**',
    // Package manager tokens
    '**/.npmrc',
    '**/.yarnrc',
    '**/.pip/**',
    // Shell configs (could contain secrets)
    '**/.bashrc',
    '**/.zshrc',
    '**/.profile',
    '**/.bash_profile',
    '**/.zprofile',
    '**/.env',
    '**/.env.*',
    // Git credentials
    '**/.git-credentials',
    '**/.gitconfig',
    // Browser data
    '**/.config/google-chrome/**',
    '**/.config/chromium/**',
    '**/Library/Application Support/Google/Chrome/**',
    // Password managers
    '**/.password-store/**',
    '**/Keychain/**',
    // Private keys
    '**/*.pem',
    '**/*.key',
    '**/*_rsa',
    '**/*_ed25519',
    '**/*_ecdsa',
    '**/*_dsa',
    // Database files that might contain credentials
    '**/*.sqlite',
    '**/*.db',
    // System files
    '/etc/**',
    '/var/**',
    '/usr/**',
    '/bin/**',
    '/sbin/**',
    '/System/**',
    '/Library/**',
    // Windows system
    'C:\\Windows/**',
    'C:\\Program Files/**',
    'C:\\Program Files (x86)/**',
  ],
  followSymlinks: true,
};

/**
 * Checks if a path matches any of the forbidden patterns.
 * Uses simple glob-like matching (** for any path segment, * for any characters in a segment).
 */
function matchesForbiddenPattern(filePath: string, patterns: string[]): string | null {
  const normalizedPath = path.normalize(filePath);

  for (const pattern of patterns) {
    if (matchGlobPattern(normalizedPath, pattern)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Simple glob pattern matching.
 * Supports ** for any path segments and * for any characters within a segment.
 */
function matchGlobPattern(filePath: string, pattern: string): boolean {
  // Normalize both paths
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const normalizedPattern = pattern.replace(/\\/g, '/').toLowerCase();

  // Convert glob pattern to regex
  let regexPattern = normalizedPattern
    // Escape special regex characters (except * and ?)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Convert ** to match any path
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    // Convert * to match any characters except /
    .replace(/\*/g, '[^/]*')
    // Restore ** as match-all
    .replace(/\{\{DOUBLESTAR\}\}/g, '.*');

  // Anchor the pattern
  if (!regexPattern.startsWith('.*')) {
    regexPattern = '(^|/)' + regexPattern;
  }

  const regex = new RegExp(regexPattern);
  return regex.test(normalizedPath);
}

/**
 * Checks if a path is within any of the allowed directories.
 */
function isPathInAllowedDirs(filePath: string, allowedDirs: string[]): boolean {
  const normalizedPath = path.normalize(filePath);

  for (const allowedDir of allowedDirs) {
    const normalizedAllowed = path.normalize(allowedDir);
    // Check if the path starts with the allowed directory
    if (normalizedPath.startsWith(normalizedAllowed + path.sep) || normalizedPath === normalizedAllowed) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves a path, following symlinks if configured, and returns the real path.
 * Returns the original path if the target doesn't exist yet (for write operations).
 */
function resolveRealPath(filePath: string, followSymlinks: boolean): string {
  if (!followSymlinks) {
    return path.resolve(filePath);
  }

  try {
    // If the file exists, get its real path
    if (existsSync(filePath)) {
      return realpathSync(filePath);
    }

    // For non-existent files (write operations), check parent directory
    const parentDir = path.dirname(filePath);
    if (existsSync(parentDir)) {
      const realParent = realpathSync(parentDir);
      return path.join(realParent, path.basename(filePath));
    }

    // Parent doesn't exist either, just resolve
    return path.resolve(filePath);
  } catch {
    // If we can't resolve, return the normalized path
    return path.resolve(filePath);
  }
}

export interface PathValidationResult {
  valid: boolean;
  resolvedPath: string;
  error?: string;
}

/**
 * Validates a file path for read operations.
 *
 * @param filePath - The path to validate
 * @param config - Security configuration
 * @returns Validation result with resolved path or error message
 */
export function validateReadPath(
  filePath: string,
  config: PathSecurityConfig = DEFAULT_PATH_SECURITY_CONFIG
): PathValidationResult {
  // Must be absolute
  if (!path.isAbsolute(filePath)) {
    return {
      valid: false,
      resolvedPath: filePath,
      error: 'Path must be absolute',
    };
  }

  // Resolve the real path (following symlinks if configured)
  const resolvedPath = resolveRealPath(filePath, config.followSymlinks);

  // Check forbidden patterns on both original and resolved paths
  const forbiddenMatch =
    matchesForbiddenPattern(filePath, config.forbiddenPathPatterns) ||
    matchesForbiddenPattern(resolvedPath, config.forbiddenPathPatterns);

  if (forbiddenMatch) {
    return {
      valid: false,
      resolvedPath,
      error: `Path matches forbidden pattern: ${forbiddenMatch}. This path may contain sensitive data.`,
    };
  }

  // Check if in allowed directories
  if (!isPathInAllowedDirs(resolvedPath, config.allowedReadPaths)) {
    return {
      valid: false,
      resolvedPath,
      error: `Path is not in an allowed directory. Allowed read directories: ${config.allowedReadPaths.join(', ')}`,
    };
  }

  return { valid: true, resolvedPath };
}

/**
 * Validates a file path for write operations.
 *
 * @param filePath - The path to validate
 * @param config - Security configuration
 * @returns Validation result with resolved path or error message
 */
export function validateWritePath(
  filePath: string,
  config: PathSecurityConfig = DEFAULT_PATH_SECURITY_CONFIG
): PathValidationResult {
  // Must be absolute
  if (!path.isAbsolute(filePath)) {
    return {
      valid: false,
      resolvedPath: filePath,
      error: 'Path must be absolute',
    };
  }

  // Resolve the real path (following symlinks if configured)
  const resolvedPath = resolveRealPath(filePath, config.followSymlinks);

  // Check forbidden patterns on both original and resolved paths
  const forbiddenMatch =
    matchesForbiddenPattern(filePath, config.forbiddenPathPatterns) ||
    matchesForbiddenPattern(resolvedPath, config.forbiddenPathPatterns);

  if (forbiddenMatch) {
    return {
      valid: false,
      resolvedPath,
      error: `Path matches forbidden pattern: ${forbiddenMatch}. Writing to this path is not allowed.`,
    };
  }

  // Check if in allowed directories
  if (!isPathInAllowedDirs(resolvedPath, config.allowedWritePaths)) {
    return {
      valid: false,
      resolvedPath,
      error: `Path is not in an allowed directory. Allowed write directories: ${config.allowedWritePaths.join(', ')}`,
    };
  }

  return { valid: true, resolvedPath };
}

// --- Third-Party Action Detection ---

/**
 * Tools that involve third-party communication when certain parameters are used.
 * Maps tool name to the parameter(s) that trigger third-party communication.
 */
export const THIRD_PARTY_TOOLS: Record<string, { params?: string[]; always?: boolean; description: string }> = {
  // Gmail - sending/forwarding involves third parties
  sendGmailDraft: { always: true, description: 'Sends email to external recipients' },
  createGmailFilter: { params: ['forward'], description: 'Can auto-forward emails to external addresses' },

  // Calendar - attendees involve third parties
  createCalendarEvent: { params: ['attendees', 'sendUpdates'], description: 'Can send calendar invites to attendees' },
  updateCalendarEvent: { params: ['sendUpdates'], description: 'Can send update notifications to attendees' },
  deleteCalendarEvent: { params: ['sendUpdates'], description: 'Can send cancellation notifications to attendees' },

  // Drive - sharing involves third parties
  shareFile: { always: true, description: 'Shares files with other users' },
  getShareableLink: { always: true, description: 'Creates publicly accessible links' },
};

/**
 * Checks if a tool call would involve third-party communication.
 *
 * @param toolName - Name of the tool being called
 * @param args - Arguments being passed to the tool
 * @returns Object indicating if blocked and why
 */
export function checkThirdPartyAction(
  toolName: string,
  args: Record<string, unknown>
): { blocked: boolean; reason?: string } {
  const toolConfig = THIRD_PARTY_TOOLS[toolName];

  if (!toolConfig) {
    return { blocked: false };
  }

  // Tool always involves third parties
  if (toolConfig.always) {
    return {
      blocked: true,
      reason: `Tool "${toolName}" is blocked in no-third-party mode: ${toolConfig.description}`,
    };
  }

  // Check if any triggering parameters are present and non-empty
  if (toolConfig.params) {
    for (const param of toolConfig.params) {
      const value = args[param];
      // Check if parameter exists and has a meaningful value
      if (value !== undefined && value !== null && value !== '' && value !== 'none') {
        // Special handling for arrays
        if (Array.isArray(value) && value.length > 0) {
          return {
            blocked: true,
            reason: `Tool "${toolName}" with parameter "${param}" is blocked in no-third-party mode: ${toolConfig.description}`,
          };
        }
        // For non-arrays, any truthy value triggers the block
        if (!Array.isArray(value)) {
          return {
            blocked: true,
            reason: `Tool "${toolName}" with parameter "${param}=${String(value)}" is blocked in no-third-party mode: ${toolConfig.description}`,
          };
        }
      }
    }
  }

  return { blocked: false };
}
