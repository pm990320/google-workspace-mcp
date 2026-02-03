// src/types.ts
import { z } from 'zod';
import { type docs_v1, type drive_v3, type gmail_v1, type slides_v1, type forms_v1, type sheets_v4, type calendar_v3 } from 'googleapis';
import { type FastMCP } from 'fastmcp';

// --- FastMCP Server Types ---
// Session auth type - matches FastMCP's internal type
export type FastMCPSessionAuth = Record<string, unknown> | undefined;

// Common type for FastMCP server instance
export type FastMCPServer = FastMCP<FastMCPSessionAuth>;

// --- Google API Client Type Aliases ---
export type DocsClient = docs_v1.Docs;
export type DriveClient = drive_v3.Drive;
export type SheetsClient = sheets_v4.Sheets;
export type GmailClient = gmail_v1.Gmail;
export type CalendarClient = calendar_v3.Calendar;
export type SlidesClient = slides_v1.Slides;
export type FormsClient = forms_v1.Forms;

// --- Google Docs API Types ---
export type StructuralElement = docs_v1.Schema$StructuralElement;
export type ParagraphElement = docs_v1.Schema$ParagraphElement;
export type Paragraph = docs_v1.Schema$Paragraph;
export type DocsTable = docs_v1.Schema$Table;
export type TableRow = docs_v1.Schema$TableRow;
export type TableCell = docs_v1.Schema$TableCell;
export type TextRun = docs_v1.Schema$TextRun;

// --- Google Drive API Types ---
export type DriveComment = drive_v3.Schema$Comment;
export type DriveReply = drive_v3.Schema$Reply;

// --- Gmail API Types ---
export type MessagePart = gmail_v1.Schema$MessagePart;

// --- Google Slides API Types ---
export type PageElement = slides_v1.Schema$PageElement;
export type SlidesRequest = slides_v1.Schema$Request;

// --- Google Forms API Types ---
export type FormsQuestion = forms_v1.Schema$Question;

// --- Document Content Interface ---
export interface DocumentContent {
  body?: {
    content?: StructuralElement[];
  };
}

// --- Color Types and Utilities ---

/** RGB color with values in 0-1 range (Google API format) */
export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export const hexColorRegex = /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
export const validateHexColor = (color: string) => hexColorRegex.test(color);

/**
 * Converts hex color string to RGB color object (0-1 range)
 * Supports both 3-char (#RGB) and 6-char (#RRGGBB) formats
 */
export function hexToRgbColor(hex: string): RgbColor | null {
  if (!hex) return null;
  let hexClean = hex.startsWith('#') ? hex.slice(1) : hex;

  if (hexClean.length === 3) {
    hexClean = hexClean[0] + hexClean[0] + hexClean[1] + hexClean[1] + hexClean[2] + hexClean[2];
  }
  if (hexClean.length !== 6) return null;
  const bigint = parseInt(hexClean, 16);
  if (isNaN(bigint)) return null;

  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;

  return { red: r, green: g, blue: b };
}

// --- Zod Schema Fragments for Reusability ---

// Account parameter - REQUIRED for all tools (no default account)
export const AccountParameter = z.object({
  account: z
    .string()
    .min(1)
    .describe('The name of the Google account to use. Use listAccounts to see available accounts.'),
});

export const DocumentIdParameter = z.object({
  documentId: z.string().describe('The ID of the Google Document (from the URL).'),
});

// Combined parameter for tools that need both account and document ID
export const AccountDocumentParameters = AccountParameter.merge(DocumentIdParameter);

export const RangeParameters = z
  .object({
    startIndex: z
      .number()
      .int()
      .min(1)
      .describe('The starting index of the text range (inclusive, starts from 1).'),
    endIndex: z.number().int().min(1).describe('The ending index of the text range (exclusive).'),
  })
  .refine((data) => data.endIndex > data.startIndex, {
    message: 'endIndex must be greater than startIndex',
    path: ['endIndex'],
  });

export const OptionalRangeParameters = z
  .object({
    startIndex: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Optional: The starting index of the text range (inclusive, starts from 1). If omitted, might apply to a found element or whole paragraph.'
      ),
    endIndex: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Optional: The ending index of the text range (exclusive). If omitted, might apply to a found element or whole paragraph.'
      ),
  })
  .refine((data) => !data.startIndex || !data.endIndex || data.endIndex > data.startIndex, {
    message:
      'If both startIndex and endIndex are provided, endIndex must be greater than startIndex',
    path: ['endIndex'],
  });

export const TextFindParameter = z.object({
  textToFind: z.string().min(1).describe('The exact text string to locate.'),
  matchInstance: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe('Which instance of the text to target (1st, 2nd, etc.). Defaults to 1.'),
});

// --- Style Parameter Schemas ---

export const TextStyleParameters = z
  .object({
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
      .refine(validateHexColor, { message: 'Invalid hex color format (e.g., #FF0000 or #F00)' })
      .optional()
      .describe('Set text color using hex format (e.g., "#FF0000").'),
    backgroundColor: z
      .string()
      .refine(validateHexColor, { message: 'Invalid hex color format (e.g., #00FF00 or #0F0)' })
      .optional()
      .describe('Set text background color using hex format (e.g., "#FFFF00").'),
    linkUrl: z
      .string()
      .url()
      .optional()
      .describe('Make the text a hyperlink pointing to this URL.'),
    removeLink: z
      .boolean()
      .optional()
      .describe('If true, removes any hyperlink from the text. Cannot be used with linkUrl.'),
  })
  .describe('Parameters for character-level text formatting.');

// Subset of TextStyle used for passing to helpers
export type TextStyleArgs = z.infer<typeof TextStyleParameters>;

export const ParagraphStyleParameters = z
  .object({
    alignment: z
      .enum(['START', 'END', 'CENTER', 'JUSTIFIED'])
      .optional()
      .describe('Paragraph alignment. START=left for LTR languages, END=right for LTR languages.'),
    indentStart: z.number().min(0).optional().describe('Left indentation in points.'),
    indentEnd: z.number().min(0).optional().describe('Right indentation in points.'),
    spaceAbove: z.number().min(0).optional().describe('Space before the paragraph in points.'),
    spaceBelow: z.number().min(0).optional().describe('Space after the paragraph in points.'),
    namedStyleType: z
      .enum([
        'NORMAL_TEXT',
        'TITLE',
        'SUBTITLE',
        'HEADING_1',
        'HEADING_2',
        'HEADING_3',
        'HEADING_4',
        'HEADING_5',
        'HEADING_6',
      ])
      .optional()
      .describe('Apply a built-in named paragraph style (e.g., HEADING_1).'),
    keepWithNext: z
      .boolean()
      .optional()
      .describe('Keep this paragraph together with the next one on the same page.'),
    // Borders are more complex, might need separate objects/tools
    // clearDirectFormatting: z.boolean().optional().describe('If true, attempts to clear all direct paragraph formatting within the range before applying new styles.') // Harder to implement perfectly
  })
  .describe('Parameters for paragraph-level formatting.');

// Subset of ParagraphStyle used for passing to helpers
export type ParagraphStyleArgs = z.infer<typeof ParagraphStyleParameters>;

// --- Combination Schemas for Tools ---

export const ApplyTextStyleToolParameters = AccountDocumentParameters.extend({
  // Target EITHER by range OR by finding text
  target: z
    .union([RangeParameters, TextFindParameter])
    .describe('Specify the target range either by start/end indices or by finding specific text.'),
  style: TextStyleParameters.refine(
    (styleArgs) => Object.keys(styleArgs).length > 0,
    { message: 'At least one text style option must be provided.' }
  ).describe('The text styling to apply.'),
});
export type ApplyTextStyleToolArgs = z.infer<typeof ApplyTextStyleToolParameters>;

export const ApplyParagraphStyleToolParameters = AccountDocumentParameters.extend({
  // Target EITHER by range OR by finding text (tool logic needs to find paragraph boundaries)
  target: z
    .union([
      RangeParameters, // User provides paragraph start/end (less likely)
      TextFindParameter, // Find text within paragraph to apply style
      z.object({
        // Target by specific index within the paragraph
        indexWithinParagraph: z
          .number()
          .int()
          .min(1)
          .describe('An index located anywhere within the target paragraph.'),
      }),
    ])
    .describe(
      'Specify the target paragraph either by start/end indices, by finding text within it, or by providing an index within it.'
    ),
  style: ParagraphStyleParameters.refine(
    (styleArgs) => Object.keys(styleArgs).length > 0,
    { message: 'At least one paragraph style option must be provided.' }
  ).describe('The paragraph styling to apply.'),
});
export type ApplyParagraphStyleToolArgs = z.infer<typeof ApplyParagraphStyleToolParameters>;

// --- OAuth Credential Types ---

/** Google OAuth client configuration (installed or web app) */
export interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
  auth_uri?: string;
  token_uri?: string;
  project_id?: string;
}

/** Google OAuth credentials file format */
export interface OAuthCredentialsFile {
  installed?: OAuthClientConfig;
  web?: OAuthClientConfig;
}

/** Parsed OAuth credentials with required fields */
export interface ParsedOAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

/** OAuth token response/storage format */
export interface OAuthTokenData {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
}

/** Google Service Account key file format */
export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

// --- Error Class ---
// Use FastMCP's UserError for client-facing issues
// Define a custom error for internal issues if needed
export class NotImplementedError extends Error {
  constructor(message = 'This feature is not yet implemented.') {
    super(message);
    this.name = 'NotImplementedError';
  }
}
