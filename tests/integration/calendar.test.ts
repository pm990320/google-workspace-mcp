/**
 * Integration tests for Google Calendar tools
 *
 * Each test exercises multiple tools in a workflow pattern to minimize test runtime.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  setupTest,
  assertOutputContains,
  type TestContext,
} from './harness.js';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';
const TEST_PREFIX = 'MCP-IntTest-Calendar';

describe('Google Calendar Tools', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTest({ account: TEST_ACCOUNT, timeout: 300_000 });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('should handle calendar and event lifecycle: list calendars, list events, create event, get event, update event, delete event', async () => {
    const timestamp = Date.now();
    const eventTitle = `${TEST_PREFIX}-Event-${timestamp}`;

    // Calculate tomorrow's date in ISO format
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const startTime = tomorrow.toISOString();

    const endTime = new Date(tomorrow);
    endTime.setHours(11, 0, 0, 0);
    const endTimeStr = endTime.toISOString();

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Calendar operations:

      1. LIST CALENDARS: List all calendars accessible to the account.
         Report how many calendars exist and the name of the primary calendar.

      2. LIST EVENTS: List upcoming events from the primary calendar (next 7 days, limit 10).
         Report how many events were found.

      3. CREATE EVENT: Create a new calendar event with:
         - Summary: "${eventTitle}"
         - Start time: ${startTime}
         - End time: ${endTimeStr}
         - Description: "This is a test event created by MCP integration tests."
         - Location: "Virtual"
         Do NOT add any attendees.
         Report the event ID.

      4. LIST EVENTS AGAIN: List upcoming events to verify the new event appears.
         Confirm the event "${eventTitle}" is in the list.

      5. GET EVENT: Get the full details of the event you created using getCalendarEvent.
         Report the event summary, start time, and description.

      6. UPDATE EVENT: Update the event to:
         - Change the summary to "${eventTitle} - UPDATED"
         - Change the location to "Conference Room A"
         Confirm the update.

      7. GET EVENT AGAIN: Get the event details to verify the update.
         Confirm the summary and location changed.

      8. DELETE EVENT: Delete the event (without sending notifications to attendees).
         Confirm deletion.

      9. LIST EVENTS FINAL: List upcoming events to verify the event was deleted.
         Confirm the event no longer appears.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, eventTitle);
  });

  it('should handle event search and filtering', async () => {
    const timestamp = Date.now();
    const eventTitle = `${TEST_PREFIX}-Search-${timestamp}`;

    // Create event for next week
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(14, 0, 0, 0);
    const startTime = nextWeek.toISOString();

    const endTime = new Date(nextWeek);
    endTime.setHours(15, 0, 0, 0);
    const endTimeStr = endTime.toISOString();

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Calendar operations:

      1. CREATE EVENT: Create a test event:
         - Summary: "${eventTitle}"
         - Start time: ${startTime}
         - End time: ${endTimeStr}
         Do NOT add attendees.
         Report the event ID.

      2. SEARCH BY TEXT: List events and search for ones containing "${TEST_PREFIX}" in the summary.
         Report if the event was found.

      3. LIST WITH TIME FILTER: List events for the next 14 days to ensure the event is included.
         Confirm the event appears.

      4. SEARCH CALENDAR EVENTS: Use searchCalendarEvents to search for events containing "${TEST_PREFIX}" in the text.
         Report how many events were found and confirm the test event appears.

      5. DELETE: Delete the event to clean up.
         Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, eventTitle);
  });
});
