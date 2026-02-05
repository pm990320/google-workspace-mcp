/**
 * Integration tests for Google Docs tools
 *
 * Each test exercises multiple tools in a workflow pattern to minimize test runtime.
 */
import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest';
import {
  setupTest,
  deleteFile,
  findFilesByName,
  deleteFilesByPattern,
  assertOutputContains,
  type TestContext,
} from './harness.js';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';
const TEST_PREFIX = 'MCP-IntTest-Docs';

describe('Google Docs Tools', () => {
  let ctx: TestContext;
  let createdFileIds: string[] = [];

  beforeAll(async () => {
    ctx = await setupTest({ account: TEST_ACCOUNT, timeout: 300_000 });
    // Clean up any leftover test files from previous runs
    await deleteFilesByPattern(ctx.drive, TEST_PREFIX);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    // Clean up files created during test
    for (const fileId of createdFileIds) {
      try {
        await deleteFile(ctx.drive, fileId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdFileIds = [];
  });

  it('should handle document lifecycle: create, read, search, list, get info, delete', async () => {
    const timestamp = Date.now();
    const docName = `${TEST_PREFIX}-Lifecycle-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations and report results for each step:

      1. CREATE: Create a new Google Doc called "${docName}" with this initial content:
         "This is a test document created for integration testing.

         It has multiple paragraphs to test reading functionality.

         Final paragraph here."
         Report the document ID.

      2. SEARCH: Search for documents containing "${TEST_PREFIX}" in the name.
         Report how many results were found.

      3. LIST: List recent Google Docs (limit 5).
         Confirm the new document appears in the list.

      4. GET INFO: Get the document metadata/info using getDocumentInfo.
         Report the title and last modified time.

      5. READ TEXT: Read the document in plain text format.
         Report the first 50 characters of content.

      6. READ MARKDOWN: Read the document in markdown format.
         Confirm it returns markdown-formatted content.

      7. LIST TABS: List the document's tabs.
         Report how many tabs exist.

      8. DELETE: Delete the document (move to trash).
         Confirm deletion was successful.
    `);

    expect(result.success).toBe(true);
    // Check for key indicators that the workflow completed
    assertOutputContains(result, 'CREATE');
    assertOutputContains(result, 'DELETE');

    // Extract document ID for cleanup if deletion failed
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });

  it('should handle text manipulation: insert, append, find/replace, delete range', async () => {
    const timestamp = Date.now();
    const docName = `${TEST_PREFIX}-TextOps-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. Create a new Google Doc called "${docName}" with initial content:
         "Hello World. This is the original text. Goodbye World."
         Report the document ID.

      2. INSERT TEXT: Insert "INSERTED: " at the very beginning of the document (index 1).
         Confirm the insertion.

      3. APPEND TEXT: Append "\\n\\nAPPENDED: This text was added at the end." to the document.
         Confirm the append.

      4. FIND AND REPLACE: Replace all occurrences of "World" with "UNIVERSE" in the document.
         Report how many replacements were made.

      5. READ: Read the document to verify all changes.
         The content should now contain "INSERTED:", "UNIVERSE" (twice), and "APPENDED:".

      6. DELETE RANGE: Delete characters from index 1 to index 11 (removing "INSERTED: ").
         Confirm the deletion.

      7. READ AGAIN: Read the document to verify the deletion worked.
         Confirm "INSERTED:" is no longer present.

      8. DELETE: Delete the document.
         Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    // Check for key operations completing - Claude may not echo "UNIVERSE" literally
    assertOutputContains(result, 'replace');

    // Extract document ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });

  it('should handle text styling: bold and formatMatchingText', async () => {
    const timestamp = Date.now();
    const docName = `${TEST_PREFIX}-Styling-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. Create a new Google Doc called "${docName}" with content:
         "This text has bold words and italic words."
         Report the document ID.

      2. APPLY TEXT STYLE: Apply bold to "bold words" using applyTextStyle.
         Confirm success.

      3. FORMAT MATCHING TEXT: Apply italic to "italic words" using formatMatchingText.
         Confirm success.

      4. DELETE: Delete the document.
         Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'bold');

    // Extract document ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });

  it('should handle document structure: tables, page breaks, images', async () => {
    const timestamp = Date.now();
    const docName = `${TEST_PREFIX}-Structure-${timestamp}`;
    // Use a reliable public image URL
    const imageUrl = 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png';

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. Create a new Google Doc called "${docName}" with content:
         "Document Structure Test

         Section 1: Table will be inserted below.

         Section 2: Page break will be inserted below.

         Section 3: Image will be inserted below.

         End of document."
         Report the document ID.

      2. INSERT TABLE: Insert a 3x3 table after "Table will be inserted below."
         Confirm the table was inserted.

      3. EDIT TABLE CELL: Add the text "Header 1" to the first cell (row 1, column 1) of the table.
         Note: This tool is experimental and may have issues - report any errors.

      4. FIND ELEMENT: Search for tables in the document using findElement.
         Report if the table was found.

      5. INSERT PAGE BREAK: Insert a page break after "Page break will be inserted below."
         Confirm the page break was inserted.

      6. INSERT IMAGE: Insert the image from URL "${imageUrl}" after "Image will be inserted below."
         Confirm the image was inserted.

      7. READ: Read the document to verify the structure changes.

      8. DELETE: Delete the document.

      Report success/failure for each step. Note any experimental tool issues.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'table');

    // Extract document ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });

  it('should handle comments: add, list, get, reply, resolve, delete', async () => {
    const timestamp = Date.now();
    const docName = `${TEST_PREFIX}-Comments-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. Create a new Google Doc called "${docName}" with content:
         "This document tests the comment functionality.

         This paragraph should have a comment attached to it.

         Final paragraph without comments."
         Report the document ID.

      2. ADD COMMENT: Add a comment to the document with content "This is a test comment"
         anchored to the text "comment attached".
         Report the comment ID.

      3. LIST COMMENTS: List all comments on the document.
         Confirm at least 1 comment exists.

      4. GET COMMENT: Get the details of the comment you just created.
         Confirm the comment content matches.

      5. REPLY TO COMMENT: Reply to the comment with "This is a reply to the test comment."
         Confirm the reply was added.

      6. RESOLVE COMMENT: Resolve the comment.
         Note: This may have API limitations - report the result.

      7. DELETE COMMENT: Delete the comment.
         Confirm deletion.

      8. LIST COMMENTS AGAIN: List comments to verify deletion.
         Confirm no comments remain (or the deleted one is gone).

      9. DELETE: Delete the document.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'comment');

    // Extract document ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });

  it('should handle paragraph styling: applyParagraphStyle', async () => {
    const timestamp = Date.now();
    const docName = `${TEST_PREFIX}-ParagraphStyle-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. Create a new Google Doc called "${docName}" with content:
         "Main Title

         This is a regular paragraph that should be left-aligned.

         This paragraph should be centered.

         This paragraph should be right-aligned."
         Report the document ID.

      2. APPLY PARAGRAPH STYLE: Apply centered alignment to the paragraph containing "should be centered"
         using applyParagraphStyle with alignment "CENTER".
         Confirm success.

      3. APPLY PARAGRAPH STYLE: Apply right alignment to the paragraph containing "should be right-aligned"
         using applyParagraphStyle with alignment "END".
         Confirm success.

      4. READ: Read the document to verify it still contains all the text.

      5. DELETE: Delete the document.
         Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'paragraph');

    // Extract document ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });
});
