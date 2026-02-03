// src/errorHelpers.ts - Error handling utilities

/**
 * Google API error structure (from gaxios)
 */
export interface GoogleApiError extends Error {
  code?: number;
  status?: number;
  errors?: { message: string; domain: string; reason: string }[];
  response?: {
    data?: unknown;
    status?: number;
    statusText?: string;
  };
}

/**
 * Type guard for errors with a message property
 */
export function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

/**
 * Type guard for Google API errors with code/status
 */
export function isGoogleApiError(error: unknown): error is GoogleApiError {
  return isErrorWithMessage(error) && error instanceof Error;
}

/**
 * Get error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}

/**
 * Get error details for logging
 */
export function getErrorDetails(error: unknown): Record<string, unknown> {
  if (!isGoogleApiError(error)) {
    return { message: getErrorMessage(error) };
  }

  return {
    message: error.message,
    code: error.code,
    status: error.status,
    errors: error.errors,
    response: error.response?.data,
  };
}

/**
 * Format error for tool response
 */
export function formatToolError(toolName: string, error: unknown): string {
  const message = getErrorMessage(error);
  const details = getErrorDetails(error);

  if (isGoogleApiError(error) && error.code) {
    return `${toolName} error: ${message}. Code: ${error.code}. Details: ${JSON.stringify(details.errors || details.response || 'No additional details')}`;
  }

  return `${toolName} error: ${message}`;
}
