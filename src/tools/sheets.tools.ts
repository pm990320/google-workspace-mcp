// sheets.tools.ts - Google Sheets tool module
import { UserError } from 'fastmcp';
import { z } from 'zod';
import type { drive_v3 } from 'googleapis';
import * as SheetsHelpers from '../googleSheetsApiHelpers.js';
import { isGoogleApiError, getErrorMessage } from '../errorHelpers.js';
import { type SheetsToolOptions } from '../types.js';
import { getSheetsUrl } from '../urlHelpers.js';
import { escapeDriveQuery, validateWritePath, wrapSpreadsheetContent } from '../securityHelpers.js';
import { getServerConfig } from '../serverWrapper.js';

export function registerSheetsTools(options: SheetsToolOptions) {
  const { server, getSheetsClient, getDriveClient, getAccountEmail } = options;
  // --- Read Spreadsheet ---
  server.addTool({
    name: 'readSpreadsheet',
    description: 'Reads data from a specific range in a Google Spreadsheet.',
    annotations: {
      title: 'Read Spreadsheet',
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
      spreadsheetId: z.string().describe('The ID of the Google Spreadsheet (from the URL).'),
      range: z.string().describe('A1 notation range to read (e.g., "A1:B10" or "Sheet1!A1:B10").'),
      valueRenderOption: z
        .enum(['FORMATTED_VALUE', 'UNFORMATTED_VALUE', 'FORMULA'])
        .optional()
        .default('FORMATTED_VALUE')
        .describe('How values should be rendered in the output.'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient(args.account);
      log.info(`Reading spreadsheet ${args.spreadsheetId}, range: ${args.range}`);

      try {
        const response = await SheetsHelpers.readRange(sheets, args.spreadsheetId, args.range);
        const values = response.values ?? [];

        if (values.length === 0) {
          return `Range ${args.range} is empty or does not exist.`;
        }

        const email = await getAccountEmail(args.account);
        const link = getSheetsUrl(args.spreadsheetId, email);

        // Build cell content and wrap with security warning
        let cellContent = '';
        values.forEach((row, index) => {
          cellContent += `Row ${index + 1}: ${JSON.stringify(row)}\n`;
        });
        const wrappedContent = wrapSpreadsheetContent(cellContent, undefined, args.range);

        let result = `**Spreadsheet Range:** ${args.range}\n\n`;
        result += wrappedContent;
        result += `\nView spreadsheet: ${link}`;

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error reading spreadsheet ${args.spreadsheetId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to read spreadsheet: ${message}`);
      }
    },
  });

  // --- Write Spreadsheet ---
  server.addTool({
    name: 'writeSpreadsheet',
    description:
      'Writes data to a specific range in a Google Spreadsheet. Overwrites existing data in the range.',
    annotations: {
      title: 'Write Spreadsheet',
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
      spreadsheetId: z.string().describe('The ID of the Google Spreadsheet (from the URL).'),
      range: z
        .string()
        .describe('A1 notation range to write to (e.g., "A1:B2" or "Sheet1!A1:B2").'),
      values: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .describe('2D array of values to write. Each inner array represents a row.'),
      valueInputOption: z
        .enum(['RAW', 'USER_ENTERED'])
        .optional()
        .default('USER_ENTERED')
        .describe(
          'How input data should be interpreted. RAW: values are stored as-is. USER_ENTERED: values are parsed as if typed by a user.'
        ),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient(args.account);
      log.info(`Writing to spreadsheet ${args.spreadsheetId}, range: ${args.range}`);

      try {
        const response = await SheetsHelpers.writeRange(
          sheets,
          args.spreadsheetId,
          args.range,
          args.values,
          args.valueInputOption
        );

        const updatedCells = response.updatedCells || 0;
        const updatedRows = response.updatedRows || 0;
        const updatedColumns = response.updatedColumns || 0;
        const email = await getAccountEmail(args.account);
        const link = getSheetsUrl(args.spreadsheetId, email);

        return `Successfully wrote ${updatedCells} cells (${updatedRows} rows, ${updatedColumns} columns) to range ${args.range}.\nView spreadsheet: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error writing to spreadsheet ${args.spreadsheetId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to write to spreadsheet: ${message}`);
      }
    },
  });

  // --- Append Spreadsheet Rows ---
  server.addTool({
    name: 'appendSpreadsheetRows',
    description: 'Appends rows of data to the end of a sheet in a Google Spreadsheet.',
    annotations: {
      title: 'Append Spreadsheet Rows',
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
      spreadsheetId: z.string().describe('The ID of the Google Spreadsheet (from the URL).'),
      range: z
        .string()
        .describe(
          'A1 notation range indicating where to append (e.g., "A1" or "Sheet1!A1"). Data will be appended starting from this range.'
        ),
      values: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .describe('2D array of values to append. Each inner array represents a row.'),
      valueInputOption: z
        .enum(['RAW', 'USER_ENTERED'])
        .optional()
        .default('USER_ENTERED')
        .describe(
          'How input data should be interpreted. RAW: values are stored as-is. USER_ENTERED: values are parsed as if typed by a user.'
        ),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient(args.account);
      log.info(`Appending rows to spreadsheet ${args.spreadsheetId}, starting at: ${args.range}`);

      try {
        const response = await SheetsHelpers.appendValues(
          sheets,
          args.spreadsheetId,
          args.range,
          args.values,
          args.valueInputOption
        );

        const updatedCells = response.updates?.updatedCells || 0;
        const updatedRows = response.updates?.updatedRows || 0;
        const updatedRange = response.updates?.updatedRange || args.range;
        const email = await getAccountEmail(args.account);
        const link = getSheetsUrl(args.spreadsheetId, email);

        return `Successfully appended ${updatedRows} row(s) (${updatedCells} cells) to spreadsheet. Updated range: ${updatedRange}\nView spreadsheet: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error appending to spreadsheet ${args.spreadsheetId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to append to spreadsheet: ${message}`);
      }
    },
  });

  // --- Clear Spreadsheet Range ---
  server.addTool({
    name: 'clearSpreadsheetRange',
    description: 'Clears all values from a specific range in a Google Spreadsheet.',
    annotations: {
      title: 'Clear Spreadsheet Range',
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
      spreadsheetId: z.string().describe('The ID of the Google Spreadsheet (from the URL).'),
      range: z.string().describe('A1 notation range to clear (e.g., "A1:B10" or "Sheet1!A1:B10").'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient(args.account);
      log.info(`Clearing range ${args.range} in spreadsheet ${args.spreadsheetId}`);

      try {
        const response = await SheetsHelpers.clearRange(sheets, args.spreadsheetId, args.range);
        const clearedRange = response.clearedRange || args.range;
        const email = await getAccountEmail(args.account);
        const link = getSheetsUrl(args.spreadsheetId, email);

        return `Successfully cleared range ${clearedRange}.\nView spreadsheet: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error clearing range in spreadsheet ${args.spreadsheetId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to clear range: ${message}`);
      }
    },
  });

  // --- Get Spreadsheet Info ---
  server.addTool({
    name: 'getSpreadsheetInfo',
    description: 'Gets detailed information about a Google Spreadsheet including all sheets/tabs.',
    annotations: {
      title: 'Get Spreadsheet Info',
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
      spreadsheetId: z.string().describe('The ID of the Google Spreadsheet (from the URL).'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient(args.account);
      log.info(`Getting info for spreadsheet: ${args.spreadsheetId}`);

      try {
        const metadata = await SheetsHelpers.getSpreadsheetMetadata(sheets, args.spreadsheetId);
        const email = await getAccountEmail(args.account);
        const link = getSheetsUrl(args.spreadsheetId, email);

        let result = '**Spreadsheet Information:**\n\n';
        result += `**Title:** ${metadata.properties?.title || 'Untitled'}\n`;
        result += `**ID:** ${metadata.spreadsheetId}\n`;
        result += `**URL:** ${link}\n\n`;

        const sheetList = metadata.sheets ?? [];
        result += `**Sheets (${sheetList.length}):**\n`;
        sheetList.forEach((sheet, index) => {
          const props = sheet.properties;
          result += `${index + 1}. **${props?.title || 'Untitled'}**\n`;
          result += `   - Sheet ID: ${props?.sheetId}\n`;
          result += `   - Grid: ${props?.gridProperties?.rowCount || 0} rows x ${props?.gridProperties?.columnCount || 0} columns\n`;
          if (props?.hidden) {
            result += '   - Status: Hidden\n';
          }
          result += '\n';
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error getting spreadsheet info ${args.spreadsheetId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to get spreadsheet info: ${message}`);
      }
    },
  });

  // --- Add Spreadsheet Sheet ---
  server.addTool({
    name: 'addSpreadsheetSheet',
    description: 'Adds a new sheet/tab to an existing Google Spreadsheet.',
    annotations: {
      title: 'Add Spreadsheet Sheet',
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
      spreadsheetId: z.string().describe('The ID of the Google Spreadsheet (from the URL).'),
      sheetTitle: z.string().min(1).describe('Title for the new sheet/tab.'),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient(args.account);
      log.info(`Adding sheet "${args.sheetTitle}" to spreadsheet ${args.spreadsheetId}`);

      try {
        const response = await SheetsHelpers.addSheet(sheets, args.spreadsheetId, args.sheetTitle);
        const addedSheet = response.replies?.[0]?.addSheet?.properties;

        if (!addedSheet) {
          throw new UserError('Failed to add sheet - no sheet properties returned.');
        }

        const email = await getAccountEmail(args.account);
        const link = getSheetsUrl(args.spreadsheetId, email);
        return `Successfully added sheet "${addedSheet.title}" (Sheet ID: ${addedSheet.sheetId}) to spreadsheet.\nView spreadsheet: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error adding sheet to spreadsheet ${args.spreadsheetId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to add sheet: ${message}`);
      }
    },
  });

  // --- Create Spreadsheet ---
  server.addTool({
    name: 'createSpreadsheet',
    description: 'Creates a new Google Spreadsheet.',
    annotations: {
      title: 'Create Spreadsheet',
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
      title: z.string().min(1).describe('Title for the new spreadsheet.'),
      parentFolderId: z
        .string()
        .optional()
        .describe(
          'ID of folder where spreadsheet should be created. If not provided, creates in Drive root.'
        ),
      initialData: z
        .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
        .optional()
        .describe(
          'Optional initial data to populate in the first sheet. Each inner array represents a row.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const sheets = await getSheetsClient(args.account);
      log.info(`Creating new spreadsheet "${args.title}"`);

      try {
        const spreadsheetMetadata: drive_v3.Schema$File = {
          name: args.title,
          mimeType: 'application/vnd.google-apps.spreadsheet',
        };

        if (args.parentFolderId) {
          spreadsheetMetadata.parents = [args.parentFolderId];
        }

        const driveResponse = await drive.files.create({
          requestBody: spreadsheetMetadata,
          fields: 'id,name,webViewLink',
        });

        const spreadsheetId = driveResponse.data.id;
        if (!spreadsheetId) {
          throw new UserError('Failed to create spreadsheet - no ID returned.');
        }

        const email = await getAccountEmail(args.account);
        const link = getSheetsUrl(spreadsheetId, email);
        let result = `Successfully created spreadsheet "${driveResponse.data.name}" (ID: ${spreadsheetId})\nView Link: ${link}`;

        if (args.initialData && args.initialData.length > 0) {
          try {
            await SheetsHelpers.writeRange(
              sheets,
              spreadsheetId,
              'A1',
              args.initialData,
              'USER_ENTERED'
            );
            result += '\n\nInitial data added to the spreadsheet.';
          } catch (contentError: unknown) {
            const contentMessage = getErrorMessage(contentError);
            log.warn(`Spreadsheet created but failed to add initial data: ${contentMessage}`);
            result +=
              '\n\nSpreadsheet created but failed to add initial data. You can add data manually.';
          }
        }

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        const code = isGoogleApiError(error) ? error.code : undefined;
        log.error(`Error creating spreadsheet: ${message}`);
        if (code === 404) throw new UserError('Parent folder not found. Check the folder ID.');
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to create spreadsheet: ${message}`);
      }
    },
  });

  // --- Delete Spreadsheet Sheet ---
  server.addTool({
    name: 'deleteSpreadsheetSheet',
    description:
      'Deletes a sheet/tab from an existing Google Spreadsheet. Cannot delete the last sheet.',
    annotations: {
      title: 'Delete Spreadsheet Sheet',
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
      spreadsheetId: z.string().describe('The ID of the Google Spreadsheet (from the URL).'),
      sheetId: z
        .number()
        .int()
        .optional()
        .describe(
          'The numeric ID of the sheet to delete. Use getSpreadsheetInfo to find sheet IDs.'
        ),
      sheetTitle: z
        .string()
        .optional()
        .describe(
          'The title/name of the sheet to delete. Either sheetId or sheetTitle must be provided.'
        ),
    }),
    execute: async (args, { log }) => {
      const sheets = await getSheetsClient(args.account);

      if (args.sheetId === undefined && !args.sheetTitle) {
        throw new UserError('Either sheetId or sheetTitle must be provided.');
      }

      log.info(
        `Deleting sheet from spreadsheet ${args.spreadsheetId} (sheetId: ${args.sheetId}, title: ${args.sheetTitle})`
      );

      try {
        let sheetIdToDelete: number;
        let sheetTitleDeleted: string;

        if (args.sheetId !== undefined) {
          // Verify sheet exists and get its title
          const metadata = await SheetsHelpers.getSpreadsheetMetadata(sheets, args.spreadsheetId);
          const sheet = metadata.sheets?.find((s) => s.properties?.sheetId === args.sheetId);
          if (!sheet) {
            throw new UserError(
              `Sheet with ID ${args.sheetId} not found in spreadsheet. Use getSpreadsheetInfo to see available sheets.`
            );
          }
          sheetIdToDelete = args.sheetId;
          sheetTitleDeleted = sheet.properties?.title || 'Unknown';
        } else {
          // Find sheet by title
          const metadata = await SheetsHelpers.getSpreadsheetMetadata(sheets, args.spreadsheetId);
          const sheet = metadata.sheets?.find((s) => s.properties?.title === args.sheetTitle);
          if (!sheet?.properties?.sheetId) {
            throw new UserError(
              `Sheet "${args.sheetTitle}" not found in spreadsheet. Use getSpreadsheetInfo to see available sheets.`
            );
          }
          sheetIdToDelete = sheet.properties.sheetId;
          sheetTitleDeleted = args.sheetTitle!;
        }

        await SheetsHelpers.deleteSheet(sheets, args.spreadsheetId, sheetIdToDelete);

        const email = await getAccountEmail(args.account);
        const link = getSheetsUrl(args.spreadsheetId, email);
        return `Successfully deleted sheet "${sheetTitleDeleted}" (ID: ${sheetIdToDelete}) from spreadsheet.\nView spreadsheet: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error deleting sheet from spreadsheet ${args.spreadsheetId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete sheet: ${message}`);
      }
    },
  });

  // --- Download Spreadsheet ---
  server.addTool({
    name: 'downloadSpreadsheet',
    description:
      'Downloads a Google Spreadsheet as CSV or Excel (XLSX) format and saves it to the local filesystem. CSV exports a single sheet; XLSX exports the entire workbook.',
    annotations: {
      title: 'Download Spreadsheet',
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
      spreadsheetId: z.string().describe('The ID of the Google Spreadsheet (from the URL).'),
      format: z
        .enum(['csv', 'xlsx'])
        .describe('Export format. CSV exports a single sheet; XLSX exports the entire workbook.'),
      outputPath: z
        .string()
        .min(1)
        .describe(
          'Absolute path where the file should be saved (e.g., "/Users/name/Downloads/data.csv").'
        ),
      sheetName: z
        .string()
        .optional()
        .describe(
          'Name of the sheet to export (for CSV format). If not provided, exports the first sheet. Use getSpreadsheetInfo to see available sheet names.'
        ),
    }),
    execute: async (args, { log }) => {
      const { createWriteStream } = await import('fs');
      const { stat } = await import('fs/promises');
      const { pipeline } = await import('stream/promises');
      const { Readable } = await import('stream');
      const pathModule = await import('path');

      // Validate output path for security
      const pathValidation = validateWritePath(args.outputPath, getServerConfig().pathSecurity);
      if (!pathValidation.valid) {
        throw new UserError(`Invalid output path: ${pathValidation.error}`);
      }

      const sheets = await getSheetsClient(args.account);
      log.info(
        `Downloading spreadsheet ${args.spreadsheetId} as ${args.format.toUpperCase()} to ${pathValidation.resolvedPath}`
      );

      try {
        // Get spreadsheet metadata
        const metadata = await SheetsHelpers.getSpreadsheetMetadata(sheets, args.spreadsheetId);

        if (args.format === 'csv') {
          // For CSV, read sheet data and stream to file
          let sheetToExport = metadata.sheets?.[0];

          if (args.sheetName) {
            sheetToExport = metadata.sheets?.find((s) => s.properties?.title === args.sheetName);
            if (!sheetToExport) {
              const availableSheets =
                metadata.sheets?.map((s) => s.properties?.title).join(', ') || 'none';
              throw new UserError(
                `Sheet "${args.sheetName}" not found. Available sheets: ${availableSheets}`
              );
            }
          }

          const sheetTitle = sheetToExport?.properties?.title || 'Sheet1';

          // Read all data from the sheet (Sheets API doesn't support streaming reads)
          const range = `'${sheetTitle}'`;
          const response = await SheetsHelpers.readRange(sheets, args.spreadsheetId, range);
          const values = response.values ?? [];

          // Ensure output path has correct extension
          let outputPath = args.outputPath;
          if (!outputPath.toLowerCase().endsWith('.csv')) {
            outputPath = outputPath + '.csv';
          }

          // Stream rows to file to avoid building full CSV string in memory
          const rowCount = values.length;
          async function* generateCsvRows() {
            for (let i = 0; i < values.length; i++) {
              const row = values[i];
              const csvRow = row
                .map((cell) => {
                  const cellStr = cell?.toString() ?? '';
                  if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                    return `"${cellStr.replace(/"/g, '""')}"`;
                  }
                  return cellStr;
                })
                .join(',');
              yield csvRow + (i < values.length - 1 ? '\n' : '');
            }
          }

          const csvStream = Readable.from(generateCsvRows());
          const writeStream = createWriteStream(outputPath, { encoding: 'utf-8' });
          await pipeline(csvStream, writeStream);

          const fileStats = await stat(outputPath);
          return `**Saved:** ${pathModule.basename(outputPath)}\n**Path:** ${outputPath}\n**Format:** CSV\n**Sheet:** ${sheetTitle}\n**Rows:** ${rowCount.toLocaleString()}\n**Size:** ${fileStats.size.toLocaleString()} bytes`;
        } else {
          // For XLSX, stream directly from Drive API to file
          const drive = await getDriveClient(args.account);
          const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

          // Ensure output path has correct extension
          let outputPath = args.outputPath;
          if (!outputPath.toLowerCase().endsWith('.xlsx')) {
            outputPath = outputPath + '.xlsx';
          }

          const xlsxResponse = await drive.files.export(
            {
              fileId: args.spreadsheetId,
              mimeType: mimeType,
            },
            { responseType: 'stream' }
          );

          const writeStream = createWriteStream(outputPath);
          await pipeline(xlsxResponse.data as NodeJS.ReadableStream, writeStream);

          const fileStats = await stat(outputPath);
          return `**Saved:** ${pathModule.basename(outputPath)}\n**Path:** ${outputPath}\n**Format:** Excel (XLSX)\n**Sheets:** ${metadata.sheets?.length || 1}\n**Size:** ${fileStats.size.toLocaleString()} bytes`;
        }
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error downloading spreadsheet ${args.spreadsheetId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to download spreadsheet: ${message}`);
      }
    },
  });

  // --- List Google Sheets ---
  server.addTool({
    name: 'listGoogleSheets',
    description: 'Lists Google Spreadsheets from your Google Drive with optional filtering.',
    annotations: {
      title: 'List Google Sheets',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z
      .object({
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
          .describe('Maximum number of spreadsheets to return (1-100).'),
        query: z
          .string()
          .optional()
          .describe(
            'Search query to filter spreadsheets by name or content. Cannot be used with orderBy (Google Drive API limitation).'
          ),
        orderBy: z
          .enum(['name', 'modifiedTime', 'createdTime'])
          .optional()
          .describe(
            'Sort order for results (default: modifiedTime). Cannot be used with query (Google Drive API limitation).'
          ),
      })
      .refine((data) => !(data.query && data.orderBy), {
        message:
          'Cannot use both query and orderBy together. Google Drive API does not support sorting when using fullText search.',
        path: ['orderBy'],
      }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      log.info(
        `Listing Google Sheets. Query: ${args.query || 'none'}, Max: ${args.maxResults}, Order: ${args.orderBy || 'modifiedTime'}`
      );

      try {
        let queryString = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
        if (args.query) {
          const safeQuery = escapeDriveQuery(args.query);
          queryString += ` and (name contains '${safeQuery}' or fullText contains '${safeQuery}')`;
        }

        // Don't use orderBy when query contains fullText search (Google Drive API limitation)
        const orderBy = args.query
          ? undefined
          : args.orderBy
            ? args.orderBy === 'name'
              ? 'name'
              : args.orderBy
            : 'modifiedTime';

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy,
          fields:
            'files(id,name,modifiedTime,createdTime,size,webViewLink,owners(displayName,emailAddress))',
        });

        const files = response.data.files ?? [];

        if (files.length === 0) {
          return 'No Google Spreadsheets found matching your criteria.';
        }

        const email = await getAccountEmail(args.account);
        let result = `Found ${files.length} Google Spreadsheet(s):\n\n`;
        files.forEach((file, index) => {
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleDateString()
            : 'Unknown';
          const owner = file.owners?.[0]?.displayName || 'Unknown';
          const link = file.id ? getSheetsUrl(file.id, email) : file.webViewLink;
          result += `${index + 1}. **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Modified: ${modifiedDate}\n`;
          result += `   Owner: ${owner}\n`;
          result += `   Link: ${link}\n\n`;
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        const code = isGoogleApiError(error) ? error.code : undefined;
        log.error(`Error listing Google Sheets: ${message}`);
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to list spreadsheets: ${message}`);
      }
    },
  });
}
