// tests/excelHelpers.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import {
  EXCEL_MIME_TYPES,
  isExcelFile,
  getSheetNames,
  getWorksheet,
  parseA1Notation,
  colIndexToLetter,
  cellRefToA1,
  readRange,
  readCell,
  writeCell,
  writeRange,
  appendRows,
  clearRange,
  getSheetInfo,
  addSheet,
  deleteSheet,
  renameSheet,
} from '../dist/excelHelpers.js';

describe('Excel Helpers', () => {
  describe('EXCEL_MIME_TYPES', () => {
    it('should have correct MIME types', () => {
      expect(EXCEL_MIME_TYPES.xlsx).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(EXCEL_MIME_TYPES.xls).toBe('application/vnd.ms-excel');
    });
  });

  describe('isExcelFile', () => {
    it('should return true for xlsx MIME type', () => {
      expect(isExcelFile(EXCEL_MIME_TYPES.xlsx)).toBe(true);
    });

    it('should return true for xls MIME type', () => {
      expect(isExcelFile(EXCEL_MIME_TYPES.xls)).toBe(true);
    });

    it('should return false for Google Sheets MIME type', () => {
      expect(isExcelFile('application/vnd.google-apps.spreadsheet')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isExcelFile(null)).toBe(false);
      expect(isExcelFile(undefined)).toBe(false);
    });

    it('should return false for other MIME types', () => {
      expect(isExcelFile('text/plain')).toBe(false);
      expect(isExcelFile('application/pdf')).toBe(false);
    });
  });

  describe('A1 Notation Parsing', () => {
    describe('parseA1Notation', () => {
      it('should parse single cell reference', () => {
        const result = parseA1Notation('A1');
        expect(result).toEqual({ col: 0, row: 0 });
      });

      it('should parse cell reference with larger coordinates', () => {
        const result = parseA1Notation('C5');
        expect(result).toEqual({ col: 2, row: 4 });
      });

      it('should parse range reference', () => {
        const result = parseA1Notation('A1:C3');
        expect(result).toEqual({
          start: { col: 0, row: 0 },
          end: { col: 2, row: 2 },
        });
      });

      it('should handle lowercase input', () => {
        const result = parseA1Notation('b2');
        expect(result).toEqual({ col: 1, row: 1 });
      });

      it('should handle multi-letter columns', () => {
        const result = parseA1Notation('AA1');
        expect(result).toEqual({ col: 26, row: 0 });
      });

      it('should handle column AZ', () => {
        const result = parseA1Notation('AZ1');
        expect(result).toEqual({ col: 51, row: 0 });
      });

      it('should handle column BA', () => {
        const result = parseA1Notation('BA1');
        expect(result).toEqual({ col: 52, row: 0 });
      });

      it('should throw for invalid cell reference', () => {
        expect(() => parseA1Notation('invalid')).toThrow('Invalid cell reference');
        expect(() => parseA1Notation('1A')).toThrow('Invalid cell reference');
        expect(() => parseA1Notation('')).toThrow('Invalid cell reference');
      });
    });

    describe('colIndexToLetter', () => {
      it('should convert 0 to A', () => {
        expect(colIndexToLetter(0)).toBe('A');
      });

      it('should convert 25 to Z', () => {
        expect(colIndexToLetter(25)).toBe('Z');
      });

      it('should convert 26 to AA', () => {
        expect(colIndexToLetter(26)).toBe('AA');
      });

      it('should convert 27 to AB', () => {
        expect(colIndexToLetter(27)).toBe('AB');
      });

      it('should convert 51 to AZ', () => {
        expect(colIndexToLetter(51)).toBe('AZ');
      });

      it('should convert 52 to BA', () => {
        expect(colIndexToLetter(52)).toBe('BA');
      });

      it('should convert 701 to ZZ', () => {
        expect(colIndexToLetter(701)).toBe('ZZ');
      });
    });

    describe('cellRefToA1', () => {
      it('should convert {col: 0, row: 0} to A1', () => {
        expect(cellRefToA1({ col: 0, row: 0 })).toBe('A1');
      });

      it('should convert {col: 2, row: 4} to C5', () => {
        expect(cellRefToA1({ col: 2, row: 4 })).toBe('C5');
      });

      it('should convert {col: 26, row: 0} to AA1', () => {
        expect(cellRefToA1({ col: 26, row: 0 })).toBe('AA1');
      });
    });
  });

  describe('Workbook Operations', () => {
    let workbook;

    beforeEach(() => {
      // Create a test workbook with sample data
      workbook = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        ['Name', 'Age', 'City'],
        ['Alice', 30, 'New York'],
        ['Bob', 25, 'Los Angeles'],
      ]);
      XLSX.utils.book_append_sheet(workbook, ws, 'Sheet1');
    });

    describe('getSheetNames', () => {
      it('should return sheet names', () => {
        expect(getSheetNames(workbook)).toEqual(['Sheet1']);
      });

      it('should return multiple sheet names', () => {
        const ws2 = XLSX.utils.aoa_to_sheet([['Data']]);
        XLSX.utils.book_append_sheet(workbook, ws2, 'Sheet2');
        expect(getSheetNames(workbook)).toEqual(['Sheet1', 'Sheet2']);
      });
    });

    describe('getWorksheet', () => {
      it('should return worksheet by name', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        expect(sheet).toBeDefined();
        expect(sheet['A1'].v).toBe('Name');
      });

      it('should return first worksheet if name not provided', () => {
        const sheet = getWorksheet(workbook);
        expect(sheet).toBeDefined();
        expect(sheet['A1'].v).toBe('Name');
      });

      it('should throw if sheet not found', () => {
        expect(() => getWorksheet(workbook, 'NonExistent')).toThrow(
          'Sheet "NonExistent" not found'
        );
      });
    });

    describe('readCell', () => {
      it('should read cell value', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        expect(readCell(sheet, 'A1')).toBe('Name');
        expect(readCell(sheet, 'B2')).toBe(30);
      });

      it('should return null for empty cell', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        expect(readCell(sheet, 'Z99')).toBe(null);
      });

      it('should handle lowercase cell references', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        expect(readCell(sheet, 'a1')).toBe('Name');
      });
    });

    describe('readRange', () => {
      it('should read single cell as 1x1 array', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const result = readRange(sheet, 'A1');
        expect(result).toEqual([['Name']]);
      });

      it('should read range of cells', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const result = readRange(sheet, 'A1:C2');
        expect(result).toEqual([
          ['Name', 'Age', 'City'],
          ['Alice', 30, 'New York'],
        ]);
      });

      it('should return null for empty cells in range', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const result = readRange(sheet, 'A1:D1');
        expect(result).toEqual([['Name', 'Age', 'City', null]]);
      });
    });

    describe('writeCell', () => {
      it('should write string value', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        writeCell(sheet, 'D1', 'Country');
        expect(sheet['D1'].v).toBe('Country');
        expect(sheet['D1'].t).toBe('s');
      });

      it('should write number value', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        writeCell(sheet, 'D1', 42);
        expect(sheet['D1'].v).toBe(42);
        expect(sheet['D1'].t).toBe('n');
      });

      it('should write boolean value', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        writeCell(sheet, 'D1', true);
        expect(sheet['D1'].v).toBe(true);
        expect(sheet['D1'].t).toBe('b');
      });

      it('should delete cell when writing null', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        expect(sheet['A1']).toBeDefined();
        writeCell(sheet, 'A1', null);
        expect(sheet['A1']).toBeUndefined();
      });

      it('should delete cell when writing undefined', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        expect(sheet['A1']).toBeDefined();
        writeCell(sheet, 'A1', undefined);
        expect(sheet['A1']).toBeUndefined();
      });
    });

    describe('writeRange', () => {
      it('should write 2D array of values', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const result = writeRange(sheet, 'D1', [['Country'], ['USA'], ['USA']]);

        expect(result).toEqual({
          updatedCells: 3,
          updatedRows: 3,
          updatedColumns: 1,
        });
        expect(sheet['D1'].v).toBe('Country');
        expect(sheet['D2'].v).toBe('USA');
        expect(sheet['D3'].v).toBe('USA');
      });

      it('should handle varying row lengths', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const result = writeRange(sheet, 'E1', [['A', 'B', 'C'], ['D']]);

        expect(result.updatedColumns).toBe(3);
        expect(result.updatedRows).toBe(2);
      });
    });

    describe('appendRows', () => {
      it('should append rows after existing data', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const result = appendRows(sheet, [['Charlie', 35, 'Chicago']]);

        expect(result.appendedRows).toBe(1);
        expect(result.startingRow).toBe(4); // 1-based, after 3 existing rows
        expect(sheet['A4'].v).toBe('Charlie');
      });

      it('should append multiple rows', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const result = appendRows(sheet, [
          ['Charlie', 35, 'Chicago'],
          ['Diana', 28, 'Seattle'],
        ]);

        expect(result.appendedRows).toBe(2);
        expect(sheet['A5'].v).toBe('Diana');
      });

      it('should respect startColumn parameter', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        appendRows(sheet, [['Extra']], 'D');

        expect(sheet['D4'].v).toBe('Extra');
      });
    });

    describe('clearRange', () => {
      it('should clear single cell', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        expect(sheet['A1']).toBeDefined();

        const cleared = clearRange(sheet, 'A1');
        expect(cleared).toBe(1);
        expect(sheet['A1']).toBeUndefined();
      });

      it('should clear range of cells', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const cleared = clearRange(sheet, 'A1:C1');

        expect(cleared).toBe(3);
        expect(sheet['A1']).toBeUndefined();
        expect(sheet['B1']).toBeUndefined();
        expect(sheet['C1']).toBeUndefined();
      });

      it('should return 0 for already empty range', () => {
        const sheet = getWorksheet(workbook, 'Sheet1');
        const cleared = clearRange(sheet, 'Z99');
        expect(cleared).toBe(0);
      });
    });

    describe('getSheetInfo', () => {
      it('should return sheet information', () => {
        const info = getSheetInfo(workbook, 'Sheet1');

        expect(info.name).toBe('Sheet1');
        expect(info.rowCount).toBe(3);
        expect(info.columnCount).toBe(3);
        expect(info.range).toBe('A1:C3');
        expect(info.usedRange).toBe('A1:C3');
      });
    });

    describe('addSheet', () => {
      it('should add a new sheet', () => {
        const sheet = addSheet(workbook, 'NewSheet');

        expect(sheet).toBeDefined();
        expect(workbook.SheetNames).toContain('NewSheet');
      });

      it('should throw if sheet already exists', () => {
        expect(() => addSheet(workbook, 'Sheet1')).toThrow('Sheet "Sheet1" already exists');
      });
    });

    describe('deleteSheet', () => {
      it('should delete a sheet', () => {
        addSheet(workbook, 'ToDelete');
        expect(workbook.SheetNames).toContain('ToDelete');

        deleteSheet(workbook, 'ToDelete');
        expect(workbook.SheetNames).not.toContain('ToDelete');
      });

      it('should throw if sheet not found', () => {
        expect(() => deleteSheet(workbook, 'NonExistent')).toThrow('Sheet "NonExistent" not found');
      });

      it('should throw if trying to delete only sheet', () => {
        expect(() => deleteSheet(workbook, 'Sheet1')).toThrow('Cannot delete the only sheet');
      });
    });

    describe('renameSheet', () => {
      it('should rename a sheet', () => {
        renameSheet(workbook, 'Sheet1', 'RenamedSheet');

        expect(workbook.SheetNames).toContain('RenamedSheet');
        expect(workbook.SheetNames).not.toContain('Sheet1');
        expect(workbook.Sheets['RenamedSheet']).toBeDefined();
        expect(workbook.Sheets['Sheet1']).toBeUndefined();
      });

      it('should throw if old name not found', () => {
        expect(() => renameSheet(workbook, 'NonExistent', 'NewName')).toThrow(
          'Sheet "NonExistent" not found'
        );
      });

      it('should throw if new name already exists', () => {
        addSheet(workbook, 'Sheet2');
        expect(() => renameSheet(workbook, 'Sheet1', 'Sheet2')).toThrow(
          'Sheet "Sheet2" already exists'
        );
      });
    });
  });
});
