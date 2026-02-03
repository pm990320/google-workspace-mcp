// forms.tools.ts - Auto-generated tool module
import { z } from 'zod';
import { type forms_v1, type drive_v3 } from 'googleapis';
import { type FastMCPServer, type FormsQuestion } from '../types.js';

export function registerFormsTools(
  server: FastMCPServer,
  getClient: (accountName: string) => Promise<forms_v1.Forms>,
  getDrive: (accountName: string) => Promise<drive_v3.Drive>
) {
  server.addTool({
    name: 'listForms',
    description: 'List Google Forms in Drive.',
    annotations: {
      title: 'List Forms',
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
        q: "mimeType='application/vnd.google-apps.form'",
        pageSize: args.maxResults,
        fields: 'files(id, name, createdTime, modifiedTime, owners, webViewLink)',
      });

      return JSON.stringify(
        {
          forms: (response.data.files ?? []).map((f) => ({
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

  // --- Read Form ---
  server.addTool({
    name: 'readForm',
    description: 'Read the structure and questions of a Google Form.',
    annotations: {
      title: 'Read Form',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      formId: z.string().describe('Form ID (from URL)'),
    }),
    async execute(args, { log: _log }) {
      const forms = await getClient(args.account);

      const response = await forms.forms.get({
        formId: args.formId,
      });

      const form = response.data;

      return JSON.stringify(
        {
          formId: form.formId,
          title: form.info?.title,
          description: form.info?.description,
          documentTitle: form.info?.documentTitle,
          responderUri: form.responderUri,
          linkedSheetId: form.linkedSheetId,
          items: form.items?.map((item) => ({
            itemId: item.itemId,
            title: item.title,
            description: item.description,
            questionType: item.questionItem?.question?.choiceQuestion
              ? 'choice'
              : item.questionItem?.question?.textQuestion
                ? 'text'
                : item.questionItem?.question?.scaleQuestion
                  ? 'scale'
                  : item.questionItem?.question?.dateQuestion
                    ? 'date'
                    : item.questionItem?.question?.timeQuestion
                      ? 'time'
                      : item.questionItem?.question?.fileUploadQuestion
                        ? 'fileUpload'
                        : item.questionGroupItem
                          ? 'questionGroup'
                          : item.pageBreakItem
                            ? 'pageBreak'
                            : item.textItem
                              ? 'text_display'
                              : item.imageItem
                                ? 'image'
                                : item.videoItem
                                  ? 'video'
                                  : 'unknown',
            required: item.questionItem?.question?.required,
          })),
        },
        null,
        2
      );
    },
  });

  // --- Get Form Responses ---
  server.addTool({
    name: 'getFormResponses',
    description: 'Get responses submitted to a Google Form.',
    annotations: {
      title: 'Get Form Responses',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      formId: z.string().describe('Form ID'),
      maxResponses: z
        .number()
        .optional()
        .default(50)
        .describe('Maximum responses to return (default: 50)'),
    }),
    async execute(args, { log: _log }) {
      const forms = await getClient(args.account);

      const response = await forms.forms.responses.list({
        formId: args.formId,
        pageSize: args.maxResponses,
      });

      return JSON.stringify(
        {
          formId: args.formId,
          responsesCount: response.data.responses?.length || 0,
          responses: response.data.responses?.map((r) => ({
            responseId: r.responseId,
            createTime: r.createTime,
            lastSubmittedTime: r.lastSubmittedTime,
            respondentEmail: r.respondentEmail,
            answers: r.answers
              ? Object.entries(r.answers).map(([questionId, answer]) => ({
                  questionId,
                  textAnswers: answer.textAnswers?.answers?.map((a) => a.value),
                  fileUploadAnswers: answer.fileUploadAnswers?.answers?.map((a) => ({
                    fileId: a.fileId,
                    fileName: a.fileName,
                  })),
                }))
              : [],
          })),
        },
        null,
        2
      );
    },
  });

  // --- Create Form ---
  server.addTool({
    name: 'createForm',
    description: 'Create a new Google Form.',
    annotations: {
      title: 'Create Form',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      title: z.string().describe('Form title'),
      description: z.string().optional().describe('Form description'),
    }),
    async execute(args, { log: _log }) {
      const forms = await getClient(args.account);

      const response = await forms.forms.create({
        requestBody: {
          info: {
            title: args.title,
            documentTitle: args.title,
          },
        },
      });

      // Add description if provided
      if (args.description && response.data.formId) {
        await forms.forms.batchUpdate({
          formId: response.data.formId,
          requestBody: {
            requests: [
              {
                updateFormInfo: {
                  info: {
                    description: args.description,
                  },
                  updateMask: 'description',
                },
              },
            ],
          },
        });
      }

      return JSON.stringify(
        {
          success: true,
          formId: response.data.formId,
          title: response.data.info?.title,
          responderUri: response.data.responderUri,
        },
        null,
        2
      );
    },
  });

  // --- Add Question to Form ---
  server.addTool({
    name: 'addFormQuestion',
    description: 'Add a question to a Google Form.',
    annotations: {
      title: 'Add Form Question',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      formId: z.string().describe('Form ID'),
      title: z.string().describe('Question title/text'),
      questionType: z
        .enum(['short_text', 'paragraph', 'multiple_choice', 'checkboxes', 'dropdown', 'scale'])
        .describe('Type of question'),
      required: z.boolean().optional().default(false).describe('Whether the question is required'),
      options: z
        .array(z.string())
        .optional()
        .describe('Options for multiple choice, checkboxes, or dropdown questions'),
      scaleMin: z.number().optional().default(1).describe('Minimum value for scale questions'),
      scaleMax: z.number().optional().default(5).describe('Maximum value for scale questions'),
    }),
    async execute(args, { log: _log }) {
      const forms = await getClient(args.account);

      const question: FormsQuestion = { required: args.required };

      switch (args.questionType) {
        case 'short_text':
          question.textQuestion = { paragraph: false };
          break;
        case 'paragraph':
          question.textQuestion = { paragraph: true };
          break;
        case 'multiple_choice':
          question.choiceQuestion = {
            type: 'RADIO',
            options: args.options?.map((o) => ({ value: o })) ?? [{ value: 'Option 1' }],
          };
          break;
        case 'checkboxes':
          question.choiceQuestion = {
            type: 'CHECKBOX',
            options: args.options?.map((o) => ({ value: o })) ?? [{ value: 'Option 1' }],
          };
          break;
        case 'dropdown':
          question.choiceQuestion = {
            type: 'DROP_DOWN',
            options: args.options?.map((o) => ({ value: o })) ?? [{ value: 'Option 1' }],
          };
          break;
        case 'scale':
          question.scaleQuestion = {
            low: args.scaleMin,
            high: args.scaleMax,
          };
          break;
      }

      await forms.forms.batchUpdate({
        formId: args.formId,
        requestBody: {
          requests: [
            {
              createItem: {
                item: {
                  title: args.title,
                  questionItem: { question },
                },
                location: { index: 0 },
              },
            },
          ],
        },
      });

      return JSON.stringify(
        {
          success: true,
          formId: args.formId,
          questionTitle: args.title,
        },
        null,
        2
      );
    },
  });
}
