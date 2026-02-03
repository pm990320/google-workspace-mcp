/**
 * CompatibilityChecker - Checks if a Google Doc can be represented as Markdown
 *
 * This class analyzes a Google Docs document structure and determines if it
 * contains only elements that can be faithfully represented in Markdown format.
 */

import {
  type Document,
  type StructuralElement,
  type Paragraph,
  type ParagraphElement,
  type Table,
  type TableRow,
  type TableCell,
  type CompatibilityResult,
  type CompatibilityIssue,
  IncompatibleElementType,
} from './types.js';

export class CompatibilityChecker {
  private issues: CompatibilityIssue[] = [];
  private paragraphIndex = 0;

  /**
   * Check if a document is compatible with markdown representation
   * @param document The Google Docs document to check
   * @returns CompatibilityResult indicating if compatible and any issues found
   */
  check(document: Document): CompatibilityResult {
    this.issues = [];
    this.paragraphIndex = 0;

    // Check for document-level incompatibilities
    this.checkDocumentLevel(document);

    // Check body content
    if (document.body?.content) {
      this.checkStructuralElements(document.body.content);
    }

    // Check inline objects (images, drawings, etc.)
    if (document.inlineObjects) {
      this.checkInlineObjects(document.inlineObjects);
    }

    // Check positioned objects (non-inline images/drawings)
    if (document.positionedObjects && Object.keys(document.positionedObjects).length > 0) {
      this.addIssue(
        IncompatibleElementType.POSITIONED_OBJECT,
        'Document contains positioned objects (non-inline images or drawings). ' +
          'These cannot be represented in markdown. Move images inline or use the standard editing tools.'
      );
    }

    return {
      compatible: this.issues.length === 0,
      issues: this.issues,
    };
  }

  /**
   * Check for document-level features that are incompatible
   */
  private checkDocumentLevel(document: Document): void {
    // Check for headers
    if (document.headers && Object.keys(document.headers).length > 0) {
      this.addIssue(
        IncompatibleElementType.HEADER,
        'Document contains headers. Remove headers or use the standard editing tools.'
      );
    }

    // Check for footers
    if (document.footers && Object.keys(document.footers).length > 0) {
      this.addIssue(
        IncompatibleElementType.FOOTER,
        'Document contains footers. Remove footers or use the standard editing tools.'
      );
    }

    // Check for footnotes
    if (document.footnotes && Object.keys(document.footnotes).length > 0) {
      this.addIssue(
        IncompatibleElementType.FOOTNOTE,
        'Document contains footnotes. Remove footnotes or use the standard editing tools.'
      );
    }

    // Note: We don't check for suggestionsViewMode or comments here
    // as those would require a separate API call to the Drive API
  }

  /**
   * Check structural elements (paragraphs, tables, etc.)
   */
  private checkStructuralElements(elements: StructuralElement[]): void {
    for (const element of elements) {
      this.paragraphIndex++;

      if (element.paragraph) {
        this.checkParagraph(element.paragraph);
      } else if (element.table) {
        this.checkTable(element.table);
      } else if (element.tableOfContents) {
        this.addIssue(
          IncompatibleElementType.TABLE_OF_CONTENTS,
          'Document contains a table of contents. Remove it or use the standard editing tools.',
          `element ${this.paragraphIndex}`
        );
      }
      // sectionBreak is fine - we convert to horizontal rule
    }
  }

  /**
   * Check a paragraph for incompatible elements
   */
  private checkParagraph(paragraph: Paragraph): void {
    if (!paragraph.elements) return;

    for (const element of paragraph.elements) {
      this.checkParagraphElement(element);
    }
  }

  /**
   * Check a paragraph element for incompatible content
   */
  private checkParagraphElement(element: ParagraphElement): void {
    // Check for equations
    if (element.equation) {
      this.addIssue(
        IncompatibleElementType.EQUATION,
        'Document contains equations. Remove equations or use the standard editing tools.',
        `paragraph ${this.paragraphIndex}`
      );
    }

    // Check for footnote references
    if (element.footnoteReference) {
      this.addIssue(
        IncompatibleElementType.FOOTNOTE,
        'Document contains footnote references. Remove footnotes or use the standard editing tools.',
        `paragraph ${this.paragraphIndex}`
      );
    }

    // Check for person mentions (@mentions)
    if (element.person) {
      this.addIssue(
        IncompatibleElementType.PERSON,
        'Document contains @mentions. Remove mentions or use the standard editing tools.',
        `paragraph ${this.paragraphIndex}`
      );
    }

    // Check for rich links (smart chips)
    if (element.richLink) {
      this.addIssue(
        IncompatibleElementType.RICH_LINK,
        'Document contains smart chips/rich links. Convert to regular links or use the standard editing tools.',
        `paragraph ${this.paragraphIndex}`
      );
    }

    // InlineObjectElement is fine - we handle inline images
    // TextRun is fine - basic text with formatting
    // AutoText (page numbers etc) - we'll treat as text
    // PageBreak - we'll ignore or convert to ---
    // ColumnBreak - we'll ignore
    // HorizontalRule is fine
  }

  /**
   * Check a table for incompatible features
   */
  private checkTable(table: Table): void {
    if (!table.tableRows) return;

    // Check for merged cells by analyzing column spans
    for (let rowIdx = 0; rowIdx < table.tableRows.length; rowIdx++) {
      const row = table.tableRows[rowIdx];
      if (!row.tableCells) continue;

      for (let cellIdx = 0; cellIdx < row.tableCells.length; cellIdx++) {
        const cell = row.tableCells[cellIdx];

        // Check for merged cells (row span or column span > 1)
        if (cell.tableCellStyle) {
          const rowSpan = cell.tableCellStyle.rowSpan ?? 1;
          const columnSpan = cell.tableCellStyle.columnSpan ?? 1;

          if (rowSpan > 1 || columnSpan > 1) {
            this.addIssue(
              IncompatibleElementType.MERGED_TABLE_CELL,
              `Table has merged cells (row ${rowIdx + 1}, column ${cellIdx + 1}). ` +
                'Unmerge cells or use the standard editing tools.',
              `table at element ${this.paragraphIndex}`
            );
            return; // One issue per table is enough
          }
        }

        // Recursively check cell content
        if (cell.content) {
          const savedIndex = this.paragraphIndex;
          this.checkStructuralElements(cell.content);
          this.paragraphIndex = savedIndex;
        }
      }
    }
  }

  /**
   * Check inline objects (images, drawings, etc.)
   */
  private checkInlineObjects(
    inlineObjects: Record<string, { inlineObjectProperties?: { embeddedObject?: unknown } }>
  ): void {
    for (const [objectId, obj] of Object.entries(inlineObjects)) {
      const embeddedObject = obj.inlineObjectProperties?.embeddedObject as
        | {
            imageProperties?: unknown;
            embeddedDrawingProperties?: unknown;
          }
        | undefined;

      if (!embeddedObject) continue;

      // Embedded drawings are not compatible
      if (embeddedObject.embeddedDrawingProperties) {
        this.addIssue(
          IncompatibleElementType.DRAWING,
          `Document contains an embedded drawing (${objectId}). ` +
            'Remove drawings or use the standard editing tools.'
        );
      }

      // Images are fine - we can represent them as ![alt](url)
      // imageProperties is OK
    }
  }

  /**
   * Add an issue to the list
   */
  private addIssue(type: IncompatibleElementType, message: string, location?: string): void {
    // Avoid duplicate issues of the same type
    if (!this.issues.some((i) => i.type === type)) {
      this.issues.push({ type, message, location });
    }
  }

  /**
   * Format issues as a human-readable error message
   */
  static formatIssues(issues: CompatibilityIssue[]): string {
    if (issues.length === 0) {
      return 'Document is compatible with markdown editing.';
    }

    const lines = [
      'This document cannot be edited as markdown due to the following incompatible elements:',
      '',
    ];

    for (const issue of issues) {
      lines.push(`• ${issue.message}`);
    }

    lines.push('');
    lines.push('Use readGoogleDoc and the standard editing tools instead.');

    return lines.join('\n');
  }
}
