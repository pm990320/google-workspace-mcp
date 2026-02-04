// tests/urlHelpers.test.js
import {
  getDocsUrl,
  getSheetsUrl,
  getSlidesUrl,
  getFormsUrl,
  getFormsResponseUrl,
  getDriveFileUrl,
  getDriveFolderUrl,
  getGmailMessageUrl,
  getGmailThreadUrl,
  getGmailDraftsUrl,
  getGmailDraftUrl,
  getCalendarEventUrl,
  getCalendarUrl,
  addAuthUserToUrl,
} from '../dist/urlHelpers.js';
import { describe, it, expect } from 'vitest';

describe('URL Helpers', () => {
  const testEmail = 'test@example.com';
  const testEmailWithSpecialChars = 'test+alias@example.com';

  describe('getDocsUrl', () => {
    it('should construct a valid Google Docs URL', () => {
      const url = getDocsUrl('abc123', testEmail);
      expect(url).toBe(
        'https://docs.google.com/document/d/abc123/edit?authuser=test%40example.com'
      );
    });

    it('should encode special characters in email', () => {
      const url = getDocsUrl('abc123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://docs.google.com/document/d/abc123/edit?authuser=test%2Balias%40example.com'
      );
    });

    it('should handle document IDs with special characters', () => {
      const url = getDocsUrl('1abc-XYZ_123', testEmail);
      expect(url).toBe(
        'https://docs.google.com/document/d/1abc-XYZ_123/edit?authuser=test%40example.com'
      );
    });
  });

  describe('getSheetsUrl', () => {
    it('should construct a valid Google Sheets URL', () => {
      const url = getSheetsUrl('sheet123', testEmail);
      expect(url).toBe(
        'https://docs.google.com/spreadsheets/d/sheet123/edit?authuser=test%40example.com'
      );
    });

    it('should encode special characters in email', () => {
      const url = getSheetsUrl('sheet123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://docs.google.com/spreadsheets/d/sheet123/edit?authuser=test%2Balias%40example.com'
      );
    });
  });

  describe('getSlidesUrl', () => {
    it('should construct a valid Google Slides URL', () => {
      const url = getSlidesUrl('pres123', testEmail);
      expect(url).toBe(
        'https://docs.google.com/presentation/d/pres123/edit?authuser=test%40example.com'
      );
    });

    it('should encode special characters in email', () => {
      const url = getSlidesUrl('pres123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://docs.google.com/presentation/d/pres123/edit?authuser=test%2Balias%40example.com'
      );
    });
  });

  describe('getFormsUrl', () => {
    it('should construct a valid Google Forms edit URL', () => {
      const url = getFormsUrl('form123', testEmail);
      expect(url).toBe('https://docs.google.com/forms/d/form123/edit?authuser=test%40example.com');
    });

    it('should encode special characters in email', () => {
      const url = getFormsUrl('form123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://docs.google.com/forms/d/form123/edit?authuser=test%2Balias%40example.com'
      );
    });
  });

  describe('getFormsResponseUrl', () => {
    it('should construct a valid Google Forms response URL', () => {
      const url = getFormsResponseUrl('form123', testEmail);
      expect(url).toBe(
        'https://docs.google.com/forms/d/form123/edit?authuser=test%40example.com#responses'
      );
    });

    it('should encode special characters in email', () => {
      const url = getFormsResponseUrl('form123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://docs.google.com/forms/d/form123/edit?authuser=test%2Balias%40example.com#responses'
      );
    });
  });

  describe('getDriveFileUrl', () => {
    it('should construct a valid Google Drive file URL', () => {
      const url = getDriveFileUrl('file123', testEmail);
      expect(url).toBe('https://drive.google.com/file/d/file123/view?authuser=test%40example.com');
    });

    it('should encode special characters in email', () => {
      const url = getDriveFileUrl('file123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://drive.google.com/file/d/file123/view?authuser=test%2Balias%40example.com'
      );
    });
  });

  describe('getDriveFolderUrl', () => {
    it('should construct a valid Google Drive folder URL', () => {
      const url = getDriveFolderUrl('folder123', testEmail);
      expect(url).toBe(
        'https://drive.google.com/drive/folders/folder123?authuser=test%40example.com'
      );
    });

    it('should encode special characters in email', () => {
      const url = getDriveFolderUrl('folder123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://drive.google.com/drive/folders/folder123?authuser=test%2Balias%40example.com'
      );
    });
  });

  describe('getGmailMessageUrl', () => {
    it('should construct a valid Gmail message URL', () => {
      const url = getGmailMessageUrl('msg123', testEmail);
      expect(url).toBe('https://mail.google.com/mail/?authuser=test%40example.com#all/msg123');
    });

    it('should encode special characters in email', () => {
      const url = getGmailMessageUrl('msg123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://mail.google.com/mail/?authuser=test%2Balias%40example.com#all/msg123'
      );
    });
  });

  describe('getGmailThreadUrl', () => {
    it('should construct a valid Gmail thread URL', () => {
      const url = getGmailThreadUrl('thread123', testEmail);
      expect(url).toBe('https://mail.google.com/mail/?authuser=test%40example.com#all/thread123');
    });

    it('should encode special characters in email', () => {
      const url = getGmailThreadUrl('thread123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://mail.google.com/mail/?authuser=test%2Balias%40example.com#all/thread123'
      );
    });
  });

  describe('getGmailDraftsUrl', () => {
    it('should construct a valid Gmail drafts URL', () => {
      const url = getGmailDraftsUrl(testEmail);
      expect(url).toBe('https://mail.google.com/mail/?authuser=test%40example.com#drafts');
    });

    it('should encode special characters in email', () => {
      const url = getGmailDraftsUrl(testEmailWithSpecialChars);
      expect(url).toBe('https://mail.google.com/mail/?authuser=test%2Balias%40example.com#drafts');
    });
  });

  describe('getGmailDraftUrl', () => {
    it('should construct a valid Gmail draft URL', () => {
      const url = getGmailDraftUrl('draft123', testEmail);
      expect(url).toBe(
        'https://mail.google.com/mail/?authuser=test%40example.com#drafts?compose=draft123'
      );
    });

    it('should encode special characters in email', () => {
      const url = getGmailDraftUrl('draft123', testEmailWithSpecialChars);
      expect(url).toBe(
        'https://mail.google.com/mail/?authuser=test%2Balias%40example.com#drafts?compose=draft123'
      );
    });
  });

  describe('getCalendarEventUrl', () => {
    it('should construct a valid Calendar event URL with default calendarId', () => {
      const url = getCalendarEventUrl('event123', testEmail);
      expect(url).toBe(
        'https://calendar.google.com/calendar/r/eventedit/event123?authuser=test%40example.com&cid=primary'
      );
    });

    it('should construct a valid Calendar event URL with custom calendarId', () => {
      const url = getCalendarEventUrl('event123', testEmail, 'custom@calendar.com');
      expect(url).toBe(
        'https://calendar.google.com/calendar/r/eventedit/event123?authuser=test%40example.com&cid=custom%40calendar.com'
      );
    });

    it('should encode special characters in email and calendarId', () => {
      const url = getCalendarEventUrl(
        'event123',
        testEmailWithSpecialChars,
        'cal+test@example.com'
      );
      expect(url).toBe(
        'https://calendar.google.com/calendar/r/eventedit/event123?authuser=test%2Balias%40example.com&cid=cal%2Btest%40example.com'
      );
    });

    it('should encode special characters in eventId', () => {
      const url = getCalendarEventUrl('event/with/slashes', testEmail);
      expect(url).toBe(
        'https://calendar.google.com/calendar/r/eventedit/event%2Fwith%2Fslashes?authuser=test%40example.com&cid=primary'
      );
    });
  });

  describe('getCalendarUrl', () => {
    it('should construct a valid Calendar view URL', () => {
      const url = getCalendarUrl(testEmail);
      expect(url).toBe('https://calendar.google.com/calendar/r?authuser=test%40example.com');
    });

    it('should encode special characters in email', () => {
      const url = getCalendarUrl(testEmailWithSpecialChars);
      expect(url).toBe(
        'https://calendar.google.com/calendar/r?authuser=test%2Balias%40example.com'
      );
    });
  });

  describe('addAuthUserToUrl', () => {
    it('should add authuser to URL without query params', () => {
      const url = addAuthUserToUrl('https://example.com/path', testEmail);
      expect(url).toBe('https://example.com/path?authuser=test%40example.com');
    });

    it('should add authuser to URL with existing query params', () => {
      const url = addAuthUserToUrl('https://example.com/path?foo=bar', testEmail);
      expect(url).toBe('https://example.com/path?foo=bar&authuser=test%40example.com');
    });

    it('should replace existing authuser param', () => {
      const url = addAuthUserToUrl('https://example.com/path?authuser=old@example.com', testEmail);
      expect(url).toBe('https://example.com/path?authuser=test%40example.com');
    });

    it('should handle URLs with hash fragments', () => {
      const url = addAuthUserToUrl('https://example.com/path#section', testEmail);
      expect(url).toBe('https://example.com/path?authuser=test%40example.com#section');
    });

    it('should handle URLs with query params and hash fragments', () => {
      const url = addAuthUserToUrl('https://example.com/path?foo=bar#section', testEmail);
      expect(url).toBe('https://example.com/path?foo=bar&authuser=test%40example.com#section');
    });

    it('should fallback to manual append for invalid URLs', () => {
      const url = addAuthUserToUrl('not-a-valid-url', testEmail);
      expect(url).toBe('not-a-valid-url?authuser=test%40example.com');
    });

    it('should fallback with & for invalid URLs that contain ?', () => {
      const url = addAuthUserToUrl('not-a-valid-url?param=value', testEmail);
      expect(url).toBe('not-a-valid-url?param=value&authuser=test%40example.com');
    });

    it('should encode special characters in email', () => {
      const url = addAuthUserToUrl('https://example.com/path', testEmailWithSpecialChars);
      expect(url).toBe('https://example.com/path?authuser=test%2Balias%40example.com');
    });
  });
});
