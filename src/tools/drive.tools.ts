// drive.tools.ts - Google Drive tool module
import { FastMCP, UserError } from 'fastmcp';
import { z } from 'zod';
import { drive_v3, docs_v1 } from 'googleapis';
import { AccountDocumentParameters } from '../types.js';

export function registerDriveTools(
  server: FastMCP<any>,
  getDriveClient: (accountName: string) => Promise<drive_v3.Drive>,
  getDocsClient: (accountName: string) => Promise<docs_v1.Docs>
) {
  // --- List Google Docs ---
  server.addTool({
    name: 'listGoogleDocs',
    description: 'Lists Google Documents from your Google Drive with optional filtering.',
    annotations: {
      title: 'List Google Docs',
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
        .describe('Maximum number of documents to return (1-100).'),
      query: z.string().optional().describe('Search query to filter documents by name or content.'),
      orderBy: z
        .enum(['name', 'modifiedTime', 'createdTime'])
        .optional()
        .default('modifiedTime')
        .describe('Sort order for results.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      log.info(
        `Listing Google Docs. Query: ${args.query || 'none'}, Max: ${args.maxResults}, Order: ${args.orderBy}`
      );

      try {
        let queryString = "mimeType='application/vnd.google-apps.document' and trashed=false";
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
          return 'No Google Docs found matching your criteria.';
        }

        let result = `Found ${files.length} Google Document(s):\n\n`;
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
        log.error(`Error listing Google Docs: ${error.message || error}`);
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to list documents: ${error.message || 'Unknown error'}`);
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
      log.info(`Searching Google Docs for: "${args.searchQuery}" in ${args.searchIn}`);

      try {
        let queryString = "mimeType='application/vnd.google-apps.document' and trashed=false";

        if (args.searchIn === 'name') {
          queryString += ` and name contains '${args.searchQuery}'`;
        } else if (args.searchIn === 'content') {
          queryString += ` and fullText contains '${args.searchQuery}'`;
        } else {
          queryString += ` and (name contains '${args.searchQuery}' or fullText contains '${args.searchQuery}')`;
        }

        if (args.modifiedAfter) {
          queryString += ` and modifiedTime > '${args.modifiedAfter}'`;
        }

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy: 'modifiedTime desc',
          fields: 'files(id,name,modifiedTime,createdTime,webViewLink,owners(displayName),parents)',
        });

        const files = response.data.files || [];

        if (files.length === 0) {
          return `No Google Docs found containing "${args.searchQuery}".`;
        }

        let result = `Found ${files.length} document(s) matching "${args.searchQuery}":\n\n`;
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
        log.error(`Error searching Google Docs: ${error.message || error}`);
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to search documents: ${error.message || 'Unknown error'}`);
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
      log.info(`Getting recent Google Docs: ${args.maxResults} results, ${args.daysBack} days back`);

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

        const files = response.data.files || [];

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

          result += `${index + 1}. **${file.name}**\n`;
          result += `   ID: ${file.id}\n`;
          result += `   Last Modified: ${modifiedDate} by ${lastModifier}\n`;
          result += `   Owner: ${owner}\n`;
          result += `   Link: ${file.webViewLink}\n\n`;
        });

        return result;
      } catch (error: any) {
        log.error(`Error getting recent Google Docs: ${error.message || error}`);
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have granted Google Drive access to the application.'
          );
        throw new UserError(`Failed to get recent documents: ${error.message || 'Unknown error'}`);
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
      log.info(`Getting info for document: ${args.documentId}`);

      try {
        const response = await drive.files.get({
          fileId: args.documentId,
          fields:
            'id,name,description,mimeType,size,createdTime,modifiedTime,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),shared,parents,version',
        });

        const file = response.data;

        if (!file) {
          throw new UserError(`Document with ID ${args.documentId} not found.`);
        }

        const createdDate = file.createdTime
          ? new Date(file.createdTime).toLocaleString()
          : 'Unknown';
        const modifiedDate = file.modifiedTime
          ? new Date(file.modifiedTime).toLocaleString()
          : 'Unknown';
        const owner = file.owners?.[0];
        const lastModifier = file.lastModifyingUser;

        let result = `**Document Information:**\n\n`;
        result += `**Name:** ${file.name}\n`;
        result += `**ID:** ${file.id}\n`;
        result += `**Type:** Google Document\n`;
        result += `**Created:** ${createdDate}\n`;
        result += `**Last Modified:** ${modifiedDate}\n`;

        if (owner) {
          result += `**Owner:** ${owner.displayName} (${owner.emailAddress})\n`;
        }

        if (lastModifier) {
          result += `**Last Modified By:** ${lastModifier.displayName} (${lastModifier.emailAddress})\n`;
        }

        result += `**Shared:** ${file.shared ? 'Yes' : 'No'}\n`;
        result += `**View Link:** ${file.webViewLink}\n`;

        if (file.description) {
          result += `**Description:** ${file.description}\n`;
        }

        return result;
      } catch (error: any) {
        log.error(`Error getting document info: ${error.message || error}`);
        if (error.code === 404) throw new UserError(`Document not found (ID: ${args.documentId}).`);
        if (error.code === 403)
          throw new UserError('Permission denied. Make sure you have access to this document.');
        throw new UserError(`Failed to get document info: ${error.message || 'Unknown error'}`);
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
        return `Successfully created folder "${folder.name}" (ID: ${folder.id})\nLink: ${folder.webViewLink}`;
      } catch (error: any) {
        log.error(`Error creating folder: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError('Parent folder not found. Check the parent folder ID.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the parent folder.'
          );
        throw new UserError(`Failed to create folder: ${error.message || 'Unknown error'}`);
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
      log.info(`Listing contents of folder: ${args.folderId}`);

      try {
        let queryString = `'${args.folderId}' in parents and trashed=false`;

        if (!args.includeSubfolders && !args.includeFiles) {
          throw new UserError('At least one of includeSubfolders or includeFiles must be true.');
        }

        if (!args.includeSubfolders) {
          queryString += ` and mimeType!='application/vnd.google-apps.folder'`;
        } else if (!args.includeFiles) {
          queryString += ` and mimeType='application/vnd.google-apps.folder'`;
        }

        const response = await drive.files.list({
          q: queryString,
          pageSize: args.maxResults,
          orderBy: 'folder,name',
          fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink,owners(displayName))',
        });

        const items = response.data.files || [];

        if (items.length === 0) {
          return "The folder is empty or you don't have permission to view its contents.";
        }

        let result = `Contents of folder (${items.length} item${items.length !== 1 ? 's' : ''}):\n\n`;

        const folders = items.filter(
          (item) => item.mimeType === 'application/vnd.google-apps.folder'
        );
        const files = items.filter((item) => item.mimeType !== 'application/vnd.google-apps.folder');

        if (folders.length > 0 && args.includeSubfolders) {
          result += `**Folders (${folders.length}):**\n`;
          folders.forEach((folder) => {
            result += `  ${folder.name} (ID: ${folder.id})\n`;
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

            result += `[${fileType}] ${file.name}\n`;
            result += `   ID: ${file.id}\n`;
            result += `   Modified: ${modifiedDate} by ${owner}\n`;
            result += `   Link: ${file.webViewLink}\n\n`;
          });
        }

        return result;
      } catch (error: any) {
        log.error(`Error listing folder contents: ${error.message || error}`);
        if (error.code === 404) throw new UserError('Folder not found. Check the folder ID.');
        if (error.code === 403)
          throw new UserError('Permission denied. Make sure you have access to this folder.');
        throw new UserError(`Failed to list folder contents: ${error.message || 'Unknown error'}`);
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
      log.info(`Getting folder info: ${args.folderId}`);

      try {
        const response = await drive.files.get({
          fileId: args.folderId,
          fields:
            'id,name,description,createdTime,modifiedTime,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName),shared,parents',
        });

        const folder = response.data;

        if (folder.mimeType !== 'application/vnd.google-apps.folder') {
          throw new UserError('The specified ID does not belong to a folder.');
        }

        const createdDate = folder.createdTime
          ? new Date(folder.createdTime).toLocaleString()
          : 'Unknown';
        const modifiedDate = folder.modifiedTime
          ? new Date(folder.modifiedTime).toLocaleString()
          : 'Unknown';
        const owner = folder.owners?.[0];
        const lastModifier = folder.lastModifyingUser;

        let result = `**Folder Information:**\n\n`;
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
        result += `**View Link:** ${folder.webViewLink}\n`;

        if (folder.description) {
          result += `**Description:** ${folder.description}\n`;
        }

        if (folder.parents && folder.parents.length > 0) {
          result += `**Parent Folder ID:** ${folder.parents[0]}\n`;
        }

        return result;
      } catch (error: any) {
        log.error(`Error getting folder info: ${error.message || error}`);
        if (error.code === 404) throw new UserError(`Folder not found (ID: ${args.folderId}).`);
        if (error.code === 403)
          throw new UserError('Permission denied. Make sure you have access to this folder.');
        throw new UserError(`Failed to get folder info: ${error.message || 'Unknown error'}`);
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
      log.info(`Moving file ${args.fileId} to folder ${args.newParentId}`);

      try {
        const fileInfo = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,parents',
        });

        const fileName = fileInfo.data.name;
        const currentParents = fileInfo.data.parents || [];

        const updateParams: any = {
          fileId: args.fileId,
          addParents: args.newParentId,
          fields: 'id,name,parents',
        };

        if (args.removeFromAllParents && currentParents.length > 0) {
          updateParams.removeParents = currentParents.join(',');
        }

        const response = await drive.files.update(updateParams);

        const action = args.removeFromAllParents ? 'moved' : 'copied';
        return `Successfully ${action} "${fileName}" to new location.\nFile ID: ${response.data.id}`;
      } catch (error: any) {
        log.error(`Error moving file: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError('File or destination folder not found. Check the IDs.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to both source and destination.'
          );
        throw new UserError(`Failed to move file: ${error.message || 'Unknown error'}`);
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
          fields: 'id,name,webViewLink',
        });

        const copiedFile = response.data;
        return `Successfully created copy "${copiedFile.name}" (ID: ${copiedFile.id})\nLink: ${copiedFile.webViewLink}`;
      } catch (error: any) {
        log.error(`Error copying file: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError('Original file or destination folder not found. Check the IDs.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have read access to the original file and write access to the destination.'
          );
        throw new UserError(`Failed to copy file: ${error.message || 'Unknown error'}`);
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
      log.info(`Renaming file ${args.fileId} to "${args.newName}"`);

      try {
        const response = await drive.files.update({
          fileId: args.fileId,
          requestBody: {
            name: args.newName,
          },
          fields: 'id,name,webViewLink',
        });

        const file = response.data;
        return `Successfully renamed to "${file.name}" (ID: ${file.id})\nLink: ${file.webViewLink}`;
      } catch (error: any) {
        log.error(`Error renaming file: ${error.message || error}`);
        if (error.code === 404) throw new UserError('File not found. Check the file ID.');
        if (error.code === 403)
          throw new UserError('Permission denied. Make sure you have write access to this file.');
        throw new UserError(`Failed to rename file: ${error.message || 'Unknown error'}`);
      }
    },
  });

  // --- Delete File ---
  server.addTool({
    name: 'deleteFile',
    description: 'Permanently deletes a file or folder from Google Drive.',
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
      fileId: z.string().describe('ID of the file or folder to delete.'),
      skipTrash: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, permanently deletes the file. If false, moves to trash (can be restored).'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
      log.info(`Deleting file ${args.fileId} ${args.skipTrash ? '(permanent)' : '(to trash)'}`);

      try {
        const fileInfo = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,mimeType',
        });

        const fileName = fileInfo.data.name;
        const isFolder = fileInfo.data.mimeType === 'application/vnd.google-apps.folder';

        if (args.skipTrash) {
          await drive.files.delete({
            fileId: args.fileId,
          });
          return `Permanently deleted ${isFolder ? 'folder' : 'file'} "${fileName}".`;
        } else {
          await drive.files.update({
            fileId: args.fileId,
            requestBody: {
              trashed: true,
            },
          });
          return `Moved ${isFolder ? 'folder' : 'file'} "${fileName}" to trash. It can be restored from the trash.`;
        }
      } catch (error: any) {
        log.error(`Error deleting file: ${error.message || error}`);
        if (error.code === 404) throw new UserError('File not found. Check the file ID.');
        if (error.code === 403)
          throw new UserError('Permission denied. Make sure you have delete access to this file.');
        throw new UserError(`Failed to delete file: ${error.message || 'Unknown error'}`);
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
      initialContent: z.string().optional().describe('Initial text content to add to the document.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient(args.account);
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
        let result = `Successfully created document "${document.name}" (ID: ${document.id})\nView Link: ${document.webViewLink}`;

        if (args.initialContent) {
          try {
            const docs = await getDocsClient(args.account);
            await docs.documents.batchUpdate({
              documentId: document.id!,
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
            result += `\n\nInitial content added to document.`;
          } catch (contentError: any) {
            log.warn(`Document created but failed to add initial content: ${contentError.message}`);
            result += `\n\nDocument created but failed to add initial content. You can add content manually.`;
          }
        }

        return result;
      } catch (error: any) {
        log.error(`Error creating document: ${error.message || error}`);
        if (error.code === 404) throw new UserError('Parent folder not found. Check the folder ID.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to create document: ${error.message || 'Unknown error'}`);
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
        let result = `Successfully created document "${document.name}" from template (ID: ${document.id})\nView Link: ${document.webViewLink}`;

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

            if (requests.length > 0) {
              await docs.documents.batchUpdate({
                documentId: document.id!,
                requestBody: { requests },
              });

              const replacementCount = Object.keys(args.replacements).length;
              result += `\n\nApplied ${replacementCount} text replacement${replacementCount !== 1 ? 's' : ''} to the document.`;
            }
          } catch (replacementError: any) {
            log.warn(
              `Document created but failed to apply replacements: ${replacementError.message}`
            );
            result += `\n\nDocument created but failed to apply text replacements. You can make changes manually.`;
          }
        }

        return result;
      } catch (error: any) {
        log.error(`Error creating document from template: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError('Template document or parent folder not found. Check the IDs.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Make sure you have read access to the template and write access to the destination folder.'
          );
        throw new UserError(
          `Failed to create document from template: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
