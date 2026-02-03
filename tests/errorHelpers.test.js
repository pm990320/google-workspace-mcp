// tests/errorHelpers.test.js
import {
  isErrorWithMessage,
  isGoogleApiError,
  getErrorMessage,
  getErrorDetails,
  formatToolError,
} from '../dist/errorHelpers.js';
import assert from 'node:assert';
import { describe, it } from 'node:test';

describe('Error Helpers', () => {
  describe('isErrorWithMessage', () => {
    it('should return true for objects with message property', () => {
      assert.strictEqual(isErrorWithMessage({ message: 'test' }), true);
      assert.strictEqual(isErrorWithMessage(new Error('test')), true);
      assert.strictEqual(isErrorWithMessage({ message: '', other: 'prop' }), true);
    });

    it('should return false for objects without message property', () => {
      assert.strictEqual(isErrorWithMessage({}), false);
      assert.strictEqual(isErrorWithMessage({ error: 'test' }), false);
      assert.strictEqual(isErrorWithMessage({ msg: 'test' }), false);
    });

    it('should return false for non-objects', () => {
      assert.strictEqual(isErrorWithMessage(null), false);
      assert.strictEqual(isErrorWithMessage(undefined), false);
      assert.strictEqual(isErrorWithMessage('string'), false);
      assert.strictEqual(isErrorWithMessage(123), false);
      assert.strictEqual(isErrorWithMessage(true), false);
    });

    it('should return false for objects with non-string message', () => {
      assert.strictEqual(isErrorWithMessage({ message: 123 }), false);
      assert.strictEqual(isErrorWithMessage({ message: null }), false);
      assert.strictEqual(isErrorWithMessage({ message: {} }), false);
    });
  });

  describe('isGoogleApiError', () => {
    it('should return true for Error instances with message', () => {
      const error = new Error('test error');
      assert.strictEqual(isGoogleApiError(error), true);
    });

    it('should return true for Error instances with code property', () => {
      const error = new Error('test error');
      error.code = 404;
      assert.strictEqual(isGoogleApiError(error), true);
    });

    it('should return false for plain objects with message', () => {
      // Must be actual Error instance
      assert.strictEqual(isGoogleApiError({ message: 'test' }), false);
    });

    it('should return false for non-errors', () => {
      assert.strictEqual(isGoogleApiError(null), false);
      assert.strictEqual(isGoogleApiError('error string'), false);
      assert.strictEqual(isGoogleApiError(404), false);
    });
  });

  describe('getErrorMessage', () => {
    it('should extract message from Error objects', () => {
      assert.strictEqual(getErrorMessage(new Error('test error')), 'test error');
    });

    it('should extract message from plain objects with message property', () => {
      assert.strictEqual(getErrorMessage({ message: 'plain object error' }), 'plain object error');
    });

    it('should convert non-message types to string', () => {
      assert.strictEqual(getErrorMessage('string error'), 'string error');
      assert.strictEqual(getErrorMessage(404), '404');
      assert.strictEqual(getErrorMessage(null), 'null');
      assert.strictEqual(getErrorMessage(undefined), 'undefined');
    });

    it('should handle objects without message property', () => {
      assert.strictEqual(getErrorMessage({ code: 404 }), '[object Object]');
    });
  });

  describe('getErrorDetails', () => {
    it('should return basic details for non-Google errors', () => {
      const details = getErrorDetails('simple error');
      assert.deepStrictEqual(details, { message: 'simple error' });
    });

    it('should return full details for Google API errors', () => {
      const error = new Error('API Error');
      error.code = 404;
      error.status = 404;
      error.errors = [{ message: 'Not found', domain: 'global', reason: 'notFound' }];
      error.response = { data: { error: 'details' } };

      const details = getErrorDetails(error);
      assert.strictEqual(details.message, 'API Error');
      assert.strictEqual(details.code, 404);
      assert.strictEqual(details.status, 404);
      assert.deepStrictEqual(details.errors, [
        { message: 'Not found', domain: 'global', reason: 'notFound' },
      ]);
      assert.deepStrictEqual(details.response, { error: 'details' });
    });

    it('should handle errors without optional properties', () => {
      const error = new Error('Basic Error');
      const details = getErrorDetails(error);
      assert.strictEqual(details.message, 'Basic Error');
      assert.strictEqual(details.code, undefined);
      assert.strictEqual(details.status, undefined);
    });
  });

  describe('formatToolError', () => {
    it('should format basic errors with tool name', () => {
      const result = formatToolError('readDoc', 'Something went wrong');
      assert.strictEqual(result, 'readDoc error: Something went wrong');
    });

    it('should format Error objects', () => {
      const result = formatToolError('writeDoc', new Error('Write failed'));
      assert.strictEqual(result, 'writeDoc error: Write failed');
    });

    it('should include code and details for Google API errors', () => {
      const error = new Error('Not Found');
      error.code = 404;
      error.errors = [{ message: 'Document not found', domain: 'global', reason: 'notFound' }];

      const result = formatToolError('getDoc', error);
      assert.ok(result.includes('getDoc error: Not Found'));
      assert.ok(result.includes('Code: 404'));
      assert.ok(result.includes('Document not found'));
    });

    it('should include response data when errors array is missing', () => {
      const error = new Error('Forbidden');
      error.code = 403;
      error.response = { data: { reason: 'accessDenied' } };

      const result = formatToolError('updateDoc', error);
      assert.ok(result.includes('updateDoc error: Forbidden'));
      assert.ok(result.includes('Code: 403'));
      assert.ok(result.includes('accessDenied'));
    });

    it('should handle errors with code but no details', () => {
      const error = new Error('Server Error');
      error.code = 500;

      const result = formatToolError('createDoc', error);
      assert.ok(result.includes('createDoc error: Server Error'));
      assert.ok(result.includes('Code: 500'));
      assert.ok(result.includes('No additional details'));
    });
  });
});
