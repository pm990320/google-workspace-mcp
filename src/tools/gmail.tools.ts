// gmail.tools.ts - Gmail tool module
import { z } from 'zod';
import { formatToolError } from '../errorHelpers.js';
import { type GmailToolOptions, type MessagePart } from '../types.js';
import { getGmailMessageUrl, getGmailDraftsUrl } from '../urlHelpers.js';

export function registerGmailTools(options: GmailToolOptions) {
  const { server, getGmailClient, getAccountEmail } = options;
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
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.messages.list({
          userId: 'me',
          maxResults: Math.min(args.maxResults || 10, 500),
          labelIds: args.labelIds,
          q: args.query,
        });

        const messages = response.data.messages ?? [];
        const accountEmail = await getAccountEmail(args.account);

        let result = `Found approximately ${response.data.resultSizeEstimate} messages.\n\n`;

        if (messages.length === 0) {
          result += 'No messages found.';
        } else {
          result += `Showing ${messages.length} messages:\n\n`;
          messages.forEach((m, i) => {
            const link = m.id ? getGmailMessageUrl(m.id, accountEmail) : 'N/A';
            result += `${i + 1}. ID: ${m.id}\n`;
            result += `   Thread: ${m.threadId}\n`;
            result += `   Link: ${link}\n\n`;
          });
        }

        if (response.data.nextPageToken) {
          result += `\nMore messages available (next page token: ${response.data.nextPageToken})`;
        }

        return result;
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
        const gmail = await getGmailClient(args.account);

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

        const accountEmail = await getAccountEmail(args.account);
        const link = message.id ? getGmailMessageUrl(message.id, accountEmail) : undefined;

        let result = '**Email Message**\n\n';
        result += `ID: ${message.id}\n`;
        result += `Thread ID: ${message.threadId}\n`;
        result += `Labels: ${(message.labelIds ?? []).join(', ') || 'None'}\n\n`;

        result += '**Headers**\n';
        result += `From: ${getHeader('From') || 'N/A'}\n`;
        result += `To: ${getHeader('To') || 'N/A'}\n`;
        if (getHeader('Cc')) result += `Cc: ${getHeader('Cc')}\n`;
        result += `Subject: ${getHeader('Subject') || 'N/A'}\n`;
        result += `Date: ${getHeader('Date') || 'N/A'}\n\n`;

        if (message.snippet) {
          result += `**Snippet:** ${message.snippet}\n\n`;
        }

        result += `**Body**\n${body || '(empty)'}\n\n`;

        if (attachments.length > 0) {
          result += `**Attachments (${attachments.length})**\n`;
          attachments.forEach((att, i) => {
            result += `${i + 1}. ${att.filename} (${att.mimeType}, ${att.size} bytes)\n`;
          });
          result += '\n';
        }

        if (link) {
          result += `View in Gmail: ${link}`;
        }

        return result;
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
        const gmail = await getGmailClient(args.account);

        // Build the email
        let emailContent = '';

        emailContent += `To: ${args.to}\r\n`;
        if (args.cc) emailContent += `Cc: ${args.cc}\r\n`;
        if (args.bcc) emailContent += `Bcc: ${args.bcc}\r\n`;
        emailContent += `Subject: ${args.subject}\r\n`;
        emailContent += 'MIME-Version: 1.0\r\n';

        if (args.isHtml) {
          emailContent += 'Content-Type: text/html; charset=utf-8\r\n';
        } else {
          emailContent += 'Content-Type: text/plain; charset=utf-8\r\n';
        }

        emailContent += `\r\n${args.body}`;

        // Base64 encode the email
        const encodedEmail = Buffer.from(emailContent)
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

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.id
          ? getGmailMessageUrl(response.data.id, accountEmail)
          : undefined;

        let result = 'Successfully sent email.\n\n';
        result += `To: ${args.to}\n`;
        result += `Subject: ${args.subject}\n`;
        result += `Message ID: ${response.data.id}\n`;
        result += `Thread ID: ${response.data.threadId}\n`;
        result += `Labels: ${(response.data.labelIds ?? []).join(', ')}\n`;
        if (link) {
          result += `\nView sent message: ${link}`;
        }

        return result;
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
        const gmail = await getGmailClient(args.account);

        const listResponse = await gmail.users.messages.list({
          userId: 'me',
          q: args.query,
          maxResults: Math.min(args.maxResults || 20, 100),
        });

        const messages = listResponse.data.messages ?? [];

        const accountEmail = await getAccountEmail(args.account);
        // Get snippets for each message (filter ensures m.id is defined)
        const messagesWithIds = messages
          .slice(0, 20)
          .filter((m): m is typeof m & { id: string } => Boolean(m.id));

        let result = `**Search Results for:** "${args.query}"\n`;
        result += `Total estimate: ${listResponse.data.resultSizeEstimate} messages\n\n`;

        if (messagesWithIds.length === 0) {
          result += 'No messages found matching your query.';
          return result;
        }

        for (let i = 0; i < messagesWithIds.length; i++) {
          const m = messagesWithIds[i];
          const msg = await gmail.users.messages.get({
            userId: 'me',
            id: m.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });
          const headers = msg.data.payload?.headers ?? [];
          const getHeader = (name: string) => headers.find((h) => h.name === name)?.value;
          const link = msg.data.id ? getGmailMessageUrl(msg.data.id, accountEmail) : undefined;

          result += `**${i + 1}. ${getHeader('Subject') || '(no subject)'}**\n`;
          result += `   From: ${getHeader('From') || 'N/A'}\n`;
          result += `   Date: ${getHeader('Date') || 'N/A'}\n`;
          result += `   ID: ${msg.data.id}\n`;
          result += `   Labels: ${(msg.data.labelIds ?? []).join(', ')}\n`;
          if (msg.data.snippet) {
            result += `   Preview: ${msg.data.snippet}\n`;
          }
          if (link) {
            result += `   Link: ${link}\n`;
          }
          result += '\n';
        }

        return result;
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
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.labels.list({ userId: 'me' });
        const labels = response.data.labels ?? [];

        let result = `**Gmail Labels (${labels.length} total)**\n\n`;

        // Separate system and user labels
        const systemLabels = labels.filter((l) => l.type === 'system');
        const userLabels = labels.filter((l) => l.type === 'user');

        if (systemLabels.length > 0) {
          result += '**System Labels:**\n';
          systemLabels.forEach((l) => {
            result += `- ${l.name} (ID: ${l.id})`;
            if (l.messagesTotal !== undefined) {
              result += ` - ${l.messagesTotal} messages`;
              if (l.messagesUnread) result += ` (${l.messagesUnread} unread)`;
            }
            result += '\n';
          });
          result += '\n';
        }

        if (userLabels.length > 0) {
          result += '**User Labels:**\n';
          userLabels.forEach((l) => {
            result += `- ${l.name} (ID: ${l.id})`;
            if (l.messagesTotal !== undefined) {
              result += ` - ${l.messagesTotal} messages`;
              if (l.messagesUnread) result += ` (${l.messagesUnread} unread)`;
            }
            result += '\n';
          });
        }

        return result;
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
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.messages.modify({
          userId: 'me',
          id: args.messageId,
          requestBody: {
            addLabelIds: args.addLabelIds,
            removeLabelIds: args.removeLabelIds,
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.id
          ? getGmailMessageUrl(response.data.id, accountEmail)
          : undefined;

        let result = `Successfully modified labels for message ${args.messageId}.\n\n`;
        if (args.addLabelIds?.length) {
          result += `Added labels: ${args.addLabelIds.join(', ')}\n`;
        }
        if (args.removeLabelIds?.length) {
          result += `Removed labels: ${args.removeLabelIds.join(', ')}\n`;
        }
        result += `\nCurrent labels: ${(response.data.labelIds ?? []).join(', ')}\n`;
        if (link) {
          result += `\nView message: ${link}`;
        }

        return result;
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
        const gmail = await getGmailClient(args.account);

        let emailContent = '';
        emailContent += `To: ${args.to}\r\n`;
        if (args.cc) emailContent += `Cc: ${args.cc}\r\n`;
        emailContent += `Subject: ${args.subject}\r\n`;
        emailContent += `Content-Type: ${args.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n`;
        emailContent += `\r\n${args.body}`;

        const encodedEmail = Buffer.from(emailContent)
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

        const accountEmail = await getAccountEmail(args.account);
        const draftsLink = getGmailDraftsUrl(accountEmail);

        let result = 'Successfully created draft email.\n\n';
        result += `To: ${args.to}\n`;
        result += `Subject: ${args.subject}\n`;
        result += `Draft ID: ${response.data.id}\n`;
        result += `Message ID: ${response.data.message?.id}\n`;
        result += `\nView drafts: ${draftsLink}`;

        return result;
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
        const gmail = await getGmailClient(args.account);

        await gmail.users.messages.trash({
          userId: 'me',
          id: args.messageId,
        });

        return `Successfully moved message ${args.messageId} to trash.\n\nThe message will be automatically deleted after 30 days.`;
      } catch (error: unknown) {
        throw new Error(formatToolError('deleteGmailMessage', error));
      }
    },
  });
}
