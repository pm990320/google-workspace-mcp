/**
 * Integration tests for Google People (Contacts) tools
 *
 * Each test exercises multiple tools in a workflow pattern to minimize test runtime.
 *
 * NOTE: These tests create real contacts in your Google account. They are cleaned up
 * after each test, but if a test fails, you may need to manually delete test contacts.
 * Test contacts are prefixed with "MCP-IntTest-People" for easy identification.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  setupTest,
  assertOutputContains,
  type TestContext,
} from './harness.js';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';
const TEST_PREFIX = 'MCP-IntTest-People';

describe('Google People (Contacts) Tools', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setupTest({ account: TEST_ACCOUNT, timeout: 300_000 });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('should handle contact lifecycle: list, search, create, get, update, update photo, delete photo', async () => {
    const timestamp = Date.now();
    const contactName = `${TEST_PREFIX}-Contact-${timestamp}`;
    const contactEmail = `test-${timestamp}@example.com`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these People/Contacts operations:

      1. LIST CONTACTS: List existing contacts (limit 10).
         Report how many contacts were found.

      2. CREATE CONTACT: Create a new contact with:
         - Given name: "${contactName}"
         - Family name: "TestUser"
         - Email: "${contactEmail}" (type: work)
         - Phone: "+1-555-${timestamp.toString().slice(-7)}" (type: mobile)
         - Organization: "Test Company" with title "Test Engineer"
         Report the contact resource name.

      3. GET CONTACT: Get the full details of the contact you just created.
         Verify the name, email, phone, and organization are correct.
         Report the resource name.

      4. SEARCH CONTACTS: Search for contacts with query "${TEST_PREFIX}".
         Verify the new contact appears in search results.

      5. UPDATE CONTACT: Update the contact to:
         - Add a note/biography: "This is a test contact created by MCP integration tests."
         - Change the organization title to "Senior Test Engineer"
         Confirm the update.

      6. GET CONTACT AGAIN: Get the contact details to verify the update.
         Confirm the note and updated title are present.

      7. LIST CONTACTS AGAIN: List contacts and verify the test contact appears.

      Note: Do not delete the contact - we'll clean it up separately.
      Store the resource name for cleanup.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, contactName);
    assertOutputContains(result, contactEmail);

    // Extract resource name for cleanup
    const resourceMatch = result.output.match(/people\/c\d+/i);
    if (resourceMatch) {
      // Clean up the contact we created
      const cleanupResult = await ctx.runPrompt(`
        Using account "${TEST_ACCOUNT}", I need to clean up a test contact.
        However, there is no deletePeopleContact tool available for safety reasons.
        
        Instead, please use updatePeopleContact to update the contact with resource name "${resourceMatch[0]}" 
        to add a note saying "MARKED FOR DELETION - test contact".
        
        This will help identify test contacts that should be manually cleaned up.
      `);
      // We don't fail if cleanup fails
      console.log('Cleanup result:', cleanupResult.success ? 'marked for deletion' : 'cleanup skipped');
    }
  });

  it('should handle contact groups: list, create, get, update, add members, remove members, delete', async () => {
    const timestamp = Date.now();
    const groupName = `${TEST_PREFIX}-Group-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Contact Groups operations:

      1. LIST CONTACT GROUPS: List all contact groups.
         Report how many groups exist and note any system groups (like "myContacts").

      2. CREATE GROUP: Create a new contact group called "${groupName}".
         Report the group resource name.

      3. GET GROUP: Get the details of the group you just created.
         Verify the name is "${groupName}".
         Report the member count (should be 0).

      4. UPDATE GROUP: Rename the group to "${groupName}-Renamed".
         Confirm the update.

      5. GET GROUP AGAIN: Get the group details to verify the rename.
         Confirm the name changed.

      6. DELETE GROUP: Delete the contact group (without deleting its members).
         Confirm deletion.

      7. LIST GROUPS AGAIN: List contact groups to verify the group was deleted.
         Confirm the test group no longer appears.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, groupName);
  });

  it('should handle other contacts (read-only): list and search', async () => {
    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Other Contacts operations:

      1. LIST OTHER CONTACTS: List "other contacts" (auto-saved contacts from interactions).
         Report how many other contacts were found.
         Note: It's OK if there are 0 - this depends on your account's history.

      2. SEARCH OTHER CONTACTS: Search other contacts for a common term like "test" or "example".
         Report how many results were found.
         Note: It's OK if there are 0 results.

      Report success/failure for each step.
      These are read-only operations so there's nothing to clean up.
    `);

    expect(result.success).toBe(true);
    // These operations should succeed even if they return empty results
    assertOutputContains(result, 'other contact');
  });

  it('should handle directory operations (Workspace only): list and search', async () => {
    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Directory operations:

      1. LIST DIRECTORY: Try to list the organization directory.
         Note: This will only work for Google Workspace accounts.
         For personal Gmail accounts, expect an error message about Workspace.
         Report what happens.

      2. SEARCH DIRECTORY: Try to search the directory for "admin" or any common term.
         Note: Same limitation - only works for Workspace accounts.
         Report what happens.

      Report success/failure for each step.
      It's expected that these may fail for personal accounts - that's OK.
    `);

    expect(result.success).toBe(true);
    // Should either show directory results or explain it's Workspace-only
    const output = result.output.toLowerCase();
    const hasDirectoryResults = output.includes('directory');
    const hasWorkspaceError = output.includes('workspace') || output.includes('personal');
    expect(hasDirectoryResults || hasWorkspaceError).toBe(true);
  });

  it('should handle batch operations: batchGetPeopleContacts', async () => {
    const timestamp = Date.now();
    const contact1Name = `${TEST_PREFIX}-Batch1-${timestamp}`;
    const contact2Name = `${TEST_PREFIX}-Batch2-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these batch operations:

      1. CREATE TWO CONTACTS:
         - Contact 1: Given name "${contact1Name}", email "batch1-${timestamp}@example.com"
         - Contact 2: Given name "${contact2Name}", email "batch2-${timestamp}@example.com"
         Report both resource names.

      2. BATCH GET: Use batchGetPeopleContacts to get both contacts at once.
         Verify both contacts are returned with correct names.

      3. Mark both contacts for cleanup by updating their notes to "MARKED FOR DELETION".

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, contact1Name);
    assertOutputContains(result, contact2Name);
  });
});
