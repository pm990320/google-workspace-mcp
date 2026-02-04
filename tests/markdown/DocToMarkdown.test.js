// tests/markdown/DocToMarkdown.test.js
import { DocToMarkdown } from '../../dist/markdown/DocToMarkdown.js';
import { describe, it, beforeEach, expect } from 'vitest';

describe('DocToMarkdown', () => {
  let converter;

  beforeEach(() => {
    converter = new DocToMarkdown();
  });

  describe('basic text conversion', () => {
    it('should convert a simple paragraph', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Hello, world!' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('Hello, world!');
    });

    it('should convert multiple paragraphs', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'First paragraph.' } }],
              },
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Second paragraph.' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('First paragraph.\n\nSecond paragraph.');
    });

    it('should handle empty document', () => {
      const doc = { body: { content: [] } };
      const result = converter.convert(doc);
      expect(result.markdown).toBe('');
    });

    it('should handle document with no body', () => {
      const doc = {};
      const result = converter.convert(doc);
      expect(result.markdown).toBe('');
    });
  });

  describe('heading conversion', () => {
    it('should convert HEADING_1 to # heading', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'HEADING_1' },
                elements: [{ textRun: { content: 'My Heading' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('# My Heading');
    });

    it('should convert HEADING_2 to ## heading', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'HEADING_2' },
                elements: [{ textRun: { content: 'Subheading' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('## Subheading');
    });

    it('should convert TITLE to # heading', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'TITLE' },
                elements: [{ textRun: { content: 'Document Title' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('# Document Title');
    });

    it('should convert SUBTITLE to ## heading', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'SUBTITLE' },
                elements: [{ textRun: { content: 'Document Subtitle' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('## Document Subtitle');
    });

    it('should handle all heading levels (1-6)', () => {
      const doc = {
        body: {
          content: [1, 2, 3, 4, 5, 6].map((level) => ({
            paragraph: {
              paragraphStyle: { namedStyleType: `HEADING_${level}` },
              elements: [{ textRun: { content: `Heading ${level}` } }],
            },
          })),
        },
      };

      const result = converter.convert(doc);
      const expected = [
        '# Heading 1',
        '## Heading 2',
        '### Heading 3',
        '#### Heading 4',
        '##### Heading 5',
        '###### Heading 6',
      ].join('\n\n');
      expect(result.markdown).toBe(expected);
    });
  });

  describe('inline formatting', () => {
    it('should convert bold text', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'This is ' } },
                  { textRun: { content: 'bold', textStyle: { bold: true } } },
                  { textRun: { content: ' text.' } },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('This is **bold** text.');
    });

    it('should convert italic text', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'This is ' } },
                  { textRun: { content: 'italic', textStyle: { italic: true } } },
                  { textRun: { content: ' text.' } },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('This is *italic* text.');
    });

    it('should convert strikethrough text', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'This is ' } },
                  { textRun: { content: 'deleted', textStyle: { strikethrough: true } } },
                  { textRun: { content: ' text.' } },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('This is ~~deleted~~ text.');
    });

    it('should convert links', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'Visit ' } },
                  {
                    textRun: {
                      content: 'Google',
                      textStyle: { link: { url: 'https://google.com' } },
                    },
                  },
                  { textRun: { content: ' for more.' } },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('Visit [Google](https://google.com) for more.');
    });

    it('should convert bold and italic combined', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    textRun: {
                      content: 'bold and italic',
                      textStyle: { bold: true, italic: true },
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      // Bold is applied first, then italic wraps it
      expect(result.markdown).toBe('***bold and italic***');
    });

    it('should convert monospace font to inline code', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'Run ' } },
                  {
                    textRun: {
                      content: 'npm install',
                      textStyle: { weightedFontFamily: { fontFamily: 'Courier New' } },
                    },
                  },
                  { textRun: { content: ' to install.' } },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('Run `npm install` to install.');
    });
  });

  describe('list conversion', () => {
    it('should convert bullet list items', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                bullet: { listId: 'list1' },
                elements: [{ textRun: { content: 'First item' } }],
              },
            },
            {
              paragraph: {
                bullet: { listId: 'list1' },
                elements: [{ textRun: { content: 'Second item' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('- First item\n- Second item');
    });

    it('should handle nested bullet lists', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                bullet: { listId: 'list1', nestingLevel: 0 },
                elements: [{ textRun: { content: 'Parent item' } }],
              },
            },
            {
              paragraph: {
                bullet: { listId: 'list1', nestingLevel: 1 },
                elements: [{ textRun: { content: 'Child item' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('- Parent item\n  - Child item');
    });
  });

  describe('table conversion', () => {
    it('should convert a simple table', () => {
      const doc = {
        body: {
          content: [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [{ paragraph: { elements: [{ textRun: { content: 'Name' } }] } }],
                      },
                      { content: [{ paragraph: { elements: [{ textRun: { content: 'Age' } }] } }] },
                    ],
                  },
                  {
                    tableCells: [
                      {
                        content: [{ paragraph: { elements: [{ textRun: { content: 'Alice' } }] } }],
                      },
                      { content: [{ paragraph: { elements: [{ textRun: { content: '30' } }] } }] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      const expected = '| Name | Age |\n|---|---|\n| Alice | 30 |';
      expect(result.markdown).toBe(expected);
    });

    it('should handle empty table cells', () => {
      const doc = {
        body: {
          content: [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      { content: [{ paragraph: { elements: [{ textRun: { content: 'A' } }] } }] },
                      { content: [] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toContain('| A |');
    });
  });

  describe('image conversion', () => {
    it('should convert inline images with source URI', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    inlineObjectElement: { inlineObjectId: 'img1' },
                  },
                ],
              },
            },
          ],
        },
        inlineObjects: {
          img1: {
            inlineObjectProperties: {
              embeddedObject: {
                title: 'My Image',
                description: 'A nice picture',
                imageProperties: {
                  sourceUri: 'https://example.com/image.png',
                },
              },
            },
          },
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('![A nice picture](https://example.com/image.png)');
    });

    it('should use title when description is missing', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ inlineObjectElement: { inlineObjectId: 'img1' } }],
              },
            },
          ],
        },
        inlineObjects: {
          img1: {
            inlineObjectProperties: {
              embeddedObject: {
                title: 'Screenshot',
                imageProperties: {
                  sourceUri: 'https://example.com/screenshot.png',
                },
              },
            },
          },
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('![Screenshot](https://example.com/screenshot.png)');
    });

    it('should handle missing inline object gracefully', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'Before ' } },
                  { inlineObjectElement: { inlineObjectId: 'missing' } },
                  { textRun: { content: ' after' } },
                ],
              },
            },
          ],
        },
        inlineObjects: {},
      };

      const result = converter.convert(doc);
      // Double space is expected since the original text runs have surrounding spaces
      expect(result.markdown).toBe('Before  after');
    });
  });

  describe('section breaks', () => {
    it('should convert section breaks to horizontal rules', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Section 1' } }],
              },
            },
            { sectionBreak: {} },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Section 2' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('Section 1\n\n---\n\nSection 2');
    });
  });

  describe('horizontal rules', () => {
    it('should convert horizontal rule elements', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Above' } }],
              },
            },
            {
              paragraph: {
                elements: [{ horizontalRule: {} }],
              },
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Below' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toContain('---');
    });
  });

  describe('line numbers option', () => {
    it('should add line numbers when requested', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Line one' } }],
              },
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Line two' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc, { includeLineNumbers: true });
      expect(result.markdown).toContain('1\t');
      expect(result.markdown).toContain('Line one');
    });
  });

  describe('whitespace handling', () => {
    it('should preserve spacing around formatted text', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  { textRun: { content: 'Hello ' } },
                  { textRun: { content: 'world', textStyle: { bold: true } } },
                  { textRun: { content: ' today!' } },
                ],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      expect(result.markdown).toBe('Hello **world** today!');
    });

    it('should collapse excessive newlines', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'First' } }],
              },
            },
            { paragraph: { elements: [] } },
            { paragraph: { elements: [] } },
            { paragraph: { elements: [] } },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Second' } }],
              },
            },
          ],
        },
      };

      const result = converter.convert(doc);
      // Should not have more than 2 consecutive newlines
      expect(result.markdown).not.toContain('\n\n\n');
    });
  });
});
