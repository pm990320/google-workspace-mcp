// excel.tools.ts - Tools for editing Excel-format files (.xlsx/.xls) on Google Drive
// These extend Sheets functionality to work with Excel formats without conversion
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { type ExcelToolOptions } from '../types.js';
import { getErrorMessage } from '../errorHelpers.js';
import { getDriveFileUrl } from '../urlHelpers.js';
import * as ExcelHelpers from '../excelHelpers.js';
import { escapeDriveQuery, wrapSpreadsheetContent } from '../securityHelpers.js';

export function registerExcelTools(options: ExcelToolOptions) {
  const { server, getDriveClient, getAccountEmail } = options;

  // --- List Excel Sheets ---
  server.addTool({
    name: 'listExcelSheets',
    description:
      'Lists all sheet/tab names in an Excel-format file (.xlsx or .xls) stored on Google Drive. Use this for spreadsheets that need to stay in Excel format.',
    annotations: {
      title: 'List Excel Sheets',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Listing sheets in Excel file: ${args.fileId}`);

      try {
        const { workbook, fileName } = await ExcelHelpers.downloadAndParseExcel(drive, args.fileId);
        const sheetNames = ExcelHelpers.getSheetNames(workbook);
        const link = getDriveFileUrl(args.fileId, email);

        let result = `**Excel File:** ${fileName}\n`;
        result += `**Sheets (${sheetNames.length}):**\n`;
        sheetNames.forEach((name, index) => {
          const info = ExcelHelpers.getSheetInfo(workbook, name);
          result += `${index + 1}. **${name}** (${info.rowCount} rows x ${info.columnCount} columns)\n`;
        });
        result += `\nView in Drive: ${link}`;

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error listing Excel sheets: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to list Excel sheets: ${message}`);
      }
    },
  });

  // --- Read Excel File ---
  server.addTool({
    name: 'readExcelFile',
    description:
      'Reads data from a specific range in an Excel-format file (.xlsx or .xls) on Google Drive. Similar to readSpreadsheet but for files that need to stay in Excel format.',
    annotations: {
      title: 'Read Excel File',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
      range: z
        .string()
        .describe(
          'A1 notation range to read (e.g., "A1:B10"). If only a cell is specified (e.g., "A1"), reads that single cell.'
        ),
      sheetName: z
        .string()
        .optional()
        .describe(
          'Name of the sheet to read from. If not provided, reads from the first sheet. Use listExcelSheets to see available sheets.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Reading Excel file ${args.fileId}, range: ${args.range}`);

      try {
        const { workbook, fileName } = await ExcelHelpers.downloadAndParseExcel(drive, args.fileId);
        const sheet = ExcelHelpers.getWorksheet(workbook, args.sheetName);
        const sheetName = args.sheetName || workbook.SheetNames[0];

        const values = ExcelHelpers.readRange(sheet, args.range);
        const link = getDriveFileUrl(args.fileId, email);

        if (values.length === 0 || (values.length === 1 && values[0].length === 0)) {
          return `Range ${args.range} in sheet "${sheetName}" is empty.`;
        }

        // Build cell content and wrap with security warning
        let cellContent = '';
        values.forEach((row, index) => {
          cellContent += `Row ${index + 1}: ${JSON.stringify(row)}\n`;
        });
        const wrappedContent = wrapSpreadsheetContent(cellContent, sheetName, args.range);

        let result = `**File:** ${fileName}\n`;
        result += `**Sheet:** ${sheetName}\n`;
        result += `**Range:** ${args.range}\n\n`;
        result += wrappedContent;
        result += `\nView in Drive: ${link}`;
        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error reading Excel file ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to read Excel file: ${message}`);
      }
    },
  });

  // --- Write Excel Cell ---
  server.addTool({
    name: 'writeExcelCell',
    description:
      'Writes a value to a specific cell in an Excel-format file (.xlsx or .xls) on Google Drive. Use when the file must remain in Excel format.',
    annotations: {
      title: 'Write Excel Cell',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
      cell: z.string().describe('The cell reference in A1 notation (e.g., "A1", "B5", "AA100").'),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.null()])
        .describe('The value to write to the cell. Use null to clear the cell.'),
      sheetName: z
        .string()
        .optional()
        .describe(
          'Name of the sheet to write to. If not provided, writes to the first sheet. Use listExcelSheets to see available sheets.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Writing to Excel file ${args.fileId}, cell: ${args.cell}`);

      try {
        const { workbook, fileName, mimeType } = await ExcelHelpers.downloadAndParseExcel(
          drive,
          args.fileId
        );
        const sheet = ExcelHelpers.getWorksheet(workbook, args.sheetName);
        const sheetName = args.sheetName || workbook.SheetNames[0];

        ExcelHelpers.writeCell(sheet, args.cell, args.value);

        await ExcelHelpers.uploadExcel(drive, args.fileId, workbook, mimeType);

        const link = getDriveFileUrl(args.fileId, email);
        return `Successfully wrote to cell ${args.cell.toUpperCase()} in sheet "${sheetName}" of "${fileName}".\nView in Drive: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error writing to Excel file ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to write to Excel file: ${message}`);
      }
    },
  });

  // --- Write Excel Range ---
  server.addTool({
    name: 'writeExcelRange',
    description:
      'Writes data to a range in an Excel-format file (.xlsx or .xls) on Google Drive. Similar to writeSpreadsheet but preserves Excel format.',
    annotations: {
      title: 'Write Excel Range',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
      startCell: z
        .string()
        .describe(
          'The top-left cell of the range to write to in A1 notation (e.g., "A1", "B5"). Data will expand from this cell.'
        ),
      values: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .describe('2D array of values to write. Each inner array represents a row.'),
      sheetName: z
        .string()
        .optional()
        .describe(
          'Name of the sheet to write to. If not provided, writes to the first sheet. Use listExcelSheets to see available sheets.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Writing range to Excel file ${args.fileId}, starting at: ${args.startCell}`);

      try {
        const { workbook, fileName, mimeType } = await ExcelHelpers.downloadAndParseExcel(
          drive,
          args.fileId
        );
        const sheet = ExcelHelpers.getWorksheet(workbook, args.sheetName);
        const sheetName = args.sheetName || workbook.SheetNames[0];

        const result = ExcelHelpers.writeRange(sheet, args.startCell, args.values);

        await ExcelHelpers.uploadExcel(drive, args.fileId, workbook, mimeType);

        const link = getDriveFileUrl(args.fileId, email);
        return `Successfully wrote ${result.updatedCells} cells (${result.updatedRows} rows x ${result.updatedColumns} columns) starting at ${args.startCell.toUpperCase()} in sheet "${sheetName}" of "${fileName}".\nView in Drive: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error writing range to Excel file ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to write range to Excel file: ${message}`);
      }
    },
  });

  // --- Append Excel Rows ---
  server.addTool({
    name: 'appendExcelRows',
    description:
      'Appends rows to an Excel-format file (.xlsx or .xls) on Google Drive. Similar to appendSpreadsheetRows but preserves Excel format.',
    annotations: {
      title: 'Append Excel Rows',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
      values: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .describe('2D array of values to append. Each inner array represents a row.'),
      sheetName: z
        .string()
        .optional()
        .describe(
          'Name of the sheet to append to. If not provided, appends to the first sheet. Use listExcelSheets to see available sheets.'
        ),
      startColumn: z
        .string()
        .optional()
        .default('A')
        .describe('Column letter to start appending from (e.g., "A", "B"). Defaults to "A".'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Appending rows to Excel file ${args.fileId}`);

      try {
        const { workbook, fileName, mimeType } = await ExcelHelpers.downloadAndParseExcel(
          drive,
          args.fileId
        );
        const sheet = ExcelHelpers.getWorksheet(workbook, args.sheetName);
        const sheetName = args.sheetName || workbook.SheetNames[0];

        const result = ExcelHelpers.appendRows(sheet, args.values, args.startColumn);

        await ExcelHelpers.uploadExcel(drive, args.fileId, workbook, mimeType);

        const link = getDriveFileUrl(args.fileId, email);
        return `Successfully appended ${result.appendedRows} row(s) starting at row ${result.startingRow} in sheet "${sheetName}" of "${fileName}".\nView in Drive: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error appending rows to Excel file ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to append rows to Excel file: ${message}`);
      }
    },
  });

  // --- Clear Excel Range ---
  server.addTool({
    name: 'clearExcelRange',
    description:
      'Clears values from a range in an Excel-format file (.xlsx or .xls) on Google Drive. Similar to clearSpreadsheetRange but preserves Excel format.',
    annotations: {
      title: 'Clear Excel Range',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
      range: z.string().describe('A1 notation range to clear (e.g., "A1:B10").'),
      sheetName: z
        .string()
        .optional()
        .describe(
          'Name of the sheet to clear from. If not provided, clears from the first sheet. Use listExcelSheets to see available sheets.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Clearing range ${args.range} in Excel file ${args.fileId}`);

      try {
        const { workbook, fileName, mimeType } = await ExcelHelpers.downloadAndParseExcel(
          drive,
          args.fileId
        );
        const sheet = ExcelHelpers.getWorksheet(workbook, args.sheetName);
        const sheetName = args.sheetName || workbook.SheetNames[0];

        const clearedCells = ExcelHelpers.clearRange(sheet, args.range);

        await ExcelHelpers.uploadExcel(drive, args.fileId, workbook, mimeType);

        const link = getDriveFileUrl(args.fileId, email);
        return `Successfully cleared ${clearedCells} cells in range ${args.range} in sheet "${sheetName}" of "${fileName}".\nView in Drive: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error clearing range in Excel file ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to clear range in Excel file: ${message}`);
      }
    },
  });

  // --- Get Excel Info ---
  server.addTool({
    name: 'getExcelInfo',
    description:
      'Gets detailed information about an Excel-format file (.xlsx or .xls) on Google Drive, including all sheets and their dimensions.',
    annotations: {
      title: 'Get Excel Info',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Getting info for Excel file: ${args.fileId}`);

      try {
        // Get file metadata
        const metadataResponse = await drive.files.get({
          fileId: args.fileId,
          fields: 'id,name,mimeType,size,createdTime,modifiedTime,owners(displayName,emailAddress)',
        });

        const { workbook, fileName, mimeType } = await ExcelHelpers.downloadAndParseExcel(
          drive,
          args.fileId
        );

        const link = getDriveFileUrl(args.fileId, email);
        const metadata = metadataResponse.data;
        const modifiedDate = metadata.modifiedTime
          ? new Date(metadata.modifiedTime).toLocaleString()
          : 'Unknown';
        const owner = metadata.owners?.[0];

        let result = '**Excel File Information:**\n\n';
        result += `**Name:** ${fileName}\n`;
        result += `**ID:** ${args.fileId}\n`;
        result += `**Format:** ${mimeType === ExcelHelpers.EXCEL_MIME_TYPES.xlsx ? 'Excel (.xlsx)' : 'Excel (.xls)'}\n`;
        result += `**Size:** ${metadata.size ? `${parseInt(metadata.size).toLocaleString()} bytes` : 'Unknown'}\n`;
        result += `**Modified:** ${modifiedDate}\n`;
        if (owner) {
          result += `**Owner:** ${owner.displayName} (${owner.emailAddress})\n`;
        }
        result += `**Link:** ${link}\n\n`;

        const sheetNames = ExcelHelpers.getSheetNames(workbook);
        result += `**Sheets (${sheetNames.length}):**\n`;
        sheetNames.forEach((name, index) => {
          const info = ExcelHelpers.getSheetInfo(workbook, name);
          result += `${index + 1}. **${name}**\n`;
          result += `   - Dimensions: ${info.rowCount} rows x ${info.columnCount} columns\n`;
          result += `   - Used Range: ${info.usedRange || 'Empty'}\n`;
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error getting Excel info ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to get Excel info: ${message}`);
      }
    },
  });

  // --- Add Excel Sheet ---
  server.addTool({
    name: 'addExcelSheet',
    description: 'Adds a new sheet/tab to an Excel-format file (.xlsx or .xls) on Google Drive.',
    annotations: {
      title: 'Add Excel Sheet',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
      sheetName: z.string().min(1).describe('Name for the new sheet/tab.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Adding sheet "${args.sheetName}" to Excel file ${args.fileId}`);

      try {
        const { workbook, fileName, mimeType } = await ExcelHelpers.downloadAndParseExcel(
          drive,
          args.fileId
        );

        ExcelHelpers.addSheet(workbook, args.sheetName);

        await ExcelHelpers.uploadExcel(drive, args.fileId, workbook, mimeType);

        const link = getDriveFileUrl(args.fileId, email);
        return `Successfully added sheet "${args.sheetName}" to "${fileName}".\nView in Drive: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error adding sheet to Excel file ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to add sheet: ${message}`);
      }
    },
  });

  // --- Delete Excel Sheet ---
  server.addTool({
    name: 'deleteExcelSheet',
    description:
      'Deletes a sheet/tab from an Excel-format file (.xlsx or .xls) on Google Drive. Cannot delete the last sheet.',
    annotations: {
      title: 'Delete Excel Sheet',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
      sheetName: z.string().min(1).describe('Name of the sheet to delete.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Deleting sheet "${args.sheetName}" from Excel file ${args.fileId}`);

      try {
        const { workbook, fileName, mimeType } = await ExcelHelpers.downloadAndParseExcel(
          drive,
          args.fileId
        );

        ExcelHelpers.deleteSheet(workbook, args.sheetName);

        await ExcelHelpers.uploadExcel(drive, args.fileId, workbook, mimeType);

        const link = getDriveFileUrl(args.fileId, email);
        return `Successfully deleted sheet "${args.sheetName}" from "${fileName}".\nView in Drive: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error deleting sheet from Excel file ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete sheet: ${message}`);
      }
    },
  });

  // --- Rename Excel Sheet ---
  server.addTool({
    name: 'renameExcelSheet',
    description: 'Renames a sheet/tab in an Excel-format file (.xlsx or .xls) on Google Drive.',
    annotations: {
      title: 'Rename Excel Sheet',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive.'),
      oldName: z.string().min(1).describe('Current name of the sheet to rename.'),
      newName: z.string().min(1).describe('New name for the sheet.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(
        `Renaming sheet "${args.oldName}" to "${args.newName}" in Excel file ${args.fileId}`
      );

      try {
        const { workbook, fileName, mimeType } = await ExcelHelpers.downloadAndParseExcel(
          drive,
          args.fileId
        );

        ExcelHelpers.renameSheet(workbook, args.oldName, args.newName);

        await ExcelHelpers.uploadExcel(drive, args.fileId, workbook, mimeType);

        const link = getDriveFileUrl(args.fileId, email);
        return `Successfully renamed sheet "${args.oldName}" to "${args.newName}" in "${fileName}".\nView in Drive: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error renaming sheet in Excel file ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to rename sheet: ${message}`);
      }
    },
  });

  // --- Convert Excel to Google Sheets ---
  server.addTool({
    name: 'convertExcelToSheets',
    description:
      'Converts an Excel-format file (.xlsx or .xls) on Google Drive to native Google Sheets format for full Sheets API support. Creates a copy; the original is preserved.',
    annotations: {
      title: 'Convert Excel to Google Sheets',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      fileId: z.string().describe('The ID of the Excel file on Google Drive to convert.'),
      newName: z
        .string()
        .optional()
        .describe(
          'Name for the new Google Sheets file. If not provided, uses the original name without the Excel extension.'
        ),
      parentFolderId: z
        .string()
        .optional()
        .describe(
          'ID of folder where the new Sheets file should be created. If not provided, creates in the same location as the original.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Converting Excel file ${args.fileId} to Google Sheets`);

      try {
        // Get original file metadata
        const originalFile = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,mimeType,parents',
        });

        if (!ExcelHelpers.isExcelFile(originalFile.data.mimeType)) {
          throw new UserError(
            `File is not an Excel file. MIME type: ${originalFile.data.mimeType}. ` +
              'This tool only converts .xlsx or .xls files.'
          );
        }

        // Determine new name
        let newName = args.newName;
        if (!newName) {
          const originalName = originalFile.data.name || 'Untitled';
          newName = originalName.replace(/\.(xlsx?|xls)$/i, '');
        }

        // Copy the file with conversion to Google Sheets format
        const copyResponse = await drive.files.copy({
          fileId: args.fileId,
          requestBody: {
            name: newName,
            mimeType: 'application/vnd.google-apps.spreadsheet',
            parents: args.parentFolderId ? [args.parentFolderId] : originalFile.data.parents,
          },
          fields: 'id,name,webViewLink',
        });

        const newFile = copyResponse.data;
        const newId = newFile.id || '';
        const sheetsUrl = `https://docs.google.com/spreadsheets/d/${newId}/edit?authuser=${encodeURIComponent(email)}`;

        return `Successfully converted Excel file to Google Sheets!\n\n**Original:** ${originalFile.data.name}\n**New Sheets File:** ${newFile.name} (ID: ${newId})\n**Link:** ${sheetsUrl}\n\nYou can now use the Sheets tools to edit this file with full API support.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error converting Excel to Sheets ${args.fileId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to convert Excel to Sheets: ${message}`);
      }
    },
  });

  // --- List Excel Files ---
  server.addTool({
    name: 'listExcelFiles',
    description:
      'Lists Excel-format files (.xlsx and .xls) in your Google Drive. Use this to find spreadsheets stored in Excel format rather than native Google Sheets.',
    annotations: {
      title: 'List Excel Files',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          'The name of the Google account to use. Use listAccounts to see available accounts.'
        ),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe('Maximum number of files to return (1-100).'),
      query: z.string().optional().describe('Search query to filter files by name.'),
      folderId: z
        .string()
        .optional()
        .describe('ID of a specific folder to search in. If not provided, searches all of Drive.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Listing Excel files. Query: ${args.query || 'none'}, Max: ${args.maxResults}`);

      try {
        // Build query for Excel files
        let queryString = `(mimeType='${ExcelHelpers.EXCEL_MIME_TYPES.xlsx}' or mimeType='${ExcelHelpers.EXCEL_MIME_TYPES.xls}') and trashed=false`;

        if (args.query) {
          const safeQuery = escapeDriveQuery(args.query);
          queryString += ` and name contains '${safeQuery}'`;
        }

        if (args.folderId) {
          const safeFolderId = escapeDriveQuery(args.folderId);
          queryString += ` and '${safeFolderId}' in parents`;
        }

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy: 'modifiedTime desc',
          fields:
            'files(id,name,mimeType,size,modifiedTime,createdTime,owners(displayName,emailAddress))',
        });

        const files = response.data.files ?? [];

        if (files.length === 0) {
          return 'No Excel files found matching your criteria.';
        }

        let result = `Found ${files.length} Excel file(s):\n\n`;
        files.forEach((file, index) => {
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleDateString()
            : 'Unknown';
          const owner = file.owners?.[0]?.displayName || 'Unknown';
          const size = file.size ? `${parseInt(file.size).toLocaleString()} bytes` : 'Unknown';
          const format = file.mimeType === ExcelHelpers.EXCEL_MIME_TYPES.xlsx ? '.xlsx' : '.xls';
          const link = file.id ? getDriveFileUrl(file.id, email) : '';

          result += `${index + 1}. **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Format: Excel (${format})\n`;
          result += `   Size: ${size}\n`;
          result += `   Modified: ${modifiedDate}\n`;
          result += `   Owner: ${owner}\n`;
          result += `   Link: ${link}\n\n`;
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error listing Excel files: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to list Excel files: ${message}`);
      }
    },
  });
}
