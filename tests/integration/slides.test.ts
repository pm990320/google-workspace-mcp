/**
 * Integration tests for Google Slides tools
 *
 * Each test exercises multiple tools in a workflow pattern to minimize test runtime.
 */
import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest';
import {
  setupTest,
  deleteFile,
  deleteFilesByPattern,
  assertOutputContains,
  type TestContext,
} from './harness.js';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';
const TEST_PREFIX = 'MCP-IntTest-Slides';

describe('Google Slides Tools', () => {
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
    // Clean up presentations created during test
    for (const fileId of createdFileIds) {
      try {
        await deleteFile(ctx.drive, fileId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdFileIds = [];
  });

  it('should handle presentation lifecycle: create, read, add slides, add text, list, search, delete', async () => {
    const timestamp = Date.now();
    const presentationName = `${TEST_PREFIX}-Lifecycle-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Slides operations:

      1. LIST PRESENTATIONS: List existing presentations (limit 5).
         Report how many presentations were found.

      2. CREATE: Create a new presentation called "${presentationName}".
         Report the presentation ID.

      3. READ: Read the presentation structure.
         Report how many slides exist initially (should be 1 - the title slide).

      4. ADD SLIDE: Add a new slide with a "TITLE_AND_BODY" layout.
         Report the new slide ID.

      5. ADD TEXT TO TITLE: Add the text "Introduction" to the title placeholder of the new slide.
         Confirm the text was added.

      6. ADD TEXT TO BODY: Add the text "This is the body content of the slide.\\n\\n- Point 1\\n- Point 2\\n- Point 3" to the body placeholder.
         Confirm the text was added.

      7. ADD ANOTHER SLIDE: Add another slide with layout "TITLE_ONLY".
         Report the slide ID.

      8. ADD TEXT: Add "Conclusion" as the title of this slide.
         Confirm the text was added.

      9. READ AGAIN: Read the presentation structure.
         Confirm there are now 3 slides total.

      10. SEARCH: Search for presentations containing "${TEST_PREFIX}".
          Confirm the test presentation is found.

      11. DELETE: Delete the presentation (move to trash).
          Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, presentationName);

    // Extract ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+([a-zA-Z0-9_-]{20,})/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });
});
