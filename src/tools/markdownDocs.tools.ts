/**
 * markdownDocs.tools.ts - Markdown-based Google Docs editing tools
 *
 * These tools provide a simplified interface for editing Google Docs using
 * Markdown syntax. They are designed for documents that contain only
 * markdown-compatible elements (text, headings, lists, tables, images, links).
 */

import { UserError } from 'fastmcp';
import { z } from 'zod';
import { type docs_v1 } from 'googleapis';
import { type DocsToolOptions, AccountDocumentParameters } from '../types.js';
import { CompatibilityChecker, DocToMarkdown, MarkdownToDoc } from '../markdown/index.js';
import { type TableInsertionInfo, type Request } from '../markdown/types.js';
import { isGoogleApiError, getErrorMessage } from '../errorHelpers.js';
import { getDocsUrl } from '../urlHelpers.js';

/**
 * Helper to populate table cells after tables have been created
 * This is the second pass of the two-pass table insertion approach
 */
function populateTableCells(
  document: docs_v1.Schema$Document,
  tables: TableInsertionInfo[],
  log: { info: (msg: string) => void }
): Request[] {
  const requests: Request[] = [];
  const body = document.body;

  if (!body?.content) {
    return requests;
  }

  // Find all tables in the document
  const docTables: Array<{
    startIndex: number;
    rows: docs_v1.Schema$TableRow[];
  }> = [];

  for (const element of body.content) {
    if (element.table && typeof element.startIndex === 'number') {
      docTables.push({
        startIndex: element.startIndex,
        rows: element.table.tableRows || [],
      });
    }
  }

  log.info(`Found ${docTables.length} table(s) in document`);

  // Match tables by order (since we insert in order, they should align)
  // For each table we need to populate, find the corresponding doc table
  for (let tableIdx = 0; tableIdx < tables.length; tableIdx++) {
    const tableInfo = tables[tableIdx];

    if (tableIdx >= docTables.length) {
      log.info(`Warning: Could not find table ${tableIdx + 1} in document`);
      continue;
    }

    const docTable = docTables[tableIdx];

    // Populate each cell - we need to insert in REVERSE order
    // because insertions shift subsequent indices
    const cellInserts: Array<{
      index: number;
      text: string;
    }> = [];

    for (let rowIdx = 0; rowIdx < tableInfo.rows; rowIdx++) {
      if (rowIdx >= docTable.rows.length) continue;

      const docRow = docTable.rows[rowIdx];
      const cells = docRow.tableCells || [];

      for (let colIdx = 0; colIdx < tableInfo.columns; colIdx++) {
        if (colIdx >= cells.length) continue;

        const docCell = cells[colIdx];
        const cellContent = tableInfo.cellContent[rowIdx]?.[colIdx] || '';

        // Skip empty cells
        if (!cellContent.trim()) continue;

        // Find the cell's content start index
        // Each cell has content array with paragraph(s)
        if (docCell.content && docCell.content.length > 0) {
          const firstParagraph = docCell.content[0];
          const cellStartIndex = firstParagraph.startIndex;

          if (typeof cellStartIndex === 'number') {
            cellInserts.push({
              index: cellStartIndex,
              text: cellContent,
            });
          }
        }
      }
    }

    // Sort by index descending so we insert from end to beginning
    // This way indices don't shift for earlier insertions
    cellInserts.sort((a, b) => b.index - a.index);

    for (const insert of cellInserts) {
      requests.push({
        insertText: {
          location: { index: insert.index },
          text: insert.text,
        },
      });
    }
  }

  return requests;
}

export function registerMarkdownDocsTools(options: DocsToolOptions) {
  const { server, getDocsClient, getAccountEmail } = options;

  // --- readDocAsMarkdown ---
  server.addTool({
    name: 'readDocAsMarkdown',
    description: `Read a Google Doc as Markdown for simplified editing.

This tool converts a Google Doc to Markdown format, making it easy to understand and edit the document structure. The output includes line numbers for reference when making edits.

**Supported elements:** Headings, paragraphs, bold, italic, strikethrough, links, bullet lists, numbered lists, tables, inline images, horizontal rules.

**Incompatible elements:** If the document contains equations, footnotes, comments, suggestions, drawings, @mentions, smart chips, headers/footers, or merged table cells, this tool will return an error explaining the incompatibility. Use readGoogleDoc instead for such documents.

**Use case:** Ideal for text-heavy documents where you want to make edits using familiar Markdown syntax.`,
    annotations: {
      title: 'Read Doc as Markdown',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      includeLineNumbers: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include line numbers in output for easier editing references. Default: true.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Reading Google Doc as Markdown: ${args.documentId}`);

      try {
        // Fetch the full document
        const res = await docs.documents.get({
          documentId: args.documentId,
        });

        const document = res.data;
        log.info(`Fetched doc: ${document.title}`);

        // Check compatibility
        const checker = new CompatibilityChecker();
        const compatibility = checker.check(document);

        if (!compatibility.compatible) {
          const errorMessage = CompatibilityChecker.formatIssues(compatibility.issues);
          throw new UserError(errorMessage);
        }

        // Convert to Markdown
        const converter = new DocToMarkdown();
        const result = converter.convert(document, {
          includeLineNumbers: args.includeLineNumbers,
        });

        const docLink = getDocsUrl(args.documentId, email);

        let output = `# ${document.title || 'Untitled Document'}\n\n`;
        output += `Document ID: ${args.documentId}\n`;
        output += `View/Edit: ${docLink}\n\n`;
        output += '---\n\n';
        output += result.markdown;
        output += '\n\n---\n';
        output +=
          '\nTo edit this document, use writeDocAsMarkdown with the updated Markdown content.';

        return output;
      } catch (error: unknown) {
        if (error instanceof UserError) throw error;
        const message = getErrorMessage(error);
        log.error(`Error reading doc as Markdown: ${message}`);
        const apiError = isGoogleApiError(error) ? error : null;
        const code = apiError?.code;
        if (code === 404) throw new UserError(`Document not found (ID: ${args.documentId}).`);
        if (code === 403)
          throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
        throw new UserError(`Failed to read document as Markdown: ${message}`);
      }
    },
  });

  // --- writeDocAsMarkdown ---
  server.addTool({
    name: 'writeDocAsMarkdown',
    description: `Replace a Google Doc's content with Markdown.

This tool takes Markdown content and replaces the entire document content with the converted result. It's designed for bulk editing where you want to rewrite significant portions of a document.

**Supported Markdown:**
- Headings: # H1, ## H2, through ###### H6
- Text formatting: **bold**, *italic*, ~~strikethrough~~, \`code\`
- Links: [text](url)
- Lists: - bullet items, 1. numbered items (including nested)
- Tables: | A | B | with |---|---| separator
- Images: ![alt](url)
- Horizontal rules: ---
- Code blocks: \`\`\`code\`\`\`
- Blockquotes: > quoted text

**Important:** This replaces ALL document content. The document must be markdown-compatible (no equations, footnotes, comments, etc.). Use readDocAsMarkdown first to check compatibility.

**Use case:** Ideal for rewriting drafts, updating documentation, or making comprehensive edits.`,
    annotations: {
      title: 'Write Doc as Markdown',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters.extend({
      markdown: z
        .string()
        .min(1)
        .describe(
          'The Markdown content to write to the document. This will replace all existing content.'
        ),
      confirmReplace: z
        .boolean()
        .describe(
          'Must be set to true to confirm replacing all document content. This is a safety check.'
        ),
    }),
    execute: async (args, { log }) => {
      if (!args.confirmReplace) {
        throw new UserError(
          'You must set confirmReplace to true to replace document content. ' +
            'This will delete all existing content and replace it with the provided Markdown.'
        );
      }

      const docs = await getDocsClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Writing Markdown to Google Doc: ${args.documentId}`);

      try {
        // First, fetch the document to check compatibility and get current state
        const res = await docs.documents.get({
          documentId: args.documentId,
        });

        const document = res.data;
        log.info(`Fetched doc: ${document.title}`);

        // Check compatibility
        const checker = new CompatibilityChecker();
        const compatibility = checker.check(document);

        if (!compatibility.compatible) {
          const errorMessage = CompatibilityChecker.formatIssues(compatibility.issues);
          throw new UserError('Cannot write to this document as Markdown.\n\n' + errorMessage);
        }

        // Get the current document end index
        const body = document.body;
        let endIndex = 1;
        if (body?.content && body.content.length > 0) {
          const lastElement = body.content[body.content.length - 1];
          endIndex = lastElement.endIndex ?? 1;
        }

        log.info(`Document end index: ${endIndex}`);

        // Convert Markdown to Docs requests
        const converter = new MarkdownToDoc();
        const result = converter.convert(args.markdown, { fullReplace: true }, endIndex);

        log.info(`Generated ${result.requests.length} API requests`);

        // Execute the batch update (first pass - creates structure including empty tables)
        if (result.requests.length > 0) {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: result.requests,
            },
          });
        }

        // Second pass: populate table cells if any tables were inserted
        let tableRequestCount = 0;
        if (result.tables.length > 0) {
          log.info(`Populating ${result.tables.length} table(s) with content`);

          // Re-fetch the document to get actual table cell indices
          const updatedDoc = await docs.documents.get({
            documentId: args.documentId,
          });

          const tablePopulateRequests = populateTableCells(updatedDoc.data, result.tables, log);

          if (tablePopulateRequests.length > 0) {
            await docs.documents.batchUpdate({
              documentId: args.documentId,
              requestBody: {
                requests: tablePopulateRequests,
              },
            });
            tableRequestCount = tablePopulateRequests.length;
          }
        }

        const docLink = getDocsUrl(args.documentId, email);

        let output = `Successfully updated document "${document.title}".\n\n`;
        output += `Document ID: ${args.documentId}\n`;
        output += `View/Edit: ${docLink}\n\n`;
        const totalRequests = result.requests.length + tableRequestCount;
        output += `Applied ${totalRequests} changes`;
        if (result.tables.length > 0) {
          output += ` (including ${result.tables.length} table(s))`;
        }
        output += '.\n\n';
        output += 'Note: Review the document in Google Docs to verify the formatting is correct.';

        return output;
      } catch (error: unknown) {
        if (error instanceof UserError) throw error;
        const message = getErrorMessage(error);
        log.error(`Error writing Markdown to doc: ${message}`);
        const apiError = isGoogleApiError(error) ? error : null;
        const code = apiError?.code;
        if (code === 404) throw new UserError(`Document not found (ID: ${args.documentId}).`);
        if (code === 403)
          throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
        throw new UserError(`Failed to write Markdown to document: ${message}`);
      }
    },
  });

  // --- checkDocMarkdownCompatibility ---
  server.addTool({
    name: 'checkDocMarkdownCompatibility',
    description: `Check if a Google Doc can be edited using Markdown tools.

This tool analyzes a document and reports whether it's compatible with the Markdown editing tools (readDocAsMarkdown, writeDocAsMarkdown).

Use this before attempting Markdown operations on a document you're unsure about.`,
    annotations: {
      title: 'Check Markdown Compatibility',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: AccountDocumentParameters,
    execute: async (args, { log }) => {
      const docs = await getDocsClient(args.account);
      const email = await getAccountEmail(args.account);
      log.info(`Checking Markdown compatibility: ${args.documentId}`);

      try {
        const res = await docs.documents.get({
          documentId: args.documentId,
        });

        const document = res.data;
        log.info(`Fetched doc: ${document.title}`);

        const checker = new CompatibilityChecker();
        const compatibility = checker.check(document);

        const docLink = getDocsUrl(args.documentId, email);

        let output = '# Markdown Compatibility Check\n\n';
        output += `**Document:** ${document.title}\n`;
        output += `**ID:** ${args.documentId}\n`;
        output += `**Link:** ${docLink}\n\n`;

        if (compatibility.compatible) {
          output += '✅ **Compatible with Markdown editing**\n\n';
          output += 'This document can be read and written using the Markdown tools:\n';
          output += '- Use `readDocAsMarkdown` to get the content as Markdown\n';
          output += '- Use `writeDocAsMarkdown` to update the content\n';
        } else {
          output += '❌ **Not compatible with Markdown editing**\n\n';
          output += CompatibilityChecker.formatIssues(compatibility.issues);
        }

        return output;
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        log.error(`Error checking compatibility: ${message}`);
        const apiError = isGoogleApiError(error) ? error : null;
        const code = apiError?.code;
        if (code === 404) throw new UserError(`Document not found (ID: ${args.documentId}).`);
        if (code === 403)
          throw new UserError(`Permission denied for document (ID: ${args.documentId}).`);
        throw new UserError(`Failed to check document compatibility: ${message}`);
      }
    },
  });
}
