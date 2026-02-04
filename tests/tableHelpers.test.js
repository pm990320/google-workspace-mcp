// tests/tableHelpers.test.js
import {
  findDocumentTables,
  findTableCellRange,
  editTableCellContent,
} from '../dist/googleDocsApiHelpers.js';
import { describe, it, expect, vi } from 'vitest';

// Helper to create a mock table structure
function createMockTable(startIndex, rows, columns) {
  const tableRows = [];
  let currentIndex = startIndex + 1; // Table content starts after table element

  for (let r = 0; r < rows; r++) {
    const tableCells = [];
    for (let c = 0; c < columns; c++) {
      const cellStartIndex = currentIndex;
      const cellEndIndex = currentIndex + 2; // Each cell has a paragraph with newline
      tableCells.push({
        content: [
          {
            paragraph: {
              elements: [
                { startIndex: cellStartIndex, endIndex: cellEndIndex, textRun: { content: '\n' } },
              ],
            },
            startIndex: cellStartIndex,
            endIndex: cellEndIndex,
          },
        ],
      });
      currentIndex = cellEndIndex;
    }
    tableRows.push({ tableCells });
  }

  return {
    table: { tableRows },
    startIndex,
    endIndex: currentIndex,
  };
}

describe('Table Helper Functions', () => {
  describe('findDocumentTables', () => {
    it('should find tables in a document and return their metadata', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [{ startIndex: 1, endIndex: 10, textRun: { content: 'Hello\n' } }],
                    },
                    startIndex: 1,
                    endIndex: 10,
                  },
                  createMockTable(10, 2, 3), // 2 rows, 3 columns starting at index 10
                ],
              },
            },
          })),
        },
      };

      const result = await findDocumentTables(mockDocs, 'doc123');

      expect(result.length).toBe(1);
      expect(result[0].startIndex).toBe(10);
      expect(result[0].rows).toBe(2);
      expect(result[0].columns).toBe(3);
    });

    it('should find multiple tables in a document', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  createMockTable(1, 2, 2), // First table: 2x2
                  {
                    paragraph: {
                      elements: [
                        { startIndex: 20, endIndex: 30, textRun: { content: 'Some text\n' } },
                      ],
                    },
                    startIndex: 20,
                    endIndex: 30,
                  },
                  createMockTable(30, 3, 4), // Second table: 3x4
                ],
              },
            },
          })),
        },
      };

      const result = await findDocumentTables(mockDocs, 'doc123');

      expect(result.length).toBe(2);
      expect(result[0].rows).toBe(2);
      expect(result[0].columns).toBe(2);
      expect(result[1].rows).toBe(3);
      expect(result[1].columns).toBe(4);
    });

    it('should return empty array when document has no tables', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [
                        { startIndex: 1, endIndex: 20, textRun: { content: 'Just some text.\n' } },
                      ],
                    },
                    startIndex: 1,
                    endIndex: 20,
                  },
                ],
              },
            },
          })),
        },
      };

      const result = await findDocumentTables(mockDocs, 'doc123');

      expect(result.length).toBe(0);
    });

    it('should return empty array when document body has no content', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {},
            },
          })),
        },
      };

      const result = await findDocumentTables(mockDocs, 'doc123');

      expect(result.length).toBe(0);
    });
  });

  describe('findTableCellRange', () => {
    it('should find the cell range for a valid row and column', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    table: {
                      tableRows: [
                        {
                          tableCells: [
                            {
                              content: [
                                { startIndex: 5, endIndex: 10, paragraph: { elements: [] } },
                              ],
                            },
                            {
                              content: [
                                { startIndex: 10, endIndex: 15, paragraph: { elements: [] } },
                              ],
                            },
                          ],
                        },
                        {
                          tableCells: [
                            {
                              content: [
                                { startIndex: 15, endIndex: 20, paragraph: { elements: [] } },
                              ],
                            },
                            {
                              content: [
                                { startIndex: 20, endIndex: 25, paragraph: { elements: [] } },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    startIndex: 1,
                    endIndex: 30,
                  },
                ],
              },
            },
          })),
        },
      };

      // Get cell at row 1, column 1 (second row, second column - 0-indexed)
      const result = await findTableCellRange(mockDocs, 'doc123', 1, 1, 1);

      expect(result).toEqual({ startIndex: 20, endIndex: 25 });
    });

    it('should throw UserError for out-of-bounds row index', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    table: {
                      tableRows: [
                        {
                          tableCells: [{ content: [{ startIndex: 5, endIndex: 10 }] }],
                        },
                      ],
                    },
                    startIndex: 1,
                    endIndex: 15,
                  },
                ],
              },
            },
          })),
        },
      };

      await expect(findTableCellRange(mockDocs, 'doc123', 1, 5, 0)).rejects.toThrow(
        /Row index 5 out of bounds/
      );
    });

    it('should throw UserError for out-of-bounds column index', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    table: {
                      tableRows: [
                        {
                          tableCells: [{ content: [{ startIndex: 5, endIndex: 10 }] }],
                        },
                      ],
                    },
                    startIndex: 1,
                    endIndex: 15,
                  },
                ],
              },
            },
          })),
        },
      };

      await expect(findTableCellRange(mockDocs, 'doc123', 1, 0, 5)).rejects.toThrow(
        /Column index 5 out of bounds/
      );
    });

    it('should throw UserError when no table found at specified index', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    paragraph: { elements: [] },
                    startIndex: 1,
                    endIndex: 10,
                  },
                ],
              },
            },
          })),
        },
      };

      await expect(findTableCellRange(mockDocs, 'doc123', 100, 0, 0)).rejects.toThrow(
        /No table found at index 100/
      );
    });
  });

  describe('editTableCellContent', () => {
    it('should generate correct requests for editing cell content', async () => {
      let capturedRequests = null;

      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    table: {
                      tableRows: [
                        {
                          tableCells: [
                            {
                              content: [
                                { startIndex: 5, endIndex: 15, paragraph: { elements: [] } },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    startIndex: 1,
                    endIndex: 20,
                  },
                ],
              },
            },
          })),
          batchUpdate: vi.fn(async (params) => {
            capturedRequests = params.requestBody.requests;
            return { data: { documentId: 'doc123' } };
          }),
        },
      };

      await editTableCellContent(mockDocs, 'doc123', 1, 0, 0, 'New content');

      // Should have 2 requests: delete existing content, then insert new
      expect(capturedRequests.length).toBe(2);

      // First request should be deleteContentRange (from startIndex to endIndex-1)
      expect(capturedRequests[0].deleteContentRange).toBeTruthy();
      expect(capturedRequests[0].deleteContentRange.range.startIndex).toBe(5);
      expect(capturedRequests[0].deleteContentRange.range.endIndex).toBe(14); // 15-1

      // Second request should be insertText
      expect(capturedRequests[1].insertText).toBeTruthy();
      expect(capturedRequests[1].insertText.location.index).toBe(5);
      expect(capturedRequests[1].insertText.text).toBe('New content');
    });

    it('should only insert when cell is empty (no content to delete)', async () => {
      let capturedRequests = null;

      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    table: {
                      tableRows: [
                        {
                          tableCells: [
                            {
                              content: [
                                { startIndex: 5, endIndex: 6, paragraph: { elements: [] } }, // Single newline only
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    startIndex: 1,
                    endIndex: 10,
                  },
                ],
              },
            },
          })),
          batchUpdate: vi.fn(async (params) => {
            capturedRequests = params.requestBody.requests;
            return { data: { documentId: 'doc123' } };
          }),
        },
      };

      await editTableCellContent(mockDocs, 'doc123', 1, 0, 0, 'Content');

      // Should only have insert request (no delete since cell was empty - startIndex 5, endIndex 6, delete would be 5 to 5)
      expect(capturedRequests.length).toBe(1);
      expect(capturedRequests[0].insertText).toBeTruthy();
      expect(capturedRequests[0].insertText.text).toBe('Content');
    });

    it('should return empty response when new content is empty and cell has only newline', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    table: {
                      tableRows: [
                        {
                          tableCells: [
                            {
                              content: [
                                { startIndex: 5, endIndex: 6, paragraph: { elements: [] } },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    startIndex: 1,
                    endIndex: 10,
                  },
                ],
              },
            },
          })),
          batchUpdate: vi.fn(async () => {
            return { data: { documentId: 'doc123' } };
          }),
        },
      };

      const result = await editTableCellContent(mockDocs, 'doc123', 1, 0, 0, '');

      // With empty content and nothing to delete, should return empty object
      expect(result).toEqual({});
    });
  });
});
