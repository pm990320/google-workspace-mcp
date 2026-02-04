// tests/errorHelpers.test.js
import {
  isErrorWithMessage,
  isGoogleApiError,
  getErrorMessage,
  getErrorDetails,
  formatToolError,
} from '../dist/errorHelpers.js';
import { describe, it, expect } from 'vitest';

describe('Error Helpers', () => {
  describe('isErrorWithMessage', () => {
    it('should return true for objects with message property', () => {
      expect(isErrorWithMessage({ message: 'test' })).toBe(true);
      expect(isErrorWithMessage(new Error('test'))).toBe(true);
      expect(isErrorWithMessage({ message: '', other: 'prop' })).toBe(true);
    });

    it('should return false for objects without message property', () => {
      expect(isErrorWithMessage({})).toBe(false);
      expect(isErrorWithMessage({ error: 'test' })).toBe(false);
      expect(isErrorWithMessage({ msg: 'test' })).toBe(false);
    });

    it('should return false for non-objects', () => {
      expect(isErrorWithMessage(null)).toBe(false);
      expect(isErrorWithMessage(undefined)).toBe(false);
      expect(isErrorWithMessage('string')).toBe(false);
      expect(isErrorWithMessage(123)).toBe(false);
      expect(isErrorWithMessage(true)).toBe(false);
    });

    it('should return false for objects with non-string message', () => {
      expect(isErrorWithMessage({ message: 123 })).toBe(false);
      expect(isErrorWithMessage({ message: null })).toBe(false);
      expect(isErrorWithMessage({ message: {} })).toBe(false);
    });
  });

  describe('isGoogleApiError', () => {
    it('should return true for Error instances with message', () => {
      const error = new Error('test error');
      expect(isGoogleApiError(error)).toBe(true);
    });

    it('should return true for Error instances with code property', () => {
      const error = new Error('test error');
      error.code = 404;
      expect(isGoogleApiError(error)).toBe(true);
    });

    it('should return false for plain objects with message', () => {
      // Must be actual Error instance
      expect(isGoogleApiError({ message: 'test' })).toBe(false);
    });

    it('should return false for non-errors', () => {
      expect(isGoogleApiError(null)).toBe(false);
      expect(isGoogleApiError('error string')).toBe(false);
      expect(isGoogleApiError(404)).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('should extract message from Error objects', () => {
      expect(getErrorMessage(new Error('test error'))).toBe('test error');
    });

    it('should extract message from plain objects with message property', () => {
      expect(getErrorMessage({ message: 'plain object error' })).toBe('plain object error');
    });

    it('should convert non-message types to string', () => {
      expect(getErrorMessage('string error')).toBe('string error');
      expect(getErrorMessage(404)).toBe('404');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('should handle objects without message property', () => {
      expect(getErrorMessage({ code: 404 })).toBe('[object Object]');
    });
  });

  describe('getErrorDetails', () => {
    it('should return basic details for non-Google errors', () => {
      const details = getErrorDetails('simple error');
      expect(details).toEqual({ message: 'simple error' });
    });

    it('should return full details for Google API errors', () => {
      const error = new Error('API Error');
      error.code = 404;
      error.status = 404;
      error.errors = [{ message: 'Not found', domain: 'global', reason: 'notFound' }];
      error.response = { data: { error: 'details' } };

      const details = getErrorDetails(error);
      expect(details.message).toBe('API Error');
      expect(details.code).toBe(404);
      expect(details.status).toBe(404);
      expect(details.errors).toEqual([
        { message: 'Not found', domain: 'global', reason: 'notFound' },
      ]);
      expect(details.response).toEqual({ error: 'details' });
    });

    it('should handle errors without optional properties', () => {
      const error = new Error('Basic Error');
      const details = getErrorDetails(error);
      expect(details.message).toBe('Basic Error');
      expect(details.code).toBe(undefined);
      expect(details.status).toBe(undefined);
    });
  });

  describe('formatToolError', () => {
    it('should format basic errors with tool name', () => {
      const result = formatToolError('readDoc', 'Something went wrong');
      expect(result).toBe('readDoc error: Something went wrong');
    });

    it('should format Error objects', () => {
      const result = formatToolError('writeDoc', new Error('Write failed'));
      expect(result).toBe('writeDoc error: Write failed');
    });

    it('should include code and details for Google API errors', () => {
      const error = new Error('Not Found');
      error.code = 404;
      error.errors = [{ message: 'Document not found', domain: 'global', reason: 'notFound' }];

      const result = formatToolError('getDoc', error);
      expect(result).toContain('getDoc error: Not Found');
      expect(result).toContain('Code: 404');
      expect(result).toContain('Document not found');
    });

    it('should include response data when errors array is missing', () => {
      const error = new Error('Forbidden');
      error.code = 403;
      error.response = { data: { reason: 'accessDenied' } };

      const result = formatToolError('updateDoc', error);
      expect(result).toContain('updateDoc error: Forbidden');
      expect(result).toContain('Code: 403');
      expect(result).toContain('accessDenied');
    });

    it('should handle errors with code but no details', () => {
      const error = new Error('Server Error');
      error.code = 500;

      const result = formatToolError('createDoc', error);
      expect(result).toContain('createDoc error: Server Error');
      expect(result).toContain('Code: 500');
      expect(result).toContain('No additional details');
    });
  });
});
