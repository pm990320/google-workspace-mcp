// urlHelpers.ts - Helper functions for constructing Google Workspace URLs with authuser param

/**
 * Constructs a Google Docs URL with authuser parameter
 */
export function getDocsUrl(documentId: string, accountEmail: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit?authuser=${encodeURIComponent(accountEmail)}`;
}

/**
 * Constructs a Google Sheets URL with authuser parameter
 */
export function getSheetsUrl(spreadsheetId: string, accountEmail: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?authuser=${encodeURIComponent(accountEmail)}`;
}

/**
 * Constructs a Google Slides URL with authuser parameter
 */
export function getSlidesUrl(presentationId: string, accountEmail: string): string {
  return `https://docs.google.com/presentation/d/${presentationId}/edit?authuser=${encodeURIComponent(accountEmail)}`;
}

/**
 * Constructs a Google Forms edit URL with authuser parameter
 */
export function getFormsUrl(formId: string, accountEmail: string): string {
  return `https://docs.google.com/forms/d/${formId}/edit?authuser=${encodeURIComponent(accountEmail)}`;
}

/**
 * Constructs a Google Forms response URL with authuser parameter
 */
export function getFormsResponseUrl(formId: string, accountEmail: string): string {
  return `https://docs.google.com/forms/d/${formId}/edit?authuser=${encodeURIComponent(accountEmail)}#responses`;
}

/**
 * Constructs a Google Drive file URL with authuser parameter
 */
export function getDriveFileUrl(fileId: string, accountEmail: string): string {
  return `https://drive.google.com/file/d/${fileId}/view?authuser=${encodeURIComponent(accountEmail)}`;
}

/**
 * Constructs a Google Drive folder URL with authuser parameter
 */
export function getDriveFolderUrl(folderId: string, accountEmail: string): string {
  return `https://drive.google.com/drive/folders/${folderId}?authuser=${encodeURIComponent(accountEmail)}`;
}

/**
 * Constructs a Gmail message URL with authuser parameter
 * Note: This opens the message in the Gmail web interface
 */
export function getGmailMessageUrl(messageId: string, accountEmail: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${messageId}`;
}

/**
 * Constructs a Gmail thread URL with authuser parameter
 */
export function getGmailThreadUrl(threadId: string, accountEmail: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${threadId}`;
}

/**
 * Constructs a Gmail drafts URL with authuser parameter
 */
export function getGmailDraftsUrl(accountEmail: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#drafts`;
}

/**
 * Constructs a Gmail draft URL with authuser parameter
 */
export function getGmailDraftUrl(draftId: string, accountEmail: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#drafts?compose=${draftId}`;
}

/**
 * Constructs a Google Calendar event URL with authuser parameter
 * Uses the event's htmlLink as base if available, otherwise constructs one
 */
export function getCalendarEventUrl(
  eventId: string,
  accountEmail: string,
  calendarId: string = 'primary'
): string {
  // Calendar event URLs need special encoding
  const encodedEventId = encodeURIComponent(eventId);
  const encodedCalendarId = encodeURIComponent(calendarId);
  return `https://calendar.google.com/calendar/r/eventedit/${encodedEventId}?authuser=${encodeURIComponent(accountEmail)}&cid=${encodedCalendarId}`;
}

/**
 * Constructs a Google Calendar view URL with authuser parameter
 */
export function getCalendarUrl(accountEmail: string): string {
  return `https://calendar.google.com/calendar/r?authuser=${encodeURIComponent(accountEmail)}`;
}

/**
 * Adds authuser parameter to an existing Google URL
 * Useful when the API returns a webViewLink that needs the authuser param added
 */
export function addAuthUserToUrl(url: string, accountEmail: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.set('authuser', accountEmail);
    return urlObj.toString();
  } catch {
    // If URL parsing fails, append manually
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}authuser=${encodeURIComponent(accountEmail)}`;
  }
}
