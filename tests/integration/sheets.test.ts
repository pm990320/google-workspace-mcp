/**
 * Integration tests for Google Sheets tools
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
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';
const TEST_PREFIX = 'MCP-IntTest-Sheets';

describe('Google Sheets Tools', () => {
  let ctx: TestContext;
  let createdFileIds: string[] = [];
  let createdFilePaths: string[] = [];

  beforeAll(async () => {
    ctx = await setupTest({ account: TEST_ACCOUNT, timeout: 300_000 });
    // Clean up any leftover test files from previous runs
    await deleteFilesByPattern(ctx.drive, TEST_PREFIX);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    // Clean up spreadsheets
    for (const fileId of createdFileIds) {
      try {
        await deleteFile(ctx.drive, fileId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdFileIds = [];

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

  it('should handle spreadsheet lifecycle: create, read, write, append, clear, search, list, delete', async () => {
    const timestamp = Date.now();
    const sheetName = `${TEST_PREFIX}-Lifecycle-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. CREATE: Create a new spreadsheet called "${sheetName}" with initial data:
         - Row 1 (headers): "Name", "Age", "City"
         - Row 2: "Alice", "30", "New York"
         - Row 3: "Bob", "25", "Los Angeles"
         Report the spreadsheet ID.

      2. LIST SHEETS: List the sheets/tabs in the spreadsheet using listGoogleSheets.
         Report the sheet names and dimensions.

      3. READ: Read the range A1:C3 from the spreadsheet.
         Confirm it contains "Alice" and "Bob".

      4. WRITE: Write new data to column D:
         - D1: "Country"
         - D2: "USA"
         - D3: "USA"
         Confirm the write.

      5. APPEND: Append a new row: "Charlie", "35", "Chicago", "USA"
         Confirm the append.

      6. READ AGAIN: Read the range A1:D4 to verify all changes.
         Confirm it now has 4 rows and 4 columns.

      7. CLEAR: Clear the range D1:D4 (the Country column).
         Confirm the clear.

      8. READ AFTER CLEAR: Read A1:D4 again.
         Confirm column D is now empty.

      9. SEARCH: Search for spreadsheets containing "${TEST_PREFIX}".
         Confirm the test spreadsheet is found.

      10. DELETE: Delete the spreadsheet.
          Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'Alice');
    assertOutputContains(result, 'Bob');

    // Extract ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });

  it('should handle sheet tab operations: add sheet, delete sheet', async () => {
    const timestamp = Date.now();
    const sheetName = `${TEST_PREFIX}-Tabs-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. CREATE: Create a new spreadsheet called "${sheetName}".
         Report the spreadsheet ID.

      2. ADD SHEET: Add a new sheet tab called "Sales Data" to the spreadsheet.
         Confirm the sheet was added.

      3. WRITE TO NEW SHEET: Write data to the "Sales Data" sheet:
         - A1: "Product", B1: "Revenue"
         - A2: "Widget", B2: "1000"
         - A3: "Gadget", B3: "2500"
         Confirm the write.

      4. LIST SHEETS: List all sheets in the spreadsheet.
         Confirm both the default sheet and "Sales Data" exist.

      5. ADD ANOTHER SHEET: Add another sheet called "Summary".
         Confirm it was added.

      6. DELETE SHEET: Delete the "Summary" sheet.
         Confirm deletion.

      7. LIST SHEETS AGAIN: List sheets to verify.
         Confirm "Summary" no longer exists but "Sales Data" still does.

      8. DELETE: Delete the spreadsheet.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'Sales Data');

    // Extract ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });

  it('should handle spreadsheet download: CSV and XLSX formats', async () => {
    const timestamp = Date.now();
    const sheetName = `${TEST_PREFIX}-Download-${timestamp}`;
    const csvPath = join(tmpdir(), `test-download-${timestamp}.csv`);
    const xlsxPath = join(tmpdir(), `test-download-${timestamp}.xlsx`);
    createdFilePaths.push(csvPath, xlsxPath);

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. CREATE: Create a new spreadsheet called "${sheetName}" with data:
         - Row 1: "Product", "Price", "Quantity"
         - Row 2: "Apple", "1.50", "100"
         - Row 3: "Banana", "0.75", "200"
         - Row 4: "Item with, comma", "2.00", "50"
         Report the spreadsheet ID.

      2. DOWNLOAD CSV: Download the spreadsheet as CSV to: ${csvPath}
         Confirm the file was saved.

      3. DOWNLOAD XLSX: Download the spreadsheet as XLSX to: ${xlsxPath}
         Confirm the file was saved and report the file size.

      4. ADD SHEET: Add a new sheet called "Summary" with data:
         - A1: "Total Items", B1: "350"

      5. DOWNLOAD SPECIFIC SHEET: Download only the "Summary" sheet as CSV to: ${csvPath}
         (This will overwrite the previous CSV)
         Confirm the file was saved.

      6. DELETE: Delete the spreadsheet.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);

    // Verify CSV file exists and has content
    expect(existsSync(csvPath)).toBe(true);
    const csvContent = readFileSync(csvPath, 'utf-8');
    expect(csvContent).toContain('Total Items');

    // Verify XLSX file exists and is valid
    expect(existsSync(xlsxPath)).toBe(true);
    const xlsxBuffer = readFileSync(xlsxPath);
    expect(xlsxBuffer.length).toBeGreaterThan(0);
    expect(xlsxBuffer.slice(0, 2).toString()).toBe('PK'); // ZIP signature

    // Extract ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });

  it('should get spreadsheet info: getSpreadsheetInfo', async () => {
    const timestamp = Date.now();
    const sheetName = `${TEST_PREFIX}-Info-${timestamp}`;

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. CREATE: Create a new spreadsheet called "${sheetName}" with data:
         - Row 1: "Header1", "Header2", "Header3"
         - Row 2: "Data1", "Data2", "Data3"
         Report the spreadsheet ID.

      2. ADD SHEET: Add a new sheet tab called "ExtraSheet".
         Confirm it was added.

      3. GET SPREADSHEET INFO: Get detailed information about the spreadsheet using getSpreadsheetInfo.
         Report:
         - The spreadsheet title
         - The number of sheets/tabs
         - The names of all sheets
         - Any other metadata returned (locale, timezone, etc.)

      4. DELETE: Delete the spreadsheet.
         Confirm deletion.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'info');

    // Extract ID for cleanup
    const idMatch = result.output.match(/ID[:\s]+`?([a-zA-Z0-9_-]{20,})`?/i);
    if (idMatch) createdFileIds.push(idMatch[1]);
  });
});
