// tests/sheetsHelpers.test.js
import { a1ToRowCol, rowColToA1, normalizeRange } from '../dist/googleSheetsApiHelpers.js';
import { describe, it, expect } from 'vitest';

describe('Sheets A1 Notation Helpers', () => {
  describe('a1ToRowCol', () => {
    it('should convert simple A1 notation correctly', () => {
      expect(a1ToRowCol('A1')).toEqual({ row: 0, col: 0 });
      expect(a1ToRowCol('B1')).toEqual({ row: 0, col: 1 });
      expect(a1ToRowCol('A2')).toEqual({ row: 1, col: 0 });
      expect(a1ToRowCol('B2')).toEqual({ row: 1, col: 1 });
    });

    it('should handle double-letter columns', () => {
      expect(a1ToRowCol('AA1')).toEqual({ row: 0, col: 26 });
      expect(a1ToRowCol('AB1')).toEqual({ row: 0, col: 27 });
      expect(a1ToRowCol('AZ1')).toEqual({ row: 0, col: 51 });
      expect(a1ToRowCol('BA1')).toEqual({ row: 0, col: 52 });
    });

    it('should handle triple-letter columns', () => {
      expect(a1ToRowCol('AAA1')).toEqual({ row: 0, col: 702 });
    });

    it('should handle large row numbers', () => {
      expect(a1ToRowCol('A1000')).toEqual({ row: 999, col: 0 });
      expect(a1ToRowCol('Z999')).toEqual({ row: 998, col: 25 });
    });

    it('should be case-insensitive', () => {
      expect(a1ToRowCol('a1')).toEqual({ row: 0, col: 0 });
      expect(a1ToRowCol('aa1')).toEqual({ row: 0, col: 26 });
    });

    it('should throw UserError for invalid notation', () => {
      expect(() => a1ToRowCol('')).toThrow();
      expect(() => a1ToRowCol('1')).toThrow();
      expect(() => a1ToRowCol('A')).toThrow();
      expect(() => a1ToRowCol('1A')).toThrow();
      expect(() => a1ToRowCol('A-1')).toThrow();
      expect(() => a1ToRowCol('A1:B2')).toThrow(); // Range, not cell
    });

    it('should handle A0 notation (returns row -1)', () => {
      // Note: The function doesn't validate row >= 1, so A0 returns {row: -1, col: 0}
      // This behavior could be considered a bug but matches current implementation
      expect(a1ToRowCol('A0')).toEqual({ row: -1, col: 0 });
    });
  });

  describe('rowColToA1', () => {
    it('should convert simple indices correctly', () => {
      expect(rowColToA1(0, 0)).toBe('A1');
      expect(rowColToA1(0, 1)).toBe('B1');
      expect(rowColToA1(1, 0)).toBe('A2');
      expect(rowColToA1(1, 1)).toBe('B2');
    });

    it('should handle double-letter columns', () => {
      expect(rowColToA1(0, 26)).toBe('AA1');
      expect(rowColToA1(0, 27)).toBe('AB1');
      expect(rowColToA1(0, 51)).toBe('AZ1');
      expect(rowColToA1(0, 52)).toBe('BA1');
    });

    it('should handle triple-letter columns', () => {
      expect(rowColToA1(0, 702)).toBe('AAA1');
    });

    it('should handle large row numbers', () => {
      expect(rowColToA1(999, 0)).toBe('A1000');
      expect(rowColToA1(998, 25)).toBe('Z999');
    });

    it('should throw UserError for negative indices', () => {
      expect(() => rowColToA1(-1, 0)).toThrow();
      expect(() => rowColToA1(0, -1)).toThrow();
      expect(() => rowColToA1(-1, -1)).toThrow();
    });

    it('should be inverse of a1ToRowCol', () => {
      // Test round-trip conversion
      const testCases = ['A1', 'Z1', 'AA1', 'AZ1', 'BA1', 'ZZ1', 'AAA1', 'A100', 'Z999'];
      for (const cell of testCases) {
        const { row, col } = a1ToRowCol(cell);
        expect(rowColToA1(row, col)).toBe(cell.toUpperCase());
      }
    });
  });

  describe('normalizeRange', () => {
    it('should prepend default sheet name when no sheet specified', () => {
      expect(normalizeRange('A1')).toBe('Sheet1!A1');
      expect(normalizeRange('A1:B2')).toBe('Sheet1!A1:B2');
    });

    it('should prepend custom sheet name when provided', () => {
      expect(normalizeRange('A1', 'MySheet')).toBe('MySheet!A1');
      expect(normalizeRange('A1:B2', 'Data')).toBe('Data!A1:B2');
    });

    it('should not modify ranges that already have sheet name', () => {
      expect(normalizeRange('Sheet1!A1')).toBe('Sheet1!A1');
      expect(normalizeRange('MyData!A1:B2')).toBe('MyData!A1:B2');
      expect(normalizeRange("'Sheet Name'!A1")).toBe("'Sheet Name'!A1");
    });

    it('should not add sheet name if already present even when sheetName provided', () => {
      // The function prioritizes existing sheet name in the range
      expect(normalizeRange('ExistingSheet!A1', 'NewSheet')).toBe('ExistingSheet!A1');
    });
  });
});
