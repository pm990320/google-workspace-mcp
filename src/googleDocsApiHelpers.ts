// src/googleDocsApiHelpers.ts
import { type docs_v1 } from 'googleapis';
import { UserError } from 'fastmcp';
import {
  type TextStyleArgs,
  type ParagraphStyleArgs,
  hexToRgbColor,
  type DocsClient,
  type StructuralElement,
  type ParagraphElement,
  type TableRow,
  type TableCell,
} from './types.js';
import { isGoogleApiError, getErrorMessage } from './errorHelpers.js';

// --- Constants ---
const MAX_BATCH_UPDATE_REQUESTS = 50; // Google API limits batch size

// --- Core Helper to Execute Batch Updates ---

/**
 * Execute a single batch update with error handling
 */
async function executeSingleBatch(
  docs: DocsClient,
  documentId: string,
  requests: docs_v1.Schema$Request[]
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  try {
    const response = await docs.documents.batchUpdate({
      documentId: documentId,
      requestBody: { requests },
    });
    return response.data;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const apiError = isGoogleApiError(error) ? error : null;
    const code = apiError?.code;
    const responseData = apiError?.response?.data;

    // Translate common API errors to UserErrors
    if (code === 400 && message.includes('Invalid requests')) {
      // Try to extract more specific info if available
      const errorResponse = responseData as
        | { error?: { details?: { description?: string }[] } }
        | undefined;
      const details = errorResponse?.error?.details;
      let detailMsg = '';
      if (details && Array.isArray(details)) {
        detailMsg = details.map((d) => d.description ?? JSON.stringify(d)).join('; ');
      }
      throw new UserError(
        `Invalid request sent to Google Docs API. Details: ${detailMsg || message}`
      );
    }
    if (code === 404) throw new UserError(`Document not found (ID: ${documentId}). Check the ID.`);
    if (code === 403)
      throw new UserError(
        `Permission denied for document (ID: ${documentId}). Ensure the authenticated user has edit access.`
      );
    // Generic internal error for others
    throw new Error(`Google API Error (${code}): ${message}`);
  }
}

/**
 * Execute batch updates, automatically splitting large request arrays into multiple batches.
 * Returns the combined response from all batches.
 */
export async function executeBatchUpdate(
  docs: DocsClient,
  documentId: string,
  requests: docs_v1.Schema$Request[]
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  if (requests.length === 0) {
    return {}; // Nothing to do
  }

  // If within limits, execute as single batch
  if (requests.length <= MAX_BATCH_UPDATE_REQUESTS) {
    return executeSingleBatch(docs, documentId, requests);
  }

  // Split into multiple batches and execute sequentially
  // Note: Sequential execution is required because document indices change after each batch

  const allReplies: docs_v1.Schema$Response[] = [];
  let lastDocumentId = documentId;

  for (let i = 0; i < requests.length; i += MAX_BATCH_UPDATE_REQUESTS) {
    const batch = requests.slice(i, i + MAX_BATCH_UPDATE_REQUESTS);
    const response = await executeSingleBatch(docs, documentId, batch);

    if (response.replies) {
      allReplies.push(...response.replies);
    }
    if (response.documentId) {
      lastDocumentId = response.documentId;
    }
  }

  return {
    documentId: lastDocumentId,
    replies: allReplies.length > 0 ? allReplies : undefined,
  };
}

// --- Text Finding Helper ---
// This improved version is more robust in handling various text structure scenarios
export async function findTextRange(
  docs: DocsClient,
  documentId: string,
  textToFind: string,
  instance = 1
): Promise<{ startIndex: number; endIndex: number } | null> {
  try {
    // Request more detailed information about the document structure
    const res = await docs.documents.get({
      documentId,
      // Request more fields to handle various container types (not just paragraphs)
      fields:
        'body(content(paragraph(elements(startIndex,endIndex,textRun(content))),table,sectionBreak,tableOfContents,startIndex,endIndex))',
    });

    if (!res.data.body?.content) {
      return null;
    }

    // More robust text collection and index tracking
    let fullText = '';
    const segments: { text: string; start: number; end: number }[] = [];

    // Process all content elements, including structural ones
    const collectTextFromContent = (content: StructuralElement[]) => {
      content.forEach((element) => {
        // Handle paragraph elements
        if (element.paragraph?.elements) {
          element.paragraph.elements.forEach((pe: ParagraphElement) => {
            if (
              pe.textRun?.content &&
              pe.startIndex !== null &&
              pe.startIndex !== undefined &&
              pe.endIndex !== null &&
              pe.endIndex !== undefined
            ) {
              const textContent = pe.textRun.content;
              fullText += textContent;
              segments.push({
                text: textContent,
                start: pe.startIndex,
                end: pe.endIndex,
              });
            }
          });
        }

        // Handle table elements - this is simplified and might need expansion
        if (element.table?.tableRows) {
          element.table.tableRows.forEach((row: TableRow) => {
            if (row.tableCells) {
              row.tableCells.forEach((cell: TableCell) => {
                if (cell.content) {
                  collectTextFromContent(cell.content);
                }
              });
            }
          });
        }

        // Add handling for other structural elements as needed
      });
    };

    collectTextFromContent(res.data.body.content);

    // Sort segments by starting position to ensure correct ordering
    segments.sort((a, b) => a.start - b.start);

    // Find the specified instance of the text
    let startIndex = -1;
    let endIndex = -1;
    let foundCount = 0;
    let searchStartIndex = 0;

    while (foundCount < instance) {
      const currentIndex = fullText.indexOf(textToFind, searchStartIndex);
      if (currentIndex === -1) {
        break;
      }

      foundCount++;

      if (foundCount === instance) {
        const targetStartInFullText = currentIndex;
        const targetEndInFullText = currentIndex + textToFind.length;
        let currentPosInFullText = 0;

        for (const seg of segments) {
          const segStartInFullText = currentPosInFullText;
          const segTextLength = seg.text.length;
          const segEndInFullText = segStartInFullText + segTextLength;

          // Map from reconstructed text position to actual document indices
          if (
            startIndex === -1 &&
            targetStartInFullText >= segStartInFullText &&
            targetStartInFullText < segEndInFullText
          ) {
            startIndex = seg.start + (targetStartInFullText - segStartInFullText);
          }

          if (targetEndInFullText > segStartInFullText && targetEndInFullText <= segEndInFullText) {
            endIndex = seg.start + (targetEndInFullText - segStartInFullText);
            break;
          }

          currentPosInFullText = segEndInFullText;
        }

        if (startIndex === -1 || endIndex === -1) {
          // Reset and try next occurrence
          startIndex = -1;
          endIndex = -1;
          searchStartIndex = currentIndex + 1;
          foundCount--;
          continue;
        }

        return { startIndex, endIndex };
      }

      // Prepare for next search iteration
      searchStartIndex = currentIndex + 1;
    }

    return null; // Instance not found or mapping failed for all attempts
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const code = isGoogleApiError(error) ? error.code : undefined;
    if (code === 404)
      throw new UserError(`Document not found while searching text (ID: ${documentId}).`);
    if (code === 403)
      throw new UserError(`Permission denied while searching text in doc ${documentId}.`);
    throw new Error(`Failed to retrieve doc for text searching: ${message}`);
  }
}

// --- Paragraph Boundary Helper ---
// Enhanced version to handle document structural elements more robustly
export async function getParagraphRange(
  docs: DocsClient,
  documentId: string,
  indexWithin: number
): Promise<{ startIndex: number; endIndex: number } | null> {
  try {
    // Request more detailed document structure to handle nested elements
    const res = await docs.documents.get({
      documentId,
      // Request more comprehensive structure information
      fields: 'body(content(startIndex,endIndex,paragraph,table,sectionBreak,tableOfContents))',
    });

    if (!res.data.body?.content) {
      return null;
    }

    // Find paragraph containing the index
    // We'll look at all structural elements recursively
    const findParagraphInContent = (
      content: StructuralElement[]
    ): { startIndex: number; endIndex: number } | null => {
      for (const element of content) {
        // Check if we have element boundaries defined (can be 0, so check both null and undefined)
        if (
          element.startIndex !== null &&
          element.startIndex !== undefined &&
          element.endIndex !== null &&
          element.endIndex !== undefined
        ) {
          // Check if index is within this element's range first
          if (indexWithin >= element.startIndex && indexWithin < element.endIndex) {
            // If it's a paragraph, we've found our target
            if (element.paragraph) {
              return {
                startIndex: element.startIndex,
                endIndex: element.endIndex,
              };
            }

            // If it's a table, we need to check cells recursively
            if (element.table?.tableRows) {
              for (const row of element.table.tableRows) {
                if (row.tableCells) {
                  for (const cell of row.tableCells) {
                    if (cell.content) {
                      const result = findParagraphInContent(cell.content);
                      if (result) return result;
                    }
                  }
                }
              }
            }
          }
        }
      }

      return null;
    };

    return findParagraphInContent(res.data.body.content);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const code = isGoogleApiError(error) ? error.code : undefined;
    if (code === 404)
      throw new UserError(`Document not found while finding paragraph (ID: ${documentId}).`);
    if (code === 403) throw new UserError(`Permission denied while accessing doc ${documentId}.`);
    throw new Error(`Failed to find paragraph: ${message}`);
  }
}

// --- Style Request Builders ---

export function buildUpdateTextStyleRequest(
  startIndex: number,
  endIndex: number,
  style: TextStyleArgs
): { request: docs_v1.Schema$Request; fields: string[] } | null {
  const textStyle: docs_v1.Schema$TextStyle = {};
  const fieldsToUpdate: string[] = [];

  if (style.bold !== undefined) {
    textStyle.bold = style.bold;
    fieldsToUpdate.push('bold');
  }
  if (style.italic !== undefined) {
    textStyle.italic = style.italic;
    fieldsToUpdate.push('italic');
  }
  if (style.underline !== undefined) {
    textStyle.underline = style.underline;
    fieldsToUpdate.push('underline');
  }
  if (style.strikethrough !== undefined) {
    textStyle.strikethrough = style.strikethrough;
    fieldsToUpdate.push('strikethrough');
  }
  if (style.fontSize !== undefined) {
    textStyle.fontSize = { magnitude: style.fontSize, unit: 'PT' };
    fieldsToUpdate.push('fontSize');
  }
  if (style.fontFamily !== undefined) {
    textStyle.weightedFontFamily = { fontFamily: style.fontFamily };
    fieldsToUpdate.push('weightedFontFamily');
  }
  if (style.foregroundColor !== undefined) {
    const rgbColor = hexToRgbColor(style.foregroundColor);
    if (!rgbColor)
      throw new UserError(`Invalid foreground hex color format: ${style.foregroundColor}`);
    textStyle.foregroundColor = { color: { rgbColor: rgbColor } };
    fieldsToUpdate.push('foregroundColor');
  }
  if (style.backgroundColor !== undefined) {
    const rgbColor = hexToRgbColor(style.backgroundColor);
    if (!rgbColor)
      throw new UserError(`Invalid background hex color format: ${style.backgroundColor}`);
    textStyle.backgroundColor = { color: { rgbColor: rgbColor } };
    fieldsToUpdate.push('backgroundColor');
  }
  if (style.linkUrl !== undefined) {
    textStyle.link = { url: style.linkUrl };
    fieldsToUpdate.push('link');
  }
  if (style.removeLink === true) {
    // To remove a link, we set link to an empty object and update the 'link' field
    textStyle.link = {};
    fieldsToUpdate.push('link');
  }

  if (fieldsToUpdate.length === 0) return null; // No styles to apply

  const request: docs_v1.Schema$Request = {
    updateTextStyle: {
      range: { startIndex, endIndex },
      textStyle: textStyle,
      fields: fieldsToUpdate.join(','),
    },
  };
  return { request, fields: fieldsToUpdate };
}

export function buildUpdateParagraphStyleRequest(
  startIndex: number,
  endIndex: number,
  style: ParagraphStyleArgs
): { request: docs_v1.Schema$Request; fields: string[] } | null {
  // Create style object and track which fields to update
  const paragraphStyle: docs_v1.Schema$ParagraphStyle = {};
  const fieldsToUpdate: string[] = [];

  // Process alignment option (LEFT, CENTER, RIGHT, JUSTIFIED)
  if (style.alignment !== undefined) {
    paragraphStyle.alignment = style.alignment;
    fieldsToUpdate.push('alignment');
  }

  // Process indentation options
  if (style.indentStart !== undefined) {
    paragraphStyle.indentStart = { magnitude: style.indentStart, unit: 'PT' };
    fieldsToUpdate.push('indentStart');
  }

  if (style.indentEnd !== undefined) {
    paragraphStyle.indentEnd = { magnitude: style.indentEnd, unit: 'PT' };
    fieldsToUpdate.push('indentEnd');
  }

  // Process spacing options
  if (style.spaceAbove !== undefined) {
    paragraphStyle.spaceAbove = { magnitude: style.spaceAbove, unit: 'PT' };
    fieldsToUpdate.push('spaceAbove');
  }

  if (style.spaceBelow !== undefined) {
    paragraphStyle.spaceBelow = { magnitude: style.spaceBelow, unit: 'PT' };
    fieldsToUpdate.push('spaceBelow');
  }

  // Process named style types (headings, etc.)
  if (style.namedStyleType !== undefined) {
    paragraphStyle.namedStyleType = style.namedStyleType;
    fieldsToUpdate.push('namedStyleType');
  }

  // Process page break control
  if (style.keepWithNext !== undefined) {
    paragraphStyle.keepWithNext = style.keepWithNext;
    fieldsToUpdate.push('keepWithNext');
  }

  // Verify we have styles to apply
  if (fieldsToUpdate.length === 0) {
    return null; // No styles to apply
  }

  // Build the request object
  const request: docs_v1.Schema$Request = {
    updateParagraphStyle: {
      range: { startIndex, endIndex },
      paragraphStyle: paragraphStyle,
      fields: fieldsToUpdate.join(','),
    },
  };

  return { request, fields: fieldsToUpdate };
}

// --- Specific Feature Helpers ---

export async function createTable(
  docs: DocsClient,
  documentId: string,
  rows: number,
  columns: number,
  index: number
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  if (rows < 1 || columns < 1) {
    throw new UserError('Table must have at least 1 row and 1 column.');
  }
  const request: docs_v1.Schema$Request = {
    insertTable: {
      location: { index },
      rows: rows,
      columns: columns,
    },
  };
  return executeBatchUpdate(docs, documentId, [request]);
}

/**
 * Find a table cell's content range by navigating the document structure
 * @param docs - Google Docs API client
 * @param documentId - The document ID
 * @param tableStartIndex - The start index of the table element
 * @param rowIndex - 0-based row index
 * @param columnIndex - 0-based column index
 * @returns Object with startIndex and endIndex of the cell's content, or null if not found
 */
export async function findTableCellRange(
  docs: DocsClient,
  documentId: string,
  tableStartIndex: number,
  rowIndex: number,
  columnIndex: number
): Promise<{ startIndex: number; endIndex: number } | null> {
  const response = await docs.documents.get({ documentId });
  const document = response.data;
  const body = document.body;

  if (!body?.content) {
    throw new UserError('Document has no content');
  }

  // Find the table at the given start index
  for (const element of body.content) {
    if (element.table && element.startIndex === tableStartIndex) {
      const table = element.table;
      const rows = table.tableRows;

      if (!rows || rows.length === 0) {
        throw new UserError('Table has no rows');
      }

      if (rowIndex < 0 || rowIndex >= rows.length) {
        throw new UserError(
          `Row index ${rowIndex} out of bounds. Table has ${rows.length} rows (0-${rows.length - 1}).`
        );
      }

      const row = rows[rowIndex];
      const cells = row.tableCells;

      if (!cells || cells.length === 0) {
        throw new UserError(`Row ${rowIndex} has no cells`);
      }

      if (columnIndex < 0 || columnIndex >= cells.length) {
        throw new UserError(
          `Column index ${columnIndex} out of bounds. Row has ${cells.length} columns (0-${cells.length - 1}).`
        );
      }

      const cell = cells[columnIndex];
      const cellContent = cell.content;

      if (!cellContent || cellContent.length === 0) {
        throw new UserError(`Cell (${rowIndex}, ${columnIndex}) has no content`);
      }

      // Find the content range of the cell
      // Cell content is an array of structural elements (usually paragraphs)
      const firstElement = cellContent[0];
      const lastElement = cellContent[cellContent.length - 1];

      const startIndex = firstElement.startIndex ?? 0;
      const endIndex = lastElement.endIndex ?? startIndex;

      return { startIndex, endIndex };
    }
  }

  throw new UserError(
    `No table found at index ${tableStartIndex}. Use readGoogleDoc to find table locations.`
  );
}

/**
 * Edit the content of a specific table cell
 * @param docs - Google Docs API client
 * @param documentId - The document ID
 * @param tableStartIndex - The start index of the table element
 * @param rowIndex - 0-based row index
 * @param columnIndex - 0-based column index
 * @param newContent - New text content for the cell (replaces existing content)
 * @returns Batch update response
 */
export async function editTableCellContent(
  docs: DocsClient,
  documentId: string,
  tableStartIndex: number,
  rowIndex: number,
  columnIndex: number,
  newContent: string
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  const cellRange = await findTableCellRange(
    docs,
    documentId,
    tableStartIndex,
    rowIndex,
    columnIndex
  );

  if (!cellRange) {
    throw new UserError(`Could not find cell at (${rowIndex}, ${columnIndex})`);
  }

  const requests: docs_v1.Schema$Request[] = [];

  // Delete existing content (but leave the cell structure - delete content inside the cell)
  // The cell always has at least one paragraph, so we need to be careful
  // We delete from startIndex to endIndex-1 (leave the trailing newline that marks end of cell paragraph)
  const deleteEndIndex = cellRange.endIndex - 1; // Keep the newline at the end
  if (deleteEndIndex > cellRange.startIndex) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: cellRange.startIndex,
          endIndex: deleteEndIndex,
        },
      },
    });
  }

  // Insert new content at the start of the cell
  if (newContent) {
    requests.push({
      insertText: {
        location: { index: cellRange.startIndex },
        text: newContent,
      },
    });
  }

  if (requests.length === 0) {
    return {}; // Nothing to do
  }

  return executeBatchUpdate(docs, documentId, requests);
}

/**
 * Find all tables in a document and return their locations and dimensions
 * @param docs - Google Docs API client
 * @param documentId - The document ID
 * @returns Array of table info objects
 */
export async function findDocumentTables(
  docs: DocsClient,
  documentId: string
): Promise<
  Array<{
    startIndex: number;
    endIndex: number;
    rows: number;
    columns: number;
  }>
> {
  const response = await docs.documents.get({ documentId });
  const document = response.data;
  const body = document.body;

  if (!body?.content) {
    return [];
  }

  const tables: Array<{
    startIndex: number;
    endIndex: number;
    rows: number;
    columns: number;
  }> = [];

  for (const element of body.content) {
    if (element.table) {
      const table = element.table;
      const rows = table.tableRows ?? [];
      const columns = rows.length > 0 ? (rows[0].tableCells?.length ?? 0) : 0;

      tables.push({
        startIndex: element.startIndex ?? 0,
        endIndex: element.endIndex ?? 0,
        rows: rows.length,
        columns: columns,
      });
    }
  }

  return tables;
}

export async function insertText(
  docs: DocsClient,
  documentId: string,
  text: string,
  index: number
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  if (!text) return {}; // Nothing to insert
  const request: docs_v1.Schema$Request = {
    insertText: {
      location: { index },
      text: text,
    },
  };
  return executeBatchUpdate(docs, documentId, [request]);
}

// --- Complex / Stubbed Helpers ---

/** Style criteria for finding paragraphs */
export interface StyleCriteria {
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
}

export async function findParagraphsMatchingStyle(
  docs: DocsClient,
  documentId: string,
  styleCriteria: StyleCriteria
): Promise<{ startIndex: number; endIndex: number }[]> {
  // Get document content
  const response = await docs.documents.get({ documentId });
  const document = response.data;
  const body = document.body;

  if (!body?.content) {
    return [];
  }

  const matchingRanges: { startIndex: number; endIndex: number }[] = [];

  // Helper to check if a text style matches criteria
  function styleMatches(textStyle: docs_v1.Schema$TextStyle | undefined): boolean {
    if (!textStyle) return false;

    if (styleCriteria.bold !== undefined && textStyle.bold !== styleCriteria.bold) {
      return false;
    }
    if (styleCriteria.italic !== undefined && textStyle.italic !== styleCriteria.italic) {
      return false;
    }
    if (styleCriteria.fontFamily !== undefined) {
      const fontFamily = textStyle.weightedFontFamily?.fontFamily;
      if (fontFamily !== styleCriteria.fontFamily) {
        return false;
      }
    }
    if (styleCriteria.fontSize !== undefined) {
      const fontSize = textStyle.fontSize?.magnitude;
      if (fontSize !== styleCriteria.fontSize) {
        return false;
      }
    }
    return true;
  }

  // Iterate through structural elements to find paragraphs
  for (const element of body.content) {
    if (element.paragraph) {
      const paragraph = element.paragraph;
      const startIdx = element.startIndex ?? 0;
      const endIdx = element.endIndex ?? startIdx;

      // Check if any text run in this paragraph matches the criteria
      let paragraphMatches = false;
      if (paragraph.elements) {
        for (const paraElement of paragraph.elements) {
          if (paraElement.textRun?.textStyle) {
            if (styleMatches(paraElement.textRun.textStyle)) {
              paragraphMatches = true;
              break;
            }
          }
        }
      }

      if (paragraphMatches) {
        matchingRanges.push({ startIndex: startIdx, endIndex: endIdx });
      }
    }
  }

  return matchingRanges;
}

/** Pattern info for list detection */
interface ListPattern {
  regex: RegExp;
  bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' | 'NUMBERED_DECIMAL_ALPHA_ROMAN';
}

const LIST_PATTERNS: ListPattern[] = [
  // Bullet patterns: -, *, •
  { regex: /^[\s]*[-*•]\s+/, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' },
  // Numbered patterns: 1. 2. etc
  { regex: /^[\s]*\d+[.)]\s+/, bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' },
  // Letter patterns: a) b) A) B)
  { regex: /^[\s]*[a-zA-Z][.)]\s+/, bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN' },
];

export async function detectAndFormatLists(
  docs: DocsClient,
  documentId: string,
  startIndex?: number,
  endIndex?: number
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  // Get document content
  const response = await docs.documents.get({ documentId });
  const document = response.data;
  const body = document.body;

  if (!body?.content) {
    return {};
  }

  const requests: docs_v1.Schema$Request[] = [];

  // Track paragraphs that look like list items
  interface PotentialListItem {
    startIndex: number;
    endIndex: number;
    markerEndIndex: number; // Where the marker text ends (to delete it later)
    bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' | 'NUMBERED_DECIMAL_ALPHA_ROMAN';
  }

  const potentialListItems: PotentialListItem[] = [];

  // Iterate through structural elements to find paragraphs
  for (const element of body.content) {
    if (!element.paragraph) continue;

    const paraStart = element.startIndex ?? 0;
    const paraEnd = element.endIndex ?? paraStart;

    // Skip if outside specified range
    if (startIndex !== undefined && paraEnd < startIndex) continue;
    if (endIndex !== undefined && paraStart > endIndex) continue;

    // Skip paragraphs that are already in a list
    if (element.paragraph.bullet) continue;

    // Get the text content of the paragraph
    let paragraphText = '';
    if (element.paragraph.elements) {
      for (const paraElement of element.paragraph.elements) {
        if (paraElement.textRun?.content) {
          paragraphText += paraElement.textRun.content;
        }
      }
    }

    // Check if the paragraph starts with a list marker
    for (const pattern of LIST_PATTERNS) {
      const match = pattern.regex.exec(paragraphText);
      if (match) {
        potentialListItems.push({
          startIndex: paraStart,
          endIndex: paraEnd,
          markerEndIndex: paraStart + match[0].length,
          bulletPreset: pattern.bulletPreset,
        });
        break; // Only match one pattern per paragraph
      }
    }
  }

  if (potentialListItems.length === 0) {
    return {}; // No list items detected
  }

  // Group consecutive paragraphs with the same bullet type into lists
  // For now, just apply bullets to each detected item
  // Process in reverse order to maintain correct indices when deleting markers
  const sortedItems = [...potentialListItems].sort((a, b) => b.startIndex - a.startIndex);

  for (const item of sortedItems) {
    // First, delete the marker text
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: item.startIndex,
          endIndex: item.markerEndIndex,
        },
      },
    });

    // Then create the bullet
    // Note: After deletion, the paragraph range shifts, but createParagraphBullets
    // works on paragraph boundaries, so we use the original start index
    requests.push({
      createParagraphBullets: {
        range: {
          startIndex: item.startIndex,
          endIndex: item.startIndex + 1, // Just needs to touch the paragraph
        },
        bulletPreset: item.bulletPreset,
      },
    });
  }

  // Reverse to get correct execution order (Google Docs processes requests in order)
  requests.reverse();

  return executeBatchUpdate(docs, documentId, requests);
}

// --- Image Insertion Helpers ---

/**
 * Inserts an inline image into a document from a publicly accessible URL
 * @param docs - Google Docs API client
 * @param documentId - The document ID
 * @param imageUrl - Publicly accessible URL to the image
 * @param index - Position in the document where image should be inserted (1-based)
 * @param width - Optional width in points
 * @param height - Optional height in points
 * @returns Promise with batch update response
 */
export async function insertInlineImage(
  docs: DocsClient,
  documentId: string,
  imageUrl: string,
  index: number,
  width?: number,
  height?: number
): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
  // Validate URL format
  try {
    new URL(imageUrl);
  } catch {
    throw new UserError(`Invalid image URL format: ${imageUrl}`);
  }

  // Build the insertInlineImage request
  const request: docs_v1.Schema$Request = {
    insertInlineImage: {
      location: { index },
      uri: imageUrl,
      ...(width &&
        height && {
          objectSize: {
            height: { magnitude: height, unit: 'PT' },
            width: { magnitude: width, unit: 'PT' },
          },
        }),
    },
  };

  return executeBatchUpdate(docs, documentId, [request]);
}

/**
 * Uploads a local image file to Google Drive and returns its public URL
 * @param drive - Google Drive API client
 * @param localFilePath - Path to the local image file
 * @param parentFolderId - Optional parent folder ID (defaults to root)
 * @returns Promise with the public webContentLink URL
 */
export async function uploadImageToDrive(
  drive: import('googleapis').drive_v3.Drive,
  localFilePath: string,
  parentFolderId?: string
): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');

  // Verify file exists
  if (!fs.existsSync(localFilePath)) {
    throw new UserError(`Image file not found: ${localFilePath}`);
  }

  // Get file name and mime type
  const fileName = path.basename(localFilePath);
  const mimeTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };

  const ext = path.extname(localFilePath).toLowerCase();
  // eslint-disable-next-line security/detect-object-injection -- ext is from path.extname, limited to known file extensions
  const mimeType = mimeTypeMap[ext] || 'application/octet-stream';

  // Upload file to Drive
  const fileMetadata: import('googleapis').drive_v3.Schema$File = {
    name: fileName,
    mimeType: mimeType,
  };

  if (parentFolderId) {
    fileMetadata.parents = [parentFolderId];
  }

  const media = {
    mimeType: mimeType,
    body: fs.createReadStream(localFilePath),
  };

  const uploadResponse = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id,webViewLink,webContentLink',
  });

  const fileId = uploadResponse.data.id;
  if (!fileId) {
    throw new Error('Failed to upload image to Drive - no file ID returned');
  }

  // Make the file publicly readable
  await drive.permissions.create({
    fileId: fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  // Get the webContentLink
  const fileInfo = await drive.files.get({
    fileId: fileId,
    fields: 'webContentLink',
  });

  const webContentLink = fileInfo.data.webContentLink;
  if (!webContentLink) {
    throw new Error('Failed to get public URL for uploaded image');
  }

  return webContentLink;
}

// --- Tab Management Helpers ---

/**
 * Interface for a tab with hierarchy level information
 */
export interface TabWithLevel extends docs_v1.Schema$Tab {
  level: number;
}

/**
 * Recursively collect all tabs from a document in a flat list with hierarchy info
 * @param doc - The Google Doc document object
 * @returns Array of tabs with nesting level information
 */
export function getAllTabs(doc: docs_v1.Schema$Document): TabWithLevel[] {
  const allTabs: TabWithLevel[] = [];
  if (!doc.tabs || doc.tabs.length === 0) {
    return allTabs;
  }

  for (const tab of doc.tabs) {
    addCurrentAndChildTabs(tab, allTabs, 0);
  }
  return allTabs;
}

/**
 * Recursive helper to add tabs with their nesting level
 * @param tab - The tab to add
 * @param allTabs - The accumulator array
 * @param level - Current nesting level (0 for top-level)
 */
function addCurrentAndChildTabs(
  tab: docs_v1.Schema$Tab,
  allTabs: TabWithLevel[],
  level: number
): void {
  allTabs.push({ ...tab, level });
  if (tab.childTabs && tab.childTabs.length > 0) {
    for (const childTab of tab.childTabs) {
      addCurrentAndChildTabs(childTab, allTabs, level + 1);
    }
  }
}

/**
 * Get the text length from a DocumentTab
 * @param documentTab - The DocumentTab object
 * @returns Total character count
 */
export function getTabTextLength(documentTab: docs_v1.Schema$DocumentTab | undefined): number {
  let totalLength = 0;

  if (!documentTab?.body?.content) {
    return 0;
  }

  documentTab.body.content.forEach((element: StructuralElement) => {
    // Handle paragraphs
    if (element.paragraph?.elements) {
      element.paragraph.elements.forEach((pe: ParagraphElement) => {
        if (pe.textRun?.content) {
          totalLength += pe.textRun.content.length;
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
                totalLength += pe.textRun.content.length;
              }
            });
          });
        });
      });
    }
  });

  return totalLength;
}

/**
 * Find a specific tab by ID in a document (searches recursively through child tabs)
 * @param doc - The Google Doc document object
 * @param tabId - The tab ID to search for
 * @returns The tab object if found, null otherwise
 */
export function findTabById(
  doc: docs_v1.Schema$Document,
  tabId: string
): docs_v1.Schema$Tab | null {
  if (!doc.tabs || doc.tabs.length === 0) {
    return null;
  }

  // Helper function to search through tabs recursively
  const searchTabs = (tabs: docs_v1.Schema$Tab[]): docs_v1.Schema$Tab | null => {
    for (const tab of tabs) {
      if (tab.tabProperties?.tabId === tabId) {
        return tab;
      }
      // Recursively search child tabs
      if (tab.childTabs && tab.childTabs.length > 0) {
        const found = searchTabs(tab.childTabs);
        if (found) return found;
      }
    }
    return null;
  };

  return searchTabs(doc.tabs);
}
