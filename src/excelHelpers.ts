// excelHelpers.ts - Helper functions for manipulating Excel-format files (.xlsx/.xls) via Drive API
// Extends Sheets functionality to work with Excel formats without requiring conversion
import * as XLSX from 'xlsx';
import type { drive_v3 } from 'googleapis';
import type { Readable } from 'stream';

// Excel MIME types
export const EXCEL_MIME_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

// Cell value type that xlsx library uses
export type CellValue = string | number | boolean | Date | null | undefined;

/**
 * Check if a file is an Excel file based on its MIME type
 */
export function isExcelFile(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return mimeType === EXCEL_MIME_TYPES.xlsx || mimeType === EXCEL_MIME_TYPES.xls;
}

/**
 * Download an Excel file from Google Drive and parse it into a workbook
 */
export async function downloadAndParseExcel(
  drive: drive_v3.Drive,
  fileId: string
): Promise<{ workbook: XLSX.WorkBook; fileName: string; mimeType: string }> {
  // First get file metadata to verify it's an Excel file
  const metadataResponse = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType',
  });

  const { name, mimeType } = metadataResponse.data;

  if (!isExcelFile(mimeType)) {
    throw new Error(
      `File "${name}" is not an Excel file. MIME type: ${mimeType}. ` +
        'This tool only works with .xlsx or .xls files stored on Drive. ' +
        'For Google Sheets, use the Sheets tools instead.'
    );
  }

  // Download the file content
  const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });

  // Parse with xlsx
  const workbook = XLSX.read(response.data as ArrayBuffer, { type: 'array' });

  return {
    workbook,
    fileName: name || 'Unknown',
    mimeType: mimeType || EXCEL_MIME_TYPES.xlsx,
  };
}

/**
 * Upload a workbook back to Google Drive, replacing the existing file
 */
export async function uploadExcel(
  drive: drive_v3.Drive,
  fileId: string,
  workbook: XLSX.WorkBook,
  mimeType: string = EXCEL_MIME_TYPES.xlsx
): Promise<void> {
  // Write workbook to buffer
  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: mimeType === EXCEL_MIME_TYPES.xls ? 'xls' : 'xlsx',
  });

  // Upload back to Drive
  await drive.files.update({
    fileId,
    media: {
      mimeType,
      body: bufferToStream(buffer),
    },
  });
}

/**
 * Convert a Buffer to a Readable stream for the Drive API
 */
function bufferToStream(buffer: Buffer): Readable {
  const { Readable } = require('stream');
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

/**
 * Get list of sheet names in a workbook
 */
export function getSheetNames(workbook: XLSX.WorkBook): string[] {
  return workbook.SheetNames;
}

/**
 * Get a worksheet by name, throwing an error if not found
 */
export function getWorksheet(workbook: XLSX.WorkBook, sheetName?: string): XLSX.WorkSheet {
  const name = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];

  if (!sheet) {
    const available = workbook.SheetNames.join(', ');
    throw new Error(`Sheet "${name}" not found. Available sheets: ${available}`);
  }

  return sheet;
}

/**
 * Parse A1 notation range into column/row components
 * e.g., "A1" -> { col: 0, row: 0 }
 * e.g., "B3:D5" -> { startCol: 1, startRow: 2, endCol: 3, endRow: 4 }
 */
export interface CellRef {
  col: number;
  row: number;
}

export interface RangeRef {
  start: CellRef;
  end: CellRef;
}

export function parseA1Notation(a1: string): CellRef | RangeRef {
  const parts = a1.toUpperCase().split(':');

  if (parts.length === 1) {
    return parseCellRef(parts[0]);
  }

  return {
    start: parseCellRef(parts[0]),
    end: parseCellRef(parts[1]),
  };
}

function parseCellRef(ref: string): CellRef {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    throw new Error(`Invalid cell reference: ${ref}`);
  }

  const colStr = match[1];
  const rowStr = match[2];

  // Convert column letters to 0-based index (A=0, B=1, ..., Z=25, AA=26, etc.)
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  col -= 1; // Make 0-based

  const row = parseInt(rowStr, 10) - 1; // Make 0-based

  return { col, row };
}

/**
 * Convert column index (0-based) to A1 notation letters
 */
export function colIndexToLetter(col: number): string {
  let result = '';
  let c = col + 1; // Make 1-based for calculation
  while (c > 0) {
    const remainder = (c - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    c = Math.floor((c - 1) / 26);
  }
  return result;
}

/**
 * Convert cell ref to A1 notation string
 */
export function cellRefToA1(ref: CellRef): string {
  return `${colIndexToLetter(ref.col)}${ref.row + 1}`;
}

/**
 * Read a range of cells from a worksheet
 */
export function readRange(sheet: XLSX.WorkSheet, range: string): CellValue[][] {
  const ref = parseA1Notation(range);
  const result: CellValue[][] = [];

  let startRef: CellRef;
  let endRef: CellRef;

  if ('start' in ref) {
    startRef = ref.start;
    endRef = ref.end;
  } else {
    // Single cell - return as 1x1 array
    startRef = ref;
    endRef = ref;
  }

  for (let row = startRef.row; row <= endRef.row; row++) {
    const rowData: CellValue[] = [];
    for (let col = startRef.col; col <= endRef.col; col++) {
      const cellAddress = cellRefToA1({ col, row });
      const cell = sheet[cellAddress];
      rowData.push(cell ? cell.v : null);
    }
    result.push(rowData);
  }

  return result;
}

/**
 * Read a single cell from a worksheet
 */
export function readCell(sheet: XLSX.WorkSheet, cellRef: string): CellValue {
  const cell = sheet[cellRef.toUpperCase()];
  return cell ? cell.v : null;
}

/**
 * Write a value to a single cell
 */
export function writeCell(sheet: XLSX.WorkSheet, cellRef: string, value: CellValue): void {
  const address = cellRef.toUpperCase();

  if (value === null || value === undefined) {
    delete sheet[address];
  } else {
    // Determine cell type
    let type: string;
    if (typeof value === 'number') {
      type = 'n';
    } else if (typeof value === 'boolean') {
      type = 'b';
    } else if (value instanceof Date) {
      type = 'd';
    } else {
      type = 's';
    }

    sheet[address] = { t: type, v: value };
  }

  // Update sheet range
  updateSheetRange(sheet);
}

/**
 * Write a 2D array of values to a range starting at a cell
 */
export function writeRange(
  sheet: XLSX.WorkSheet,
  startCell: string,
  values: CellValue[][]
): { updatedCells: number; updatedRows: number; updatedColumns: number } {
  const start = parseCellRef(startCell.toUpperCase());
  let updatedCells = 0;
  let maxCols = 0;

  for (let rowOffset = 0; rowOffset < values.length; rowOffset++) {
    const rowData = values[rowOffset];
    if (rowData.length > maxCols) maxCols = rowData.length;

    for (let colOffset = 0; colOffset < rowData.length; colOffset++) {
      const cellAddress = cellRefToA1({
        col: start.col + colOffset,
        row: start.row + rowOffset,
      });
      writeCell(sheet, cellAddress, rowData[colOffset]);
      updatedCells++;
    }
  }

  return {
    updatedCells,
    updatedRows: values.length,
    updatedColumns: maxCols,
  };
}

/**
 * Append rows to the end of data in a sheet
 */
export function appendRows(
  sheet: XLSX.WorkSheet,
  values: CellValue[][],
  startColumn: string = 'A'
): { appendedRows: number; startingRow: number } {
  // Find the last row with data
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const lastRow = range.e.r + 1; // Next row after current data

  const startCol = parseCellRef(`${startColumn}1`).col;
  const startCell = cellRefToA1({ col: startCol, row: lastRow });

  writeRange(sheet, startCell, values);

  return {
    appendedRows: values.length,
    startingRow: lastRow + 1, // 1-based for user
  };
}

/**
 * Update the !ref property of a sheet to encompass all cells
 */
function updateSheetRange(sheet: XLSX.WorkSheet): void {
  const range = { s: { c: Infinity, r: Infinity }, e: { c: -Infinity, r: -Infinity } };

  for (const key of Object.keys(sheet)) {
    if (key[0] === '!' || !key.match(/^[A-Z]+\d+$/)) continue;

    const cell = XLSX.utils.decode_cell(key);
    if (cell.c < range.s.c) range.s.c = cell.c;
    if (cell.r < range.s.r) range.s.r = cell.r;
    if (cell.c > range.e.c) range.e.c = cell.c;
    if (cell.r > range.e.r) range.e.r = cell.r;
  }

  if (range.s.c === Infinity) {
    // Empty sheet
    sheet['!ref'] = 'A1';
  } else {
    sheet['!ref'] = XLSX.utils.encode_range(range);
  }
}

/**
 * Clear a range of cells
 */
export function clearRange(sheet: XLSX.WorkSheet, range: string): number {
  const ref = parseA1Notation(range);
  let clearedCells = 0;

  let startRef: CellRef;
  let endRef: CellRef;

  if ('start' in ref) {
    startRef = ref.start;
    endRef = ref.end;
  } else {
    startRef = ref;
    endRef = ref;
  }

  for (let row = startRef.row; row <= endRef.row; row++) {
    for (let col = startRef.col; col <= endRef.col; col++) {
      const cellAddress = cellRefToA1({ col, row });
      if (sheet[cellAddress]) {
        delete sheet[cellAddress];
        clearedCells++;
      }
    }
  }

  updateSheetRange(sheet);
  return clearedCells;
}

/**
 * Get info about a worksheet (dimensions, row/col count)
 */
export interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
  range: string;
  usedRange: string | null;
}

export function getSheetInfo(workbook: XLSX.WorkBook, sheetName: string): SheetInfo {
  const sheet = getWorksheet(workbook, sheetName);
  const range = sheet['!ref'] || 'A1';
  const decoded = XLSX.utils.decode_range(range);

  return {
    name: sheetName,
    rowCount: decoded.e.r - decoded.s.r + 1,
    columnCount: decoded.e.c - decoded.s.c + 1,
    range: range,
    usedRange: sheet['!ref'] || null,
  };
}

/**
 * Create a new sheet in a workbook
 */
export function addSheet(workbook: XLSX.WorkBook, sheetName: string): XLSX.WorkSheet {
  if (workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" already exists in workbook.`);
  }

  const sheet = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return sheet;
}

/**
 * Delete a sheet from a workbook
 */
export function deleteSheet(workbook: XLSX.WorkBook, sheetName: string): void {
  const index = workbook.SheetNames.indexOf(sheetName);
  if (index === -1) {
    throw new Error(`Sheet "${sheetName}" not found in workbook.`);
  }

  if (workbook.SheetNames.length === 1) {
    throw new Error('Cannot delete the only sheet in a workbook.');
  }

  workbook.SheetNames.splice(index, 1);
  delete workbook.Sheets[sheetName];
}

/**
 * Rename a sheet in a workbook
 */
export function renameSheet(workbook: XLSX.WorkBook, oldName: string, newName: string): void {
  const index = workbook.SheetNames.indexOf(oldName);
  if (index === -1) {
    throw new Error(`Sheet "${oldName}" not found in workbook.`);
  }

  if (workbook.SheetNames.includes(newName)) {
    throw new Error(`Sheet "${newName}" already exists in workbook.`);
  }

  workbook.SheetNames[index] = newName;
  workbook.Sheets[newName] = workbook.Sheets[oldName];
  delete workbook.Sheets[oldName];
}
