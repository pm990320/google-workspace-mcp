// sheets.tools.ts - Google Sheets tool module
import { FastMCP, UserError } from 'fastmcp';
import { z } from 'zod';
import { sheets_v4, drive_v3 } from 'googleapis';
import * as SheetsHelpers from '../googleSheetsApiHelpers.js';

export function registerSheetsTools(
  server: FastMCP<any>,
  getSheetsClient: (accountName: string) => Promise<sheets_v4.Sheets>,
  getDriveClient: (accountName: string) => Promise<drive_v3.Drive>
) {
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
        const values = response.values || [];

        if (values.length === 0) {
          return `Range ${args.range} is empty or does not exist.`;
        }

        let result = `**Spreadsheet Range:** ${args.range}\n\n`;
        values.forEach((row, index) => {
          result += `Row ${index + 1}: ${JSON.stringify(row)}\n`;
        });

        return result;
      } catch (error: any) {
        log.error(`Error reading spreadsheet ${args.spreadsheetId}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to read spreadsheet: ${error.message || 'Unknown error'}`);
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
      range: z.string().describe('A1 notation range to write to (e.g., "A1:B2" or "Sheet1!A1:B2").'),
      values: z
        .array(z.array(z.any()))
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

        return `Successfully wrote ${updatedCells} cells (${updatedRows} rows, ${updatedColumns} columns) to range ${args.range}.`;
      } catch (error: any) {
        log.error(`Error writing to spreadsheet ${args.spreadsheetId}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to write to spreadsheet: ${error.message || 'Unknown error'}`);
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
        .array(z.array(z.any()))
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

        return `Successfully appended ${updatedRows} row(s) (${updatedCells} cells) to spreadsheet. Updated range: ${updatedRange}`;
      } catch (error: any) {
        log.error(`Error appending to spreadsheet ${args.spreadsheetId}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to append to spreadsheet: ${error.message || 'Unknown error'}`);
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

        return `Successfully cleared range ${clearedRange}.`;
      } catch (error: any) {
        log.error(
          `Error clearing range in spreadsheet ${args.spreadsheetId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to clear range: ${error.message || 'Unknown error'}`);
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

        let result = `**Spreadsheet Information:**\n\n`;
        result += `**Title:** ${metadata.properties?.title || 'Untitled'}\n`;
        result += `**ID:** ${metadata.spreadsheetId}\n`;
        result += `**URL:** https://docs.google.com/spreadsheets/d/${metadata.spreadsheetId}\n\n`;

        const sheetList = metadata.sheets || [];
        result += `**Sheets (${sheetList.length}):**\n`;
        sheetList.forEach((sheet, index) => {
          const props = sheet.properties;
          result += `${index + 1}. **${props?.title || 'Untitled'}**\n`;
          result += `   - Sheet ID: ${props?.sheetId}\n`;
          result += `   - Grid: ${props?.gridProperties?.rowCount || 0} rows x ${props?.gridProperties?.columnCount || 0} columns\n`;
          if (props?.hidden) {
            result += `   - Status: Hidden\n`;
          }
          result += `\n`;
        });

        return result;
      } catch (error: any) {
        log.error(`Error getting spreadsheet info ${args.spreadsheetId}: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to get spreadsheet info: ${error.message || 'Unknown error'}`);
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

        return `Successfully added sheet "${addedSheet.title}" (Sheet ID: ${addedSheet.sheetId}) to spreadsheet.`;
      } catch (error: any) {
        log.error(
          `Error adding sheet to spreadsheet ${args.spreadsheetId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to add sheet: ${error.message || 'Unknown error'}`);
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
        .array(z.array(z.any()))
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

        let result = `Successfully created spreadsheet "${driveResponse.data.name}" (ID: ${spreadsheetId})\nView Link: ${driveResponse.data.webViewLink}`;

        if (args.initialData && args.initialData.length > 0) {
          try {
            await SheetsHelpers.writeRange(
              sheets,
              spreadsheetId,
              'A1',
              args.initialData,
              'USER_ENTERED'
            );
            result += `\n\nInitial data added to the spreadsheet.`;
          } catch (contentError: any) {
            log.warn(`Spreadsheet created but failed to add initial data: ${contentError.message}`);
            result += `\n\nSpreadsheet created but failed to add initial data. You can add data manually.`;
          }
        }

        return result;
      } catch (error: any) {
        log.error(`Error creating spreadsheet: ${error.message || error}`);
        if (error.code === 404) throw new UserError('Parent folder not found. Check the folder ID.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to create spreadsheet: ${error.message || 'Unknown error'}`);
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
        .describe('Maximum number of spreadsheets to return (1-100).'),
      query: z
        .string()
        .optional()
        .describe('Search query to filter spreadsheets by name or content.'),
      orderBy: z
        .enum(['name', 'modifiedTime', 'createdTime'])
        .optional()
        .default('modifiedTime')
        .describe('Sort order for results.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      log.info(
        `Listing Google Sheets. Query: ${args.query || 'none'}, Max: ${args.maxResults}, Order: ${args.orderBy}`
      );

      try {
        let queryString = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
        if (args.query) {
          queryString += ` and (name contains '${args.query}' or fullText contains '${args.query}')`;
        }

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy: args.orderBy === 'name' ? 'name' : args.orderBy,
          fields:
            'files(id,name,modifiedTime,createdTime,size,webViewLink,owners(displayName,emailAddress))',
        });

        const files = response.data.files || [];

        if (files.length === 0) {
          return 'No Google Spreadsheets found matching your criteria.';
        }

        let result = `Found ${files.length} Google Spreadsheet(s):\n\n`;
        files.forEach((file, index) => {
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleDateString()
            : 'Unknown';
          const owner = file.owners?.[0]?.displayName || 'Unknown';
          result += `${index + 1}. **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Modified: ${modifiedDate}\n`;
          result += `   Owner: ${owner}\n`;
          result += `   Link: ${file.webViewLink}\n\n`;
        });

        return result;
      } catch (error: any) {
        log.error(`Error listing Google Sheets: ${error.message || error}`);
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to list spreadsheets: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
