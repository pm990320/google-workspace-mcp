// docs.tools.ts - Google Docs tool definitions
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { docs_v1, drive_v3 } from 'googleapis';
import {
  AccountDocumentParameters,
  OptionalRangeParameters,
  TextStyleParameters,
  TextStyleArgs,
  ParagraphStyleParameters,
  ApplyTextStyleToolParameters,
  ApplyTextStyleToolArgs,
  ApplyParagraphStyleToolParameters,
  ApplyParagraphStyleToolArgs,
  NotImplementedError,
  FastMCPServer,
  StructuralElement,
  ParagraphElement,
  Paragraph,
  DocsTable,
  TableRow,
  TableCell,
  TextRun,
  DriveComment,
  DriveReply,
  DocumentContent,
} from '../types.js';
import * as GDocsHelpers from '../googleDocsApiHelpers.js';
import { isGoogleApiError, getErrorMessage } from '../errorHelpers.js';

/**
 * Converts Google Docs JSON structure to Markdown format
 */
function convertDocsJsonToMarkdown(docData: DocumentContent): string {
  let markdown = '';

  if (!docData.body?.content) {
    return 'Document appears to be empty.';
  }

  docData.body.content.forEach((element: StructuralElement) => {
    if (element.paragraph) {
      markdown += convertParagraphToMarkdown(element.paragraph);
    } else if (element.table) {
      markdown += convertTableToMarkdown(element.table);
    } else if (element.sectionBreak) {
      markdown += '\n---\n\n'; // Section break as horizontal rule
    }
  });

  return markdown.trim();
}

/**
 * Converts a paragraph element to markdown
 */
function convertParagraphToMarkdown(paragraph: Paragraph): string {
  let text = '';
  let isHeading = false;
  let headingLevel = 0;
  let isList = false;

  // Check paragraph style for headings and lists
  if (paragraph.paragraphStyle?.namedStyleType) {
    const styleType = paragraph.paragraphStyle.namedStyleType;
    if (styleType.startsWith('HEADING_')) {
      isHeading = true;
      headingLevel = parseInt(styleType.replace('HEADING_', ''));
    } else if (styleType === 'TITLE') {
      isHeading = true;
      headingLevel = 1;
    } else if (styleType === 'SUBTITLE') {
      isHeading = true;
      headingLevel = 2;
    }
  }

  // Check for bullet lists
  if (paragraph.bullet) {
    isList = true;
  }

  // Process text elements
  if (paragraph.elements) {
    paragraph.elements.forEach((element: ParagraphElement) => {
      if (element.textRun) {
        text += convertTextRunToMarkdown(element.textRun);
      }
    });
  }

  // Format based on style
  if (isHeading && text.trim()) {
    const hashes = '#'.repeat(Math.min(headingLevel, 6));
    return `${hashes} ${text.trim()}\n\n`;
  } else if (isList && text.trim()) {
    return `- ${text.trim()}\n`;
  } else if (text.trim()) {
    return `${text.trim()}\n\n`;
  }

  return '\n'; // Empty paragraph
}

/**
 * Converts a textRun element to markdown with formatting
 */
function convertTextRunToMarkdown(textRun: TextRun): string {
  let text = textRun.content || '';
  const style = textRun.textStyle || {};

  // Apply inline formatting
  if (style.bold) {
    text = `**${text.trim()}**`;
    if (textRun.content?.endsWith(' ')) text += ' ';
    if (textRun.content?.startsWith(' ')) text = ' ' + text;
  }
  if (style.italic) {
    text = `*${text.trim()}*`;
    if (textRun.content?.endsWith(' ')) text += ' ';
    if (textRun.content?.startsWith(' ')) text = ' ' + text;
  }
  if (style.strikethrough) {
    text = `~~${text.trim()}~~`;
    if (textRun.content?.endsWith(' ')) text += ' ';
    if (textRun.content?.startsWith(' ')) text = ' ' + text;
  }
  if (style.link?.url) {
    text = `[${text.trim()}](${style.link.url})`;
    if (textRun.content?.endsWith(' ')) text += ' ';
    if (textRun.content?.startsWith(' ')) text = ' ' + text;
  }

  return text;
}

/**
 * Converts a table element to markdown
 */
function convertTableToMarkdown(table: DocsTable): string {
  if (!table.tableRows || table.tableRows.length === 0) {
    return '';
  }

  let markdown = '\n';
  const rows = table.tableRows;

  rows.forEach((row: TableRow, rowIndex: number) => {
    const cells = row.tableCells || [];
    const cellTexts = cells.map((cell: TableCell) => {
      let cellText = '';
      cell.content?.forEach((content: StructuralElement) => {
        content.paragraph?.elements?.forEach((element: ParagraphElement) => {
          if (element.textRun?.content) {
            cellText += element.textRun.content.trim();
          }
        });
      });
      return cellText || ' ';
    });

    markdown += '| ' + cellTexts.join(' | ') + ' |\n';

    // Add header separator after first row
    if (rowIndex === 0) {
      markdown += '|' + cellTexts.map(() => '---').join('|') + '|\n';
    }
  });

  return markdown + '\n';
}

export function registerDocsTools(
  server: FastMCPServer,
  getDocsClient: (accountName: string) => Promise<docs_v1.Docs>,
  getDriveClient: (accountName: string) => Promise<drive_v3.Drive>
) {
  // --- readGoogleDoc ---
  server.addTool({
    name: 'readGoogleDoc',
    description:
      'Reads the content of a specific Google Document, optionally returning structured data.',
    annotations: {
      title: 'Read Google Doc',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      format: z
        .enum(['text', 'json', 'markdown'])
        .optional()
        .default('text')
        .describe(
          "Output format: 'text' (plain text), 'json' (raw API structure, complex), 'markdown' (experimental conversion)."
        ),
      maxLength: z
        .number()
        .optional()
        .describe(
          'Maximum character limit for text output. If not specified, returns full document content. Use this to limit very large documents.'
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to read. If not specified, reads the first tab (or legacy document.body for documents without tabs).'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(
        `Reading Google Doc: ${args.documentId}, Format: ${args.format}${args.tabId ? `, Tab: ${args.tabId}` : ''}`
      );

      try {
        // Determine if we need tabs content
        const needsTabsContent = !!args.tabId;

        const fields =
          args.format === 'json' || args.format === 'markdown'
            ? '*' // Get everything for structure analysis
            : 'body(content(paragraph(elements(textRun(content)))))'; // Just text content

        const res = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: needsTabsContent,
          fields: needsTabsContent ? '*' : fields, // Get full document if using tabs
        });
        log.info(`Fetched doc: ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`);

        // If tabId is specified, find the specific tab
        let contentSource: DocumentContent;
        if (args.tabId) {
          const targetTab = GDocsHelpers.findTabById(res.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
          contentSource = { body: targetTab.documentTab.body };
          log.info(`Using content from tab: ${targetTab.tabProperties?.title || 'Untitled'}`);
        } else {
          // Use the document body (backward compatible)
          contentSource = res.data;
        }

        if (args.format === 'json') {
          const jsonContent = JSON.stringify(contentSource, null, 2);
          // Apply length limit to JSON if specified
          if (args.maxLength && jsonContent.length > args.maxLength) {
            return (
              jsonContent.substring(0, args.maxLength) +
              `\n... [JSON truncated: ${jsonContent.length} total chars]`
            );
          }
          return jsonContent;
        }

        if (args.format === 'markdown') {
          const markdownContent = convertDocsJsonToMarkdown(contentSource);
          const totalLength = markdownContent.length;
          log.info(`Generated markdown: ${totalLength} characters`);

          // Apply length limit to markdown if specified
          if (args.maxLength && totalLength > args.maxLength) {
            const truncatedContent = markdownContent.substring(0, args.maxLength);
            return `${truncatedContent}\n\n... [Markdown truncated to ${args.maxLength} chars of ${totalLength} total. Use maxLength parameter to adjust limit or remove it to get full content.]`;
          }

          return markdownContent;
        }

        // Default: Text format - extract all text content
        let textContent = '';
        let elementCount = 0;

        // Process all content elements from contentSource
        contentSource.body?.content?.forEach((element: StructuralElement) => {
          elementCount++;

          // Handle paragraphs
          if (element.paragraph?.elements) {
            element.paragraph.elements.forEach((pe: ParagraphElement) => {
              if (pe.textRun?.content) {
                textContent += pe.textRun.content;
              }
            });
          }

          // Handle tables
          if (element.table?.tableRows) {
            element.table.tableRows.forEach((row: TableRow) => {
              row.tableCells?.forEach((cell: TableCell) => {
                cell.content?.forEach((cellElement: StructuralElement) => {
                  cellElement.paragraph?.elements?.forEach((pe: ParagraphElement) => {
                    if (pe.textRun?.content) {
                      textContent += pe.textRun.content;
                    }
                  });
                });
              });
            });
          }
        });

        if (!textContent.trim()) return 'Document found, but appears empty.';

        const totalLength = textContent.length;
        log.info(`Document contains ${totalLength} characters across ${elementCount} elements`);
        log.info(`maxLength parameter: ${args.maxLength || 'not specified'}`);

        // Apply length limit only if specified
        if (args.maxLength && totalLength > args.maxLength) {
          const truncatedContent = textContent.substring(0, args.maxLength);
          log.info(`Truncating content from ${totalLength} to ${args.maxLength} characters`);
          return `Content (truncated to ${args.maxLength} chars of ${totalLength} total):\n---\n${truncatedContent}\n\n... [Document continues for ${totalLength - args.maxLength} more characters. Use maxLength parameter to adjust limit or remove it to get full content.]`;
        }

        // Return full content
        const fullResponse = `Content (${totalLength} characters):\n---\n${textContent}`;
        const responseLength = fullResponse.length;
        log.info(
          `Returning full content: ${responseLength} characters in response (${totalLength} content + ${responseLength - totalLength} metadata)`
        );

        return fullResponse;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error reading doc ${args.documentId}: ${message}`);
        // Handle errors thrown by helpers or API directly
        if (error instanceof UserError) throw error;
        if (error instanceof NotImplementedError) throw error;
        // Generic fallback for API errors not caught by helpers
        const apiError = isGoogleApiError(error) ? error : null;
        const code = apiError?.code;
        if (code === 404) throw new UserError(`Doc not found (ID: ${args.documentId}).`);
        if (code === 403)
          throw new UserError(`Permission denied for doc (ID: ${args.documentId}).`);
        // Extract detailed error information from Google API response
        const responseData = apiError?.response?.data as { error?: { message?: string; code?: number } } | undefined;
        const errorDetails = responseData?.error?.message || message;
        const errorCode = responseData?.error?.code || code;
        throw new UserError(
          `Failed to read doc: ${errorDetails}${errorCode ? ` (Code: ${errorCode})` : ''}`
        );
      }
    },
  });

  // --- editGoogleDoc ---
  server.addTool({
    name: 'editGoogleDoc',
    description:
      "Find and replace text in a Google Document. Similar to Claude Code's Edit tool - finds exact text and replaces it. Use this for surgical edits to documents.",
    annotations: {
      title: 'Edit Google Doc',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      documentId: z.string().describe('The Google Doc document ID'),
      oldText: z
        .string()
        .describe(
          'The exact text to find and replace (must be unique in the document, or use matchInstance)'
        ),
      newText: z.string().describe('The text to replace it with'),
      matchInstance: z
        .number()
        .optional()
        .default(1)
        .describe('Which instance to replace if text appears multiple times (1-based, default: 1)'),
      tabId: z
        .string()
        .optional()
        .describe('Tab ID for multi-tab documents (optional, defaults to first tab)'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(
        `Editing document ${args.documentId}: replacing "${args.oldText.substring(0, 50)}..." with "${args.newText.substring(0, 50)}..."`
      );

      try {
        // First, find the text range
        const range = await GDocsHelpers.findTextRange(
          docs,
          args.documentId,
          args.oldText,
          args.matchInstance
        );

        if (!range) {
          // Count how many instances exist
          const allRanges: { startIndex: number; endIndex: number }[] = [];
          let instance = 1;
          let foundRange = await GDocsHelpers.findTextRange(
            docs,
            args.documentId,
            args.oldText,
            instance
          );
          while (foundRange) {
            allRanges.push(foundRange);
            instance++;
            foundRange = await GDocsHelpers.findTextRange(
              docs,
              args.documentId,
              args.oldText,
              instance
            );
          }

          if (allRanges.length === 0) {
            throw new UserError(
              `Text not found in document: "${args.oldText.substring(0, 100)}${args.oldText.length > 100 ? '...' : ''}"`
            );
          } else {
            throw new UserError(
              `Instance ${args.matchInstance} not found. Only ${allRanges.length} instance(s) of the text exist in the document.`
            );
          }
        }

        // Delete the old text, then insert new text at that position
        // We do this as a batch update for atomicity
        const requests: docs_v1.Schema$Request[] = [];

        // Delete the old text
        requests.push({
          deleteContentRange: {
            range: {
              startIndex: range.startIndex,
              endIndex: range.endIndex,
              ...(args.tabId && { tabId: args.tabId }),
            },
          },
        });

        // Insert the new text at the start position
        if (args.newText.length > 0) {
          requests.push({
            insertText: {
              location: {
                index: range.startIndex,
                ...(args.tabId && { tabId: args.tabId }),
              },
              text: args.newText,
            },
          });
        }

        // Execute the batch update
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: { requests },
        });

        const charsRemoved = args.oldText.length;
        const charsAdded = args.newText.length;
        const netChange = charsAdded - charsRemoved;

        return `Successfully edited document. Replaced ${charsRemoved} characters with ${charsAdded} characters (net change: ${netChange >= 0 ? '+' : ''}${netChange}).`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error editing doc ${args.documentId}: ${message}`);
        if (error instanceof UserError) throw error;
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError(`Document not found (ID: ${args.documentId}).`);
        if (code === 403)
          throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
        throw new UserError(`Failed to edit document: ${message}`);
      }
    },
  });

  // --- listDocumentTabs ---
  server.addTool({
    name: 'listDocumentTabs',
    description:
      'Lists all tabs in a Google Document, including their hierarchy, IDs, and structure.',
    annotations: {
      title: 'List Document Tabs',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      includeContent: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether to include a content summary for each tab (character count).'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(`Listing tabs for document: ${args.documentId}`);

      try {
        // Get document with tabs structure
        const res = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: true,
          // Only get essential fields for tab listing
          fields: args.includeContent
            ? 'title,tabs' // Get all tab data if we need content summary
            : 'title,tabs(tabProperties,childTabs)', // Otherwise just structure
        });

        const docTitle = res.data.title || 'Untitled Document';

        // Get all tabs in a flat list with hierarchy info
        const allTabs = GDocsHelpers.getAllTabs(res.data);

        if (allTabs.length === 0) {
          // Shouldn't happen with new structure, but handle edge case
          return `Document "${docTitle}" appears to have no tabs (unexpected).`;
        }

        // Check if it's a single-tab or multi-tab document
        const isSingleTab = allTabs.length === 1;

        // Format the output
        let result = `**Document:** "${docTitle}"\n`;
        result += `**Total tabs:** ${allTabs.length}`;
        result += isSingleTab ? ' (single-tab document)\n\n' : '\n\n';

        if (!isSingleTab) {
          result += `**Tab Structure:**\n`;
          result += `${'─'.repeat(50)}\n\n`;
        }

        allTabs.forEach((tab: GDocsHelpers.TabWithLevel, index: number) => {
          const level = tab.level;
          const tabProperties = tab.tabProperties || {};
          const indent = '  '.repeat(level);

          // For single tab documents, show simplified info
          if (isSingleTab) {
            result += `**Default Tab:**\n`;
            result += `- Tab ID: ${tabProperties.tabId || 'Unknown'}\n`;
            result += `- Title: ${tabProperties.title || '(Untitled)'}\n`;
          } else {
            // For multi-tab documents, show hierarchy
            const prefix = level > 0 ? '└─ ' : '';
            result += `${indent}${prefix}**Tab ${index + 1}:** "${tabProperties.title || 'Untitled Tab'}"\n`;
            result += `${indent}   - ID: ${tabProperties.tabId || 'Unknown'}\n`;
            result += `${indent}   - Index: ${tabProperties.index !== undefined ? tabProperties.index : 'N/A'}\n`;

            if (tabProperties.parentTabId) {
              result += `${indent}   - Parent Tab ID: ${tabProperties.parentTabId}\n`;
            }
          }

          // Optionally include content summary
          if (args.includeContent && tab.documentTab) {
            const textLength = GDocsHelpers.getTabTextLength(tab.documentTab);
            const contentInfo =
              textLength > 0 ? `${textLength.toLocaleString()} characters` : 'Empty';
            result += `${indent}   - Content: ${contentInfo}\n`;
          }

          if (!isSingleTab) {
            result += '\n';
          }
        });

        // Add usage hint for multi-tab documents
        if (!isSingleTab) {
          result += `\n💡 **Tip:** Use tab IDs with other tools to target specific tabs.`;
        }

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error listing tabs for doc ${args.documentId}: ${message}`);
        const code = isGoogleApiError(error) ? error.code : undefined;
        if (code === 404) throw new UserError(`Document not found (ID: ${args.documentId}).`);
        if (code === 403)
          throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
        throw new UserError(`Failed to list tabs: ${message}`);
      }
    },
  });

  // --- appendToGoogleDoc ---
  server.addTool({
    name: 'appendToGoogleDoc',
    description: 'Appends text to the very end of a specific Google Document or tab.',
    annotations: {
      title: 'Append to Google Doc',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      textToAppend: z.string().min(1).describe('The text to add to the end.'),
      addNewlineIfNeeded: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Automatically add a newline before the appended text if the doc doesn't end with one."
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to append to. If not specified, appends to the first tab (or legacy document.body for documents without tabs).'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(
        `Appending to Google Doc: ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );

      try {
        // Determine if we need tabs content
        const needsTabsContent = !!args.tabId;

        // Get the current end index
        const docInfo = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: needsTabsContent,
          fields: needsTabsContent ? 'tabs' : 'body(content(endIndex)),documentStyle(pageSize)',
        });

        let endIndex = 1;
        let bodyContent: StructuralElement[] | undefined;

        // If tabId is specified, find the specific tab
        if (args.tabId) {
          const targetTab = GDocsHelpers.findTabById(docInfo.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
          bodyContent = targetTab.documentTab.body?.content;
        } else {
          bodyContent = docInfo.data.body?.content;
        }

        if (bodyContent) {
          const lastElement = bodyContent[bodyContent.length - 1];
          if (lastElement?.endIndex) {
            endIndex = lastElement.endIndex - 1; // Insert *before* the final newline of the doc typically
          }
        }

        // Simpler approach: Always assume insertion is needed unless explicitly told not to add newline
        const textToInsert =
          (args.addNewlineIfNeeded && endIndex > 1 ? '\n' : '') + args.textToAppend;

        if (!textToInsert) return 'Nothing to append.';

        const location: docs_v1.Schema$Location = { index: endIndex };
        if (args.tabId) {
          location.tabId = args.tabId;
        }

        const request: docs_v1.Schema$Request = { insertText: { location, text: textToInsert } };
        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        log.info(
          `Successfully appended to doc: ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
        );
        return `Successfully appended text to ${args.tabId ? `tab ${args.tabId} in ` : ''}document ${args.documentId}.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error appending to doc ${args.documentId}: ${message}`);
        if (error instanceof UserError) throw error;
        if (error instanceof NotImplementedError) throw error;
        throw new UserError(`Failed to append to doc: ${message}`);
      }
    },
  });

  // --- insertText ---
  server.addTool({
    name: 'insertText',
    description: 'Inserts text at a specific index within the document body or a specific tab.',
    annotations: {
      title: 'Insert Text',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      textToInsert: z.string().min(1).describe('The text to insert.'),
      index: z
        .number()
        .int()
        .min(1)
        .describe('The index (1-based) where the text should be inserted.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to insert into. If not specified, inserts into the first tab (or legacy document.body for documents without tabs).'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(
        `Inserting text in doc ${args.documentId} at index ${args.index}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );
      try {
        if (args.tabId) {
          // For tab-specific inserts, we need to verify the tab exists first
          const docInfo = await docs.documents.get({
            documentId: args.documentId,
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab)',
          });
          const targetTab = GDocsHelpers.findTabById(docInfo.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }

          // Insert with tabId
          const location: docs_v1.Schema$Location = { index: args.index, tabId: args.tabId };
          const request: docs_v1.Schema$Request = {
            insertText: { location, text: args.textToInsert },
          };
          await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        } else {
          // Use existing helper for backward compatibility
          await GDocsHelpers.insertText(docs, args.documentId, args.textToInsert, args.index);
        }
        return `Successfully inserted text at index ${args.index}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error inserting text in doc ${args.documentId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert text: ${message}`);
      }
    },
  });

  // --- deleteRange ---
  server.addTool({
    name: 'deleteRange',
    description:
      'Deletes content within a specified range (start index inclusive, end index exclusive) from the document or a specific tab.',
    annotations: {
      title: 'Delete Range',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      startIndex: z
        .number()
        .int()
        .min(1)
        .describe('The starting index of the text range (inclusive, starts from 1).'),
      endIndex: z.number().int().min(1).describe('The ending index of the text range (exclusive).'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to delete from. If not specified, deletes from the first tab (or legacy document.body for documents without tabs).'
        ),
    }).refine((data) => data.endIndex > data.startIndex, {
      message: 'endIndex must be greater than startIndex',
      path: ['endIndex'],
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(
        `Deleting range ${args.startIndex}-${args.endIndex} in doc ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );
      if (args.endIndex <= args.startIndex) {
        throw new UserError('End index must be greater than start index for deletion.');
      }
      try {
        // If tabId is specified, verify the tab exists
        if (args.tabId) {
          const docInfo = await docs.documents.get({
            documentId: args.documentId,
            includeTabsContent: true,
            fields: 'tabs(tabProperties,documentTab)',
          });
          const targetTab = GDocsHelpers.findTabById(docInfo.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
        }

        const range: docs_v1.Schema$Range = { startIndex: args.startIndex, endIndex: args.endIndex };
        if (args.tabId) {
          range.tabId = args.tabId;
        }

        const request: docs_v1.Schema$Request = {
          deleteContentRange: { range },
        };
        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        return `Successfully deleted content in range ${args.startIndex}-${args.endIndex}${args.tabId ? ` in tab ${args.tabId}` : ''}.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error deleting range in doc ${args.documentId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete range: ${message}`);
      }
    },
  });

  // --- applyTextStyle ---
  server.addTool({
    name: 'applyTextStyle',
    description:
      'Applies character-level formatting (bold, color, font, etc.) to a specific range or found text.',
    annotations: {
      title: 'Apply Text Style',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: ApplyTextStyleToolParameters,
    execute: async (args: ApplyTextStyleToolArgs, { log }) => {
      const docs = await getDocsClient(args.account);
      let startIndex: number | undefined;
      let endIndex: number | undefined;

      // Extract from target if it's a range type
      if ('startIndex' in args.target && 'endIndex' in args.target) {
        startIndex = args.target.startIndex;
        endIndex = args.target.endIndex;
      }

      log.info(
        `Applying text style in doc ${args.documentId}. Target: ${JSON.stringify(args.target)}, Style: ${JSON.stringify(args.style)}`
      );

      try {
        // Determine target range
        if ('textToFind' in args.target) {
          const range = await GDocsHelpers.findTextRange(
            docs,
            args.documentId,
            args.target.textToFind,
            args.target.matchInstance
          );
          if (!range) {
            throw new UserError(
              `Could not find instance ${args.target.matchInstance} of text "${args.target.textToFind}".`
            );
          }
          startIndex = range.startIndex;
          endIndex = range.endIndex;
          log.info(
            `Found text "${args.target.textToFind}" (instance ${args.target.matchInstance}) at range ${startIndex}-${endIndex}`
          );
        }

        if (startIndex === undefined || endIndex === undefined) {
          throw new UserError('Target range could not be determined.');
        }
        if (endIndex <= startIndex) {
          throw new UserError('End index must be greater than start index for styling.');
        }

        // Build the request
        const requestInfo = GDocsHelpers.buildUpdateTextStyleRequest(
          startIndex,
          endIndex,
          args.style
        );
        if (!requestInfo) {
          return 'No valid text styling options were provided.';
        }

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [requestInfo.request]);
        return `Successfully applied text style (${requestInfo.fields.join(', ')}) to range ${startIndex}-${endIndex}.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error applying text style in doc ${args.documentId}: ${message}`);
        if (error instanceof UserError) throw error;
        if (error instanceof NotImplementedError) throw error; // Should not happen here
        throw new UserError(`Failed to apply text style: ${message}`);
      }
    },
  });

  // --- applyParagraphStyle ---
  server.addTool({
    name: 'applyParagraphStyle',
    description:
      'Applies paragraph-level formatting (alignment, spacing, named styles like Heading 1) to the paragraph(s) containing specific text, an index, or a range.',
    annotations: {
      title: 'Apply Paragraph Style',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: ApplyParagraphStyleToolParameters,
    execute: async (args: ApplyParagraphStyleToolArgs, { log }) => {
      const docs = await getDocsClient(args.account);
      let startIndex: number | undefined;
      let endIndex: number | undefined;

      log.info(`Applying paragraph style to document ${args.documentId}`);
      log.info(`Style options: ${JSON.stringify(args.style)}`);
      log.info(`Target specification: ${JSON.stringify(args.target)}`);

      try {
        // STEP 1: Determine the target paragraph's range based on the targeting method
        if ('textToFind' in args.target) {
          // Find the text first
          log.info(
            `Finding text "${args.target.textToFind}" (instance ${args.target.matchInstance || 1})`
          );
          const textRange = await GDocsHelpers.findTextRange(
            docs,
            args.documentId,
            args.target.textToFind,
            args.target.matchInstance || 1
          );

          if (!textRange) {
            throw new UserError(`Could not find "${args.target.textToFind}" in the document.`);
          }

          log.info(
            `Found text at range ${textRange.startIndex}-${textRange.endIndex}, now locating containing paragraph`
          );

          // Then find the paragraph containing this text
          const paragraphRange = await GDocsHelpers.getParagraphRange(
            docs,
            args.documentId,
            textRange.startIndex
          );

          if (!paragraphRange) {
            throw new UserError(`Found the text but could not determine the paragraph boundaries.`);
          }

          startIndex = paragraphRange.startIndex;
          endIndex = paragraphRange.endIndex;
          log.info(`Text is contained within paragraph at range ${startIndex}-${endIndex}`);
        } else if ('indexWithinParagraph' in args.target) {
          // Find paragraph containing the specified index
          log.info(`Finding paragraph containing index ${args.target.indexWithinParagraph}`);
          const paragraphRange = await GDocsHelpers.getParagraphRange(
            docs,
            args.documentId,
            args.target.indexWithinParagraph
          );

          if (!paragraphRange) {
            throw new UserError(
              `Could not find paragraph containing index ${args.target.indexWithinParagraph}.`
            );
          }

          startIndex = paragraphRange.startIndex;
          endIndex = paragraphRange.endIndex;
          log.info(`Located paragraph at range ${startIndex}-${endIndex}`);
        } else if ('startIndex' in args.target && 'endIndex' in args.target) {
          // Use directly provided range
          startIndex = args.target.startIndex;
          endIndex = args.target.endIndex;
          log.info(`Using provided paragraph range ${startIndex}-${endIndex}`);
        }

        // Verify that we have a valid range
        if (startIndex === undefined || endIndex === undefined) {
          throw new UserError(
            'Could not determine target paragraph range from the provided information.'
          );
        }

        if (endIndex <= startIndex) {
          throw new UserError(
            `Invalid paragraph range: end index (${endIndex}) must be greater than start index (${startIndex}).`
          );
        }

        // STEP 2: Build and apply the paragraph style request
        log.info(`Building paragraph style request for range ${startIndex}-${endIndex}`);
        const requestInfo = GDocsHelpers.buildUpdateParagraphStyleRequest(
          startIndex,
          endIndex,
          args.style
        );

        if (!requestInfo) {
          return 'No valid paragraph styling options were provided.';
        }

        log.info(`Applying styles: ${requestInfo.fields.join(', ')}`);
        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [requestInfo.request]);

        return `Successfully applied paragraph styles (${requestInfo.fields.join(', ')}) to the paragraph.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        // Detailed error logging
        log.error(`Error applying paragraph style in doc ${args.documentId}: ${message}`);

        if (error instanceof UserError) throw error;
        if (error instanceof NotImplementedError) throw error;

        // Provide a more helpful error message
        throw new UserError(`Failed to apply paragraph style: ${message}`);
      }
    },
  });

  // --- insertTable ---
  server.addTool({
    name: 'insertTable',
    description: 'Inserts a new table with the specified dimensions at a given index.',
    annotations: {
      title: 'Insert Table',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      rows: z.number().int().min(1).describe('Number of rows for the new table.'),
      columns: z.number().int().min(1).describe('Number of columns for the new table.'),
      index: z
        .number()
        .int()
        .min(1)
        .describe('The index (1-based) where the table should be inserted.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(
        `Inserting ${args.rows}x${args.columns} table in doc ${args.documentId} at index ${args.index}`
      );
      try {
        await GDocsHelpers.createTable(docs, args.documentId, args.rows, args.columns, args.index);
        // The API response contains info about the created table, but might be too complex to return here.
        return `Successfully inserted a ${args.rows}x${args.columns} table at index ${args.index}.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error inserting table in doc ${args.documentId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert table: ${message}`);
      }
    },
  });

  // --- editTableCell ---
  server.addTool({
    name: 'editTableCell',
    description:
      'Edits the content and/or basic style of a specific table cell. Requires knowing table start index.',
    annotations: {
      title: 'Edit Table Cell',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      tableStartIndex: z
        .number()
        .int()
        .min(1)
        .describe(
          'The starting index of the TABLE element itself (tricky to find, may require reading structure first).'
        ),
      rowIndex: z.number().int().min(0).describe('Row index (0-based).'),
      columnIndex: z.number().int().min(0).describe('Column index (0-based).'),
      textContent: z
        .string()
        .optional()
        .describe('Optional: New text content for the cell. Replaces existing content.'),
      // Combine basic styles for simplicity here. More advanced cell styling might need separate tools.
      textStyle: TextStyleParameters.optional().describe('Optional: Text styles to apply.'),
      paragraphStyle: ParagraphStyleParameters.optional().describe(
        'Optional: Paragraph styles (like alignment) to apply.'
      ),
    }),
    execute: async (args, { log }) => {
      await getDocsClient(args.account);
      log.info(
        `Editing cell (${args.rowIndex}, ${args.columnIndex}) in table starting at ${args.tableStartIndex}, doc ${args.documentId}`
      );

      log.error('editTableCell is not implemented due to complexity of finding cell indices.');
      throw new NotImplementedError('Editing table cells is complex and not yet implemented.');
    },
  });

  // --- insertPageBreak ---
  server.addTool({
    name: 'insertPageBreak',
    description: 'Inserts a page break at the specified index.',
    annotations: {
      title: 'Insert Page Break',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      index: z
        .number()
        .int()
        .min(1)
        .describe('The index (1-based) where the page break should be inserted.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(`Inserting page break in doc ${args.documentId} at index ${args.index}`);
      try {
        const request: docs_v1.Schema$Request = {
          insertPageBreak: {
            location: { index: args.index },
          },
        };
        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        return `Successfully inserted page break at index ${args.index}.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error inserting page break in doc ${args.documentId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert page break: ${message}`);
      }
    },
  });

  // --- insertImageFromUrl ---
  server.addTool({
    name: 'insertImageFromUrl',
    description: 'Inserts an inline image into a Google Document from a publicly accessible URL.',
    annotations: {
      title: 'Insert Image From URL',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      imageUrl: z
        .string()
        .url()
        .describe('Publicly accessible URL to the image (must be http:// or https://).'),
      index: z
        .number()
        .int()
        .min(1)
        .describe('The index (1-based) where the image should be inserted.'),
      width: z.number().min(1).optional().describe('Optional: Width of the image in points.'),
      height: z.number().min(1).optional().describe('Optional: Height of the image in points.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.info(
        `Inserting image from URL ${args.imageUrl} at index ${args.index} in doc ${args.documentId}`
      );

      try {
        await GDocsHelpers.insertInlineImage(
          docs,
          args.documentId,
          args.imageUrl,
          args.index,
          args.width,
          args.height
        );

        let sizeInfo = '';
        if (args.width && args.height) {
          sizeInfo = ` with size ${args.width}x${args.height}pt`;
        }

        return `Successfully inserted image from URL at index ${args.index}${sizeInfo}.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error inserting image in doc ${args.documentId}: ${message}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to insert image: ${message}`);
      }
    },
  });

  // --- insertLocalImage ---
  server.addTool({
    name: 'insertLocalImage',
    description:
      'Uploads a local image file to Google Drive and inserts it into a Google Document. The image will be uploaded to the same folder as the document (or optionally to a specified folder).',
    annotations: {
      title: 'Insert Local Image',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      localImagePath: z
        .string()
        .describe(
          'Absolute path to the local image file (supports .jpg, .jpeg, .png, .gif, .bmp, .webp, .svg).'
        ),
      index: z
        .number()
        .int()
        .min(1)
        .describe('The index (1-based) where the image should be inserted in the document.'),
      width: z.number().min(1).optional().describe('Optional: Width of the image in points.'),
      height: z.number().min(1).optional().describe('Optional: Height of the image in points.'),
      uploadToSameFolder: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'If true, uploads the image to the same folder as the document. If false, uploads to Drive root.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      const drive = await getDriveClient(args.account);
      log.info(
        `Uploading local image ${args.localImagePath} and inserting at index ${args.index} in doc ${args.documentId}`
      );

      try {
        // Get the document's parent folder if requested
        let parentFolderId: string | undefined;
        if (args.uploadToSameFolder) {
          try {
            const docInfo = await drive.files.get({
              fileId: args.documentId,
              fields: 'parents',
            });
            if (docInfo.data.parents && docInfo.data.parents.length > 0) {
              parentFolderId = docInfo.data.parents[0];
              log.info(`Will upload image to document's parent folder: ${parentFolderId}`);
            }
          } catch (folderError) {
            log.warn(
              `Could not determine document's parent folder, using Drive root: ${folderError}`
            );
          }
        }

        // Upload the image to Drive
        log.info(`Uploading image to Drive...`);
        const imageUrl = await GDocsHelpers.uploadImageToDrive(
          drive,
          args.localImagePath,
          parentFolderId
        );
        log.info(`Image uploaded successfully, public URL: ${imageUrl}`);

        // Insert the image into the document
        await GDocsHelpers.insertInlineImage(
          docs,
          args.documentId,
          imageUrl,
          args.index,
          args.width,
          args.height
        );

        let sizeInfo = '';
        if (args.width && args.height) {
          sizeInfo = ` with size ${args.width}x${args.height}pt`;
        }

        return `Successfully uploaded image to Drive and inserted it at index ${args.index}${sizeInfo}.\nImage URL: ${imageUrl}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(
          `Error uploading/inserting local image in doc ${args.documentId}: ${message}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to upload/insert local image: ${message}`
        );
      }
    },
  });

  // --- fixListFormatting ---
  server.addTool({
    name: 'fixListFormatting',
    description:
      'EXPERIMENTAL: Attempts to detect paragraphs that look like lists (e.g., starting with -, *, 1.) and convert them to proper Google Docs bulleted or numbered lists. Best used on specific sections.',
    annotations: {
      title: 'Fix List Formatting',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      // Optional range to limit the scope, otherwise scans whole doc (potentially slow/risky)
      range: OptionalRangeParameters.optional().describe(
        'Optional: Limit the fixing process to a specific range.'
      ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      log.warn(
        `Executing EXPERIMENTAL fixListFormatting for doc ${args.documentId}. Range: ${JSON.stringify(args.range)}`
      );
      try {
        await GDocsHelpers.detectAndFormatLists(
          docs,
          args.documentId,
          args.range?.startIndex,
          args.range?.endIndex
        );
        return `Attempted to fix list formatting. Please review the document for accuracy.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(
          `Error fixing list formatting in doc ${args.documentId}: ${message}`
        );
        if (error instanceof UserError) throw error;
        if (error instanceof NotImplementedError) throw error; // Expected if helper not implemented
        throw new UserError(`Failed to fix list formatting: ${message}`);
      }
    },
  });

  // === COMMENT TOOLS ===

  // --- listComments ---
  server.addTool({
    name: 'listComments',
    description: 'Lists all comments in a Google Document.',
    annotations: {
      title: 'List Comments',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters,
    execute: async (args, { log }) => {
      log.info(`Listing comments for document ${args.documentId}`);
      const driveClient = await getDriveClient(args.account);

      try {
        // Use Drive API v3 with proper fields to get quoted content
        const response = await driveClient.comments.list({
          fileId: args.documentId,
          fields: 'comments(id,content,quotedFileContent,author,createdTime,resolved)',
          pageSize: 100,
        });

        const comments = response.data.comments || [];

        if (comments.length === 0) {
          return 'No comments found in this document.';
        }

        // Format comments for display
        const formattedComments = comments
          .map((comment: DriveComment, index: number) => {
            const replies = comment.replies?.length || 0;
            const status = comment.resolved ? ' [RESOLVED]' : '';
            const author = comment.author?.displayName || 'Unknown';
            const date = comment.createdTime
              ? new Date(comment.createdTime).toLocaleDateString()
              : 'Unknown date';

            // Get the actual quoted text content
            const quotedText = comment.quotedFileContent?.value || 'No quoted text';
            const anchor =
              quotedText !== 'No quoted text'
                ? ` (anchored to: "${quotedText.substring(0, 100)}${quotedText.length > 100 ? '...' : ''}")`
                : '';

            let result = `\n${index + 1}. **${author}** (${date})${status}${anchor}\n   ${comment.content}`;

            if (replies > 0) {
              result += `\n   └─ ${replies} ${replies === 1 ? 'reply' : 'replies'}`;
            }

            result += `\n   Comment ID: ${comment.id}`;

            return result;
          })
          .join('\n');

        return `Found ${comments.length} comment${comments.length === 1 ? '' : 's'}:\n${formattedComments}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error listing comments: ${message}`);
        throw new UserError(`Failed to list comments: ${message}`);
      }
    },
  });

  // --- getComment ---
  server.addTool({
    name: 'getComment',
    description: 'Gets a specific comment with its full thread of replies.',
    annotations: {
      title: 'Get Comment',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      commentId: z.string().describe('The ID of the comment to retrieve'),
    }),
    execute: async (args, { log }) => {
      log.info(`Getting comment ${args.commentId} from document ${args.documentId}`);
      const driveClient = await getDriveClient(args.account);

      try {
        const response = await driveClient.comments.get({
          fileId: args.documentId,
          commentId: args.commentId,
          fields:
            'id,content,quotedFileContent,author,createdTime,resolved,replies(id,content,author,createdTime)',
        });

        const comment = response.data;
        const author = comment.author?.displayName || 'Unknown';
        const date = comment.createdTime
          ? new Date(comment.createdTime).toLocaleDateString()
          : 'Unknown date';
        const status = comment.resolved ? ' [RESOLVED]' : '';
        const quotedText = comment.quotedFileContent?.value || 'No quoted text';
        const anchor = quotedText !== 'No quoted text' ? `\nAnchored to: "${quotedText}"` : '';

        let result = `**${author}** (${date})${status}${anchor}\n${comment.content}`;

        // Add replies if any
        if (comment.replies && comment.replies.length > 0) {
          result += '\n\n**Replies:**';
          comment.replies.forEach((reply: DriveReply, index: number) => {
            const replyAuthor = reply.author?.displayName || 'Unknown';
            const replyDate = reply.createdTime
              ? new Date(reply.createdTime).toLocaleDateString()
              : 'Unknown date';
            result += `\n${index + 1}. **${replyAuthor}** (${replyDate})\n   ${reply.content}`;
          });
        }

        return result;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error getting comment: ${message}`);
        throw new UserError(`Failed to get comment: ${message}`);
      }
    },
  });

  // --- addComment ---
  server.addTool({
    name: 'addComment',
    description:
      'Adds a comment anchored to a specific text range in the document. NOTE: Due to Google API limitations, comments created programmatically appear in the "All Comments" list but are not visibly anchored to text in the document UI (they show "original content deleted"). However, replies, resolve, and delete operations work on all comments including manually-created ones.',
    annotations: {
      title: 'Add Comment',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      startIndex: z
        .number()
        .int()
        .min(1)
        .describe('The starting index of the text range (inclusive, starts from 1).'),
      endIndex: z.number().int().min(1).describe('The ending index of the text range (exclusive).'),
      commentText: z.string().min(1).describe('The content of the comment.'),
    }).refine((data) => data.endIndex > data.startIndex, {
      message: 'endIndex must be greater than startIndex',
      path: ['endIndex'],
    }),
    execute: async (args, { log }) => {
      log.info(
        `Adding comment to range ${args.startIndex}-${args.endIndex} in doc ${args.documentId}`
      );
      const docsClient = await getDocsClient(args.account);
      const driveClient = await getDriveClient(args.account);

      try {
        // First, get the text content that will be quoted
        const doc = await docsClient.documents.get({ documentId: args.documentId });

        // Extract the quoted text from the document
        let quotedText = '';
        const content = doc.data.body?.content || [];

        for (const element of content) {
          if (element.paragraph) {
            const elements = element.paragraph.elements || [];
            for (const textElement of elements) {
              if (textElement.textRun) {
                const elementStart = textElement.startIndex || 0;
                const elementEnd = textElement.endIndex || 0;

                // Check if this element overlaps with our range
                if (elementEnd > args.startIndex && elementStart < args.endIndex) {
                  const text = textElement.textRun.content || '';
                  const startOffset = Math.max(0, args.startIndex - elementStart);
                  const endOffset = Math.min(text.length, args.endIndex - elementStart);
                  quotedText += text.substring(startOffset, endOffset);
                }
              }
            }
          }
        }

        // Use Drive API v3 for comments
        const response = await driveClient.comments.create({
          fileId: args.documentId,
          fields: 'id,content,quotedFileContent,author,createdTime,resolved',
          requestBody: {
            content: args.commentText,
            quotedFileContent: {
              value: quotedText,
              mimeType: 'text/html',
            },
            anchor: JSON.stringify({
              r: args.documentId,
              a: [
                {
                  txt: {
                    o: args.startIndex - 1, // Drive API uses 0-based indexing
                    l: args.endIndex - args.startIndex,
                    ml: args.endIndex - args.startIndex,
                  },
                },
              ],
            }),
          },
        });

        return `Comment added successfully. Comment ID: ${response.data.id}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error adding comment: ${message}`);
        throw new UserError(`Failed to add comment: ${message}`);
      }
    },
  });

  // --- replyToComment ---
  server.addTool({
    name: 'replyToComment',
    description: 'Adds a reply to an existing comment.',
    annotations: {
      title: 'Reply to Comment',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      commentId: z.string().describe('The ID of the comment to reply to'),
      replyText: z.string().min(1).describe('The content of the reply'),
    }),
    execute: async (args, { log }) => {
      log.info(`Adding reply to comment ${args.commentId} in doc ${args.documentId}`);
      const driveClient = await getDriveClient(args.account);

      try {
        const response = await driveClient.replies.create({
          fileId: args.documentId,
          commentId: args.commentId,
          fields: 'id,content,author,createdTime',
          requestBody: {
            content: args.replyText,
          },
        });

        return `Reply added successfully. Reply ID: ${response.data.id}`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error adding reply: ${message}`);
        throw new UserError(`Failed to add reply: ${message}`);
      }
    },
  });

  // --- resolveComment ---
  server.addTool({
    name: 'resolveComment',
    description:
      'Marks a comment as resolved. NOTE: Due to Google API limitations, the Drive API does not support resolving comments on Google Docs files. This operation will attempt to update the comment but the resolved status may not persist in the UI. Comments can be resolved manually in the Google Docs interface.',
    annotations: {
      title: 'Resolve Comment',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      commentId: z.string().describe('The ID of the comment to resolve'),
    }),
    execute: async (args, { log }) => {
      log.info(`Resolving comment ${args.commentId} in doc ${args.documentId}`);
      const driveClient = await getDriveClient(args.account);

      try {
        // First, get the current comment content (required by the API)
        const currentComment = await driveClient.comments.get({
          fileId: args.documentId,
          commentId: args.commentId,
          fields: 'content',
        });

        // Update with both content and resolved status
        await driveClient.comments.update({
          fileId: args.documentId,
          commentId: args.commentId,
          fields: 'id,resolved',
          requestBody: {
            content: currentComment.data.content,
            resolved: true,
          },
        });

        // Verify the resolved status was set
        const verifyComment = await driveClient.comments.get({
          fileId: args.documentId,
          commentId: args.commentId,
          fields: 'resolved',
        });

        if (verifyComment.data.resolved) {
          return `Comment ${args.commentId} has been marked as resolved.`;
        } else {
          return `Attempted to resolve comment ${args.commentId}, but the resolved status may not persist in the Google Docs UI due to API limitations. The comment can be resolved manually in the Google Docs interface.`;
        }
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error resolving comment: ${message}`);
        const apiError = isGoogleApiError(error) ? error : null;
        const responseData = apiError?.response?.data as { error?: { message?: string; code?: number } } | undefined;
        const errorDetails = responseData?.error?.message || message;
        const errorCode = responseData?.error?.code;
        throw new UserError(
          `Failed to resolve comment: ${errorDetails}${errorCode ? ` (Code: ${errorCode})` : ''}`
        );
      }
    },
  });

  // --- deleteComment ---
  server.addTool({
    name: 'deleteComment',
    description: 'Deletes a comment from the document.',
    annotations: {
      title: 'Delete Comment',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      commentId: z.string().describe('The ID of the comment to delete'),
    }),
    execute: async (args, { log }) => {
      log.info(`Deleting comment ${args.commentId} from doc ${args.documentId}`);
      const driveClient = await getDriveClient(args.account);

      try {
        await driveClient.comments.delete({
          fileId: args.documentId,
          commentId: args.commentId,
        });

        return `Comment ${args.commentId} has been deleted.`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error deleting comment: ${message}`);
        throw new UserError(`Failed to delete comment: ${message}`);
      }
    },
  });

  // --- findElement ---
  server.addTool({
    name: 'findElement',
    description:
      'Finds elements (paragraphs, tables, etc.) based on various criteria. (Not Implemented)',
    annotations: {
      title: 'Find Element',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      // Define complex query parameters...
      textQuery: z.string().optional(),
      elementType: z.enum(['paragraph', 'table', 'list', 'image']).optional(),
      // styleQuery...
    }),
    execute: async (args, { log }) => {
      log.warn('findElement tool called but is not implemented.');
      throw new NotImplementedError('Finding elements by complex criteria is not yet implemented.');
    },
  });

  // --- formatMatchingText ---
  server.addTool({
    name: 'formatMatchingText',
    description:
      'Finds specific text within a Google Document and applies character formatting (bold, italics, color, etc.) to the specified instance.',
    annotations: {
      title: 'Format Matching Text',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
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
        documentId: z.string().describe('The ID of the Google Document.'),
        textToFind: z.string().min(1).describe('The exact text string to find and format.'),
        matchInstance: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(1)
          .describe('Which instance of the text to format (1st, 2nd, etc.). Defaults to 1.'),
        // Re-use optional Formatting Parameters (SHARED)
        bold: z.boolean().optional().describe('Apply bold formatting.'),
        italic: z.boolean().optional().describe('Apply italic formatting.'),
        underline: z.boolean().optional().describe('Apply underline formatting.'),
        strikethrough: z.boolean().optional().describe('Apply strikethrough formatting.'),
        fontSize: z.number().min(1).optional().describe('Set font size (in points, e.g., 12).'),
        fontFamily: z
          .string()
          .optional()
          .describe('Set font family (e.g., "Arial", "Times New Roman").'),
        foregroundColor: z
          .string()
          .refine((color) => /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color), {
            message: 'Invalid hex color format (e.g., #FF0000 or #F00)',
          })
          .optional()
          .describe('Set text color using hex format (e.g., "#FF0000").'),
        backgroundColor: z
          .string()
          .refine((color) => /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color), {
            message: 'Invalid hex color format (e.g., #00FF00 or #0F0)',
          })
          .optional()
          .describe('Set text background color using hex format (e.g., "#FFFF00").'),
        linkUrl: z
          .string()
          .url()
          .optional()
          .describe('Make the text a hyperlink pointing to this URL.'),
      })
      .refine(
        (data) =>
          Object.keys(data).some(
            (key) =>
              !['documentId', 'textToFind', 'matchInstance'].includes(key) &&
              data[key as keyof typeof data] !== undefined
          ),
        {
          message: 'At least one formatting option (bold, italic, fontSize, etc.) must be provided.',
        }
      ),
    execute: async (args, { log }) => {
      // Adapt to use the new applyTextStyle implementation under the hood
      const docs = await getDocsClient(args.account);
      log.info(
        `Using formatMatchingText (legacy) for doc ${args.documentId}, target: "${args.textToFind}" (instance ${args.matchInstance})`
      );

      try {
        // Extract the style parameters
        const styleParams: TextStyleArgs = {};
        if (args.bold !== undefined) styleParams.bold = args.bold;
        if (args.italic !== undefined) styleParams.italic = args.italic;
        if (args.underline !== undefined) styleParams.underline = args.underline;
        if (args.strikethrough !== undefined) styleParams.strikethrough = args.strikethrough;
        if (args.fontSize !== undefined) styleParams.fontSize = args.fontSize;
        if (args.fontFamily !== undefined) styleParams.fontFamily = args.fontFamily;
        if (args.foregroundColor !== undefined) styleParams.foregroundColor = args.foregroundColor;
        if (args.backgroundColor !== undefined) styleParams.backgroundColor = args.backgroundColor;
        if (args.linkUrl !== undefined) styleParams.linkUrl = args.linkUrl;

        // Find the text range
        const range = await GDocsHelpers.findTextRange(
          docs,
          args.documentId,
          args.textToFind,
          args.matchInstance
        );
        if (!range) {
          throw new UserError(
            `Could not find instance ${args.matchInstance} of text "${args.textToFind}".`
          );
        }

        // Build and execute the request
        const requestInfo = GDocsHelpers.buildUpdateTextStyleRequest(
          range.startIndex,
          range.endIndex,
          styleParams
        );
        if (!requestInfo) {
          return 'No valid text styling options were provided.';
        }

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [requestInfo.request]);
        return `Successfully applied formatting to instance ${args.matchInstance} of "${args.textToFind}".`;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(
          `Error in formatMatchingText for doc ${args.documentId}: ${message}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to format text: ${message}`);
      }
    },
  });
}
