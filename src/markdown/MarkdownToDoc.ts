/**
 * MarkdownToDoc - Converts Markdown to Google Docs API requests
 *
 * This class parses markdown and generates the Google Docs API batch update
 * requests needed to create the equivalent document structure.
 */

import {
  type Request,
  type MarkdownToDocOptions,
  type MarkdownToDocResult,
  MarkdownElementType,
  type MarkdownElement,
  type InlineFormat,
} from './types.js';

// Named style types for headings
const HEADING_STYLES = [
  'NORMAL_TEXT',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'HEADING_4',
  'HEADING_5',
  'HEADING_6',
] as const;

export class MarkdownToDoc {
  /**
   * Convert markdown to Google Docs API requests
   *
   * For full replacement, this generates requests that:
   * 1. Delete all existing content
   * 2. Insert new content with appropriate formatting
   *
   * @param markdown The markdown string to convert
   * @param options Conversion options
   * @param documentEndIndex The current end index of the document (for deletion)
   */
  convert(
    markdown: string,
    options: MarkdownToDocOptions = {},
    documentEndIndex = 1
  ): MarkdownToDocResult {
    const requests: Request[] = [];

    // For full replacement, first delete existing content
    if (options.fullReplace && documentEndIndex > 1) {
      requests.push({
        deleteContentRange: {
          range: {
            startIndex: 1,
            endIndex: documentEndIndex - 1, // Keep the final newline
          },
        },
      });
    }

    // Parse markdown into elements
    const elements = this.parseMarkdown(markdown);

    // Generate insert requests
    // We insert at index 1 and build up the document
    // Text is inserted, then formatting is applied

    let currentIndex = 1;
    const formattingRequests: Request[] = [];
    const paragraphStyleRequests: Request[] = [];

    for (const element of elements) {
      const result = this.convertElement(element, currentIndex);
      if (result.insertRequest) {
        requests.push(result.insertRequest);
      }
      formattingRequests.push(...result.formattingRequests);
      paragraphStyleRequests.push(...result.paragraphStyleRequests);
      currentIndex += result.textLength;
    }

    // Apply paragraph styles after all text is inserted
    requests.push(...paragraphStyleRequests);

    // Apply text formatting after paragraph styles
    requests.push(...formattingRequests);

    return { requests };
  }

  /**
   * Parse markdown into structured elements
   */
  parseMarkdown(markdown: string): MarkdownElement[] {
    const elements: MarkdownElement[] = [];
    const lines = markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        elements.push({ type: MarkdownElementType.HORIZONTAL_RULE, content: '' });
        i++;
        continue;
      }

      // Heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        elements.push({
          type: MarkdownElementType.HEADING,
          level: headingMatch[1].length,
          content: headingMatch[2],
        });
        i++;
        continue;
      }

      // Image (on its own line)
      const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imageMatch) {
        elements.push({
          type: MarkdownElementType.IMAGE,
          content: '',
          imageAlt: imageMatch[1],
          imageUrl: imageMatch[2],
        });
        i++;
        continue;
      }

      // Bullet list item
      const bulletMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
      if (bulletMatch) {
        const indent = Math.floor(bulletMatch[1].length / 2);
        elements.push({
          type: MarkdownElementType.BULLET_LIST_ITEM,
          content: bulletMatch[2],
          indent,
        });
        i++;
        continue;
      }

      // Numbered list item
      const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
      if (numberedMatch) {
        const indent = Math.floor(numberedMatch[1].length / 2);
        elements.push({
          type: MarkdownElementType.NUMBERED_LIST_ITEM,
          content: numberedMatch[2],
          indent,
        });
        i++;
        continue;
      }

      // Table (starts with |)
      if (line.trim().startsWith('|')) {
        const tableRows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const row = lines[i];
          // Skip separator rows (|---|---|)
          if (!/^\|[-:\s|]+\|$/.test(row.trim())) {
            const cells = row
              .split('|')
              .slice(1, -1) // Remove first and last empty strings
              .map((c) => c.trim());
            tableRows.push(cells);
          }
          i++;
        }
        if (tableRows.length > 0) {
          elements.push({
            type: MarkdownElementType.TABLE,
            content: '',
            tableRows,
          });
        }
        continue;
      }

      // Code block (```)
      if (line.trim().startsWith('```')) {
        const codeLines: string[] = [];
        i++; // Skip opening ```
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // Skip closing ```
        elements.push({
          type: MarkdownElementType.CODE_BLOCK,
          content: codeLines.join('\n'),
        });
        continue;
      }

      // Blockquote
      const quoteMatch = line.match(/^>\s*(.*)$/);
      if (quoteMatch) {
        elements.push({
          type: MarkdownElementType.BLOCKQUOTE,
          content: quoteMatch[1],
        });
        i++;
        continue;
      }

      // Regular paragraph
      elements.push({
        type: MarkdownElementType.PARAGRAPH,
        content: line,
      });
      i++;
    }

    return elements;
  }

  /**
   * Convert a markdown element to Docs API requests
   */
  private convertElement(
    element: MarkdownElement,
    startIndex: number
  ): {
    insertRequest: Request | null;
    formattingRequests: Request[];
    paragraphStyleRequests: Request[];
    textLength: number;
  } {
    const formattingRequests: Request[] = [];
    const paragraphStyleRequests: Request[] = [];

    switch (element.type) {
      case MarkdownElementType.HEADING: {
        // Parse inline formatting
        const { text, formats } = this.parseInlineFormatting(element.content);
        const fullText = text + '\n';

        // Add paragraph style for heading
        paragraphStyleRequests.push({
          updateParagraphStyle: {
            range: { startIndex, endIndex: startIndex + fullText.length },
            paragraphStyle: {
              namedStyleType: HEADING_STYLES[element.level ?? 1],
            },
            fields: 'namedStyleType',
          },
        });

        // Add inline formatting
        for (const format of formats) {
          formattingRequests.push(
            ...this.createFormattingRequests(format, startIndex)
          );
        }

        return {
          insertRequest: { insertText: { location: { index: startIndex }, text: fullText } },
          formattingRequests,
          paragraphStyleRequests,
          textLength: fullText.length,
        };
      }

      case MarkdownElementType.PARAGRAPH: {
        const { text, formats } = this.parseInlineFormatting(element.content);
        const fullText = text + '\n';

        for (const format of formats) {
          formattingRequests.push(
            ...this.createFormattingRequests(format, startIndex)
          );
        }

        return {
          insertRequest: { insertText: { location: { index: startIndex }, text: fullText } },
          formattingRequests,
          paragraphStyleRequests,
          textLength: fullText.length,
        };
      }

      case MarkdownElementType.BULLET_LIST_ITEM: {
        const { text, formats } = this.parseInlineFormatting(element.content);
        const fullText = text + '\n';

        // Create bullet
        paragraphStyleRequests.push({
          createParagraphBullets: {
            range: { startIndex, endIndex: startIndex + fullText.length },
            bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE',
          },
        });

        for (const format of formats) {
          formattingRequests.push(
            ...this.createFormattingRequests(format, startIndex)
          );
        }

        return {
          insertRequest: { insertText: { location: { index: startIndex }, text: fullText } },
          formattingRequests,
          paragraphStyleRequests,
          textLength: fullText.length,
        };
      }

      case MarkdownElementType.NUMBERED_LIST_ITEM: {
        const { text, formats } = this.parseInlineFormatting(element.content);
        const fullText = text + '\n';

        // Create numbered list
        paragraphStyleRequests.push({
          createParagraphBullets: {
            range: { startIndex, endIndex: startIndex + fullText.length },
            bulletPreset: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
          },
        });

        for (const format of formats) {
          formattingRequests.push(
            ...this.createFormattingRequests(format, startIndex)
          );
        }

        return {
          insertRequest: { insertText: { location: { index: startIndex }, text: fullText } },
          formattingRequests,
          paragraphStyleRequests,
          textLength: fullText.length,
        };
      }

      case MarkdownElementType.HORIZONTAL_RULE: {
        return {
          insertRequest: { insertText: { location: { index: startIndex }, text: '\n' } },
          formattingRequests: [],
          paragraphStyleRequests: [],
          textLength: 1,
        };
      }

      case MarkdownElementType.IMAGE: {
        // Insert image using insertInlineImage
        if (element.imageUrl) {
          return {
            insertRequest: {
              insertInlineImage: {
                location: { index: startIndex },
                uri: element.imageUrl,
                objectSize: {
                  // Default to reasonable size, Google Docs will adjust
                  height: { magnitude: 200, unit: 'PT' },
                  width: { magnitude: 300, unit: 'PT' },
                },
              },
            },
            formattingRequests: [],
            paragraphStyleRequests: [],
            textLength: 1, // Inline image takes 1 index position
          };
        }
        return {
          insertRequest: null,
          formattingRequests: [],
          paragraphStyleRequests: [],
          textLength: 0,
        };
      }

      case MarkdownElementType.TABLE: {
        if (!element.tableRows || element.tableRows.length === 0) {
          return {
            insertRequest: null,
            formattingRequests: [],
            paragraphStyleRequests: [],
            textLength: 0,
          };
        }

        const rows = element.tableRows.length;
        const cols = element.tableRows[0].length;

        // Insert table
        const insertTableRequest: Request = {
          insertTable: {
            location: { index: startIndex },
            rows,
            columns: cols,
          },
        };

        // Note: Table cell content would need to be inserted separately
        // after the table is created. This is complex because we need
        // to know the cell indices after table creation.
        // For now, we create an empty table.
        // Full table content support would require a two-pass approach.

        // Approximate table size (very rough estimate)
        // Tables are complex - each cell has its own content
        const estimatedLength = rows * cols * 2 + rows + 1;

        return {
          insertRequest: insertTableRequest,
          formattingRequests: [],
          paragraphStyleRequests: [],
          textLength: estimatedLength,
        };
      }

      case MarkdownElementType.CODE_BLOCK: {
        const fullText = element.content + '\n';

        // Apply monospace font to code block
        formattingRequests.push({
          updateTextStyle: {
            range: { startIndex, endIndex: startIndex + fullText.length },
            textStyle: {
              weightedFontFamily: { fontFamily: 'Courier New' },
            },
            fields: 'weightedFontFamily',
          },
        });

        return {
          insertRequest: { insertText: { location: { index: startIndex }, text: fullText } },
          formattingRequests,
          paragraphStyleRequests,
          textLength: fullText.length,
        };
      }

      case MarkdownElementType.BLOCKQUOTE: {
        const { text, formats } = this.parseInlineFormatting(element.content);
        const fullText = text + '\n';

        // Indent the paragraph
        paragraphStyleRequests.push({
          updateParagraphStyle: {
            range: { startIndex, endIndex: startIndex + fullText.length },
            paragraphStyle: {
              indentFirstLine: { magnitude: 36, unit: 'PT' },
              indentStart: { magnitude: 36, unit: 'PT' },
            },
            fields: 'indentFirstLine,indentStart',
          },
        });

        for (const format of formats) {
          formattingRequests.push(
            ...this.createFormattingRequests(format, startIndex)
          );
        }

        return {
          insertRequest: { insertText: { location: { index: startIndex }, text: fullText } },
          formattingRequests,
          paragraphStyleRequests,
          textLength: fullText.length,
        };
      }

      default:
        return {
          insertRequest: null,
          formattingRequests: [],
          paragraphStyleRequests: [],
          textLength: 0,
        };
    }
  }

  /**
   * Parse inline markdown formatting and return plain text with format spans
   */
  parseInlineFormatting(text: string): { text: string; formats: InlineFormat[] } {
    const formats: InlineFormat[] = [];
    let result = text;
    let offset = 0;

    // Process in order: links, bold, italic, strikethrough, code

    // Links: [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url, index) => {
      const adjustedIndex = index - offset;
      formats.push({
        start: adjustedIndex,
        end: adjustedIndex + linkText.length,
        link: url,
      });
      offset += match.length - linkText.length;
      return linkText;
    });

    // Inline code: `code`
    result = result.replace(/`([^`]+)`/g, (match, codeText, index) => {
      const adjustedIndex = index - offset;
      formats.push({
        start: adjustedIndex,
        end: adjustedIndex + codeText.length,
        code: true,
      });
      offset += 2; // Remove the backticks
      return codeText;
    });

    // Bold: **text** or __text__
    result = result.replace(/(\*\*|__)([^*_]+)\1/g, (match, marker, boldText, index) => {
      const adjustedIndex = index - offset;
      formats.push({
        start: adjustedIndex,
        end: adjustedIndex + boldText.length,
        bold: true,
      });
      offset += 4; // Remove the markers
      return boldText;
    });

    // Italic: *text* or _text_ (but not inside words)
    result = result.replace(/(?<![*_])([*_])([^*_]+)\1(?![*_])/g, (match, marker, italicText, index) => {
      const adjustedIndex = index - offset;
      formats.push({
        start: adjustedIndex,
        end: adjustedIndex + italicText.length,
        italic: true,
      });
      offset += 2; // Remove the markers
      return italicText;
    });

    // Strikethrough: ~~text~~
    result = result.replace(/~~([^~]+)~~/g, (match, strikeText, index) => {
      const adjustedIndex = index - offset;
      formats.push({
        start: adjustedIndex,
        end: adjustedIndex + strikeText.length,
        strikethrough: true,
      });
      offset += 4; // Remove the markers
      return strikeText;
    });

    return { text: result, formats };
  }

  /**
   * Create formatting requests for an inline format
   */
  private createFormattingRequests(format: InlineFormat, baseIndex: number): Request[] {
    const requests: Request[] = [];
    const range = {
      startIndex: baseIndex + format.start,
      endIndex: baseIndex + format.end,
    };

    if (format.bold) {
      requests.push({
        updateTextStyle: {
          range,
          textStyle: { bold: true },
          fields: 'bold',
        },
      });
    }

    if (format.italic) {
      requests.push({
        updateTextStyle: {
          range,
          textStyle: { italic: true },
          fields: 'italic',
        },
      });
    }

    if (format.strikethrough) {
      requests.push({
        updateTextStyle: {
          range,
          textStyle: { strikethrough: true },
          fields: 'strikethrough',
        },
      });
    }

    if (format.code) {
      requests.push({
        updateTextStyle: {
          range,
          textStyle: {
            weightedFontFamily: { fontFamily: 'Courier New' },
          },
          fields: 'weightedFontFamily',
        },
      });
    }

    if (format.link) {
      requests.push({
        updateTextStyle: {
          range,
          textStyle: {
            link: { url: format.link },
          },
          fields: 'link',
        },
      });
    }

    return requests;
  }
}
