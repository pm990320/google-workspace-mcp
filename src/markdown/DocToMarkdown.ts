/**
 * DocToMarkdown - Converts Google Docs document structure to Markdown
 *
 * This class takes a Google Docs document (as returned by the API) and
 * converts it to a clean Markdown representation.
 */

import {
  type Document,
  type StructuralElement,
  type Paragraph,
  type ParagraphElement,
  type TextRun,
  type Table,
  type TableRow,
  type TableCell,
  type InlineObject,
  type DocToMarkdownOptions,
  type DocToMarkdownResult,
} from './types.js';

export class DocToMarkdown {
  private inlineObjects: Record<string, InlineObject> = {};
  private listCounters: Map<string, number> = new Map();

  /**
   * Convert a Google Docs document to Markdown
   * @param document The Google Docs document
   * @param options Conversion options
   * @returns The markdown string and optional line mapping
   */
  convert(document: Document, options: DocToMarkdownOptions = {}): DocToMarkdownResult {
    // Store inline objects for image reference
    this.inlineObjects = (document.inlineObjects as Record<string, InlineObject>) ?? {};
    this.listCounters.clear();

    let markdown = '';

    if (!document.body?.content) {
      return { markdown: '' };
    }

    for (const element of document.body.content) {
      markdown += this.convertStructuralElement(element);
    }

    // Clean up excessive newlines
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

    if (options.includeLineNumbers) {
      markdown = this.addLineNumbers(markdown);
    }

    return { markdown };
  }

  /**
   * Convert a structural element (paragraph, table, etc.)
   */
  private convertStructuralElement(element: StructuralElement): string {
    if (element.paragraph) {
      return this.convertParagraph(element.paragraph);
    } else if (element.table) {
      return this.convertTable(element.table);
    } else if (element.sectionBreak) {
      return '\n---\n\n';
    }
    return '';
  }

  /**
   * Convert a paragraph to markdown
   */
  private convertParagraph(paragraph: Paragraph): string {
    // Extract text content with inline formatting
    let text = '';
    if (paragraph.elements) {
      for (const element of paragraph.elements) {
        text += this.convertParagraphElement(element);
      }
    }

    // Determine paragraph type from style
    const styleType = paragraph.paragraphStyle?.namedStyleType;
    const bullet = paragraph.bullet;

    // Handle headings
    if (styleType?.startsWith('HEADING_')) {
      const level = parseInt(styleType.replace('HEADING_', ''), 10);
      const hashes = '#'.repeat(Math.min(level, 6));
      return text.trim() ? `${hashes} ${text.trim()}\n\n` : '';
    }

    if (styleType === 'TITLE') {
      return text.trim() ? `# ${text.trim()}\n\n` : '';
    }

    if (styleType === 'SUBTITLE') {
      return text.trim() ? `## ${text.trim()}\n\n` : '';
    }

    // Handle bullet lists
    if (bullet) {
      const nestingLevel = bullet.nestingLevel ?? 0;
      const indent = '  '.repeat(nestingLevel);
      const listId = bullet.listId ?? 'default';

      // Check if this is a numbered list by looking at glyph type
      // Note: This is a simplification - Google Docs list detection is complex
      const isNumbered = this.isNumberedList(paragraph);

      if (isNumbered) {
        const counterKey = `${listId}-${nestingLevel}`;
        const counter = (this.listCounters.get(counterKey) ?? 0) + 1;
        this.listCounters.set(counterKey, counter);
        return text.trim() ? `${indent}${counter}. ${text.trim()}\n` : '';
      } else {
        return text.trim() ? `${indent}- ${text.trim()}\n` : '';
      }
    }

    // Regular paragraph
    if (text.trim()) {
      return `${text.trim()}\n\n`;
    }

    return '\n';
  }

  /**
   * Check if a paragraph is a numbered list item
   */
  private isNumberedList(paragraph: Paragraph): boolean {
    // Google Docs uses glyphType to indicate numbered vs bullet
    // GLYPH_TYPE_UNSPECIFIED or bullet types = bullet
    // DECIMAL, ALPHA, ROMAN = numbered
    const glyphType = paragraph.bullet?.textStyle?.toString() ?? '';

    // This is a heuristic - in practice we'd need to look at the list definition
    // For now, default to bullet unless we can detect numbering
    return glyphType.includes('DECIMAL') || glyphType.includes('ALPHA') || glyphType.includes('ROMAN');
  }

  /**
   * Convert a paragraph element (text run, inline image, etc.)
   */
  private convertParagraphElement(element: ParagraphElement): string {
    if (element.textRun) {
      return this.convertTextRun(element.textRun);
    }

    if (element.inlineObjectElement) {
      return this.convertInlineObject(element.inlineObjectElement.inlineObjectId ?? '');
    }

    if (element.horizontalRule) {
      return '\n---\n';
    }

    // Other elements (pageBreak, columnBreak) are ignored
    return '';
  }

  /**
   * Convert a text run to markdown with inline formatting
   */
  private convertTextRun(textRun: TextRun): string {
    let text = textRun.content ?? '';
    const style = textRun.textStyle ?? {};

    // Handle newlines at end of text runs
    const endsWithNewline = text.endsWith('\n');
    const startsWithSpace = text.startsWith(' ');
    const endsWithSpace = text.endsWith(' ') || text.endsWith('\n');

    // Trim for formatting, but preserve intentional spacing
    let trimmedText = text.trim();
    if (!trimmedText) {
      return text; // Preserve whitespace-only runs
    }

    // Apply link formatting (do this first as it wraps the text)
    if (style.link?.url) {
      trimmedText = `[${trimmedText}](${style.link.url})`;
    }

    // Apply inline code formatting
    if (style.weightedFontFamily?.fontFamily === 'Courier New' ||
        style.weightedFontFamily?.fontFamily === 'Consolas' ||
        style.weightedFontFamily?.fontFamily?.toLowerCase().includes('mono')) {
      trimmedText = `\`${trimmedText}\``;
    } else {
      // Apply other formatting (not for code)
      if (style.bold) {
        trimmedText = `**${trimmedText}**`;
      }
      if (style.italic) {
        trimmedText = `*${trimmedText}*`;
      }
      if (style.strikethrough) {
        trimmedText = `~~${trimmedText}~~`;
      }
    }

    // Restore spacing
    let result = trimmedText;
    if (startsWithSpace) result = ' ' + result;
    if (endsWithSpace && !endsWithNewline) result = result + ' ';
    if (endsWithNewline) result = result + '\n';

    return result;
  }

  /**
   * Convert an inline object (image) to markdown
   */
  private convertInlineObject(objectId: string): string {
    const obj = this.inlineObjects[objectId];
    if (!obj) return '';

    const embeddedObject = obj.inlineObjectProperties?.embeddedObject;
    if (!embeddedObject) return '';

    // Handle images
    const imageProps = embeddedObject.imageProperties;
    if (imageProps) {
      // Try to get the source URI or content URI
      const uri = imageProps.sourceUri || imageProps.contentUri || '';
      const title = embeddedObject.title || 'image';
      const description = embeddedObject.description || '';

      if (uri) {
        return `![${description || title}](${uri})`;
      }
    }

    return '';
  }

  /**
   * Convert a table to markdown
   */
  private convertTable(table: Table): string {
    if (!table.tableRows || table.tableRows.length === 0) {
      return '';
    }

    const rows: string[][] = [];

    for (const row of table.tableRows) {
      const cells: string[] = [];
      if (row.tableCells) {
        for (const cell of row.tableCells) {
          cells.push(this.convertTableCell(cell));
        }
      }
      rows.push(cells);
    }

    if (rows.length === 0) return '';

    // Build markdown table
    let markdown = '\n';

    // Header row
    markdown += '| ' + rows[0].join(' | ') + ' |\n';

    // Separator row
    markdown += '|' + rows[0].map(() => '---').join('|') + '|\n';

    // Data rows
    for (let i = 1; i < rows.length; i++) {
      markdown += '| ' + rows[i].join(' | ') + ' |\n';
    }

    return markdown + '\n';
  }

  /**
   * Convert a table cell to text
   */
  private convertTableCell(cell: TableCell): string {
    let text = '';

    if (cell.content) {
      for (const element of cell.content) {
        if (element.paragraph?.elements) {
          for (const pe of element.paragraph.elements) {
            if (pe.textRun?.content) {
              // Strip newlines from cell content for table compatibility
              text += pe.textRun.content.replace(/\n/g, ' ');
            }
          }
        }
      }
    }

    return text.trim() || ' ';
  }

  /**
   * Add line numbers to markdown output
   */
  private addLineNumbers(markdown: string): string {
    const lines = markdown.split('\n');
    const width = lines.length.toString().length;

    return lines
      .map((line, i) => `${(i + 1).toString().padStart(width, ' ')}\t${line}`)
      .join('\n');
  }
}
