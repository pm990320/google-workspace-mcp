// drive.tools.ts - Google Drive tool module
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { type drive_v3, type docs_v1 } from 'googleapis';
import { createReadStream, createWriteStream, existsSync, statSync } from 'fs';
import { basename, dirname } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import mime from 'mime-types';
import { AccountDocumentParameters, type DriveToolOptions } from '../types.js';
import { isGoogleApiError, getErrorMessage } from '../errorHelpers.js';
import { addAuthUserToUrl, getDocsUrl, getDriveFileUrl, getDriveFolderUrl } from '../urlHelpers.js';
import { escapeDriveQuery, validateReadPath, validateWritePath } from '../securityHelpers.js';
import { getServerConfig } from '../serverWrapper.js';

export function registerDriveTools(options: DriveToolOptions) {
  const { server, getDriveClient, getDocsClient, getAccountEmail } = options;
  // --- List Google Docs ---
  server.addTool({
    name: 'listGoogleDocs',
    description: 'Lists Google Documents from your Google Drive with optional filtering.',
    annotations: {
      title: 'List Google Docs',
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
          .describe('Maximum number of documents to return (1-100).'),
        query: z
          .string()
          .optional()
          .describe(
            'Search query to filter documents by name or content. Cannot be used with orderBy (Google Drive API limitation).'
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
      const email = await getAccountEmail(args.account);
      log.info(
        `Listing Google Docs. Query: ${args.query || 'none'}, Max: ${args.maxResults}, Order: ${args.orderBy}`
      );

      try {
        let queryString = "mimeType='application/vnd.google-apps.document' and trashed=false";
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
          return 'No Google Docs found matching your criteria.';
        }

        let result = `Found ${files.length} Google Document(s):\n\n`;
        files.forEach((file, index) => {
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleDateString()
            : 'Unknown';
          const owner = file.owners?.[0]?.displayName || 'Unknown';
          const link = file.id ? getDocsUrl(file.id, email) : file.webViewLink;
          result += `${index + 1}. **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Modified: ${modifiedDate}\n`;
          result += `   Owner: ${owner}\n`;
          result += `   Link: ${link}\n\n`;
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error listing Google Docs: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to list documents: ${message}`);
      }
    },
  });

  // --- Search Google Docs ---
  server.addTool({
    name: 'searchGoogleDocs',
    description: 'Searches for Google Documents by name, content, or other criteria.',
    annotations: {
      title: 'Search Google Docs',
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
      searchQuery: z.string().min(1).describe('Search term to find in document names or content.'),
      searchIn: z
        .enum(['name', 'content', 'both'])
        .optional()
        .default('both')
        .describe('Where to search: document names, content, or both.'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(10)
        .describe('Maximum number of results to return.'),
      modifiedAfter: z
        .string()
        .optional()
        .describe(
          'Only return documents modified after this date (ISO 8601 format, e.g., "2024-01-01").'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Searching Google Docs for: "${args.searchQuery}" in ${args.searchIn}`);

      try {
        let queryString = "mimeType='application/vnd.google-apps.document' and trashed=false";

        const safeSearchQuery = escapeDriveQuery(args.searchQuery);
        if (args.searchIn === 'name') {
          queryString += ` and name contains '${safeSearchQuery}'`;
        } else if (args.searchIn === 'content') {
          queryString += ` and fullText contains '${safeSearchQuery}'`;
        } else {
          queryString += ` and (name contains '${safeSearchQuery}' or fullText contains '${safeSearchQuery}')`;
        }

        if (args.modifiedAfter) {
          // modifiedAfter is expected to be an ISO 8601 date, escape it to be safe
          const safeDate = escapeDriveQuery(args.modifiedAfter);
          queryString += ` and modifiedTime > '${safeDate}'`;
        }

        // Don't use orderBy when query contains fullText search (Google Drive API limitation)
        // Only 'name' search doesn't use fullText
        const orderBy = args.searchIn === 'name' ? 'modifiedTime desc' : undefined;

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy,
          fields: 'files(id,name,modifiedTime,createdTime,webViewLink,owners(displayName),parents)',
        });

        const files = response.data.files ?? [];

        if (files.length === 0) {
          return `No Google Docs found containing "${args.searchQuery}".`;
        }

        let result = `Found ${files.length} document(s) matching "${args.searchQuery}":\n\n`;
        files.forEach((file, index) => {
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleDateString()
            : 'Unknown';
          const owner = file.owners?.[0]?.displayName || 'Unknown';
          const link = file.id ? getDocsUrl(file.id, email) : file.webViewLink;
          result += `${index + 1}. **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Modified: ${modifiedDate}\n`;
          result += `   Owner: ${owner}\n`;
          result += `   Link: ${link}\n\n`;
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error searching Google Docs: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to search documents: ${message}`);
      }
    },
  });

  // --- Get Recent Google Docs ---
  server.addTool({
    name: 'getRecentGoogleDocs',
    description: 'Gets the most recently modified Google Documents.',
    annotations: {
      title: 'Get Recent Google Docs',
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
        .max(50)
        .optional()
        .default(10)
        .describe('Maximum number of recent documents to return.'),
      daysBack: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .default(30)
        .describe('Only show documents modified within this many days.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(
        `Getting recent Google Docs: ${args.maxResults} results, ${args.daysBack} days back`
      );

      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - args.daysBack);
        const cutoffDateStr = cutoffDate.toISOString();

        const queryString = `mimeType='application/vnd.google-apps.document' and trashed=false and modifiedTime > '${cutoffDateStr}'`;

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy: 'modifiedTime desc',
          fields:
            'files(id,name,modifiedTime,createdTime,webViewLink,owners(displayName),lastModifyingUser(displayName))',
        });

        const files = response.data.files ?? [];

        if (files.length === 0) {
          return `No Google Docs found that were modified in the last ${args.daysBack} days.`;
        }

        let result = `${files.length} recently modified Google Document(s) (last ${args.daysBack} days):\n\n`;
        files.forEach((file, index) => {
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleString()
            : 'Unknown';
          const lastModifier = file.lastModifyingUser?.displayName || 'Unknown';
          const owner = file.owners?.[0]?.displayName || 'Unknown';
          const link = file.id ? getDocsUrl(file.id, email) : file.webViewLink;

          result += `${index + 1}. **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Last Modified: ${modifiedDate} by ${lastModifier}\n`;
          result += `   Owner: ${owner}\n`;
          result += `   Link: ${link}\n\n`;
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error getting recent Google Docs: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to get recent documents: ${message}`);
      }
    },
  });

  // --- Get Document Info ---
  server.addTool({
    name: 'getDocumentInfo',
    description: 'Gets detailed information about a specific Google Document.',
    annotations: {
      title: 'Get Document Info',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters,
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Getting info for document: ${args.documentId}`);

      try {
        const response = await drive.files.get({
          fileId: args.documentId,
          fields:
            'id,name,description,mimeType,size,createdTime,modifiedTime,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),shared,parents,version',
        });

        const file = response.data;
        const link = file.id ? getDocsUrl(file.id, email) : file.webViewLink;

        const createdDate = file.createdTime
          ? new Date(file.createdTime).toLocaleString()
          : 'Unknown';
        const modifiedDate = file.modifiedTime
          ? new Date(file.modifiedTime).toLocaleString()
          : 'Unknown';
        const owner = file.owners?.[0];
        const lastModifier = file.lastModifyingUser;

        let result = '**Document Information:**\n\n';
        result += `**Name:** ${file.name}\n`;
        result += `**ID:** ${file.id}\n`;
        result += '**Type:** Google Document\n';
        result += `**Created:** ${createdDate}\n`;
        result += `**Last Modified:** ${modifiedDate}\n`;

        if (owner) {
          result += `**Owner:** ${owner.displayName} (${owner.emailAddress})\n`;
        }

        if (lastModifier) {
          result += `**Last Modified By:** ${lastModifier.displayName} (${lastModifier.emailAddress})\n`;
        }

        result += `**Shared:** ${file.shared ? 'Yes' : 'No'}\n`;
        result += `**View Link:** ${link}\n`;

        if (file.description) {
          result += `**Description:** ${file.description}\n`;
        }

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error getting document info: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError(`Document not found (ID: ${args.documentId}).`);
        if (code === 403)
          throw new UserError('Permission denied. Make sure you have access to this document.');
        throw new UserError(`Failed to get document info: ${message}`);
      }
    },
  });

  // --- Create Folder ---
  server.addTool({
    name: 'createFolder',
    description: 'Creates a new folder in Google Drive.',
    annotations: {
      title: 'Create Folder',
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
      name: z.string().min(1).describe('Name for the new folder.'),
      parentFolderId: z
        .string()
        .optional()
        .describe('Parent folder ID. If not provided, creates folder in Drive root.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(
        `Creating folder "${args.name}" ${args.parentFolderId ? `in parent ${args.parentFolderId}` : 'in root'}`
      );

      try {
        const folderMetadata: drive_v3.Schema$File = {
          name: args.name,
          mimeType: 'application/vnd.google-apps.folder',
        };

        if (args.parentFolderId) {
          folderMetadata.parents = [args.parentFolderId];
        }

        const response = await drive.files.create({
          requestBody: folderMetadata,
          fields: 'id,name,parents,webViewLink',
        });

        const folder = response.data;
        const link = folder.id ? getDriveFolderUrl(folder.id, email) : folder.webViewLink;
        return `Successfully created folder "${folder.name}" (ID: ${folder.id})\nLink: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error creating folder: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404)
          throw new UserError('Parent folder not found. Check the parent folder ID.');
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the parent folder.'
          );
        throw new UserError(`Failed to create folder: ${message}`);
      }
    },
  });

  // --- List Folder Contents ---
  server.addTool({
    name: 'listFolderContents',
    description: 'Lists the contents of a specific folder in Google Drive.',
    annotations: {
      title: 'List Folder Contents',
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
      folderId: z
        .string()
        .describe('ID of the folder to list contents of. Use "root" for the root Drive folder.'),
      includeSubfolders: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to include subfolders in results.'),
      includeFiles: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to include files in results.'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(50)
        .describe('Maximum number of items to return.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Listing contents of folder: ${args.folderId}`);

      try {
        const safeFolderId = escapeDriveQuery(args.folderId);
        let queryString = `'${safeFolderId}' in parents and trashed=false`;

        if (!args.includeSubfolders && !args.includeFiles) {
          throw new UserError('At least one of includeSubfolders or includeFiles must be true.');
        }

        if (!args.includeSubfolders) {
          queryString += " and mimeType!='application/vnd.google-apps.folder'";
        } else if (!args.includeFiles) {
          queryString += " and mimeType='application/vnd.google-apps.folder'";
        }

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy: 'folder,name',
          fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,owners(displayName))',
        });

        const items = response.data.files ?? [];

        if (items.length === 0) {
          return "The folder is empty or you don't have permission to view its contents.";
        }

        let result = `Contents of folder (${items.length} item${items.length !== 1 ? 's' : ''}):\n\n`;

        const folders = items.filter(
          (item) => item.mimeType === 'application/vnd.google-apps.folder'
        );
        const files = items.filter(
          (item) => item.mimeType !== 'application/vnd.google-apps.folder'
        );

        if (folders.length > 0 && args.includeSubfolders) {
          result += `**Folders (${folders.length}):**\n`;
          folders.forEach((folder) => {
            const folderLink = folder.id ? getDriveFolderUrl(folder.id, email) : folder.webViewLink;
            result += `  ${folder.name} (ID: ${folder.id})\n`;
            result += `     Link: ${folderLink}\n`;
          });
          result += '\n';
        }

        if (files.length > 0 && args.includeFiles) {
          result += `**Files (${files.length}):\n`;
          files.forEach((file) => {
            const fileType =
              file.mimeType === 'application/vnd.google-apps.document'
                ? 'Doc'
                : file.mimeType === 'application/vnd.google-apps.spreadsheet'
                  ? 'Sheet'
                  : file.mimeType === 'application/vnd.google-apps.presentation'
                    ? 'Slides'
                    : 'File';
            const modifiedDate = file.modifiedTime
              ? new Date(file.modifiedTime).toLocaleDateString()
              : 'Unknown';
            const owner = file.owners?.[0]?.displayName || 'Unknown';
            // Use appropriate URL based on file type
            let link: string | null | undefined;
            if (file.id) {
              if (file.mimeType === 'application/vnd.google-apps.document') {
                link = getDocsUrl(file.id, email);
              } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
                link = addAuthUserToUrl(
                  file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
                  email
                );
              } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
                link = addAuthUserToUrl(
                  file.webViewLink || `https://docs.google.com/presentation/d/${file.id}/edit`,
                  email
                );
              } else {
                link = getDriveFileUrl(file.id, email);
              }
            } else {
              link = file.webViewLink;
            }

            result += `[${fileType}] ${file.name}\n`;
            result += `   ID: ${file.id}\n`;
            result += `   Modified: ${modifiedDate} by ${owner}\n`;
            result += `   Link: ${link}\n\n`;
          });
        }

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error listing folder contents: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError('Folder not found. Check the folder ID.');
        if (code === 403)
          throw new UserError('Permission denied. Make sure you have access to this folder.');
        throw new UserError(`Failed to list folder contents: ${message}`);
      }
    },
  });

  // --- Get Folder Info ---
  server.addTool({
    name: 'getFolderInfo',
    description: 'Gets detailed information about a specific folder in Google Drive.',
    annotations: {
      title: 'Get Folder Info',
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
      folderId: z.string().describe('ID of the folder to get information about.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Getting folder info: ${args.folderId}`);

      try {
        const response = await drive.files.get({
          fileId: args.folderId,
          fields:
            'id,name,mimeType,description,createdTime,modifiedTime,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName),shared,parents',
        });

        const folder = response.data;

        if (folder.mimeType !== 'application/vnd.google-apps.folder') {
          throw new UserError('The specified ID does not belong to a folder.');
        }

        const link = folder.id ? getDriveFolderUrl(folder.id, email) : folder.webViewLink;
        const createdDate = folder.createdTime
          ? new Date(folder.createdTime).toLocaleString()
          : 'Unknown';
        const modifiedDate = folder.modifiedTime
          ? new Date(folder.modifiedTime).toLocaleString()
          : 'Unknown';
        const owner = folder.owners?.[0];
        const lastModifier = folder.lastModifyingUser;

        let result = '**Folder Information:**\n\n';
        result += `**Name:** ${folder.name}\n`;
        result += `**ID:** ${folder.id}\n`;
        result += `**Created:** ${createdDate}\n`;
        result += `**Last Modified:** ${modifiedDate}\n`;

        if (owner) {
          result += `**Owner:** ${owner.displayName} (${owner.emailAddress})\n`;
        }

        if (lastModifier) {
          result += `**Last Modified By:** ${lastModifier.displayName}\n`;
        }

        result += `**Shared:** ${folder.shared ? 'Yes' : 'No'}\n`;
        result += `**View Link:** ${link}\n`;

        if (folder.description) {
          result += `**Description:** ${folder.description}\n`;
        }

        if (folder.parents && folder.parents.length > 0) {
          result += `**Parent Folder ID:** ${folder.parents[0]}\n`;
        }

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error getting folder info: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError(`Folder not found (ID: ${args.folderId}).`);
        if (code === 403)
          throw new UserError('Permission denied. Make sure you have access to this folder.');
        throw new UserError(`Failed to get folder info: ${message}`);
      }
    },
  });

  // --- Move File ---
  server.addTool({
    name: 'moveFile',
    description: 'Moves a file or folder to a different location in Google Drive.',
    annotations: {
      title: 'Move File',
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
      fileId: z.string().describe('ID of the file or folder to move.'),
      newParentId: z.string().describe('ID of the destination folder. Use "root" for Drive root.'),
      removeFromAllParents: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, removes from all current parents. If false, adds to new parent while keeping existing parents.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Moving file ${args.fileId} to folder ${args.newParentId}`);

      try {
        const fileInfo = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,parents,mimeType',
        });

        const fileName = fileInfo.data.name;
        const currentParents = fileInfo.data.parents ?? [];

        const removeParents =
          args.removeFromAllParents && currentParents.length > 0
            ? currentParents.join(',')
            : undefined;

        const response = await drive.files.update({
          fileId: args.fileId,
          addParents: args.newParentId,
          removeParents,
          fields: 'id,name,parents',
        });

        const action = args.removeFromAllParents ? 'moved' : 'copied';
        const destFolderLink = getDriveFolderUrl(args.newParentId, email);
        return `Successfully ${action} "${fileName}" to new location.\nFile ID: ${response.data.id}\nDestination Folder: ${destFolderLink}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error moving file: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404)
          throw new UserError('File or destination folder not found. Check the IDs.');
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to both source and destination.'
          );
        throw new UserError(`Failed to move file: ${message}`);
      }
    },
  });

  // --- Copy File ---
  server.addTool({
    name: 'copyFile',
    description: 'Creates a copy of a Google Drive file or document.',
    annotations: {
      title: 'Copy File',
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
      fileId: z.string().describe('ID of the file to copy.'),
      newName: z
        .string()
        .optional()
        .describe('Name for the copied file. If not provided, will use "Copy of [original name]".'),
      parentFolderId: z
        .string()
        .optional()
        .describe(
          'ID of folder where copy should be placed. If not provided, places in same location as original.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Copying file ${args.fileId} ${args.newName ? `as "${args.newName}"` : ''}`);

      try {
        const originalFile = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,parents',
        });

        const copyMetadata: drive_v3.Schema$File = {
          name: args.newName || `Copy of ${originalFile.data.name}`,
        };

        if (args.parentFolderId) {
          copyMetadata.parents = [args.parentFolderId];
        } else if (originalFile.data.parents) {
          copyMetadata.parents = originalFile.data.parents;
        }

        const response = await drive.files.copy({
          fileId: args.fileId,
          requestBody: copyMetadata,
          fields: 'id,name,webViewLink,mimeType',
        });

        const copiedFile = response.data;
        let link: string | null | undefined;
        if (copiedFile.id) {
          if (copiedFile.mimeType === 'application/vnd.google-apps.document') {
            link = getDocsUrl(copiedFile.id, email);
          } else if (copiedFile.mimeType === 'application/vnd.google-apps.folder') {
            link = getDriveFolderUrl(copiedFile.id, email);
          } else {
            link = copiedFile.webViewLink
              ? addAuthUserToUrl(copiedFile.webViewLink, email)
              : getDriveFileUrl(copiedFile.id, email);
          }
        } else {
          link = copiedFile.webViewLink;
        }
        return `Successfully created copy "${copiedFile.name}" (ID: ${copiedFile.id})\nLink: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error copying file: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404)
          throw new UserError('Original file or destination folder not found. Check the IDs.');
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have read access to the original file and write access to the destination.'
          );
        throw new UserError(`Failed to copy file: ${message}`);
      }
    },
  });

  // --- Rename File ---
  server.addTool({
    name: 'renameFile',
    description: 'Renames a file or folder in Google Drive.',
    annotations: {
      title: 'Rename File',
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
      fileId: z.string().describe('ID of the file or folder to rename.'),
      newName: z.string().min(1).describe('New name for the file or folder.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Renaming file ${args.fileId} to "${args.newName}"`);

      try {
        const response = await drive.files.update({
          fileId: args.fileId,
          requestBody: {
            name: args.newName,
          },
          fields: 'id,name,webViewLink,mimeType',
        });

        const file = response.data;
        let link: string | null | undefined;
        if (file.id) {
          if (file.mimeType === 'application/vnd.google-apps.document') {
            link = getDocsUrl(file.id, email);
          } else if (file.mimeType === 'application/vnd.google-apps.folder') {
            link = getDriveFolderUrl(file.id, email);
          } else {
            link = file.webViewLink
              ? addAuthUserToUrl(file.webViewLink, email)
              : getDriveFileUrl(file.id, email);
          }
        } else {
          link = file.webViewLink;
        }
        return `Successfully renamed to "${file.name}" (ID: ${file.id})\nLink: ${link}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error renaming file: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError('File not found. Check the file ID.');
        if (code === 403)
          throw new UserError('Permission denied. Make sure you have write access to this file.');
        throw new UserError(`Failed to rename file: ${message}`);
      }
    },
  });

  // --- Delete File ---
  server.addTool({
    name: 'deleteFile',
    description:
      'Moves a file or folder to trash in Google Drive. Files can be restored from trash within 30 days.',
    annotations: {
      title: 'Delete File',
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
      fileId: z.string().describe('ID of the file or folder to move to trash.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      log.info(`Moving file ${args.fileId} to trash`);

      try {
        const fileInfo = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,mimeType',
        });

        const fileName = fileInfo.data.name;
        const isFolder = fileInfo.data.mimeType === 'application/vnd.google-apps.folder';

        await drive.files.update({
          fileId: args.fileId,
          requestBody: {
            trashed: true,
          },
        });
        return `Moved ${isFolder ? 'folder' : 'file'} "${fileName}" to trash. It can be restored from trash within 30 days.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error deleting file: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError('File not found. Check the file ID.');
        if (code === 403)
          throw new UserError('Permission denied. Make sure you have delete access to this file.');
        throw new UserError(`Failed to delete file: ${message}`);
      }
    },
  });

  // --- Create Document ---
  server.addTool({
    name: 'createDocument',
    description: 'Creates a new Google Document.',
    annotations: {
      title: 'Create Document',
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
      title: z.string().min(1).describe('Title for the new document.'),
      parentFolderId: z
        .string()
        .optional()
        .describe(
          'ID of folder where document should be created. If not provided, creates in Drive root.'
        ),
      initialContent: z
        .string()
        .optional()
        .describe('Initial text content to add to the document.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Creating new document "${args.title}"`);

      try {
        const documentMetadata: drive_v3.Schema$File = {
          name: args.title,
          mimeType: 'application/vnd.google-apps.document',
        };

        if (args.parentFolderId) {
          documentMetadata.parents = [args.parentFolderId];
        }

        const response = await drive.files.create({
          requestBody: documentMetadata,
          fields: 'id,name,webViewLink',
        });

        const document = response.data;
        const link = document.id ? getDocsUrl(document.id, email) : document.webViewLink;
        let result = `Successfully created document "${document.name}" (ID: ${document.id})\nView Link: ${link}`;

        if (args.initialContent && document.id) {
          try {
            const docs = await getDocsClient(args.account);
            await docs.documents.batchUpdate({
              documentId: document.id,
              requestBody: {
                requests: [
                  {
                    insertText: {
                      location: { index: 1 },
                      text: args.initialContent,
                    },
                  },
                ],
              },
            });
            result += '\n\nInitial content added to document.';
          } catch (contentError: unknown) {
            const contentMessage = getErrorMessage(contentError);
            log.warn(`Document created but failed to add initial content: ${contentMessage}`);
            result +=
              '\n\nDocument created but failed to add initial content. You can add content manually.';
          }
        }

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error creating document: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError('Parent folder not found. Check the folder ID.');
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to create document: ${message}`);
      }
    },
  });

  // --- Create From Template ---
  server.addTool({
    name: 'createFromTemplate',
    description: 'Creates a new Google Document from an existing document template.',
    annotations: {
      title: 'Create From Template',
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
      templateId: z.string().describe('ID of the template document to copy from.'),
      newTitle: z.string().min(1).describe('Title for the new document.'),
      parentFolderId: z
        .string()
        .optional()
        .describe(
          'ID of folder where document should be created. If not provided, creates in Drive root.'
        ),
      replacements: z
        .record(z.string())
        .optional()
        .describe(
          'Key-value pairs for text replacements in the template (e.g., {"{{NAME}}": "John Doe", "{{DATE}}": "2024-01-01"}).'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Creating document from template ${args.templateId} with title "${args.newTitle}"`);

      try {
        const copyMetadata: drive_v3.Schema$File = {
          name: args.newTitle,
        };

        if (args.parentFolderId) {
          copyMetadata.parents = [args.parentFolderId];
        }

        const response = await drive.files.copy({
          fileId: args.templateId,
          requestBody: copyMetadata,
          fields: 'id,name,webViewLink',
        });

        const document = response.data;
        const link = document.id ? getDocsUrl(document.id, email) : document.webViewLink;
        let result = `Successfully created document "${document.name}" from template (ID: ${document.id})\nView Link: ${link}`;

        if (args.replacements && Object.keys(args.replacements).length > 0) {
          try {
            const docs = await getDocsClient(args.account);
            const requests: docs_v1.Schema$Request[] = [];

            for (const [searchText, replaceText] of Object.entries(args.replacements)) {
              requests.push({
                replaceAllText: {
                  containsText: {
                    text: searchText,
                    matchCase: false,
                  },
                  replaceText: replaceText,
                },
              });
            }

            if (requests.length > 0 && document.id) {
              await docs.documents.batchUpdate({
                documentId: document.id,
                requestBody: { requests },
              });

              const replacementCount = Object.keys(args.replacements).length;
              result += `\n\nApplied ${replacementCount} text replacement${replacementCount !== 1 ? 's' : ''} to the document.`;
            }
          } catch (replacementError: unknown) {
            const replaceMessage = getErrorMessage(replacementError);
            log.warn(`Document created but failed to apply replacements: ${replaceMessage}`);
            result +=
              '\n\nDocument created but failed to apply text replacements. You can make changes manually.';
          }
        }

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error creating document from template: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404)
          throw new UserError('Template document or parent folder not found. Check the IDs.');
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have read access to the template and write access to the destination folder.'
          );
        throw new UserError(`Failed to create document from template: ${message}`);
      }
    },
  });

  // --- Upload File to Drive ---
  server.addTool({
    name: 'uploadFileToDrive',
    description:
      'Uploads a local file to Google Drive. Supports any file type. Use this to upload documents, images, PDFs, or any other files.',
    annotations: {
      title: 'Upload File to Drive',
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
      localPath: z.string().min(1).describe('Absolute path to the local file to upload.'),
      fileName: z
        .string()
        .optional()
        .describe('Name for the uploaded file in Drive. If not provided, uses the local filename.'),
      folderId: z
        .string()
        .optional()
        .describe('ID of the folder to upload to. If not provided, uploads to Drive root.'),
      mimeType: z
        .string()
        .optional()
        .describe('MIME type of the file. If not provided, auto-detected from file extension.'),
      convertToGoogleFormat: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, converts supported files to Google format (e.g., .docx to Google Docs, .xlsx to Google Sheets).'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);

      // Validate path for security
      const pathValidation = validateReadPath(args.localPath, getServerConfig().pathSecurity);
      if (!pathValidation.valid) {
        throw new UserError(`Cannot upload from this path: ${pathValidation.error}`);
      }

      log.info(`Uploading file from ${pathValidation.resolvedPath}`);

      try {
        // Validate file exists
        if (!existsSync(pathValidation.resolvedPath)) {
          throw new UserError(`File not found: ${pathValidation.resolvedPath}`);
        }

        // Get file stats
        const stats = statSync(pathValidation.resolvedPath);
        if (!stats.isFile()) {
          throw new UserError(`Path is not a file: ${pathValidation.resolvedPath}`);
        }

        const fileName = args.fileName || basename(pathValidation.resolvedPath);
        const detectedMimeType =
          mime.lookup(pathValidation.resolvedPath) || 'application/octet-stream';
        const uploadMimeType = args.mimeType || detectedMimeType;

        // Determine if we should convert to Google format
        let googleMimeType: string | undefined;
        if (args.convertToGoogleFormat) {
          const mimeTypeMap: Record<string, string> = {
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
              'application/vnd.google-apps.document',
            'application/msword': 'application/vnd.google-apps.document',
            'text/plain': 'application/vnd.google-apps.document',
            'application/rtf': 'application/vnd.google-apps.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
              'application/vnd.google-apps.spreadsheet',
            'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
            'text/csv': 'application/vnd.google-apps.spreadsheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation':
              'application/vnd.google-apps.presentation',
            'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
          };
          googleMimeType = mimeTypeMap[uploadMimeType];
        }

        const fileMetadata: drive_v3.Schema$File = {
          name: fileName,
          mimeType: googleMimeType,
        };

        if (args.folderId) {
          fileMetadata.parents = [args.folderId];
        }

        const response = await drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: uploadMimeType,
            body: createReadStream(pathValidation.resolvedPath),
          },
          fields: 'id,name,mimeType,size,webViewLink,webContentLink',
        });

        const file = response.data;
        const fileSizeKB = stats.size > 0 ? Math.round(stats.size / 1024) : 0;

        // Generate appropriate link
        let link: string | null | undefined;
        if (file.id) {
          if (file.mimeType === 'application/vnd.google-apps.document') {
            link = getDocsUrl(file.id, email);
          } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
            link = addAuthUserToUrl(
              `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
              email
            );
          } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
            link = addAuthUserToUrl(
              `https://docs.google.com/presentation/d/${file.id}/edit`,
              email
            );
          } else {
            link = file.webViewLink
              ? addAuthUserToUrl(file.webViewLink, email)
              : getDriveFileUrl(file.id, email);
          }
        } else {
          link = file.webViewLink;
        }

        let result = `Successfully uploaded "${file.name}" (ID: ${file.id})\n`;
        result += `Size: ${fileSizeKB} KB\n`;
        result += `Type: ${file.mimeType}\n`;
        result += `View Link: ${link}`;

        if (file.webContentLink) {
          result += `\nDirect Download: ${file.webContentLink}`;
        }

        if (googleMimeType) {
          result += '\n\nFile was converted to Google format.';
        }

        return result;
      } catch (error: unknown) {
        if (error instanceof UserError) throw error;
        const message = getErrorMessage(error);
        log.error(`Error uploading file: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError('Destination folder not found. Check the folder ID.');
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to upload file: ${message}`);
      }
    },
  });

  // --- Download from Drive ---
  server.addTool({
    name: 'downloadFromDrive',
    description:
      'Downloads a file from Google Drive to your local filesystem. For Google Docs/Sheets/Slides, exports to a specified format.',
    annotations: {
      title: 'Download from Drive',
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
      fileId: z.string().min(1).describe('ID of the file to download.'),
      localPath: z
        .string()
        .min(1)
        .describe('Absolute path where the file should be saved locally.'),
      exportFormat: z
        .enum(['pdf', 'docx', 'txt', 'xlsx', 'csv', 'pptx', 'html', 'png', 'jpeg'])
        .optional()
        .describe(
          'Export format for Google Docs/Sheets/Slides. Required for native Google files. Options: pdf, docx, txt, xlsx, csv, pptx, html, png, jpeg.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);

      // Validate path for security
      const pathValidation = validateWritePath(args.localPath, getServerConfig().pathSecurity);
      if (!pathValidation.valid) {
        throw new UserError(`Cannot download to this path: ${pathValidation.error}`);
      }

      log.info(`Downloading file ${args.fileId} to ${pathValidation.resolvedPath}`);

      try {
        // Validate destination directory exists
        const destDir = dirname(pathValidation.resolvedPath);
        if (!existsSync(destDir)) {
          throw new UserError(`Destination directory does not exist: ${destDir}`);
        }

        // Get file metadata first
        const metadata = await drive.files.get({
          fileId: args.fileId,
          fields: 'id,name,mimeType,size',
        });

        const fileMimeType = metadata.data.mimeType;
        const fileName = metadata.data.name;
        const isGoogleNative = fileMimeType?.startsWith('application/vnd.google-apps');

        // Map export formats to MIME types
        const exportMimeTypes: Record<string, string> = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          txt: 'text/plain',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          csv: 'text/csv',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          html: 'text/html',
          png: 'image/png',
          jpeg: 'image/jpeg',
        };

        let response;

        if (isGoogleNative) {
          // Google native files must be exported
          if (!args.exportFormat) {
            throw new UserError(
              `This is a Google ${fileMimeType?.replace('application/vnd.google-apps.', '')} file. ` +
                'Please specify an exportFormat (pdf, docx, txt, xlsx, csv, pptx, html, png, jpeg).'
            );
          }

          const exportMimeType = exportMimeTypes[args.exportFormat];
          if (!exportMimeType) {
            throw new UserError(
              `Unsupported export format: ${args.exportFormat}. ` +
                'Supported formats: pdf, docx, txt, xlsx, csv, pptx, html, png, jpeg.'
            );
          }

          response = await drive.files.export(
            { fileId: args.fileId, mimeType: exportMimeType },
            { responseType: 'stream' }
          );
        } else {
          // Binary files can be downloaded directly
          response = await drive.files.get(
            { fileId: args.fileId, alt: 'media' },
            { responseType: 'stream' }
          );
        }

        // Write to file
        const writeStream = createWriteStream(pathValidation.resolvedPath);
        await pipeline(response.data as Readable, writeStream);

        // Get downloaded file size
        const downloadedStats = statSync(pathValidation.resolvedPath);
        const fileSizeKB = Math.round(downloadedStats.size / 1024);

        let result = `Successfully downloaded "${fileName}" to ${pathValidation.resolvedPath}\n`;
        result += `Size: ${fileSizeKB} KB`;

        if (isGoogleNative && args.exportFormat) {
          result += `\nExported as: ${args.exportFormat.toUpperCase()}`;
        }

        return result;
      } catch (error: unknown) {
        if (error instanceof UserError) throw error;
        const message = getErrorMessage(error);
        log.error(`Error downloading file: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError('File not found. Check the file ID.');
        if (code === 403)
          throw new UserError('Permission denied. Make sure you have access to this file.');
        throw new UserError(`Failed to download file: ${message}`);
      }
    },
  });

  // --- Get Shareable Link ---
  server.addTool({
    name: 'getShareableLink',
    description: 'Gets or creates a shareable link for a file with specified permission settings.',
    annotations: {
      title: 'Get Shareable Link',
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
      fileId: z.string().min(1).describe('ID of the file to share.'),
      shareWith: z
        .enum(['anyone', 'anyoneWithLink', 'domain'])
        .default('anyoneWithLink')
        .describe(
          'Who can access: "anyone" (public on web), "anyoneWithLink" (anyone with the link), "domain" (your organization).'
        ),
      role: z
        .enum(['reader', 'commenter', 'writer'])
        .default('reader')
        .describe(
          'Permission level: "reader" (view only), "commenter" (can comment), "writer" (can edit).'
        ),
      domain: z
        .string()
        .optional()
        .describe(
          'Required when shareWith is "domain". Your organization domain (e.g., "company.com").'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Creating shareable link for file ${args.fileId}`);

      try {
        // Validate domain parameter
        if (args.shareWith === 'domain' && !args.domain) {
          throw new UserError('The "domain" parameter is required when shareWith is "domain".');
        }

        // Get file info first
        const fileInfo = await drive.files.get({
          fileId: args.fileId,
          fields: 'id,name,mimeType,webViewLink,webContentLink',
        });

        const fileName = fileInfo.data.name;
        const fileMimeType = fileInfo.data.mimeType;

        // Create the permission
        const permissionBody: drive_v3.Schema$Permission = {
          role: args.role,
          type: args.shareWith === 'domain' ? 'domain' : 'anyone',
        };

        if (args.shareWith === 'domain' && args.domain) {
          permissionBody.domain = args.domain;
        }

        // For "anyoneWithLink", we still use type "anyone" but the link is not discoverable
        await drive.permissions.create({
          fileId: args.fileId,
          requestBody: permissionBody,
        });

        // Get the updated file with links
        const updatedFile = await drive.files.get({
          fileId: args.fileId,
          fields: 'id,webViewLink,webContentLink',
        });

        // Generate appropriate link
        let viewLink: string | null | undefined;
        if (updatedFile.data.id) {
          if (fileMimeType === 'application/vnd.google-apps.document') {
            viewLink = getDocsUrl(updatedFile.data.id, email);
          } else if (fileMimeType === 'application/vnd.google-apps.spreadsheet') {
            viewLink = addAuthUserToUrl(
              `https://docs.google.com/spreadsheets/d/${updatedFile.data.id}/edit`,
              email
            );
          } else if (fileMimeType === 'application/vnd.google-apps.presentation') {
            viewLink = addAuthUserToUrl(
              `https://docs.google.com/presentation/d/${updatedFile.data.id}/edit`,
              email
            );
          } else if (fileMimeType === 'application/vnd.google-apps.folder') {
            viewLink = getDriveFolderUrl(updatedFile.data.id, email);
          } else {
            viewLink = updatedFile.data.webViewLink
              ? addAuthUserToUrl(updatedFile.data.webViewLink, email)
              : getDriveFileUrl(updatedFile.data.id, email);
          }
        } else {
          viewLink = updatedFile.data.webViewLink;
        }

        const shareDescription =
          args.shareWith === 'anyone'
            ? 'Anyone on the internet'
            : args.shareWith === 'domain'
              ? `Anyone in ${args.domain}`
              : 'Anyone with the link';

        const roleDescription =
          args.role === 'reader'
            ? 'view'
            : args.role === 'commenter'
              ? 'view and comment'
              : 'view, comment, and edit';

        let result = `Successfully created shareable link for "${fileName}"\n\n`;
        result += `**Access:** ${shareDescription} can ${roleDescription}\n`;
        result += `**View Link:** ${viewLink}`;

        if (updatedFile.data.webContentLink) {
          result += `\n**Direct Download:** ${updatedFile.data.webContentLink}`;
        }

        return result;
      } catch (error: unknown) {
        if (error instanceof UserError) throw error;
        const message = getErrorMessage(error);
        log.error(`Error creating shareable link: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError('File not found. Check the file ID.');
        if (code === 403)
          throw new UserError(
            'Permission denied. You may not have permission to share this file, or sharing may be restricted by your organization.'
          );
        throw new UserError(`Failed to create shareable link: ${message}`);
      }
    },
  });

  // --- List Recent Files ---
  server.addTool({
    name: 'listRecentFiles',
    description:
      'Lists recently modified files across all of Google Drive, not limited to a specific type.',
    annotations: {
      title: 'List Recent Files',
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
      daysBack: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .default(7)
        .describe('Only show files modified within this many days.'),
      fileType: z
        .enum(['all', 'documents', 'spreadsheets', 'presentations', 'folders', 'pdfs', 'images'])
        .optional()
        .default('all')
        .describe('Filter by file type.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(
        `Listing recent files: ${args.maxResults} results, ${args.daysBack} days back, type: ${args.fileType}`
      );

      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - args.daysBack);
        const cutoffDateStr = cutoffDate.toISOString();

        let queryString = `trashed=false and modifiedTime > '${cutoffDateStr}'`;

        // Add file type filter
        const mimeTypeFilters: Record<string, string> = {
          documents: "mimeType='application/vnd.google-apps.document'",
          spreadsheets: "mimeType='application/vnd.google-apps.spreadsheet'",
          presentations: "mimeType='application/vnd.google-apps.presentation'",
          folders: "mimeType='application/vnd.google-apps.folder'",
          pdfs: "mimeType='application/pdf'",
          images: "(mimeType contains 'image/' or mimeType='application/vnd.google-apps.photo')",
        };

        if (args.fileType !== 'all' && mimeTypeFilters[args.fileType]) {
          queryString += ` and ${mimeTypeFilters[args.fileType]}`;
        }

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy: 'modifiedTime desc',
          fields:
            'files(id,name,mimeType,size,modifiedTime,webViewLink,owners(displayName),lastModifyingUser(displayName))',
        });

        const files = response.data.files ?? [];

        if (files.length === 0) {
          return `No files found that were modified in the last ${args.daysBack} day(s)${args.fileType !== 'all' ? ` matching type "${args.fileType}"` : ''}.`;
        }

        let result = `${files.length} recently modified file(s) (last ${args.daysBack} day${args.daysBack !== 1 ? 's' : ''}):\n\n`;

        files.forEach((file, index) => {
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleString()
            : 'Unknown';
          const lastModifier = file.lastModifyingUser?.displayName || 'Unknown';

          // Determine file type label
          let typeLabel = 'File';
          if (file.mimeType === 'application/vnd.google-apps.document') typeLabel = 'Doc';
          else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') typeLabel = 'Sheet';
          else if (file.mimeType === 'application/vnd.google-apps.presentation')
            typeLabel = 'Slides';
          else if (file.mimeType === 'application/vnd.google-apps.folder') typeLabel = 'Folder';
          else if (file.mimeType === 'application/pdf') typeLabel = 'PDF';
          else if (file.mimeType?.startsWith('image/')) typeLabel = 'Image';

          // Generate appropriate link
          let link: string | null | undefined;
          if (file.id) {
            if (file.mimeType === 'application/vnd.google-apps.document') {
              link = getDocsUrl(file.id, email);
            } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
              link = addAuthUserToUrl(
                `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
                email
              );
            } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
              link = addAuthUserToUrl(
                `https://docs.google.com/presentation/d/${file.id}/edit`,
                email
              );
            } else if (file.mimeType === 'application/vnd.google-apps.folder') {
              link = getDriveFolderUrl(file.id, email);
            } else {
              link = file.webViewLink
                ? addAuthUserToUrl(file.webViewLink, email)
                : getDriveFileUrl(file.id, email);
            }
          } else {
            link = file.webViewLink;
          }

          result += `${index + 1}. [${typeLabel}] **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Modified: ${modifiedDate} by ${lastModifier}\n`;
          result += `   Link: ${link}\n\n`;
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error listing recent files: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to list recent files: ${message}`);
      }
    },
  });

  // --- Search Drive ---
  server.addTool({
    name: 'searchDrive',
    description:
      'Searches across all files in Google Drive by name, content, or type. More powerful than type-specific search tools.',
    annotations: {
      title: 'Search Drive',
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
      query: z.string().min(1).describe('Search term to find in file names or content.'),
      searchIn: z
        .enum(['name', 'content', 'both'])
        .optional()
        .default('both')
        .describe('Where to search: file names only, file content only, or both.'),
      fileType: z
        .enum([
          'all',
          'documents',
          'spreadsheets',
          'presentations',
          'pdfs',
          'images',
          'folders',
          'videos',
          'audio',
        ])
        .optional()
        .default('all')
        .describe('Filter results by file type.'),
      inFolder: z
        .string()
        .optional()
        .describe('Folder ID to search within. If not provided, searches entire Drive.'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(25)
        .describe('Maximum number of results to return.'),
      modifiedAfter: z
        .string()
        .optional()
        .describe(
          'Only return files modified after this date (ISO 8601 format, e.g., "2024-01-01").'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Searching Drive for "${args.query}" in ${args.searchIn}, type: ${args.fileType}`);

      try {
        let queryString = 'trashed=false';

        // Add search query (escaped for security)
        const safeQuery = escapeDriveQuery(args.query);
        if (args.searchIn === 'name') {
          queryString += ` and name contains '${safeQuery}'`;
        } else if (args.searchIn === 'content') {
          queryString += ` and fullText contains '${safeQuery}'`;
        } else {
          queryString += ` and (name contains '${safeQuery}' or fullText contains '${safeQuery}')`;
        }

        // Add file type filter
        const mimeTypeFilters: Record<string, string> = {
          documents: "mimeType='application/vnd.google-apps.document'",
          spreadsheets: "mimeType='application/vnd.google-apps.spreadsheet'",
          presentations: "mimeType='application/vnd.google-apps.presentation'",
          pdfs: "mimeType='application/pdf'",
          images: "(mimeType contains 'image/' or mimeType='application/vnd.google-apps.photo')",
          folders: "mimeType='application/vnd.google-apps.folder'",
          videos: "mimeType contains 'video/'",
          audio: "mimeType contains 'audio/'",
        };

        if (args.fileType !== 'all' && mimeTypeFilters[args.fileType]) {
          queryString += ` and ${mimeTypeFilters[args.fileType]}`;
        }

        // Add folder filter (escaped for security)
        if (args.inFolder) {
          const safeFolderId = escapeDriveQuery(args.inFolder);
          queryString += ` and '${safeFolderId}' in parents`;
        }

        // Add date filter (escaped for security)
        if (args.modifiedAfter) {
          const safeDate = escapeDriveQuery(args.modifiedAfter);
          queryString += ` and modifiedTime > '${safeDate}'`;
        }

        // Don't use orderBy when query contains fullText search (Google Drive API limitation)
        const orderBy = args.searchIn === 'name' ? 'modifiedTime desc' : undefined;

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy,
          fields:
            'files(id,name,mimeType,size,modifiedTime,webViewLink,owners(displayName),parents)',
        });

        const files = response.data.files ?? [];

        if (files.length === 0) {
          let notFoundMsg = `No files found matching "${args.query}"`;
          if (args.fileType !== 'all') notFoundMsg += ` (type: ${args.fileType})`;
          if (args.inFolder) notFoundMsg += ' in the specified folder';
          return notFoundMsg + '.';
        }

        let result = `Found ${files.length} file(s) matching "${args.query}":\n\n`;

        files.forEach((file, index) => {
          const modifiedDate = file.modifiedTime
            ? new Date(file.modifiedTime).toLocaleDateString()
            : 'Unknown';
          const owner = file.owners?.[0]?.displayName || 'Unknown';

          // Determine file type label
          let typeLabel = 'File';
          if (file.mimeType === 'application/vnd.google-apps.document') typeLabel = 'Doc';
          else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') typeLabel = 'Sheet';
          else if (file.mimeType === 'application/vnd.google-apps.presentation')
            typeLabel = 'Slides';
          else if (file.mimeType === 'application/vnd.google-apps.folder') typeLabel = 'Folder';
          else if (file.mimeType === 'application/pdf') typeLabel = 'PDF';
          else if (file.mimeType?.startsWith('image/')) typeLabel = 'Image';
          else if (file.mimeType?.startsWith('video/')) typeLabel = 'Video';
          else if (file.mimeType?.startsWith('audio/')) typeLabel = 'Audio';

          // Generate appropriate link
          let link: string | null | undefined;
          if (file.id) {
            if (file.mimeType === 'application/vnd.google-apps.document') {
              link = getDocsUrl(file.id, email);
            } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
              link = addAuthUserToUrl(
                `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
                email
              );
            } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
              link = addAuthUserToUrl(
                `https://docs.google.com/presentation/d/${file.id}/edit`,
                email
              );
            } else if (file.mimeType === 'application/vnd.google-apps.folder') {
              link = getDriveFolderUrl(file.id, email);
            } else {
              link = file.webViewLink
                ? addAuthUserToUrl(file.webViewLink, email)
                : getDriveFileUrl(file.id, email);
            }
          } else {
            link = file.webViewLink;
          }

          result += `${index + 1}. [${typeLabel}] **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Modified: ${modifiedDate} by ${owner}\n`;
          result += `   Link: ${link}\n\n`;
        });

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error searching Drive: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to search Drive: ${message}`);
      }
    },
  });
}
