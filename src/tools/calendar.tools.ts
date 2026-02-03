// calendar.tools.ts - Calendar tool module
import { z } from 'zod';
import { formatToolError } from '../errorHelpers.js';
import { type CalendarToolOptions } from '../types.js';
import { getCalendarUrl, addAuthUserToUrl } from '../urlHelpers.js';

// Helper to format date/time for display
function formatDateTime(
  dt: { dateTime?: string | null; date?: string | null; timeZone?: string | null } | undefined
): string {
  if (!dt) return 'N/A';
  if (dt.dateTime) {
    const d = new Date(dt.dateTime);
    return d.toLocaleString() + (dt.timeZone ? ` (${dt.timeZone})` : '');
  }
  if (dt.date) return dt.date + ' (all day)';
  return 'N/A';
}

export function registerCalendarTools(options: CalendarToolOptions) {
  const { server, getCalendarClient, getAccountEmail } = options;
  server.addTool({
    name: 'listCalendars',
    description: 'List all calendars accessible by the account.',
    annotations: {
      title: 'List Calendars',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
    }),
    async execute(args, { log: _log }) {
      try {
        const calendar = await getCalendarClient(args.account);
        const accountEmail = await getAccountEmail(args.account);
        const calendarLink = getCalendarUrl(accountEmail);

        const response = await calendar.calendarList.list();
        const calendars = response.data.items ?? [];

        let result = `**Calendars (${calendars.length} total)**\n\n`;

        calendars.forEach((c, i) => {
          result += `${i + 1}. ${c.summary}${c.primary ? ' (Primary)' : ''}\n`;
          result += `   ID: ${c.id}\n`;
          if (c.description) result += `   Description: ${c.description}\n`;
          result += `   Access: ${c.accessRole}\n`;
          if (c.timeZone) result += `   Time Zone: ${c.timeZone}\n`;
          result += '\n';
        });

        result += `\nOpen Calendar: ${calendarLink}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('listCalendars', error));
      }
    },
  });

  // --- List Calendar Events ---
  server.addTool({
    name: 'listCalendarEvents',
    description: 'List events from a calendar within a time range.',
    annotations: {
      title: 'List Calendar Events',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      calendarId: z
        .string()
        .optional()
        .default('primary')
        .describe('Calendar ID (default: primary)'),
      timeMin: z
        .string()
        .optional()
        .describe('Start of time range (ISO 8601 format). Defaults to now.'),
      timeMax: z
        .string()
        .optional()
        .describe('End of time range (ISO 8601 format). Defaults to 7 days from now.'),
      maxResults: z
        .number()
        .optional()
        .default(50)
        .describe('Maximum number of events (default: 50)'),
      singleEvents: z
        .boolean()
        .optional()
        .default(true)
        .describe('Expand recurring events into instances (default: true)'),
      orderBy: z
        .enum(['startTime', 'updated'])
        .optional()
        .default('startTime')
        .describe('Order by field'),
    }),
    async execute(args, { log: _log }) {
      try {
        const calendar = await getCalendarClient(args.account);

        const now = new Date();
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const response = await calendar.events.list({
          calendarId: args.calendarId || 'primary',
          timeMin: args.timeMin || now.toISOString(),
          timeMax: args.timeMax || weekFromNow.toISOString(),
          maxResults: args.maxResults,
          singleEvents: args.singleEvents,
          orderBy: args.singleEvents ? args.orderBy : undefined,
        });

        const accountEmail = await getAccountEmail(args.account);
        const events = response.data.items ?? [];

        let result = '**Calendar Events**\n';
        result += `Time Zone: ${response.data.timeZone || 'N/A'}\n`;
        result += `Found ${events.length} events\n\n`;

        if (events.length === 0) {
          result += 'No events in this time range.';
          return result;
        }

        events.forEach((e, i) => {
          const link = e.htmlLink ? addAuthUserToUrl(e.htmlLink, accountEmail) : undefined;
          result += `**${i + 1}. ${e.summary || '(No title)'}**\n`;
          result += `   ID: ${e.id}\n`;
          result += `   Start: ${formatDateTime(e.start)}\n`;
          result += `   End: ${formatDateTime(e.end)}\n`;
          if (e.location) result += `   Location: ${e.location}\n`;
          if (e.status) result += `   Status: ${e.status}\n`;
          if (e.recurringEventId) result += '   Recurring: Yes\n';
          if (e.attendees?.length) {
            result += `   Attendees: ${e.attendees.map((a) => `${a.email} (${a.responseStatus})`).join(', ')}\n`;
          }
          if (link) result += `   Link: ${link}\n`;
          result += '\n';
        });

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('listCalendarEvents', error));
      }
    },
  });

  // --- Search Calendar Events ---
  server.addTool({
    name: 'searchCalendarEvents',
    description:
      'Search for calendar events by text query. Searches event summary, description, location, and attendee names/emails.',
    annotations: {
      title: 'Search Calendar Events',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      query: z.string().min(1).describe('Text to search for in events'),
      calendarId: z
        .string()
        .optional()
        .default('primary')
        .describe('Calendar ID (default: primary)'),
      timeMin: z
        .string()
        .optional()
        .describe('Start of time range (ISO 8601 format). Defaults to 1 year ago.'),
      timeMax: z
        .string()
        .optional()
        .describe('End of time range (ISO 8601 format). Defaults to 1 year from now.'),
      maxResults: z
        .number()
        .optional()
        .default(25)
        .describe('Maximum number of events (default: 25)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const calendar = await getCalendarClient(args.account);

        const now = new Date();
        const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        const yearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

        const response = await calendar.events.list({
          calendarId: args.calendarId || 'primary',
          q: args.query,
          timeMin: args.timeMin || yearAgo.toISOString(),
          timeMax: args.timeMax || yearFromNow.toISOString(),
          maxResults: args.maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        });

        const events = response.data.items ?? [];
        const accountEmail = await getAccountEmail(args.account);

        let result = `**Search Results for:** "${args.query}"\n`;
        result += `Time Zone: ${response.data.timeZone || 'N/A'}\n`;
        result += `Found ${events.length} events\n\n`;

        if (events.length === 0) {
          result += 'No events matching your query.';
          return result;
        }

        events.forEach((e, i) => {
          const link = e.htmlLink ? addAuthUserToUrl(e.htmlLink, accountEmail) : undefined;
          result += `**${i + 1}. ${e.summary || '(No title)'}**\n`;
          result += `   ID: ${e.id}\n`;
          result += `   Start: ${formatDateTime(e.start)}\n`;
          result += `   End: ${formatDateTime(e.end)}\n`;
          if (e.location) result += `   Location: ${e.location}\n`;
          if (e.description)
            result += `   Description: ${e.description.substring(0, 100)}${e.description.length > 100 ? '...' : ''}\n`;
          if (e.attendees?.length) {
            result += `   Attendees: ${e.attendees.map((a) => a.email).join(', ')}\n`;
          }
          if (link) result += `   Link: ${link}\n`;
          result += '\n';
        });

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('searchCalendarEvents', error));
      }
    },
  });

  // --- Get Calendar Event ---
  server.addTool({
    name: 'getCalendarEvent',
    description: 'Get details of a specific calendar event.',
    annotations: {
      title: 'Get Calendar Event',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      calendarId: z.string().optional().default('primary').describe('Calendar ID'),
      eventId: z.string().describe('Event ID to retrieve'),
    }),
    async execute(args, { log: _log }) {
      try {
        const calendar = await getCalendarClient(args.account);

        const response = await calendar.events.get({
          calendarId: args.calendarId || 'primary',
          eventId: args.eventId,
        });

        const e = response.data;
        const accountEmail = await getAccountEmail(args.account);
        const link = e.htmlLink ? addAuthUserToUrl(e.htmlLink, accountEmail) : undefined;

        let result = '**Event Details**\n\n';
        result += `Title: ${e.summary || '(No title)'}\n`;
        result += `ID: ${e.id}\n`;
        result += `Status: ${e.status || 'N/A'}\n\n`;

        result += '**Time**\n';
        result += `Start: ${formatDateTime(e.start)}\n`;
        result += `End: ${formatDateTime(e.end)}\n`;
        if (e.recurrence?.length) {
          result += `Recurrence: ${e.recurrence.join(', ')}\n`;
        }
        result += '\n';

        if (e.location) result += `Location: ${e.location}\n`;
        if (e.description) result += `Description: ${e.description}\n\n`;

        result += '**People**\n';
        result += `Organizer: ${e.organizer?.email || 'N/A'}\n`;
        result += `Creator: ${e.creator?.email || 'N/A'}\n`;
        if (e.attendees?.length) {
          result += 'Attendees:\n';
          e.attendees.forEach((a) => {
            result += `  - ${a.email} (${a.responseStatus || 'no response'})${a.organizer ? ' [organizer]' : ''}${a.self ? ' [you]' : ''}\n`;
          });
        }
        result += '\n';

        result += '**Metadata**\n';
        result += `Created: ${e.created || 'N/A'}\n`;
        result += `Updated: ${e.updated || 'N/A'}\n`;

        if (e.conferenceData) {
          result += '\n**Conference**\n';
          if (e.conferenceData.entryPoints) {
            e.conferenceData.entryPoints.forEach((ep) => {
              result += `  ${ep.entryPointType}: ${ep.uri || ep.label}\n`;
            });
          }
        }

        if (e.reminders?.overrides?.length) {
          result += `\nReminders: ${e.reminders.overrides.map((r) => `${r.minutes} min (${r.method})`).join(', ')}\n`;
        }

        if (link) result += `\nView event: ${link}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('getCalendarEvent', error));
      }
    },
  });

  // --- Create Calendar Event ---
  server.addTool({
    name: 'createCalendarEvent',
    description: 'Create a new calendar event.',
    annotations: {
      title: 'Create Calendar Event',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      calendarId: z.string().optional().default('primary').describe('Calendar ID'),
      summary: z.string().describe('Event title'),
      description: z.string().optional().describe('Event description'),
      location: z.string().optional().describe('Event location'),
      startDateTime: z
        .string()
        .describe('Start date/time (ISO 8601 format, e.g., "2024-01-15T10:00:00-05:00")'),
      endDateTime: z.string().describe('End date/time (ISO 8601 format)'),
      timeZone: z.string().optional().describe('Time zone (e.g., "America/New_York")'),
      attendees: z.array(z.string()).optional().describe('List of attendee email addresses'),
      sendUpdates: z
        .enum(['all', 'externalOnly', 'none'])
        .optional()
        .default('none')
        .describe('Send notifications to attendees'),
    }),
    async execute(args, { log: _log }) {
      try {
        const calendar = await getCalendarClient(args.account);

        const response = await calendar.events.insert({
          calendarId: args.calendarId || 'primary',
          sendUpdates: args.sendUpdates,
          requestBody: {
            summary: args.summary,
            description: args.description,
            location: args.location,
            start: {
              dateTime: args.startDateTime,
              timeZone: args.timeZone,
            },
            end: {
              dateTime: args.endDateTime,
              timeZone: args.timeZone,
            },
            attendees: args.attendees?.map((email) => ({ email })),
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.htmlLink
          ? addAuthUserToUrl(response.data.htmlLink, accountEmail)
          : undefined;

        let result = 'Successfully created calendar event.\n\n';
        result += `Title: ${response.data.summary}\n`;
        result += `Event ID: ${response.data.id}\n`;
        result += `Start: ${formatDateTime(response.data.start)}\n`;
        result += `End: ${formatDateTime(response.data.end)}\n`;
        if (args.location) result += `Location: ${args.location}\n`;
        if (args.attendees?.length) {
          result += `Attendees: ${args.attendees.join(', ')}\n`;
          result += `Notifications: ${args.sendUpdates}\n`;
        }
        if (link) result += `\nView event: ${link}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('createCalendarEvent', error));
      }
    },
  });

  // --- Update Calendar Event ---
  server.addTool({
    name: 'updateCalendarEvent',
    description: 'Update an existing calendar event.',
    annotations: {
      title: 'Update Calendar Event',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      calendarId: z.string().optional().default('primary').describe('Calendar ID'),
      eventId: z.string().describe('Event ID to update'),
      summary: z.string().optional().describe('New event title'),
      description: z.string().optional().describe('New event description'),
      location: z.string().optional().describe('New event location'),
      startDateTime: z.string().optional().describe('New start date/time (ISO 8601)'),
      endDateTime: z.string().optional().describe('New end date/time (ISO 8601)'),
      timeZone: z.string().optional().describe('Time zone'),
      sendUpdates: z
        .enum(['all', 'externalOnly', 'none'])
        .optional()
        .default('none')
        .describe('Send update notifications'),
    }),
    async execute(args, { log: _log }) {
      try {
        const calendar = await getCalendarClient(args.account);

        // First get the existing event
        const existing = await calendar.events.get({
          calendarId: args.calendarId || 'primary',
          eventId: args.eventId,
        });

        // Merge updates
        const updated = {
          ...existing.data,
          summary: args.summary ?? existing.data.summary,
          description: args.description ?? existing.data.description,
          location: args.location ?? existing.data.location,
          start: args.startDateTime
            ? { dateTime: args.startDateTime, timeZone: args.timeZone }
            : existing.data.start,
          end: args.endDateTime
            ? { dateTime: args.endDateTime, timeZone: args.timeZone }
            : existing.data.end,
        };

        const response = await calendar.events.update({
          calendarId: args.calendarId || 'primary',
          eventId: args.eventId,
          sendUpdates: args.sendUpdates,
          requestBody: updated,
        });

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.htmlLink
          ? addAuthUserToUrl(response.data.htmlLink, accountEmail)
          : undefined;

        let result = 'Successfully updated calendar event.\n\n';
        result += `Title: ${response.data.summary}\n`;
        result += `Event ID: ${response.data.id}\n`;
        result += `Start: ${formatDateTime(response.data.start)}\n`;
        result += `End: ${formatDateTime(response.data.end)}\n`;
        if (response.data.location) result += `Location: ${response.data.location}\n`;
        result += `Notifications: ${args.sendUpdates}\n`;
        if (link) result += `\nView event: ${link}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('updateCalendarEvent', error));
      }
    },
  });

  // --- Delete Calendar Event ---
  server.addTool({
    name: 'deleteCalendarEvent',
    description: 'Delete a calendar event.',
    annotations: {
      title: 'Delete Calendar Event',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      calendarId: z.string().optional().default('primary').describe('Calendar ID'),
      eventId: z.string().describe('Event ID to delete'),
      sendUpdates: z
        .enum(['all', 'externalOnly', 'none'])
        .optional()
        .default('none')
        .describe('Send cancellation notifications'),
    }),
    async execute(args, { log: _log }) {
      try {
        const calendar = await getCalendarClient(args.account);

        await calendar.events.delete({
          calendarId: args.calendarId || 'primary',
          eventId: args.eventId,
          sendUpdates: args.sendUpdates,
        });

        const accountEmail = await getAccountEmail(args.account);
        const calendarLink = getCalendarUrl(accountEmail);

        let result = 'Successfully deleted calendar event.\n\n';
        result += `Deleted Event ID: ${args.eventId}\n`;
        result += `Notifications: ${args.sendUpdates}\n`;
        result += `\nView calendar: ${calendarLink}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('deleteCalendarEvent', error));
      }
    },
  });
}
