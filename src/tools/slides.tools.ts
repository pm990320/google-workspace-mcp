// slides.tools.ts - Auto-generated tool module
import { z } from 'zod';
import { type slides_v1, type drive_v3 } from 'googleapis';
import { type FastMCPServer, type PageElement, type SlidesRequest } from '../types.js';

export function registerSlidesTools(
  server: FastMCPServer,
  getClient: (accountName: string) => Promise<slides_v1.Slides>,
  getDrive: (accountName: string) => Promise<drive_v3.Drive>
) {
  server.addTool({
    name: 'listPresentations',
    description: 'List Google Slides presentations in Drive.',
    annotations: {
      title: 'List Presentations',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      maxResults: z.number().optional().default(20).describe('Maximum results (default: 20)'),
    }),
    async execute(args, { log: _log }) {
      const drive = await getDrive(args.account);

      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.presentation'",
        pageSize: args.maxResults,
        fields: 'files(id, name, createdTime, modifiedTime, owners, webViewLink)',
      });

      return JSON.stringify(
        {
          presentations: (response.data.files || []).map((f) => ({
            id: f.id,
            name: f.name,
            createdTime: f.createdTime,
            modifiedTime: f.modifiedTime,
            owners: f.owners?.map((o) => o.emailAddress),
            webViewLink: f.webViewLink,
          })),
        },
        null,
        2
      );
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
      const slides = await getClient(args.account);

      const response = await slides.presentations.get({
        presentationId: args.presentationId,
      });

      const pres = response.data;

      return JSON.stringify(
        {
          presentationId: pres.presentationId,
          title: pres.title,
          locale: pres.locale,
          pageSize: pres.pageSize,
          slidesCount: pres.slides?.length || 0,
          slides: pres.slides?.map((slide, idx) => {
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

            return {
              slideIndex: idx,
              objectId: slide.objectId,
              textContent: textElements.filter((t) => t).join(' | '),
              elementsCount: slide.pageElements?.length || 0,
            };
          }),
        },
        null,
        2
      );
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
      const slides = await getClient(args.account);

      const response = await slides.presentations.create({
        requestBody: {
          title: args.title,
        },
      });

      return JSON.stringify(
        {
          success: true,
          presentationId: response.data.presentationId,
          title: response.data.title,
          slidesCount: response.data.slides?.length || 0,
        },
        null,
        2
      );
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
      const slides = await getClient(args.account);

      // First get the presentation to find layout IDs
      const pres = await slides.presentations.get({
        presentationId: args.presentationId,
      });

      // Find a matching layout
      const layouts = pres.data.layouts || [];
      let layoutId: string | undefined;
      for (const layout of layouts) {
        if (
          layout.layoutProperties?.name?.includes(args.layout || 'BLANK') ||
          layout.layoutProperties?.displayName?.includes(args.layout || 'BLANK')
        ) {
          layoutId = layout.objectId || undefined;
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

      return JSON.stringify(
        {
          success: true,
          slideId,
          presentationId: args.presentationId,
        },
        null,
        2
      );
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
      const slides = await getClient(args.account);

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

      return JSON.stringify(
        {
          success: true,
          textBoxId,
          slideId: args.slideId,
        },
        null,
        2
      );
    },
  });
}
