// forms.tools.ts - Forms tool module
import { z } from 'zod';
import { type FormsToolOptions, type FormsQuestion } from '../types.js';
import { getFormsUrl } from '../urlHelpers.js';

export function registerFormsTools(options: FormsToolOptions) {
  const { server, getFormsClient, getDriveClient, getAccountEmail } = options;
  server.addTool({
    name: 'listForms',
    description: 'List Google Forms in Drive with optional search.',
    annotations: {
      title: 'List Forms',
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
            'Search query to filter forms by name or content. Cannot be used with orderBy (Google Drive API limitation).'
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

      let queryString = "mimeType='application/vnd.google-apps.form' and trashed=false";
      if (args.query) {
        queryString += ` and (name contains '${args.query}' or fullText contains '${args.query}')`;
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
      const forms = response.data.files ?? [];

      let result = `**Forms (${forms.length} found)**\n\n`;

      if (forms.length === 0) {
        result += 'No forms found.';
        return result;
      }

      forms.forEach((f, i) => {
        const link = f.id ? getFormsUrl(f.id, accountEmail) : f.webViewLink;
        result += `${i + 1}. ${f.name}\n`;
        result += `   ID: ${f.id}\n`;
        result += `   Modified: ${f.modifiedTime}\n`;
        result += `   Created: ${f.createdTime}\n`;
        if (f.owners?.length) {
          result += `   Owner: ${f.owners.map((o) => o.emailAddress).join(', ')}\n`;
        }
        if (link) result += `   Link: ${link}\n`;
        result += '\n';
      });

      return result;
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
      const forms = await getFormsClient(args.account);

      const response = await forms.forms.get({
        formId: args.formId,
      });

      const form = response.data;
      const accountEmail = await getAccountEmail(args.account);
      const editLink = form.formId ? getFormsUrl(form.formId, accountEmail) : undefined;

      let result = `**Form: ${form.info?.title || '(Untitled)'}**\n\n`;
      result += `Form ID: ${form.formId}\n`;
      result += `Document Title: ${form.info?.documentTitle || 'N/A'}\n`;
      if (form.info?.description) result += `Description: ${form.info.description}\n`;
      if (form.responderUri) result += `Responder URL: ${form.responderUri}\n`;
      if (form.linkedSheetId) result += `Linked Sheet ID: ${form.linkedSheetId}\n`;
      if (editLink) result += `Edit Link: ${editLink}\n`;
      result += '\n';

      if (form.items && form.items.length > 0) {
        result += `**Questions (${form.items.length}):**\n\n`;
        form.items.forEach((item, idx) => {
          // Determine question type
          let questionType = 'unknown';
          if (item.questionItem?.question?.choiceQuestion) questionType = 'choice';
          else if (item.questionItem?.question?.textQuestion) questionType = 'text';
          else if (item.questionItem?.question?.scaleQuestion) questionType = 'scale';
          else if (item.questionItem?.question?.dateQuestion) questionType = 'date';
          else if (item.questionItem?.question?.timeQuestion) questionType = 'time';
          else if (item.questionItem?.question?.fileUploadQuestion) questionType = 'fileUpload';
          else if (item.questionGroupItem) questionType = 'questionGroup';
          else if (item.pageBreakItem) questionType = 'pageBreak';
          else if (item.textItem) questionType = 'text_display';
          else if (item.imageItem) questionType = 'image';
          else if (item.videoItem) questionType = 'video';

          result += `${idx + 1}. ${item.title || '(No title)'}\n`;
          result += `   Item ID: ${item.itemId}\n`;
          result += `   Type: ${questionType}\n`;
          if (item.description) result += `   Description: ${item.description}\n`;
          if (item.questionItem?.question?.required) result += '   Required: Yes\n';
          result += '\n';
        });
      } else {
        result += 'No questions in this form.\n';
      }

      return result;
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
      const forms = await getFormsClient(args.account);

      const response = await forms.forms.responses.list({
        formId: args.formId,
        pageSize: args.maxResponses,
      });

      const accountEmail = await getAccountEmail(args.account);
      const editLink = getFormsUrl(args.formId, accountEmail);
      const responses = response.data.responses ?? [];

      let result = '**Form Responses**\n\n';
      result += `Form ID: ${args.formId}\n`;
      result += `Total Responses: ${responses.length}\n`;
      result += `Edit Form: ${editLink}\n\n`;

      if (responses.length === 0) {
        result += 'No responses yet.';
        return result;
      }

      responses.forEach((r, i) => {
        result += `**Response ${i + 1}**\n`;
        result += `   Response ID: ${r.responseId}\n`;
        result += `   Created: ${r.createTime}\n`;
        result += `   Last Submitted: ${r.lastSubmittedTime}\n`;
        if (r.respondentEmail) result += `   Respondent: ${r.respondentEmail}\n`;

        if (r.answers) {
          result += '   Answers:\n';
          Object.entries(r.answers).forEach(([questionId, answer]) => {
            result += `     - Question ${questionId}: `;
            if (answer.textAnswers?.answers) {
              result += answer.textAnswers.answers.map((a) => a.value).join(', ');
            } else if (answer.fileUploadAnswers?.answers) {
              result += answer.fileUploadAnswers.answers
                .map((a) => `${a.fileName} (${a.fileId})`)
                .join(', ');
            } else {
              result += '(no answer)';
            }
            result += '\n';
          });
        }
        result += '\n';
      });

      return result;
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
      const forms = await getFormsClient(args.account);

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

      const accountEmail = await getAccountEmail(args.account);
      const editLink = response.data.formId
        ? getFormsUrl(response.data.formId, accountEmail)
        : undefined;

      let result = 'Successfully created form.\n\n';
      result += `Title: ${response.data.info?.title}\n`;
      result += `Form ID: ${response.data.formId}\n`;
      if (args.description) result += `Description: ${args.description}\n`;
      if (response.data.responderUri) result += `Responder URL: ${response.data.responderUri}\n`;
      if (editLink) result += `\nEdit form: ${editLink}`;

      return result;
    },
  });

  // --- Add Question to Form ---
  server.addTool({
    name: 'addFormQuestion',
    description:
      "Add a question to a Google Form. Question types must be lowercase: 'short_text' (single line text), 'paragraph' (multi-line text), 'multiple_choice' (radio buttons, single selection), 'checkboxes' (multiple selections), 'dropdown' (dropdown menu), 'scale' (linear scale). Example: questionType: 'multiple_choice' with options: ['Yes', 'No', 'Maybe'].",
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
        .describe(
          "Type of question. Must be lowercase: 'short_text', 'paragraph', 'multiple_choice', 'checkboxes', 'dropdown', or 'scale'. NOT uppercase like 'SHORT_ANSWER'."
        ),
      required: z.boolean().optional().default(false).describe('Whether the question is required'),
      options: z
        .array(z.string())
        .optional()
        .describe('Options for multiple choice, checkboxes, or dropdown questions'),
      scaleMin: z.number().optional().default(1).describe('Minimum value for scale questions'),
      scaleMax: z.number().optional().default(5).describe('Maximum value for scale questions'),
    }),
    async execute(args, { log: _log }) {
      const forms = await getFormsClient(args.account);

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

      const accountEmail = await getAccountEmail(args.account);
      const editLink = getFormsUrl(args.formId, accountEmail);

      let result = 'Successfully added question to form.\n\n';
      result += `Question: ${args.title}\n`;
      result += `Type: ${args.questionType}\n`;
      result += `Required: ${args.required ? 'Yes' : 'No'}\n`;
      if (args.options?.length) {
        result += `Options: ${args.options.join(', ')}\n`;
      }
      if (args.questionType === 'scale') {
        result += `Scale: ${args.scaleMin} to ${args.scaleMax}\n`;
      }
      result += `Form ID: ${args.formId}\n`;
      result += `\nEdit form: ${editLink}`;

      return result;
    },
  });
}
