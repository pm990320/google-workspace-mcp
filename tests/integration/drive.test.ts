/**
 * Integration tests for Google Drive tools
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
const TEST_PREFIX = 'MCP-IntTest-Drive';

describe('Google Drive Tools', () => {
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
    // Clean up files created during test (in reverse order for folders)
    for (const fileId of [...createdFileIds].reverse()) {
      try {
        await deleteFile(ctx.drive, fileId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdFileIds = [];
  });

  it('should handle folder and file operations: create folder, create doc in folder, list contents, copy, move, rename', async () => {
    const timestamp = Date.now();
    const folderName = `${TEST_PREFIX}-Folder-${timestamp}`;
    const docName = `${TEST_PREFIX}-Doc-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. CREATE FOLDER: Create a new folder called "${folderName}".
         Report the folder ID.

      2. CREATE DOCUMENT IN FOLDER: Create a new Google Doc called "${docName}"
         inside the folder you just created, with content:
         "This document was created inside a test folder."
         Report the document ID.

      3. LIST FOLDER CONTENTS: List the contents of the folder.
         Confirm the document appears in the folder.

      4. GET DOCUMENT INFO: Get metadata for the document using getDocumentInfo.
         Report the title and parent folder.

      5. COPY DOCUMENT: Copy the document to create "${docName}-Copy" (in the same folder).
         Report the new document ID.

      6. RENAME FILE: Rename the copied document to "${docName}-Renamed".
         Confirm the rename.

      7. MOVE FILE: Move the renamed document to the Drive root (out of the folder).
         Confirm the move.

      8. LIST FOLDER AGAIN: List the folder contents again.
         Confirm only the original document remains.

      9. DELETE: Delete all created resources:
         - Delete the moved/renamed document
         - Delete the original document
         - Delete the folder
         Confirm each deletion.

      Report success/failure and IDs for each step.
    `);

    expect(result.success).toBe(true);
    // Check for key operations completing successfully
    assertOutputContains(result, 'folder');
    assertOutputContains(result, 'copy');

    // Extract IDs for cleanup if deletion failed
    const idMatches = result.output.matchAll(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/gi);
    for (const match of idMatches) {
      createdFileIds.push(match[1]);
    }
  });

  it('should handle document templates and search: create from template, search, list', async () => {
    const timestamp = Date.now();
    const templateName = `${TEST_PREFIX}-Template-${timestamp}`;
    const outputName = `${TEST_PREFIX}-FromTemplate-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. CREATE TEMPLATE: Create a new Google Doc called "${templateName}" with content:
         "Dear {{NAME}},

         Thank you for your interest in {{PRODUCT}}.

         We will contact you at {{EMAIL}} soon.

         Best regards,
         The Team"
         Report the document ID.

      2. CREATE FROM TEMPLATE: Create a new document from this template called "${outputName}",
         replacing the placeholders:
         - {{NAME}} -> "John Smith"
         - {{PRODUCT}} -> "MCP Integration"
         - {{EMAIL}} -> "john@example.com"
         Report the new document ID.

      3. READ OUTPUT: Read the new document to verify replacements.
         Confirm it contains "John Smith", "MCP Integration", and "john@example.com".

      4. SEARCH: Search for documents containing "${TEST_PREFIX}" in the name.
         Report how many test documents were found.

      5. LIST GOOGLE DOCS: List recent Google Docs (limit 10).
         Confirm both template and output documents appear.

      6. DELETE: Delete both documents (template and output).
         Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    // Check for key operations completing - Claude may confirm replacements differently
    assertOutputContains(result, 'template');
    assertOutputContains(result, 'replace');

    // Extract IDs for cleanup
    const idMatches = result.output.matchAll(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/gi);
    for (const match of idMatches) {
      createdFileIds.push(match[1]);
    }
  });

  it('should handle file upload/download and sharing: upload, shareable link, download, search, list recent', async () => {
    const timestamp = Date.now();
    const testFileName = `${TEST_PREFIX}-Upload-${timestamp}.txt`;
    const localTestFile = `/tmp/${testFileName}`;
    const downloadPath = `/tmp/${TEST_PREFIX}-Downloaded-${timestamp}.txt`;

    // Create a local test file first
    const { writeFileSync, unlinkSync, existsSync } = await import('fs');
    writeFileSync(localTestFile, `This is a test file for upload integration testing.\nTimestamp: ${timestamp}`);

    try {
      const result = await ctx.runPrompt(`
        Using account "${TEST_ACCOUNT}", perform these operations:

        1. UPLOAD FILE: Upload the file at "${localTestFile}" to Google Drive.
           Report the file ID and link.

        2. GET SHAREABLE LINK: Get a shareable link for the uploaded file with "reader" access for "anyoneWithLink".
           Report the shareable link.

        3. LIST RECENT FILES: List recently modified files (last 7 days).
           Confirm the uploaded file appears in the list.

        4. SEARCH DRIVE: Search Drive for files with "${TEST_PREFIX}" in the name.
           Confirm the uploaded file is found.

        5. DOWNLOAD FILE: Download the file to "${downloadPath}".
           Confirm the download was successful.

        6. DELETE: Delete the uploaded file.
           Confirm deletion.

        Report success/failure and any IDs for each step.
      `);

      expect(result.success).toBe(true);
      assertOutputContains(result, 'upload');
      assertOutputContains(result, 'shareabl');

      // Verify download worked
      expect(existsSync(downloadPath)).toBe(true);

      // Extract IDs for cleanup
      const idMatches = result.output.matchAll(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/gi);
      for (const match of idMatches) {
        createdFileIds.push(match[1]);
      }

      // Clean up local files
      if (existsSync(downloadPath)) unlinkSync(downloadPath);
    } finally {
      // Always clean up the local test file
      if (existsSync(localTestFile)) unlinkSync(localTestFile);
    }
  });

  it('should handle folder info and recent docs: getRecentGoogleDocs, getFolderInfo', async () => {
    const timestamp = Date.now();
    const folderName = `${TEST_PREFIX}-InfoFolder-${timestamp}`;
    const docName = `${TEST_PREFIX}-InfoDoc-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. CREATE FOLDER: Create a new folder called "${folderName}".
         Report the folder ID.

      2. CREATE DOCUMENT: Create a new Google Doc called "${docName}" inside the folder
         with content: "Test document for folder info testing."
         Report the document ID.

      3. GET FOLDER INFO: Get detailed information about the folder using getFolderInfo.
         Report the folder name, ID, and any metadata returned.

      4. GET RECENT GOOGLE DOCS: Get recent Google Docs using getRecentGoogleDocs.
         Confirm the newly created document appears in the list.
         Report how many documents were returned.

      5. DELETE: Delete the document and folder.
         Confirm deletion of both.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'folder');
    assertOutputContains(result, 'recent');

    // Extract IDs for cleanup
    const idMatches = result.output.matchAll(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/gi);
    for (const match of idMatches) {
      createdFileIds.push(match[1]);
    }
  });
});
