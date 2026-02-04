/**
 * Markdown Docs Integration Tests
 *
 * Tests define WHAT to achieve - Claude figures out HOW.
 * Uses Google API clients to verify results and clean up.
 */

import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest';
import {
  setupTest,
  deleteFile,
  deleteFilesByPattern,
  documentExists,
  getDocumentText,
  assertOutputContains,
  type TestContext,
} from './harness.js';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';
const TEST_PREFIX = 'Integration Test -';

describe('Markdown Docs Tools', () => {
  let ctx: TestContext;
  let createdDocIds: string[] = [];

  beforeAll(async () => {
    ctx = await setupTest({ account: TEST_ACCOUNT });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    // Clean up any documents created during the test
    for (const docId of createdDocIds) {
      await deleteFile(ctx.drive, docId);
    }
    createdDocIds = [];
  });

  /**
   * Extract document ID from Claude's output
   * Claude may use markdown formatting like **Document ID:** `abc123`
   */
  function extractDocId(output: string): string | null {
    const patterns = [
      // Markdown: **Document ID:** `abc123` or **ID:** `abc123`
      /\*{0,2}Document ID:?\*{0,2}\s*`?([a-zA-Z0-9_-]+)`?/i,
      /\*{0,2}ID:?\*{0,2}\s*`([a-zA-Z0-9_-]+)`/i,
      // Plain: Document ID: abc123 or (ID: abc123)
      /Document ID:\s*([a-zA-Z0-9_-]+)/i,
      /\(ID:\s*([a-zA-Z0-9_-]+)\)/i,
      // URL format
      /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i,
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  it('should check compatibility of a new document', async () => {
    const result = await ctx.runPrompt(`
      Create a new Google Doc called "${TEST_PREFIX} Compat ${Date.now()}".
      Check if this document is compatible with markdown editing.
      Report the document ID and whether it was compatible.
    `);

    expect(result.success).toBe(true);

    const docId = extractDocId(result.output);
    expect(docId).toBeTruthy();
    if (docId) createdDocIds.push(docId);

    // Verify document exists
    expect(await documentExists(ctx.drive, docId!)).toBe(true);

    // Check output mentions compatibility
    assertOutputContains(result, 'compatible');
  });

  it('should write and read markdown content', async () => {
    const uniqueText = `UniqueMarker${Date.now()}`;

    const result = await ctx.runPrompt(`
      Create a new Google Doc called "${TEST_PREFIX} Write ${Date.now()}".
      Write this markdown:

      # Test Heading

      This is **bold** text with marker: ${uniqueText}

      Report the document ID.
    `);

    expect(result.success).toBe(true);

    const docId = extractDocId(result.output);
    expect(docId).toBeTruthy();
    if (docId) createdDocIds.push(docId);

    // Verify content was written using Google API
    const text = await getDocumentText(ctx.docs, docId!);
    expect(text).toContain('Test Heading');
    expect(text).toContain(uniqueText);
  });

  it('should read document as markdown', async () => {
    const uniqueText = `ReadTest${Date.now()}`;

    // First create and write
    const writeResult = await ctx.runPrompt(`
      Create a new Google Doc called "${TEST_PREFIX} Read ${Date.now()}".
      Write this markdown: "# Heading\\n\\nParagraph with ${uniqueText}"
      Report the document ID.
    `);

    expect(writeResult.success).toBe(true);
    const docId = extractDocId(writeResult.output);
    expect(docId).toBeTruthy();
    if (docId) createdDocIds.push(docId);

    // Now read it back
    const readResult = await ctx.runPrompt(`
      Read the Google Doc with ID "${docId}" as markdown.
      Tell me what heading and text you see.
    `);

    expect(readResult.success).toBe(true);
    assertOutputContains(readResult, 'heading');
  });

  it('should reject write without confirmReplace', async () => {
    // Create a doc first
    const createResult = await ctx.runPrompt(`
      Create a new Google Doc called "${TEST_PREFIX} Safety ${Date.now()}".
      Report the document ID only.
    `);

    const docId = extractDocId(createResult.output);
    expect(docId).toBeTruthy();
    if (docId) createdDocIds.push(docId);

    // Try to write without confirmReplace
    const writeResult = await ctx.runPrompt(`
      Use the writeDocAsMarkdown tool on document "${docId}" with markdown "# Test"
      but set confirmReplace to false.
      Report what error you get.
    `);

    expect(writeResult.success).toBe(true);
    const output = writeResult.output.toLowerCase();
    expect(
      output.includes('confirm') ||
        output.includes('safety') ||
        output.includes('error') ||
        output.includes('must set')
    ).toBe(true);
  });

  it('should detect incompatible documents with comments', async () => {
    // Create doc and add a comment
    const result = await ctx.runPrompt(`
      Create a new Google Doc called "${TEST_PREFIX} Comments ${Date.now()}".
      Add some text to it like "Hello world".
      Then add a comment to the document.
      Then check if it's compatible with markdown editing.
      Report the document ID and compatibility result.
    `);

    expect(result.success).toBe(true);

    const docId = extractDocId(result.output);
    if (docId) createdDocIds.push(docId);

    // Should report as not compatible
    const output = result.output.toLowerCase();
    expect(
      output.includes('not compatible') ||
        output.includes('incompatible') ||
        output.includes('comment')
    ).toBe(true);
  });

  it('should handle tables in markdown', async () => {
    const result = await ctx.runPrompt(`
      Create a new Google Doc called "${TEST_PREFIX} Table ${Date.now()}".
      Write markdown with a table:
      | Name | Value |
      |------|-------|
      | Alice | 100 |
      | Bob | 200 |
      Report the document ID.
    `);

    expect(result.success).toBe(true);

    const docId = extractDocId(result.output);
    expect(docId).toBeTruthy();
    if (docId) createdDocIds.push(docId);

    // Verify document exists
    expect(await documentExists(ctx.drive, docId!)).toBe(true);
  });

  it('should handle numbered lists', async () => {
    const result = await ctx.runPrompt(`
      Create a new Google Doc called "${TEST_PREFIX} Numbered ${Date.now()}".
      Write markdown with a numbered list:
      1. First item
      2. Second item
      3. Third item
      Report the document ID.
    `);

    expect(result.success).toBe(true);

    const docId = extractDocId(result.output);
    expect(docId).toBeTruthy();
    if (docId) createdDocIds.push(docId);

    // Verify content
    const text = await getDocumentText(ctx.docs, docId!);
    expect(text).toContain('First');
    expect(text).toContain('Second');
    expect(text).toContain('Third');
  });

  it('should fully replace content on second write', async () => {
    const original = `Original${Date.now()}`;
    const replacement = `Replacement${Date.now()}`;

    // Create and write original
    const createResult = await ctx.runPrompt(`
      Create a new Google Doc called "${TEST_PREFIX} Replace ${Date.now()}".
      Write this markdown: "# ${original}"
      Report the document ID.
    `);

    const docId = extractDocId(createResult.output);
    expect(docId).toBeTruthy();
    if (docId) createdDocIds.push(docId);

    // Write replacement
    await ctx.runPrompt(`
      Write this markdown to document "${docId}": "# ${replacement}"
      Confirm the replacement.
    `);

    // Verify using Google API - only replacement should exist
    const text = await getDocumentText(ctx.docs, docId!);
    expect(text).toContain(replacement);
    expect(text).not.toContain(original);
  });
});

describe('Cleanup', () => {
  it('should clean up any leftover test documents', async () => {
    const ctx = await setupTest({ account: TEST_ACCOUNT });

    const deleted = await deleteFilesByPattern(ctx.drive, TEST_PREFIX);
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} leftover test document(s)`);
    }

    await ctx.cleanup();
  });
});
