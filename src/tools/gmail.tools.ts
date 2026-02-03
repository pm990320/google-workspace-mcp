// gmail.tools.ts - Auto-generated tool module
import { z } from 'zod';
import { type gmail_v1 } from 'googleapis';
import { formatToolError } from '../errorHelpers.js';
import { type FastMCPServer, type MessagePart } from '../types.js';

export function registerGmailTools(
  server: FastMCPServer,
  getClient: (accountName: string) => Promise<gmail_v1.Gmail>
) {
  server.addTool({
    name: 'listGmailMessages',
    description:
      'List email messages from Gmail inbox or other labels. Returns message IDs and snippets.',
    annotations: {
      title: 'List Gmail Messages',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      maxResults: z
        .number()
        .optional()
        .default(10)
        .describe('Maximum number of messages to return (default: 10, max: 500)'),
      labelIds: z
        .array(z.string())
        .optional()
        .describe('Filter by label IDs (e.g., ["INBOX", "UNREAD"])'),
      query: z
        .string()
        .optional()
        .describe(
          'Search query (same syntax as Gmail search box, e.g., "from:user@example.com subject:test")'
        ),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getClient(args.account);

        const response = await gmail.users.messages.list({
          userId: 'me',
          maxResults: Math.min(args.maxResults || 10, 500),
          labelIds: args.labelIds,
          q: args.query,
        });

        const messages = response.data.messages ?? [];
        return JSON.stringify(
          {
            totalMessages: response.data.resultSizeEstimate,
            messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })),
            nextPageToken: response.data.nextPageToken,
          },
          null,
          2
        );
      } catch (error: unknown) {
        throw new Error(formatToolError('listGmailMessages', error));
      }
    },
  });

  // --- Read Gmail Message ---
  server.addTool({
    name: 'readGmailMessage',
    description:
      'Read a specific Gmail message by ID. Returns full message content including headers, body, and attachments info.',
    annotations: {
      title: 'Read Gmail Message',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The ID of the message to read'),
      format: z
        .enum(['full', 'metadata', 'minimal', 'raw'])
        .optional()
        .default('full')
        .describe('Response format'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getClient(args.account);

        const response = await gmail.users.messages.get({
          userId: 'me',
          id: args.messageId,
          format: args.format,
        });

        const message = response.data;
        const headers = message.payload?.headers ?? [];

        // Extract common headers
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;

        // Extract body
        let body = '';
        const extractBody = (part: MessagePart): string => {
          if (part.body?.data) {
            return Buffer.from(part.body.data, 'base64').toString('utf8');
          }
          if (part.parts) {
            for (const subpart of part.parts) {
              if (subpart.mimeType === 'text/plain') {
                return extractBody(subpart);
              }
            }
            for (const subpart of part.parts) {
              if (subpart.mimeType === 'text/html') {
                return extractBody(subpart);
              }
            }
            for (const subpart of part.parts) {
              const result = extractBody(subpart);
              if (result) return result;
            }
          }
          return '';
        };

        if (message.payload) {
          body = extractBody(message.payload);
        }

        // Extract attachments info
        const attachments: {
          filename: string;
          mimeType: string;
          size: number;
          attachmentId: string;
        }[] = [];
        const extractAttachments = (part: MessagePart) => {
          if (part.filename && part.body?.attachmentId) {
            attachments.push({
              filename: part.filename,
              mimeType: part.mimeType || 'application/octet-stream',
              size: part.body.size || 0,
              attachmentId: part.body.attachmentId,
            });
          }
          if (part.parts) {
            part.parts.forEach(extractAttachments);
          }
        };
        if (message.payload) {
          extractAttachments(message.payload);
        }

        return JSON.stringify(
          {
            id: message.id,
            threadId: message.threadId,
            labelIds: message.labelIds,
            snippet: message.snippet,
            from: getHeader('From'),
            to: getHeader('To'),
            cc: getHeader('Cc'),
            subject: getHeader('Subject'),
            date: getHeader('Date'),
            body,
            attachments,
          },
          null,
          2
        );
      } catch (error: unknown) {
        throw new Error(formatToolError('readGmailMessage', error));
      }
    },
  });

  // --- Send Gmail Message ---
  server.addTool({
    name: 'sendGmailMessage',
    description: 'Send an email via Gmail. Supports plain text and HTML content.',
    annotations: {
      title: 'Send Gmail Message',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      to: z.string().describe('Recipient email address(es), comma-separated for multiple'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body content'),
      cc: z.string().optional().describe('CC recipients, comma-separated'),
      bcc: z.string().optional().describe('BCC recipients, comma-separated'),
      isHtml: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether the body is HTML (default: false for plain text)'),
      replyToMessageId: z.string().optional().describe('Message ID to reply to (for threading)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getClient(args.account);

        // Build the email
        let email = '';

        email += `To: ${args.to}\r\n`;
        if (args.cc) email += `Cc: ${args.cc}\r\n`;
        if (args.bcc) email += `Bcc: ${args.bcc}\r\n`;
        email += `Subject: ${args.subject}\r\n`;
        email += 'MIME-Version: 1.0\r\n';

        if (args.isHtml) {
          email += 'Content-Type: text/html; charset=utf-8\r\n';
        } else {
          email += 'Content-Type: text/plain; charset=utf-8\r\n';
        }

        email += `\r\n${args.body}`;

        // Base64 encode the email
        const encodedEmail = Buffer.from(email)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedEmail,
            threadId: args.replyToMessageId
              ? (await gmail.users.messages.get({ userId: 'me', id: args.replyToMessageId })).data
                  .threadId
              : undefined,
          },
        });

        return JSON.stringify(
          {
            success: true,
            messageId: response.data.id,
            threadId: response.data.threadId,
            labelIds: response.data.labelIds,
          },
          null,
          2
        );
      } catch (error: unknown) {
        throw new Error(formatToolError('sendGmailMessage', error));
      }
    },
  });

  // --- Search Gmail ---
  server.addTool({
    name: 'searchGmail',
    description: 'Search Gmail using Gmail search syntax. Returns matching messages with snippets.',
    annotations: {
      title: 'Search Gmail',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      query: z
        .string()
        .describe(
          'Search query (Gmail search syntax: from:, to:, subject:, has:attachment, is:unread, etc.)'
        ),
      maxResults: z
        .number()
        .optional()
        .default(20)
        .describe('Maximum results to return (default: 20)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getClient(args.account);

        const listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: args.query,
          maxResults: Math.min(args.maxResults || 20, 100),
        });

        const messages = listResponse.data.messages ?? [];

        // Get snippets for each message (filter ensures m.id is defined)
        const messagesWithIds = messages
          .slice(0, 20)
          .filter((m): m is typeof m & { id: string } => Boolean(m.id));
        const results = await Promise.all(
          messagesWithIds.map(async (m) => {
            const msg = await gmail.users.messages.get({
              userId: 'me',
              id: m.id,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date'],
            });
            const headers = msg.data.payload?.headers ?? [];
            const getHeader = (name: string) => headers.find((h) => h.name === name)?.value;
            return JSON.stringify(
              {
                id: msg.data.id,
                threadId: msg.data.threadId,
                snippet: msg.data.snippet,
                from: getHeader('From'),
                subject: getHeader('Subject'),
                date: getHeader('Date'),
                labelIds: msg.data.labelIds,
              },
              null,
              2
            );
          })
        );

        return JSON.stringify(
          {
            totalEstimate: listResponse.data.resultSizeEstimate,
            results,
          },
          null,
          2
        );
      } catch (error: unknown) {
        throw new Error(formatToolError('searchGmail', error));
      }
    },
  });

  // --- List Gmail Labels ---
  server.addTool({
    name: 'listGmailLabels',
    description: 'List all Gmail labels (folders) for the account.',
    annotations: {
      title: 'List Gmail Labels',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getClient(args.account);

        const response = await gmail.users.labels.list({ userId: 'me' });

        return JSON.stringify(
          {
            labels: (response.data.labels ?? []).map((l) => ({
              id: l.id,
              name: l.name,
              type: l.type,
              messagesTotal: l.messagesTotal,
              messagesUnread: l.messagesUnread,
            })),
          },
          null,
          2
        );
      } catch (error: unknown) {
        throw new Error(formatToolError('listGmailLabels', error));
      }
    },
  });

  // --- Modify Gmail Labels ---
  server.addTool({
    name: 'modifyGmailLabels',
    description:
      'Add or remove labels from a Gmail message. Use to archive, mark as read/unread, star, etc.',
    annotations: {
      title: 'Modify Gmail Labels',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The message ID to modify'),
      addLabelIds: z
        .array(z.string())
        .optional()
        .describe('Label IDs to add (e.g., ["STARRED", "IMPORTANT"])'),
      removeLabelIds: z
        .array(z.string())
        .optional()
        .describe('Label IDs to remove (e.g., ["UNREAD", "INBOX"])'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getClient(args.account);

        const response = await gmail.users.messages.modify({
          userId: 'me',
          id: args.messageId,
          requestBody: {
            addLabelIds: args.addLabelIds,
            removeLabelIds: args.removeLabelIds,
          },
        });

        return JSON.stringify(
          {
            success: true,
            messageId: response.data.id,
            labelIds: response.data.labelIds,
          },
          null,
          2
        );
      } catch (error: unknown) {
        throw new Error(formatToolError('modifyGmailLabels', error));
      }
    },
  });

  // --- Create Gmail Draft ---
  server.addTool({
    name: 'createGmailDraft',
    description: 'Create a draft email in Gmail.',
    annotations: {
      title: 'Create Gmail Draft',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      to: z.string().describe('Recipient email address(es)'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body content'),
      cc: z.string().optional().describe('CC recipients'),
      isHtml: z.boolean().optional().default(false).describe('Whether body is HTML'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getClient(args.account);

        let email = '';
        email += `To: ${args.to}\r\n`;
        if (args.cc) email += `Cc: ${args.cc}\r\n`;
        email += `Subject: ${args.subject}\r\n`;
        email += `Content-Type: ${args.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n`;
        email += `\r\n${args.body}`;

        const encodedEmail = Buffer.from(email)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const response = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: {
            message: { raw: encodedEmail },
          },
        });

        return JSON.stringify(
          {
            success: true,
            draftId: response.data.id,
            messageId: response.data.message?.id,
          },
          null,
          2
        );
      } catch (error: unknown) {
        throw new Error(formatToolError('createGmailDraft', error));
      }
    },
  });

  // --- Delete Gmail Message ---
  server.addTool({
    name: 'deleteGmailMessage',
    description:
      'Move a Gmail message to trash. Messages in trash are automatically deleted after 30 days.',
    annotations: {
      title: 'Delete Gmail Message',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The message ID to move to trash'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getClient(args.account);

        await gmail.users.messages.trash({
          userId: 'me',
          id: args.messageId,
        });
        return JSON.stringify(
          { success: true, action: 'moved_to_trash', messageId: args.messageId },
          null,
          2
        );
      } catch (error: unknown) {
        throw new Error(formatToolError('deleteGmailMessage', error));
      }
    },
  });
}
