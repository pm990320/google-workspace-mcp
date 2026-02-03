// calendar.tools.ts - Auto-generated tool module
import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { calendar_v3 } from 'googleapis';

export function registerCalendarTools(
  server: FastMCP<any>,
  getClient: (accountName: string) => Promise<calendar_v3.Calendar>
) {
  server.addTool({
    name: 'listCalendars',
    description: 'List all calendars accessible by the account.',
    parameters: z.object({
      account: z.string().describe('Account name to use'),
    }),
    async execute(args, { log: _log }) {
      const calendar = await getClient(args.account);

      const response = await calendar.calendarList.list();

      return JSON.stringify(
        {
          calendars: (response.data.items || []).map((c) => ({
            id: c.id,
            summary: c.summary,
            description: c.description,
            primary: c.primary,
            accessRole: c.accessRole,
            backgroundColor: c.backgroundColor,
            timeZone: c.timeZone,
          })),
        },
        null,
        2
      );
    },
  });

  // --- List Calendar Events ---
  server.addTool({
    name: 'listCalendarEvents',
    description: 'List events from a calendar within a time range.',
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
      const calendar = await getClient(args.account);

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

      return JSON.stringify(
        {
          timeZone: response.data.timeZone,
          events: (response.data.items || []).map((e) => ({
            id: e.id,
            summary: e.summary,
            description: e.description,
            location: e.location,
            start: e.start,
            end: e.end,
            status: e.status,
            htmlLink: e.htmlLink,
            attendees: e.attendees?.map((a) => ({
              email: a.email,
              responseStatus: a.responseStatus,
            })),
            organizer: e.organizer,
            recurring: !!e.recurringEventId,
          })),
        },
        null,
        2
      );
    },
  });

  // --- Get Calendar Event ---
  server.addTool({
    name: 'getCalendarEvent',
    description: 'Get details of a specific calendar event.',
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      calendarId: z.string().optional().default('primary').describe('Calendar ID'),
      eventId: z.string().describe('Event ID to retrieve'),
    }),
    async execute(args, { log: _log }) {
      const calendar = await getClient(args.account);

      const response = await calendar.events.get({
        calendarId: args.calendarId || 'primary',
        eventId: args.eventId,
      });

      const e = response.data;
      return JSON.stringify(
        {
          id: e.id,
          summary: e.summary,
          description: e.description,
          location: e.location,
          start: e.start,
          end: e.end,
          status: e.status,
          htmlLink: e.htmlLink,
          attendees: e.attendees,
          organizer: e.organizer,
          creator: e.creator,
          created: e.created,
          updated: e.updated,
          recurrence: e.recurrence,
          reminders: e.reminders,
          conferenceData: e.conferenceData,
        },
        null,
        2
      );
    },
  });

  // --- Create Calendar Event ---
  server.addTool({
    name: 'createCalendarEvent',
    description: 'Create a new calendar event.',
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
      const calendar = await getClient(args.account);

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

      return JSON.stringify(
        {
          success: true,
          eventId: response.data.id,
          htmlLink: response.data.htmlLink,
          summary: response.data.summary,
          start: response.data.start,
          end: response.data.end,
        },
        null,
        2
      );
    },
  });

  // --- Update Calendar Event ---
  server.addTool({
    name: 'updateCalendarEvent',
    description: 'Update an existing calendar event.',
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
      const calendar = await getClient(args.account);

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

      return JSON.stringify(
        {
          success: true,
          eventId: response.data.id,
          htmlLink: response.data.htmlLink,
          summary: response.data.summary,
          start: response.data.start,
          end: response.data.end,
        },
        null,
        2
      );
    },
  });

  // --- Delete Calendar Event ---
  server.addTool({
    name: 'deleteCalendarEvent',
    description: 'Delete a calendar event.',
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
      const calendar = await getClient(args.account);

      await calendar.events.delete({
        calendarId: args.calendarId || 'primary',
        eventId: args.eventId,
        sendUpdates: args.sendUpdates,
      });

      return JSON.stringify({ success: true, deletedEventId: args.eventId }, null, 2);
    },
  });
}
