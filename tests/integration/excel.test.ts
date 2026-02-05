/**
 * Integration tests for Excel format tools (Sheets with .xlsx/.xls files)
 *
 * These tools work with Excel files stored on Google Drive without converting them
 * to native Google Sheets format.
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
import { writeFileSync, unlinkSync, existsSync, createReadStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';

const TEST_ACCOUNT = process.env.TEST_ACCOUNT || 'personal';
const TEST_PREFIX = 'MCP-IntTest-Excel';

describe('Excel Format Tools', () => {
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
    // Clean up Drive files
    for (const fileId of createdFileIds) {
      try {
        await deleteFile(ctx.drive, fileId);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdFileIds = [];

    // Clean up local files
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

  /**
   * Helper to create a test Excel file and upload it to Drive
   */
  async function createTestExcelFile(name: string): Promise<string> {
    const timestamp = Date.now();
    const localPath = join(tmpdir(), `${name}-${timestamp}.xlsx`);
    createdFilePaths.push(localPath);

    // Create a simple Excel workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Age', 'City'],
      ['Alice', 30, 'New York'],
      ['Bob', 25, 'Los Angeles'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, localPath);

    // Upload to Drive using the Drive API directly
    const fileMetadata = {
      name: `${TEST_PREFIX}-${name}-${timestamp}.xlsx`,
    };
    const media = {
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: createReadStream(localPath),
    };

    const response = await ctx.drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id',
    });

    const fileId = response.data.id!;
    createdFileIds.push(fileId);
    return fileId;
  }

  it('should handle Excel file operations: list, get info, read, write cell, write range, append, clear', async () => {
    // First, create a test Excel file on Drive
    const fileId = await createTestExcelFile('Lifecycle');

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Excel operations on the file with ID "${fileId}":

      1. LIST EXCEL FILES: List Excel files on Drive containing "${TEST_PREFIX}".
         Confirm the test file appears.

      2. GET INFO: Get information about the Excel file using getExcelInfo.
         Report the file name and sheet names.

      3. LIST SHEETS: List the sheets in the Excel file using listExcelSheets.
         Report the sheet names.

      4. READ: Read the Excel file contents using readExcelFile.
         Confirm it contains "Alice" and "Bob".

      5. WRITE CELL: Write "Updated" to cell D1 using writeExcelCell.
         Confirm the write.

      6. WRITE RANGE: Write a range of data starting at D2:
         - D2: "USA"
         - D3: "USA"
         using writeExcelRange.
         Confirm the write.

      7. APPEND ROWS: Append a new row: ["Charlie", 35, "Chicago", "USA"] using appendExcelRows.
         Confirm the append.

      8. READ AGAIN: Read the file to verify all changes.
         Confirm it now contains "Charlie", "Updated", and "USA".

      9. CLEAR RANGE: Clear the range D1:D4 using clearExcelRange.
         Confirm the clear.

      10. READ FINAL: Read the file to verify the clear worked.
          Confirm column D is empty.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'Alice');
  });

  it('should handle Excel sheet tab operations: add sheet, rename sheet, delete sheet', async () => {
    // Create a test Excel file
    const fileId = await createTestExcelFile('Tabs');

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these Excel operations on file ID "${fileId}":

      1. LIST SHEETS: List the sheets in the Excel file.
         Report the initial sheet names.

      2. ADD SHEET: Add a new sheet called "Sales" using addExcelSheet.
         Confirm it was added.

      3. LIST SHEETS AGAIN: List sheets to verify "Sales" was added.
         Confirm both sheets exist.

      4. WRITE TO NEW SHEET: Write some data to the "Sales" sheet:
         - A1: "Product", B1: "Revenue"
         - A2: "Widget", B2: "1000"
         Confirm the write.

      5. RENAME SHEET: Rename "Sales" to "Sales Data" using renameExcelSheet.
         Confirm the rename.

      6. LIST SHEETS: List sheets to verify the rename.
         Confirm "Sales Data" exists and "Sales" does not.

      7. ADD ANOTHER SHEET: Add a sheet called "Temp".
         Confirm it was added.

      8. DELETE SHEET: Delete the "Temp" sheet using deleteExcelSheet.
         Confirm deletion.

      9. LIST SHEETS FINAL: List sheets to verify deletion.
         Confirm only "Sheet1" and "Sales Data" remain.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'Sales');
  });

  it('should handle Excel to Sheets conversion', async () => {
    // Create a test Excel file
    const fileId = await createTestExcelFile('Convert');
    const timestamp = Date.now();

    const result = await ctx.runPrompt(`
      Using account "${TEST_ACCOUNT}", perform these operations:

      1. GET EXCEL INFO: Get info about the Excel file with ID "${fileId}".
         Report the file name.

      2. READ EXCEL: Read the Excel file to see its contents.
         Report the data.

      3. CONVERT TO SHEETS: Convert the Excel file to a native Google Sheets file using convertExcelToSheets.
         The new file should be named "${TEST_PREFIX}-Converted-${timestamp}".
         Report the new spreadsheet ID.

      4. READ SHEETS: Read the new Google Sheets file using readSpreadsheet.
         Confirm it contains the same data as the original Excel file ("Alice", "Bob").

      5. DELETE BOTH: Delete both the original Excel file and the converted Sheets file.
         Confirm both deletions.

      Report success/failure for each step.
    `);

    expect(result.success).toBe(true);
    assertOutputContains(result, 'convert');

    // Extract any additional IDs for cleanup
    const idMatches = result.output.matchAll(/ID[:\s]+([a-zA-Z0-9_-]{20,})/gi);
    for (const match of idMatches) {
      if (!createdFileIds.includes(match[1])) {
        createdFileIds.push(match[1]);
      }
    }
  });
});
