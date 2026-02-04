/**
 * Types for the Markdown ↔ Google Docs conversion layer
 */

import type { docs_v1 } from 'googleapis';

// Re-export commonly used Google Docs types
export type Document = docs_v1.Schema$Document;
export type Body = docs_v1.Schema$Body;
export type StructuralElement = docs_v1.Schema$StructuralElement;
export type Paragraph = docs_v1.Schema$Paragraph;
export type ParagraphElement = docs_v1.Schema$ParagraphElement;
export type TextRun = docs_v1.Schema$TextRun;
export type InlineObjectElement = docs_v1.Schema$InlineObjectElement;
export type Table = docs_v1.Schema$Table;
export type TableRow = docs_v1.Schema$TableRow;
export type TableCell = docs_v1.Schema$TableCell;
export type InlineObject = docs_v1.Schema$InlineObject;
export type EmbeddedObject = docs_v1.Schema$EmbeddedObject;
export type Request = docs_v1.Schema$Request;

/**
 * Elements that are NOT compatible with markdown representation.
 * If a document contains any of these, markdown editing should be rejected.
 */
export enum IncompatibleElementType {
  EQUATION = 'equation',
  FOOTNOTE = 'footnote',
  COMMENT = 'comment',
  SUGGESTION = 'suggestion',
  DRAWING = 'drawing',
  PERSON = 'person', // @mentions
  RICH_LINK = 'rich_link', // Smart chips
  TABLE_OF_CONTENTS = 'table_of_contents',
  HEADER = 'header',
  FOOTER = 'footer',
  POSITIONED_OBJECT = 'positioned_object', // Non-inline images
  MERGED_TABLE_CELL = 'merged_table_cell',
}

/**
 * Result of a compatibility check
 */
export interface CompatibilityResult {
  compatible: boolean;
  issues: CompatibilityIssue[];
}

/**
 * A specific compatibility issue found in the document
 */
export interface CompatibilityIssue {
  type: IncompatibleElementType;
  message: string;
  /** Location hint (e.g., "paragraph 5", "table row 2") */
  location?: string;
}

/**
 * Options for the Doc → Markdown conversion
 */
export interface DocToMarkdownOptions {
  /** Include line numbers in output (for edit operations) */
  includeLineNumbers?: boolean;
}

/**
 * Result of Doc → Markdown conversion
 */
export interface DocToMarkdownResult {
  markdown: string;
  /** Map of markdown line numbers to document indices (for edit mapping) */
  lineToIndexMap?: Map<number, { startIndex: number; endIndex: number }>;
}

/**
 * Options for the Markdown → Doc conversion
 */
export interface MarkdownToDocOptions {
  /** If true, generates requests to replace entire document content */
  fullReplace?: boolean;
}

/**
 * Table information for two-pass insertion
 */
export interface TableInsertionInfo {
  /** Approximate index where table was inserted (for finding it later) */
  approximateIndex: number;
  /** Number of rows */
  rows: number;
  /** Number of columns */
  columns: number;
  /** Cell content [row][col] */
  cellContent: string[][];
}

/**
 * Result of Markdown → Doc conversion
 */
export interface MarkdownToDocResult {
  /** Google Docs API requests to apply */
  requests: Request[];
  /** Tables that need content populated in a second pass */
  tables: TableInsertionInfo[];
}

/**
 * Parsed markdown element types
 */
export enum MarkdownElementType {
  HEADING = 'heading',
  PARAGRAPH = 'paragraph',
  BULLET_LIST_ITEM = 'bullet_list_item',
  NUMBERED_LIST_ITEM = 'numbered_list_item',
  CODE_BLOCK = 'code_block',
  BLOCKQUOTE = 'blockquote',
  HORIZONTAL_RULE = 'horizontal_rule',
  TABLE = 'table',
  IMAGE = 'image',
}

/**
 * A parsed markdown element
 */
export interface MarkdownElement {
  type: MarkdownElementType;
  content: string;
  /** Heading level (1-6) for headings */
  level?: number;
  /** Nesting level for lists */
  indent?: number;
  /** Image URL for images */
  imageUrl?: string;
  /** Image alt text */
  imageAlt?: string;
  /** Table rows for tables */
  tableRows?: string[][];
}

/**
 * Inline formatting span
 */
export interface InlineFormat {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: string;
}
