// tests/helpers.test.js
import { findTextRange } from '../dist/googleDocsApiHelpers.js';
import { describe, it, expect, vi } from 'vitest';

describe('Text Range Finding', () => {
  // Test hypothesis 1: Text range finding works correctly

  describe('findTextRange', () => {
    it('should find text within a single text run correctly', async () => {
      // Mock the docs.documents.get method to return a predefined structure
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [
                        {
                          startIndex: 1,
                          endIndex: 25,
                          textRun: {
                            content: 'This is a test sentence.',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          })),
        },
      };

      // Test finding "test" in the sample text
      const result = await findTextRange(mockDocs, 'doc123', 'test', 1);
      expect(result).toEqual({ startIndex: 11, endIndex: 15 });

      // Verify the docs.documents.get was called with the right parameters
      expect(mockDocs.documents.get.mock.calls.length).toBe(1);
      expect(mockDocs.documents.get.mock.calls[0][0]).toEqual({
        documentId: 'doc123',
        fields:
          'body(content(paragraph(elements(startIndex,endIndex,textRun(content))),table,sectionBreak,tableOfContents,startIndex,endIndex))',
      });
    });

    it('should find the nth instance of text correctly', async () => {
      // Mock with a document that has repeated text
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [
                        {
                          startIndex: 1,
                          endIndex: 41,
                          textRun: {
                            content: 'Test test test. This is a test sentence.',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          })),
        },
      };

      // Find the 3rd instance of "test"
      const result = await findTextRange(mockDocs, 'doc123', 'test', 3);
      expect(result).toEqual({ startIndex: 27, endIndex: 31 });
    });

    it('should return null if text is not found', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [
                        {
                          startIndex: 1,
                          endIndex: 25,
                          textRun: {
                            content: 'This is a sample sentence.',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          })),
        },
      };

      // Try to find text that doesn't exist
      const result = await findTextRange(mockDocs, 'doc123', 'test', 1);
      expect(result).toBe(null);
    });

    it('should handle text spanning multiple text runs', async () => {
      const mockDocs = {
        documents: {
          get: vi.fn(async () => ({
            data: {
              body: {
                content: [
                  {
                    paragraph: {
                      elements: [
                        {
                          startIndex: 1,
                          endIndex: 6,
                          textRun: {
                            content: 'This ',
                          },
                        },
                        {
                          startIndex: 6,
                          endIndex: 11,
                          textRun: {
                            content: 'is a ',
                          },
                        },
                        {
                          startIndex: 11,
                          endIndex: 20,
                          textRun: {
                            content: 'test case',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          })),
        },
      };

      // Find text that spans runs: "a test"
      const result = await findTextRange(mockDocs, 'doc123', 'a test', 1);
      expect(result).toEqual({ startIndex: 9, endIndex: 15 });
    });
  });
});
