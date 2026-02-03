/**
 * markdownDocs.tools.ts - Markdown-based Google Docs editing tools
 *
 * These tools provide a simplified interface for editing Google Docs using
 * Markdown syntax. They are designed for documents that contain only
 * markdown-compatible elements (text, headings, lists, tables, images, links).
 */

import { UserError } from 'fastmcp';
import { z } from 'zod';
import { type DocsToolOptions, AccountDocumentParameters } from '../types.js';
import { CompatibilityChecker, DocToMarkdown, MarkdownToDoc } from '../markdown/index.js';
import { isGoogleApiError, getErrorMessage } from '../errorHelpers.js';
import { getDocsUrl } from '../urlHelpers.js';

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

        // Execute the batch update
        if (result.requests.length > 0) {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests: result.requests,
            },
          });
        }

        const docLink = getDocsUrl(args.documentId, email);

        let output = `Successfully updated document "${document.title}".\n\n`;
        output += `Document ID: ${args.documentId}\n`;
        output += `View/Edit: ${docLink}\n\n`;
        output += `Applied ${result.requests.length} changes.\n\n`;
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
