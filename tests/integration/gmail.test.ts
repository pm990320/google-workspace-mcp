/**
 * Integration tests for Gmail tools
 *
 * Each test exercises multiple tools in a workflow pattern to minimize test runtime.
 * Note: These tests interact with real Gmail - be careful with send operations.
 */
import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest';
import {
  setupTest,
  assertOutputContains,
  type TestContext,
} from './harness.js';
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';
const TEST_PREFIX = 'MCP-IntTest-Gmail';

describe('Gmail Tools', () => {
  let ctx: TestContext;
  let createdFilePaths: string[] = [];

  beforeAll(async () => {
    ctx = await setupTest({ account: TEST_ACCOUNT, timeout: 300_000 });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    // Clean up downloaded files
    for (const filePath of createdFilePaths) {
      try {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
    createdFilePaths = [];
  });

  it('should handle message operations: list labels, list messages, search, read, mark read/unread', async () => {
    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Gmail operations:

      1. LIST LABELS: List all Gmail labels available in the account.
         Report how many labels exist and name a few of them.

      2. LIST MESSAGES: List recent inbox messages (limit 5).
         Report the count and the subject of the first message.
         Note one message ID for the following steps.

      3. SEARCH: Search Gmail for messages with query "in:inbox".
         Report how many results were found.

      4. READ MESSAGE: Read the full details of one message from step 2.
         Report the subject, sender, and first 100 characters of the body.

      5. MARK AS READ: Mark the message as read using markAsRead.
         Confirm the operation.

      6. MARK AS UNREAD: Mark the same message as unread using markAsUnread.
         Confirm the operation.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'label');
  });

  it('should handle thread operations: list threads, read thread', async () => {
    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Gmail operations:

      1. LIST THREADS: List recent Gmail threads (limit 5).
         Report how many threads were found and the subject of the first thread.
         Note one thread ID for the next step.

      2. READ THREAD: Read the complete thread using readGmailThread.
         Report how many messages are in the thread and summarize the conversation.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'thread');
  });

  it('should handle draft lifecycle: create, list, read, update, delete', async () => {
    const timestamp = Date.now();
    const subject = `${TEST_PREFIX}-Draft-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Gmail operations:

      1. CREATE DRAFT: Create a new Gmail draft with:
         - To: test-recipient@example.com
         - Subject: "${subject}"
         - Body: "This is a test draft created by the MCP integration test suite. Please ignore."
         Report the draft ID.

      2. LIST DRAFTS: List all Gmail drafts.
         Confirm the new draft appears in the list.

      3. READ DRAFT: Read the draft to verify its content.
         Confirm the subject and body match what was created.

      4. UPDATE DRAFT: Update the draft to change:
         - Subject: "${subject} - UPDATED"
         - Body: "This draft has been updated by the integration test."
         Confirm the update.

      5. READ DRAFT AGAIN: Read the draft to verify the update.
         Confirm the new subject and body.

      6. ADD ATTACHMENT: Add a small text attachment to the draft using addAttachmentToDraft.
         Use this base64 content (a simple text file): "VGhpcyBpcyBhIHRlc3QgYXR0YWNobWVudC4="
         Filename: "test-attachment.txt"
         MIME type: "text/plain"
         Report if the attachment was added.

      7. READ DRAFT WITH ATTACHMENT: Read the draft again.
         Confirm the attachment is listed.

      8. REMOVE ATTACHMENT: Remove the attachment from the draft using removeAttachmentFromDraft.
         Confirm removal.

      9. DELETE DRAFT: Delete the draft (permanent deletion).
         Confirm deletion.

      10. LIST DRAFTS AGAIN: List drafts to verify the draft was deleted.
          Confirm it no longer appears.

      IMPORTANT: Do NOT send this draft. Only delete it.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, subject);
  });

  it('should handle label management: create label, add/remove from message, batch operations', async () => {
    const timestamp = Date.now();
    const labelName = `${TEST_PREFIX}-Label-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Gmail operations:

      1. CREATE LABEL: Create a new Gmail label called "${labelName}".
         Report the label ID.

      2. LIST LABELS: List all labels to verify the new label was created.
         Confirm "${labelName}" appears in the list.

      3. LIST MESSAGES: List recent inbox messages (limit 3) to get message IDs for testing.
         Note the message IDs.

      4. ADD LABEL: Add the new label to one of the messages using addGmailLabel.
         Confirm the label was added.

      5. READ MESSAGE: Read the labeled message to verify the label is attached.
         Confirm the label appears in the message's labels.

      6. REMOVE LABEL: Remove the label from the message using removeGmailLabel.
         Confirm removal.

      7. BATCH ADD LABELS: Add the STARRED label to multiple messages (use 2 message IDs) using batchAddGmailLabels.
         Confirm the batch operation.

      8. BATCH REMOVE LABELS: Remove the STARRED label from those messages using batchRemoveGmailLabels.
         Confirm the batch operation.

      Note: The test label "${labelName}" will remain in Gmail. It can be manually deleted if desired.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, labelName);
  });

  it('should handle filter management: list filters, create filter, delete filter', async () => {
    const timestamp = Date.now();

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Gmail operations:

      1. LIST FILTERS: List all existing Gmail filters using listGmailFilters.
         Report how many filters exist.

      2. CREATE FILTER: Create a new Gmail filter with:
         - Criteria: from "mcp-test-filter-${timestamp}@example.com"
         - Action: add label "STARRED"
         Report the filter ID.

      3. LIST FILTERS AGAIN: List filters to verify the new filter was created.
         Confirm the filter appears.

      4. DELETE FILTER: Delete the filter you just created using deleteGmailFilter.
         Confirm deletion.

      5. LIST FILTERS FINAL: List filters to verify the filter was deleted.
         Confirm the filter count decreased or the filter no longer appears.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'filter');
  });

  it('should handle attachment operations: find message with attachment, get metadata, download', async () => {
    const timestamp = Date.now();
    const downloadPath = join(tmpdir(), `gmail-attachment-${timestamp}.bin`);
    createdFilePaths.push(downloadPath);

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Gmail operations:

      1. SEARCH FOR ATTACHMENTS: Search Gmail for messages with attachments using query "has:attachment".
         Report how many messages were found. If none found, report that and skip remaining steps.

      2. READ MESSAGE WITH ATTACHMENT: If messages were found, read one of them to get attachment details.
         Report the attachment filename, MIME type, and size if available.
         Note the attachment ID.

      3. GET ATTACHMENT PREVIEW: Use getGmailAttachment to get a preview of the attachment.
         Report that the preview data was retrieved (it will be truncated base64).

      4. DOWNLOAD ATTACHMENT: Use downloadGmailAttachment to download the full attachment.
         First try without savePath to get the base64 data.
         Report the size of the downloaded data.

      5. DOWNLOAD TO FILE: Use downloadGmailAttachment with savePath to save to: ${downloadPath}
         Report if the file was saved successfully.

      6. SAVE ATTACHMENT TO DRIVE: If an attachment was found, use saveAttachmentToDrive to save it
         directly to Google Drive. Report the Drive file ID if successful.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    // Note: We can't guarantee attachments exist, so we just check the test ran
  });

  it('should handle message deletion: deleteGmailMessage (moves to trash)', async () => {
    const timestamp = Date.now();

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Gmail operations:

      1. CREATE DRAFT: Create a draft email with:
         - To: test-delete-${timestamp}@example.com
         - Subject: "${TEST_PREFIX} Delete Test ${timestamp}"
         - Body: "This message will be used to test the delete functionality."
         Report the draft ID.

      2. SEND DRAFT (OPTIONAL - SKIP): Do NOT send the draft. We will work with the message directly.

      3. READ DRAFT: Read the draft to get its details and message ID.
         Report the message ID associated with the draft.

      4. DELETE MESSAGE: Use deleteGmailMessage to delete the draft message (moves to trash).
         Note: This moves the message to trash, it doesn't permanently delete it.
         Report if the deletion was successful.

      5. LIST DRAFTS: List drafts to verify the draft no longer appears in the active drafts.
         Confirm the test draft is no longer listed.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'delete');
  });
});
