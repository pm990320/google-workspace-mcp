/**
 * Integration tests for Google Forms tools
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
const TEST_PREFIX = 'MCP-IntTest-Forms';

describe('Google Forms Tools', () => {
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
    // Clean up forms created during test
    for (const fileId of createdFileIds) {
      try {
        await deleteFile(ctx.drive, fileId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdFileIds = [];
  });

  it('should handle form lifecycle: create, add questions, read, get responses, list, search, delete', async () => {
    const timestamp = Date.now();
    const formName = `${TEST_PREFIX}-Lifecycle-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Forms operations:

      1. LIST FORMS: List existing forms (limit 5).
         Report how many forms were found.

      2. CREATE: Create a new form called "${formName}" with description "Integration test form".
         Report the form ID.

      3. READ: Read the form structure to see its initial state.
         Report the form title and how many questions it has (should be 0).

      4. ADD SHORT TEXT QUESTION: Add a short text question:
         - Title: "What is your name?"
         - Required: true
         Confirm the question was added.

      5. ADD MULTIPLE CHOICE: Add a multiple choice question:
         - Title: "What is your favorite color?"
         - Options: "Red", "Blue", "Green", "Yellow"
         - Required: false
         Confirm the question was added.

      6. ADD SCALE QUESTION: Add a scale/rating question:
         - Title: "How satisfied are you with our service?"
         - Scale: 1 to 5
         - Low label: "Not satisfied"
         - High label: "Very satisfied"
         - Required: true
         Confirm the question was added.

      7. READ AGAIN: Read the form structure to verify all questions.
         Confirm there are now 3 questions.
         List the question titles.

      8. GET RESPONSES: Get form responses (should be empty for a new form).
         Confirm there are 0 responses.

      9. SEARCH: Search for forms containing "${TEST_PREFIX}".
         Confirm the test form is found.

      10. DELETE: Delete the form (move to trash).
          Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, formName);
    assertOutputContains(result, 'name');
    assertOutputContains(result, 'color');

    // Extract ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+([a-zA-Z0-9_-]{20,})/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });
});
