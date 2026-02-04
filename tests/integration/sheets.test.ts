/**
 * Integration tests for Google Sheets tools
 */
import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest';
import { setupTest, deleteFile, assertOutputContains, type TestContext } from './harness.js';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';

describe('Google Sheets Tools', () => {
  let ctx: TestContext;
  let createdFileIds: string[] = [];
  let createdFilePaths: string[] = [];

  beforeAll(async () => {
    ctx = await setupTest({ account: TEST_ACCOUNT, timeout: 180_000 });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    // Clean up any spreadsheets created during the test
    for (const fileId of createdFileIds) {
      try {
        await deleteFile(ctx.drive, fileId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdFileIds = [];

    // Clean up any downloaded files
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

  describe('downloadSpreadsheet', () => {
    it('should download a spreadsheet as CSV', async () => {
      const timestamp = Date.now();
      const csvPath = join(tmpdir(), `test-download-${timestamp}.csv`);
      createdFilePaths.push(csvPath);

      const result = await ctx.runPrompt(`
        Using account "${TEST_ACCOUNT}":
        1. Create a new spreadsheet called "Test Download CSV ${timestamp}"
        2. Write the following data to the first sheet starting at A1:
           - Row 1: "Name", "Age", "City"
           - Row 2: "Alice", "30", "New York"
           - Row 3: "Bob", "25", "Los Angeles"
        3. Download the spreadsheet as CSV to: ${csvPath}
        4. Report the spreadsheet ID and confirm the file was saved.
      `);

      expect(result.success).toBe(true);
      assertOutputContains(result, 'Saved');

      // Extract spreadsheet ID for cleanup
      const idMatch = result.output.match(/ID[:\s]+([a-zA-Z0-9_-]{20,})/i);
      if (idMatch) createdFileIds.push(idMatch[1]);

      // Verify file exists and has correct content
      expect(existsSync(csvPath)).toBe(true);
      const content = readFileSync(csvPath, 'utf-8');
      expect(content).toContain('Name');
      expect(content).toContain('Alice');
      expect(content).toContain('Bob');
    });

    it('should download a spreadsheet as XLSX', async () => {
      const timestamp = Date.now();
      const xlsxPath = join(tmpdir(), `test-download-${timestamp}.xlsx`);
      createdFilePaths.push(xlsxPath);

      const result = await ctx.runPrompt(`
        Using account "${TEST_ACCOUNT}":
        1. Create a new spreadsheet called "Test Download XLSX ${timestamp}"
        2. Write some test data (any 3 rows with headers) to the first sheet
        3. Download the spreadsheet as XLSX to: ${xlsxPath}
        4. Report the spreadsheet ID and the file size.
      `);

      expect(result.success).toBe(true);
      // Claude may say "Saved" or "downloaded" - check for either
      const output = result.output.toLowerCase();
      expect(output.includes('saved') || output.includes('downloaded')).toBe(true);
      assertOutputContains(result, 'XLSX');

      // Extract spreadsheet ID for cleanup
      const idMatch = result.output.match(/ID[:\s]+([a-zA-Z0-9_-]{20,})/i);
      if (idMatch) createdFileIds.push(idMatch[1]);

      // Verify file exists and is a valid XLSX (starts with PK for zip format)
      expect(existsSync(xlsxPath)).toBe(true);
      const buffer = readFileSync(xlsxPath);
      expect(buffer.length).toBeGreaterThan(0);
      // XLSX files are ZIP archives, which start with "PK"
      expect(buffer.slice(0, 2).toString()).toBe('PK');
    });

    it('should download a specific sheet by name as CSV', async () => {
      const timestamp = Date.now();
      const csvPath = join(tmpdir(), `test-specific-sheet-${timestamp}.csv`);
      createdFilePaths.push(csvPath);

      const result = await ctx.runPrompt(`
        Using account "${TEST_ACCOUNT}":
        1. Create a new spreadsheet called "Test Multi-Sheet ${timestamp}"
        2. Add a second sheet named "Sales Data"
        3. Write data to the "Sales Data" sheet:
           - Row 1: "Product", "Revenue"
           - Row 2: "Widget", "1000"
           - Row 3: "Gadget", "2500"
        4. Download only the "Sales Data" sheet as CSV to: ${csvPath}
        5. Report the spreadsheet ID.
      `);

      expect(result.success).toBe(true);

      // Extract spreadsheet ID for cleanup
      const idMatch = result.output.match(/ID[:\s]+([a-zA-Z0-9_-]{20,})/i);
      if (idMatch) createdFileIds.push(idMatch[1]);

      // Verify file contains the Sales Data content
      expect(existsSync(csvPath)).toBe(true);
      const content = readFileSync(csvPath, 'utf-8');
      expect(content).toContain('Product');
      expect(content).toContain('Widget');
      expect(content).toContain('Revenue');
    });

    it('should handle CSV escaping correctly', async () => {
      const timestamp = Date.now();
      const csvPath = join(tmpdir(), `test-csv-escaping-${timestamp}.csv`);
      createdFilePaths.push(csvPath);

      const result = await ctx.runPrompt(`
        Using account "${TEST_ACCOUNT}":
        1. Create a new spreadsheet called "Test CSV Escaping ${timestamp}"
        2. Write data with special characters:
           - Row 1: "Description", "Value"
           - Row 2: "Item with, comma", "100"
           - Row 3: "Item with ""quotes""", "200"
        3. Download as CSV to: ${csvPath}
        4. Report the spreadsheet ID.
      `);

      expect(result.success).toBe(true);

      // Extract spreadsheet ID for cleanup
      const idMatch = result.output.match(/ID[:\s]+([a-zA-Z0-9_-]{20,})/i);
      if (idMatch) createdFileIds.push(idMatch[1]);

      // Verify CSV escaping is correct
      expect(existsSync(csvPath)).toBe(true);
      const content = readFileSync(csvPath, 'utf-8');
      // Commas in values should be quoted
      expect(content).toMatch(/"Item with, comma"/);
    });
  });
});
