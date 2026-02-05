// slides.tools.ts - Slides tool module
import { z } from 'zod';
import { type SlidesToolOptions, type PageElement, type SlidesRequest } from '../types.js';
import { getSlidesUrl } from '../urlHelpers.js';
import { escapeDriveQuery } from '../securityHelpers.js';

export function registerSlidesTools(options: SlidesToolOptions) {
  const { server, getSlidesClient, getDriveClient, getAccountEmail } = options;
  server.addTool({
    name: 'listPresentations',
    description: 'List Google Slides presentations in Drive with optional search.',
    annotations: {
      title: 'List Presentations',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z
      .object({
        account: z.string().describe('Account name to use'),
        maxResults: z.number().optional().default(20).describe('Maximum results (default: 20)'),
        query: z
          .string()
          .optional()
          .describe(
            'Search query to filter presentations by name or content. Cannot be used with orderBy (Google Drive API limitation).'
          ),
        orderBy: z
          .enum(['name', 'modifiedTime', 'createdTime'])
          .optional()
          .describe(
            'Sort order for results (default: modifiedTime). Cannot be used with query (Google Drive API limitation).'
          ),
      })
      .refine((data) => !(data.query && data.orderBy), {
        message:
          'Cannot use both query and orderBy together. Google Drive API does not support sorting when using fullText search.',
        path: ['orderBy'],
      }),
    async execute(args, { log: _log }) {
      const drive = await getDriveClient(args.account);

      let queryString = "mimeType='application/vnd.google-apps.presentation' and trashed=false";
      if (args.query) {
        const safeQuery = escapeDriveQuery(args.query);
        queryString += ` and (name contains '${safeQuery}' or fullText contains '${safeQuery}')`;
      }

      // Don't use orderBy when query contains fullText search (Google Drive API limitation)
      const orderBy = args.query
        ? undefined
        : args.orderBy
          ? args.orderBy === 'name'
            ? 'name'
            : args.orderBy
          : 'modifiedTime';

      const response = await drive.files.list({
        q: queryString,
        pageSize: args.maxResults,
        orderBy,
        fields: 'files(id, name, createdTime, modifiedTime, owners, webViewLink)',
      });

      const accountEmail = await getAccountEmail(args.account);
      const presentations = response.data.files ?? [];

      let result = `**Presentations (${presentations.length} found)**\n\n`;

      if (presentations.length === 0) {
        result += 'No presentations found.';
        return result;
      }

      presentations.forEach((p, i) => {
        const link = p.id ? getSlidesUrl(p.id, accountEmail) : p.webViewLink;
        result += `${i + 1}. ${p.name}\n`;
        result += `   ID: ${p.id}\n`;
        result += `   Modified: ${p.modifiedTime}\n`;
        result += `   Created: ${p.createdTime}\n`;
        if (p.owners?.length) {
          result += `   Owner: ${p.owners.map((o) => o.emailAddress).join(', ')}\n`;
        }
        if (link) result += `   Link: ${link}\n`;
        result += '\n';
      });

      return result;
    },
  });

  // --- Read Presentation ---
  server.addTool({
    name: 'readPresentation',
    description: 'Read the content and structure of a Google Slides presentation.',
    annotations: {
      title: 'Read Presentation',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      presentationId: z.string().describe('Presentation ID (from URL)'),
    }),
    async execute(args, { log: _log }) {
      const slides = await getSlidesClient(args.account);

      const response = await slides.presentations.get({
        presentationId: args.presentationId,
      });

      const pres = response.data;
      const accountEmail = await getAccountEmail(args.account);
      const link = pres.presentationId
        ? getSlidesUrl(pres.presentationId, accountEmail)
        : undefined;

      let result = `**Presentation: ${pres.title}**\n\n`;
      result += `ID: ${pres.presentationId}\n`;
      result += `Locale: ${pres.locale || 'N/A'}\n`;
      result += `Slides: ${pres.slides?.length || 0}\n`;
      if (pres.pageSize) {
        const width = pres.pageSize.width;
        const height = pres.pageSize.height;
        if (width?.magnitude && height?.magnitude) {
          result += `Page Size: ${width.magnitude}${width.unit} x ${height.magnitude}${height.unit}\n`;
        }
      }
      if (link) result += `Link: ${link}\n`;
      result += '\n';

      if (pres.slides && pres.slides.length > 0) {
        result += '**Slides:**\n\n';
        pres.slides.forEach((slide, idx) => {
          // Extract text content from the slide
          const textElements: string[] = [];
          const extractText = (element: PageElement) => {
            if (element.shape?.text?.textElements) {
              for (const te of element.shape.text.textElements) {
                if (te.textRun?.content) {
                  textElements.push(te.textRun.content.trim());
                }
              }
            }
          };
          slide.pageElements?.forEach(extractText);

          const textContent = textElements.filter((t) => t).join(' | ');

          result += `Slide ${idx + 1} (ID: ${slide.objectId})\n`;
          result += `  Elements: ${slide.pageElements?.length || 0}\n`;
          if (textContent) {
            result += `  Text: ${textContent.substring(0, 200)}${textContent.length > 200 ? '...' : ''}\n`;
          }
          result += '\n';
        });
      }

      return result;
    },
  });

  // --- Create Presentation ---
  server.addTool({
    name: 'createPresentation',
    description: 'Create a new Google Slides presentation.',
    annotations: {
      title: 'Create Presentation',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      title: z.string().describe('Presentation title'),
    }),
    async execute(args, { log: _log }) {
      const slides = await getSlidesClient(args.account);

      const response = await slides.presentations.create({
        requestBody: {
          title: args.title,
        },
      });

      const accountEmail = await getAccountEmail(args.account);
      const link = response.data.presentationId
        ? getSlidesUrl(response.data.presentationId, accountEmail)
        : undefined;

      let result = 'Successfully created presentation.\n\n';
      result += `Title: ${response.data.title}\n`;
      result += `Presentation ID: ${response.data.presentationId}\n`;
      result += `Initial Slides: ${response.data.slides?.length || 0}\n`;
      if (link) result += `\nOpen presentation: ${link}`;

      return result;
    },
  });

  // --- Add Slide ---
  server.addTool({
    name: 'addSlide',
    description: 'Add a new slide to a presentation.',
    annotations: {
      title: 'Add Slide',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      presentationId: z.string().describe('Presentation ID'),
      insertionIndex: z
        .number()
        .optional()
        .describe('Position to insert (0-based). Omit to add at end.'),
      layout: z
        .enum([
          'BLANK',
          'CAPTION_ONLY',
          'TITLE',
          'TITLE_AND_BODY',
          'TITLE_AND_TWO_COLUMNS',
          'TITLE_ONLY',
          'ONE_COLUMN_TEXT',
          'MAIN_POINT',
          'BIG_NUMBER',
        ])
        .optional()
        .default('BLANK')
        .describe('Slide layout'),
    }),
    async execute(args, { log: _log }) {
      const slides = await getSlidesClient(args.account);

      // First get the presentation to find layout IDs
      const pres = await slides.presentations.get({
        presentationId: args.presentationId,
      });

      // Find a matching layout
      const layouts = pres.data.layouts ?? [];
      let layoutId: string | undefined;
      for (const layout of layouts) {
        if (
          layout.layoutProperties?.name?.includes(args.layout) ||
          layout.layoutProperties?.displayName?.includes(args.layout)
        ) {
          layoutId = layout.objectId ?? undefined;
          break;
        }
      }

      const slideId = 'slide_' + Date.now().toString(36);

      const requests: SlidesRequest[] = [
        {
          createSlide: {
            objectId: slideId,
            insertionIndex: args.insertionIndex,
            slideLayoutReference: layoutId ? { layoutId } : undefined,
          },
        },
      ];

      await slides.presentations.batchUpdate({
        presentationId: args.presentationId,
        requestBody: { requests },
      });

      const accountEmail = await getAccountEmail(args.account);
      const link = getSlidesUrl(args.presentationId, accountEmail);

      let result = 'Successfully added slide.\n\n';
      result += `Slide ID: ${slideId}\n`;
      result += `Layout: ${args.layout}\n`;
      if (args.insertionIndex !== undefined) {
        result += `Position: ${args.insertionIndex}\n`;
      } else {
        result += 'Position: End of presentation\n';
      }
      result += `Presentation ID: ${args.presentationId}\n`;
      result += `\nOpen presentation: ${link}`;

      return result;
    },
  });

  // --- Add Text to Slide ---
  server.addTool({
    name: 'addTextToSlide',
    description: 'Add a text box with content to a slide.',
    annotations: {
      title: 'Add Text to Slide',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      presentationId: z.string().describe('Presentation ID'),
      slideId: z.string().describe('Slide object ID'),
      text: z.string().describe('Text content to add'),
      x: z.number().optional().default(100).describe('X position in points (default: 100)'),
      y: z.number().optional().default(100).describe('Y position in points (default: 100)'),
      width: z.number().optional().default(400).describe('Width in points (default: 400)'),
      height: z.number().optional().default(100).describe('Height in points (default: 100)'),
    }),
    async execute(args, { log: _log }) {
      const slides = await getSlidesClient(args.account);

      const textBoxId = 'textbox_' + Date.now().toString(36);

      const requests = [
        {
          createShape: {
            objectId: textBoxId,
            shapeType: 'TEXT_BOX',
            elementProperties: {
              pageObjectId: args.slideId,
              size: {
                width: { magnitude: args.width, unit: 'PT' },
                height: { magnitude: args.height, unit: 'PT' },
              },
              transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: args.x,
                translateY: args.y,
                unit: 'PT',
              },
            },
          },
        },
        {
          insertText: {
            objectId: textBoxId,
            text: args.text,
            insertionIndex: 0,
          },
        },
      ];

      await slides.presentations.batchUpdate({
        presentationId: args.presentationId,
        requestBody: { requests },
      });

      const accountEmail = await getAccountEmail(args.account);
      const link = getSlidesUrl(args.presentationId, accountEmail);

      let result = 'Successfully added text box to slide.\n\n';
      result += `Text Box ID: ${textBoxId}\n`;
      result += `Slide ID: ${args.slideId}\n`;
      result += `Position: (${args.x}, ${args.y}) points\n`;
      result += `Size: ${args.width} x ${args.height} points\n`;
      result += `Text: ${args.text.substring(0, 100)}${args.text.length > 100 ? '...' : ''}\n`;
      result += `\nOpen presentation: ${link}`;

      return result;
    },
  });
}
