// tests/markdown/CompatibilityChecker.test.js
import { CompatibilityChecker } from '../../dist/markdown/CompatibilityChecker.js';
import { IncompatibleElementType } from '../../dist/markdown/types.js';
import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

describe('CompatibilityChecker', () => {
  let checker;

  beforeEach(() => {
    checker = new CompatibilityChecker();
  });

  describe('check()', () => {
    it('should return compatible for a simple text document', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    textRun: {
                      content: 'Hello, world!',
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, true);
      assert.strictEqual(result.issues.length, 0);
    });

    it('should return compatible for document with headings and formatting', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                paragraphStyle: { namedStyleType: 'HEADING_1' },
                elements: [
                  {
                    textRun: {
                      content: 'My Heading',
                      textStyle: { bold: true },
                    },
                  },
                ],
              },
            },
            {
              paragraph: {
                elements: [
                  {
                    textRun: {
                      content: 'Some ',
                    },
                  },
                  {
                    textRun: {
                      content: 'italic',
                      textStyle: { italic: true },
                    },
                  },
                  {
                    textRun: {
                      content: ' text.',
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, true);
    });

    it('should return compatible for document with bullet lists', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                bullet: { listId: 'list1' },
                elements: [{ textRun: { content: 'Item 1' } }],
              },
            },
            {
              paragraph: {
                bullet: { listId: 'list1' },
                elements: [{ textRun: { content: 'Item 2' } }],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, true);
    });

    it('should return compatible for document with simple table', () => {
      const doc = {
        body: {
          content: [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      { content: [{ paragraph: { elements: [{ textRun: { content: 'A' } }] } }] },
                      { content: [{ paragraph: { elements: [{ textRun: { content: 'B' } }] } }] },
                    ],
                  },
                  {
                    tableCells: [
                      { content: [{ paragraph: { elements: [{ textRun: { content: '1' } }] } }] },
                      { content: [{ paragraph: { elements: [{ textRun: { content: '2' } }] } }] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, true);
    });

    it('should return compatible for document with inline images', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    inlineObjectElement: {
                      inlineObjectId: 'img1',
                    },
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
                imageProperties: {
                  sourceUri: 'https://example.com/image.png',
                },
              },
            },
          },
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, true);
    });

    it('should return compatible for document with links', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    textRun: {
                      content: 'Click here',
                      textStyle: {
                        link: { url: 'https://example.com' },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, true);
    });

    it('should return compatible for document with section breaks', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Section 1' } }],
              },
            },
            {
              sectionBreak: {},
            },
            {
              paragraph: {
                elements: [{ textRun: { content: 'Section 2' } }],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, true);
    });
  });

  describe('incompatible elements', () => {
    it('should reject document with headers', () => {
      const doc = {
        body: { content: [] },
        headers: {
          header1: { content: [] },
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues.length, 1);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.HEADER);
    });

    it('should reject document with footers', () => {
      const doc = {
        body: { content: [] },
        footers: {
          footer1: { content: [] },
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.FOOTER);
    });

    it('should reject document with footnotes', () => {
      const doc = {
        body: { content: [] },
        footnotes: {
          fn1: { content: [] },
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.FOOTNOTE);
    });

    it('should reject document with equations', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    equation: {
                      content: 'E = mc^2',
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.EQUATION);
    });

    it('should reject document with @mentions', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    person: {
                      personId: 'user123',
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.PERSON);
    });

    it('should reject document with rich links (smart chips)', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    richLink: {
                      richLinkId: 'chip1',
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.RICH_LINK);
    });

    it('should reject document with table of contents', () => {
      const doc = {
        body: {
          content: [
            {
              tableOfContents: {
                content: [],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.TABLE_OF_CONTENTS);
    });

    it('should reject document with positioned objects', () => {
      const doc = {
        body: { content: [] },
        positionedObjects: {
          obj1: {
            positionedObjectProperties: {},
          },
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.POSITIONED_OBJECT);
    });

    it('should reject document with embedded drawings', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    inlineObjectElement: {
                      inlineObjectId: 'drawing1',
                    },
                  },
                ],
              },
            },
          ],
        },
        inlineObjects: {
          drawing1: {
            inlineObjectProperties: {
              embeddedObject: {
                embeddedDrawingProperties: {},
              },
            },
          },
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.DRAWING);
    });

    it('should reject document with merged table cells', () => {
      const doc = {
        body: {
          content: [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        tableCellStyle: { columnSpan: 2 },
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Merged' } }] } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.MERGED_TABLE_CELL);
    });

    it('should reject document with row-spanned table cells', () => {
      const doc = {
        body: {
          content: [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        tableCellStyle: { rowSpan: 2 },
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Merged' } }] } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.MERGED_TABLE_CELL);
    });

    it('should reject document with footnote references in text', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [
                  {
                    textRun: { content: 'Some text' },
                  },
                  {
                    footnoteReference: {
                      footnoteId: 'fn1',
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.FOOTNOTE);
    });
  });

  describe('multiple issues', () => {
    it('should report multiple different incompatible elements', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ equation: {} }],
              },
            },
            {
              paragraph: {
                elements: [{ person: { personId: 'user1' } }],
              },
            },
          ],
        },
        headers: { h1: {} },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      assert.strictEqual(result.issues.length, 3);
    });

    it('should deduplicate issues of the same type', () => {
      const doc = {
        body: {
          content: [
            {
              paragraph: {
                elements: [{ equation: {} }],
              },
            },
            {
              paragraph: {
                elements: [{ equation: {} }],
              },
            },
          ],
        },
      };

      const result = checker.check(doc);
      assert.strictEqual(result.compatible, false);
      // Should only have one EQUATION issue, not two
      assert.strictEqual(result.issues.length, 1);
      assert.strictEqual(result.issues[0].type, IncompatibleElementType.EQUATION);
    });
  });

  describe('formatIssues()', () => {
    it('should return success message for empty issues', () => {
      const message = CompatibilityChecker.formatIssues([]);
      assert.strictEqual(message, 'Document is compatible with markdown editing.');
    });

    it('should format single issue correctly', () => {
      const issues = [
        {
          type: IncompatibleElementType.EQUATION,
          message: 'Document contains equations.',
        },
      ];
      const message = CompatibilityChecker.formatIssues(issues);
      assert.ok(message.includes('cannot be edited as markdown'));
      assert.ok(message.includes('Document contains equations.'));
      assert.ok(message.includes('Use readGoogleDoc'));
    });

    it('should format multiple issues correctly', () => {
      const issues = [
        { type: IncompatibleElementType.EQUATION, message: 'Has equations.' },
        { type: IncompatibleElementType.HEADER, message: 'Has headers.' },
      ];
      const message = CompatibilityChecker.formatIssues(issues);
      assert.ok(message.includes('Has equations.'));
      assert.ok(message.includes('Has headers.'));
    });
  });
});
