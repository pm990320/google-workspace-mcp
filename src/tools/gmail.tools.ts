// gmail.tools.ts - Gmail tool module
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { formatToolError } from '../errorHelpers.js';
import { type GmailToolOptions, type MessagePart } from '../types.js';
import { getGmailMessageUrl, getGmailDraftsUrl, getDriveFileUrl } from '../urlHelpers.js';
import { Readable } from 'stream';
import { validateWritePath, wrapEmailContent } from '../securityHelpers.js';
import { getServerConfig } from '../serverWrapper.js';

export function registerGmailTools(options: GmailToolOptions) {
  const { server, getGmailClient, getDriveClient, getAccountEmail } = options;
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

        // Wrap email body with security warnings to defend against prompt injection
        const from = getHeader('From');
        const subject = getHeader('Subject');
        const wrappedBody = body
          ? wrapEmailContent(body, from || undefined, subject || undefined)
          : '(empty)';
        result += `**Body**\n${wrappedBody}\n\n`;

        if (attachments.length > 0) {
          result += `**Attachments (${attachments.length})**\n`;
          attachments.forEach((att, i) => {
            result += `${i + 1}. ${att.filename} (${att.mimeType}, ${att.size} bytes)\n`;
            result += `   Attachment ID: ${att.attachmentId}\n`;
          });
          result +=
            '\nUse getGmailAttachment with the message ID and attachment ID to download attachments.\n';
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

  // --- Create Gmail Label ---
  server.addTool({
    name: 'createGmailLabel',
    description:
      'Create a new Gmail label (folder). Labels can be used to organize emails. After creating a label, use addGmailLabel to apply it to messages.',
    annotations: {
      title: 'Create Gmail Label',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      name: z
        .string()
        .describe('Name of the label to create. Use "/" for nested labels (e.g., "Work/Projects")'),
      labelListVisibility: z
        .enum(['labelShow', 'labelShowIfUnread', 'labelHide'])
        .optional()
        .default('labelShow')
        .describe(
          'Whether to show the label in the label list: labelShow (always), labelShowIfUnread (only when unread), labelHide (hidden)'
        ),
      messageListVisibility: z
        .enum(['show', 'hide'])
        .optional()
        .default('show')
        .describe('Whether to show the label in the message list'),
      backgroundColor: z
        .string()
        .optional()
        .describe('Background color in hex format (e.g., "#16a765")'),
      textColor: z.string().optional().describe('Text color in hex format (e.g., "#ffffff")'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const labelColor =
          args.backgroundColor || args.textColor
            ? {
                backgroundColor: args.backgroundColor,
                textColor: args.textColor,
              }
            : undefined;

        const response = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: args.name,
            labelListVisibility: args.labelListVisibility,
            messageListVisibility: args.messageListVisibility,
            color: labelColor,
          },
        });

        const label = response.data;

        let result = `Successfully created label "${args.name}".\n\n`;
        result += `Label ID: ${label.id}\n`;
        result += `Name: ${label.name}\n`;
        result += `Type: ${label.type}\n`;
        if (label.labelListVisibility) {
          result += `Label List Visibility: ${label.labelListVisibility}\n`;
        }
        if (label.messageListVisibility) {
          result += `Message List Visibility: ${label.messageListVisibility}\n`;
        }
        if (label.color) {
          result += `Color: ${label.color.backgroundColor || 'default'} / ${label.color.textColor || 'default'}\n`;
        }
        result += '\nUse this Label ID with addGmailLabel to apply it to messages.';

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('createGmailLabel', error));
      }
    },
  });

  // --- Add Gmail Label ---
  server.addTool({
    name: 'addGmailLabel',
    description:
      'Add a label to a Gmail message. Common labels: STARRED (star), IMPORTANT, INBOX. Use listGmailLabels to see all available labels. WARNING: Draft message IDs are ephemeral and may change after draft modifications (e.g., adding/removing attachments). If labeling a draft, perform label operations BEFORE modifying draft attachments, or re-fetch the draft to get the current message ID.',
    annotations: {
      title: 'Add Gmail Label',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The message ID to modify'),
      labelId: z
        .string()
        .describe('Label ID to add (e.g., "STARRED", "IMPORTANT", or a custom label ID)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.messages.modify({
          userId: 'me',
          id: args.messageId,
          requestBody: {
            addLabelIds: [args.labelId],
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.id
          ? getGmailMessageUrl(response.data.id, accountEmail)
          : undefined;

        let result = `Successfully added label "${args.labelId}" to message ${args.messageId}.\n`;
        result += `Current labels: ${(response.data.labelIds ?? []).join(', ')}\n`;
        if (link) {
          result += `\nView message: ${link}`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('addGmailLabel', error));
      }
    },
  });

  // --- Remove Gmail Label ---
  server.addTool({
    name: 'removeGmailLabel',
    description:
      'Remove a label from a Gmail message. Common uses: remove UNREAD (mark as read), remove INBOX (archive), remove STARRED (unstar). WARNING: Draft message IDs are ephemeral and may change after draft modifications (e.g., adding/removing attachments). If removing labels from a draft, perform label operations BEFORE modifying draft attachments, or re-fetch the draft to get the current message ID.',
    annotations: {
      title: 'Remove Gmail Label',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The message ID to modify'),
      labelId: z
        .string()
        .describe(
          'Label ID to remove (e.g., "UNREAD" to mark as read, "INBOX" to archive, "STARRED" to unstar)'
        ),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.messages.modify({
          userId: 'me',
          id: args.messageId,
          requestBody: {
            removeLabelIds: [args.labelId],
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.id
          ? getGmailMessageUrl(response.data.id, accountEmail)
          : undefined;

        let result = `Successfully removed label "${args.labelId}" from message ${args.messageId}.\n`;
        result += `Current labels: ${(response.data.labelIds ?? []).join(', ')}\n`;
        if (link) {
          result += `\nView message: ${link}`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('removeGmailLabel', error));
      }
    },
  });

  // --- Create Gmail Draft ---
  server.addTool({
    name: 'createGmailDraft',
    description:
      'Create a draft email in Gmail. Supports threading by providing replyToMessageId to create a draft reply. Supports attachments by providing base64-encoded file data.',
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
      bcc: z.string().optional().describe('BCC recipients'),
      isHtml: z.boolean().optional().default(false).describe('Whether body is HTML'),
      replyToMessageId: z
        .string()
        .optional()
        .describe(
          'Message ID to reply to (for threading). The draft will appear in the same thread as the original message.'
        ),
      attachments: z
        .array(
          z.object({
            filename: z.string().describe('Name of the file (e.g., "report.pdf")'),
            mimeType: z
              .string()
              .describe('MIME type of the file (e.g., "application/pdf", "image/png")'),
            base64Data: z
              .string()
              .describe('Base64-encoded file content (standard base64, not base64url)'),
          })
        )
        .optional()
        .describe('Array of attachments to include in the draft'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        let threadId: string | undefined;
        let inReplyTo: string | undefined;
        let references: string | undefined;

        // If replying to a message, get thread info and headers for proper threading
        if (args.replyToMessageId) {
          const originalMessage = await gmail.users.messages.get({
            userId: 'me',
            id: args.replyToMessageId,
            format: 'metadata',
            metadataHeaders: ['Message-ID', 'References'],
          });

          threadId = originalMessage.data.threadId ?? undefined;

          // Get the Message-ID header for In-Reply-To and References
          const headers = originalMessage.data.payload?.headers ?? [];
          const messageIdHeader = headers.find(
            (h) => h.name?.toLowerCase() === 'message-id'
          )?.value;
          const referencesHeader = headers.find(
            (h) => h.name?.toLowerCase() === 'references'
          )?.value;

          if (messageIdHeader) {
            inReplyTo = messageIdHeader;
            // References should include the original References header (if any) plus the Message-ID
            references = referencesHeader
              ? `${referencesHeader} ${messageIdHeader}`
              : messageIdHeader;
          }
        }

        let emailContent = '';

        if (args.attachments && args.attachments.length > 0) {
          // Build multipart MIME message with attachments
          const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;

          emailContent += `To: ${args.to}\r\n`;
          if (args.cc) emailContent += `Cc: ${args.cc}\r\n`;
          if (args.bcc) emailContent += `Bcc: ${args.bcc}\r\n`;
          emailContent += `Subject: ${args.subject}\r\n`;
          if (inReplyTo) emailContent += `In-Reply-To: ${inReplyTo}\r\n`;
          if (references) emailContent += `References: ${references}\r\n`;
          emailContent += 'MIME-Version: 1.0\r\n';
          emailContent += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
          emailContent += '\r\n';

          // Body part
          emailContent += `--${boundary}\r\n`;
          emailContent += `Content-Type: ${args.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n`;
          emailContent += 'Content-Transfer-Encoding: 7bit\r\n';
          emailContent += '\r\n';
          emailContent += `${args.body}\r\n`;

          // Attachment parts
          for (const attachment of args.attachments) {
            emailContent += `--${boundary}\r\n`;
            emailContent += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
            emailContent += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
            emailContent += 'Content-Transfer-Encoding: base64\r\n';
            emailContent += '\r\n';
            // Split base64 data into 76-character lines per RFC 2045
            const base64Lines = attachment.base64Data.match(/.{1,76}/g) || [];
            emailContent += base64Lines.join('\r\n');
            emailContent += '\r\n';
          }

          emailContent += `--${boundary}--\r\n`;
        } else {
          // Simple message without attachments
          emailContent += `To: ${args.to}\r\n`;
          if (args.cc) emailContent += `Cc: ${args.cc}\r\n`;
          if (args.bcc) emailContent += `Bcc: ${args.bcc}\r\n`;
          emailContent += `Subject: ${args.subject}\r\n`;
          if (inReplyTo) emailContent += `In-Reply-To: ${inReplyTo}\r\n`;
          if (references) emailContent += `References: ${references}\r\n`;
          emailContent += `Content-Type: ${args.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n`;
          emailContent += `\r\n${args.body}`;
        }

        const encodedEmail = Buffer.from(emailContent)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const response = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: {
            message: {
              raw: encodedEmail,
              threadId: threadId,
            },
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const draftsLink = getGmailDraftsUrl(accountEmail);

        let result = 'Successfully created draft email.\n\n';
        result += `To: ${args.to}\n`;
        if (args.cc) result += `Cc: ${args.cc}\n`;
        if (args.bcc) result += `Bcc: ${args.bcc}\n`;
        result += `Subject: ${args.subject}\n`;
        result += `Draft ID: ${response.data.id}\n`;
        result += `Message ID: ${response.data.message?.id}\n`;
        if (threadId) {
          result += `Thread ID: ${threadId} (draft will appear in thread)\n`;
        }
        if (args.attachments && args.attachments.length > 0) {
          result += `Attachments: ${args.attachments.map((a) => a.filename).join(', ')}\n`;
        }
        result += `\nView drafts: ${draftsLink}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('createGmailDraft', error));
      }
    },
  });

  // --- List Gmail Drafts ---
  server.addTool({
    name: 'listGmailDrafts',
    description: 'List all draft emails in Gmail.',
    annotations: {
      title: 'List Gmail Drafts',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      maxResults: z
        .number()
        .optional()
        .default(20)
        .describe('Maximum number of drafts to return (default: 20)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.drafts.list({
          userId: 'me',
          maxResults: Math.min(args.maxResults || 20, 100),
        });

        const drafts = response.data.drafts ?? [];
        const accountEmail = await getAccountEmail(args.account);

        let result = `**Gmail Drafts (${drafts.length} found)**\n\n`;

        if (drafts.length === 0) {
          result += 'No drafts found.';
          return result;
        }

        for (let i = 0; i < drafts.length; i++) {
          const draft = drafts[i];
          if (!draft.id) continue;

          // Get draft details
          const draftDetails = await gmail.users.drafts.get({
            userId: 'me',
            id: draft.id,
            format: 'metadata',
          });

          const headers = draftDetails.data.message?.payload?.headers ?? [];
          const getHeader = (name: string) =>
            headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;

          result += `**${i + 1}. ${getHeader('Subject') || '(no subject)'}**\n`;
          result += `   Draft ID: ${draft.id}\n`;
          result += `   To: ${getHeader('To') || '(no recipient)'}\n`;
          if (draftDetails.data.message?.snippet) {
            result += `   Preview: ${draftDetails.data.message.snippet}\n`;
          }
          result += '\n';
        }

        const draftsLink = getGmailDraftsUrl(accountEmail);
        result += `View all drafts: ${draftsLink}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('listGmailDrafts', error));
      }
    },
  });

  // --- Read Gmail Draft ---
  server.addTool({
    name: 'readGmailDraft',
    description: 'Read the full content of a Gmail draft by its draft ID.',
    annotations: {
      title: 'Read Gmail Draft',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      draftId: z.string().describe('The draft ID to read'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.drafts.get({
          userId: 'me',
          id: args.draftId,
          format: 'full',
        });

        const message = response.data.message;
        const headers = message?.payload?.headers ?? [];

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

        if (message?.payload) {
          body = extractBody(message.payload);
        }

        const accountEmail = await getAccountEmail(args.account);
        const draftsLink = getGmailDraftsUrl(accountEmail);

        let result = '**Draft Email**\n\n';
        result += `Draft ID: ${response.data.id}\n`;
        result += `Message ID: ${message?.id}\n`;
        if (message?.threadId) {
          result += `Thread ID: ${message.threadId}\n`;
        }
        result += '\n**Headers**\n';
        result += `To: ${getHeader('To') || '(empty)'}\n`;
        result += `Cc: ${getHeader('Cc') || '(empty)'}\n`;
        result += `Subject: ${getHeader('Subject') || '(empty)'}\n`;
        result += '\n**Body**\n';
        result += body || '(empty)';
        result += `\n\nView drafts: ${draftsLink}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('readGmailDraft', error));
      }
    },
  });

  // --- Update Gmail Draft ---
  server.addTool({
    name: 'updateGmailDraft',
    description:
      'Update an existing Gmail draft. You can update any combination of to, cc, bcc, subject, body, or attachments. Fields not provided will keep their current values (except attachments which replace existing ones if provided).',
    annotations: {
      title: 'Update Gmail Draft',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      draftId: z.string().describe('The draft ID to update'),
      to: z.string().optional().describe('New recipient(s) - if not provided, keeps current'),
      cc: z.string().optional().describe('New CC recipient(s) - if not provided, keeps current'),
      bcc: z.string().optional().describe('New BCC recipient(s) - if not provided, keeps current'),
      subject: z.string().optional().describe('New subject - if not provided, keeps current'),
      body: z.string().optional().describe('New body content - if not provided, keeps current'),
      isHtml: z
        .boolean()
        .optional()
        .describe('Whether the body is HTML (default: false for plain text)'),
      attachments: z
        .array(
          z.object({
            filename: z.string().describe('Name of the file (e.g., "report.pdf")'),
            mimeType: z
              .string()
              .describe('MIME type of the file (e.g., "application/pdf", "image/png")'),
            base64Data: z
              .string()
              .describe('Base64-encoded file content (standard base64, not base64url)'),
          })
        )
        .optional()
        .describe('Array of attachments (replaces existing attachments if provided)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        // First, get the current draft content
        const currentDraft = await gmail.users.drafts.get({
          userId: 'me',
          id: args.draftId,
          format: 'full',
        });

        const currentMessage = currentDraft.data.message;
        const currentHeaders = currentMessage?.payload?.headers ?? [];

        const getCurrentHeader = (name: string) =>
          currentHeaders.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        // Extract current body
        let currentBody = '';
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

        if (currentMessage?.payload) {
          currentBody = extractBody(currentMessage.payload);
        }

        // Merge with updates (use new values if provided, otherwise keep current)
        const newTo = args.to ?? getCurrentHeader('To');
        const newCc = args.cc ?? getCurrentHeader('Cc');
        const newBcc = args.bcc ?? getCurrentHeader('Bcc');
        const newSubject = args.subject ?? getCurrentHeader('Subject');
        const newBody = args.body ?? currentBody;
        const isHtml = args.isHtml ?? false;

        // Build the updated email
        let emailContent = '';

        if (args.attachments && args.attachments.length > 0) {
          // Build multipart MIME message with attachments
          const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;

          emailContent += `To: ${newTo}\r\n`;
          if (newCc) emailContent += `Cc: ${newCc}\r\n`;
          if (newBcc) emailContent += `Bcc: ${newBcc}\r\n`;
          emailContent += `Subject: ${newSubject}\r\n`;
          emailContent += 'MIME-Version: 1.0\r\n';
          emailContent += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
          emailContent += '\r\n';

          // Body part
          emailContent += `--${boundary}\r\n`;
          emailContent += `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n`;
          emailContent += 'Content-Transfer-Encoding: 7bit\r\n';
          emailContent += '\r\n';
          emailContent += `${newBody}\r\n`;

          // Attachment parts
          for (const attachment of args.attachments) {
            emailContent += `--${boundary}\r\n`;
            emailContent += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
            emailContent += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
            emailContent += 'Content-Transfer-Encoding: base64\r\n';
            emailContent += '\r\n';
            // Split base64 data into 76-character lines per RFC 2045
            const base64Lines = attachment.base64Data.match(/.{1,76}/g) || [];
            emailContent += base64Lines.join('\r\n');
            emailContent += '\r\n';
          }

          emailContent += `--${boundary}--\r\n`;
        } else {
          // Simple message without attachments
          emailContent += `To: ${newTo}\r\n`;
          if (newCc) emailContent += `Cc: ${newCc}\r\n`;
          if (newBcc) emailContent += `Bcc: ${newBcc}\r\n`;
          emailContent += `Subject: ${newSubject}\r\n`;
          emailContent += `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n`;
          emailContent += `\r\n${newBody}`;
        }

        const encodedEmail = Buffer.from(emailContent)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        // Update the draft
        const response = await gmail.users.drafts.update({
          userId: 'me',
          id: args.draftId,
          requestBody: {
            message: {
              raw: encodedEmail,
              threadId: currentMessage?.threadId,
            },
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const draftsLink = getGmailDraftsUrl(accountEmail);

        let result = 'Successfully updated draft.\n\n';
        result += `Draft ID: ${response.data.id}\n`;
        result += `To: ${newTo}\n`;
        if (newCc) result += `Cc: ${newCc}\n`;
        if (newBcc) result += `Bcc: ${newBcc}\n`;
        result += `Subject: ${newSubject}\n`;
        result += '\n**Updated fields:**\n';
        if (args.to !== undefined) result += '- To\n';
        if (args.cc !== undefined) result += '- Cc\n';
        if (args.bcc !== undefined) result += '- Bcc\n';
        if (args.subject !== undefined) result += '- Subject\n';
        if (args.body !== undefined) result += '- Body\n';
        if (args.attachments !== undefined)
          result += `- Attachments (${args.attachments.length} files)\n`;
        result += `\nView drafts: ${draftsLink}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('updateGmailDraft', error));
      }
    },
  });

  // --- Add Attachment to Draft ---
  server.addTool({
    name: 'addAttachmentToDraft',
    description:
      'Add an attachment to an existing Gmail draft. The attachment is added to the draft without modifying other content.',
    annotations: {
      title: 'Add Attachment to Draft',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      draftId: z.string().describe('The draft ID to add the attachment to'),
      filename: z.string().describe('Name of the file (e.g., "report.pdf")'),
      mimeType: z.string().describe('MIME type of the file (e.g., "application/pdf", "image/png")'),
      base64Data: z
        .string()
        .describe('Base64-encoded file content (standard base64, not base64url)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        // Get current draft
        const currentDraft = await gmail.users.drafts.get({
          userId: 'me',
          id: args.draftId,
          format: 'full',
        });

        const currentMessage = currentDraft.data.message;
        const currentHeaders = currentMessage?.payload?.headers ?? [];

        const getCurrentHeader = (name: string) =>
          currentHeaders.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        // Extract current body and attachments
        let bodyContent = '';
        let bodyMimeType = 'text/plain';
        const existingAttachments: { filename: string; mimeType: string; data: string }[] = [];

        const extractParts = async (part: MessagePart) => {
          if (part.mimeType === 'text/plain' && !part.filename && part.body?.data) {
            bodyContent = Buffer.from(part.body.data, 'base64').toString('utf8');
            bodyMimeType = 'text/plain';
          } else if (
            part.mimeType === 'text/html' &&
            !part.filename &&
            part.body?.data &&
            !bodyContent
          ) {
            bodyContent = Buffer.from(part.body.data, 'base64').toString('utf8');
            bodyMimeType = 'text/html';
          } else if (part.filename && part.body?.attachmentId) {
            // Fetch attachment data
            const attachmentResponse = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: currentMessage?.id || '',
              id: part.body.attachmentId,
            });
            if (attachmentResponse.data.data) {
              existingAttachments.push({
                filename: part.filename,
                mimeType: part.mimeType || 'application/octet-stream',
                data: attachmentResponse.data.data.replace(/-/g, '+').replace(/_/g, '/'),
              });
            }
          }
          if (part.parts) {
            for (const subpart of part.parts) {
              await extractParts(subpart);
            }
          }
        };

        if (currentMessage?.payload) {
          // Handle simple messages (no parts)
          if (currentMessage.payload.body?.data && !currentMessage.payload.parts) {
            bodyContent = Buffer.from(currentMessage.payload.body.data, 'base64').toString('utf8');
            bodyMimeType = currentMessage.payload.mimeType || 'text/plain';
          } else {
            await extractParts(currentMessage.payload);
          }
        }

        // Add the new attachment
        existingAttachments.push({
          filename: args.filename,
          mimeType: args.mimeType,
          data: args.base64Data,
        });

        // Rebuild the email with attachments
        const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;
        let emailContent = '';

        emailContent += `To: ${getCurrentHeader('To')}\r\n`;
        if (getCurrentHeader('Cc')) emailContent += `Cc: ${getCurrentHeader('Cc')}\r\n`;
        if (getCurrentHeader('Bcc')) emailContent += `Bcc: ${getCurrentHeader('Bcc')}\r\n`;
        emailContent += `Subject: ${getCurrentHeader('Subject')}\r\n`;
        emailContent += 'MIME-Version: 1.0\r\n';
        emailContent += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
        emailContent += '\r\n';

        // Body part
        emailContent += `--${boundary}\r\n`;
        emailContent += `Content-Type: ${bodyMimeType}; charset=utf-8\r\n`;
        emailContent += 'Content-Transfer-Encoding: 7bit\r\n';
        emailContent += '\r\n';
        emailContent += `${bodyContent}\r\n`;

        // Attachment parts
        for (const attachment of existingAttachments) {
          emailContent += `--${boundary}\r\n`;
          emailContent += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
          emailContent += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
          emailContent += 'Content-Transfer-Encoding: base64\r\n';
          emailContent += '\r\n';
          const base64Lines = attachment.data.match(/.{1,76}/g) || [];
          emailContent += base64Lines.join('\r\n');
          emailContent += '\r\n';
        }

        emailContent += `--${boundary}--\r\n`;

        const encodedEmail = Buffer.from(emailContent)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        // Update the draft
        const response = await gmail.users.drafts.update({
          userId: 'me',
          id: args.draftId,
          requestBody: {
            message: {
              raw: encodedEmail,
              threadId: currentMessage?.threadId,
            },
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const draftsLink = getGmailDraftsUrl(accountEmail);

        let result = `Successfully added attachment "${args.filename}" to draft.\n\n`;
        result += `Draft ID: ${response.data.id}\n`;
        result += `Total attachments: ${existingAttachments.length}\n`;
        result += `Attachments: ${existingAttachments.map((a) => a.filename).join(', ')}\n`;
        result += `\nView drafts: ${draftsLink}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('addAttachmentToDraft', error));
      }
    },
  });

  // --- Remove Attachment from Draft ---
  server.addTool({
    name: 'removeAttachmentFromDraft',
    description:
      'Remove an attachment from an existing Gmail draft by filename. The attachment is removed without modifying other content.',
    annotations: {
      title: 'Remove Attachment from Draft',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      draftId: z.string().describe('The draft ID to remove the attachment from'),
      filename: z.string().describe('Name of the file to remove (must match exactly)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        // Get current draft
        const currentDraft = await gmail.users.drafts.get({
          userId: 'me',
          id: args.draftId,
          format: 'full',
        });

        const currentMessage = currentDraft.data.message;
        const currentHeaders = currentMessage?.payload?.headers ?? [];

        const getCurrentHeader = (name: string) =>
          currentHeaders.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        // Extract current body and attachments
        let bodyContent = '';
        let bodyMimeType = 'text/plain';
        const existingAttachments: { filename: string; mimeType: string; data: string }[] = [];

        const extractParts = async (part: MessagePart) => {
          if (part.mimeType === 'text/plain' && !part.filename && part.body?.data) {
            bodyContent = Buffer.from(part.body.data, 'base64').toString('utf8');
            bodyMimeType = 'text/plain';
          } else if (
            part.mimeType === 'text/html' &&
            !part.filename &&
            part.body?.data &&
            !bodyContent
          ) {
            bodyContent = Buffer.from(part.body.data, 'base64').toString('utf8');
            bodyMimeType = 'text/html';
          } else if (part.filename && part.body?.attachmentId) {
            // Fetch attachment data
            const attachmentResponse = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: currentMessage?.id || '',
              id: part.body.attachmentId,
            });
            if (attachmentResponse.data.data) {
              existingAttachments.push({
                filename: part.filename,
                mimeType: part.mimeType || 'application/octet-stream',
                data: attachmentResponse.data.data.replace(/-/g, '+').replace(/_/g, '/'),
              });
            }
          }
          if (part.parts) {
            for (const subpart of part.parts) {
              await extractParts(subpart);
            }
          }
        };

        if (currentMessage?.payload) {
          // Handle simple messages (no parts)
          if (currentMessage.payload.body?.data && !currentMessage.payload.parts) {
            bodyContent = Buffer.from(currentMessage.payload.body.data, 'base64').toString('utf8');
            bodyMimeType = currentMessage.payload.mimeType || 'text/plain';
          } else {
            await extractParts(currentMessage.payload);
          }
        }

        // Check if attachment exists
        const attachmentIndex = existingAttachments.findIndex((a) => a.filename === args.filename);
        if (attachmentIndex === -1) {
          const availableFiles = existingAttachments.map((a) => a.filename).join(', ') || 'none';
          throw new Error(
            `Attachment "${args.filename}" not found in draft. Available attachments: ${availableFiles}`
          );
        }

        // Remove the attachment
        existingAttachments.splice(attachmentIndex, 1);

        // Rebuild the email
        let emailContent = '';

        if (existingAttachments.length > 0) {
          // Still have attachments, use multipart
          const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;

          emailContent += `To: ${getCurrentHeader('To')}\r\n`;
          if (getCurrentHeader('Cc')) emailContent += `Cc: ${getCurrentHeader('Cc')}\r\n`;
          if (getCurrentHeader('Bcc')) emailContent += `Bcc: ${getCurrentHeader('Bcc')}\r\n`;
          emailContent += `Subject: ${getCurrentHeader('Subject')}\r\n`;
          emailContent += 'MIME-Version: 1.0\r\n';
          emailContent += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`;
          emailContent += '\r\n';

          // Body part
          emailContent += `--${boundary}\r\n`;
          emailContent += `Content-Type: ${bodyMimeType}; charset=utf-8\r\n`;
          emailContent += 'Content-Transfer-Encoding: 7bit\r\n';
          emailContent += '\r\n';
          emailContent += `${bodyContent}\r\n`;

          // Remaining attachment parts
          for (const attachment of existingAttachments) {
            emailContent += `--${boundary}\r\n`;
            emailContent += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
            emailContent += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
            emailContent += 'Content-Transfer-Encoding: base64\r\n';
            emailContent += '\r\n';
            const base64Lines = attachment.data.match(/.{1,76}/g) || [];
            emailContent += base64Lines.join('\r\n');
            emailContent += '\r\n';
          }

          emailContent += `--${boundary}--\r\n`;
        } else {
          // No more attachments, use simple message
          emailContent += `To: ${getCurrentHeader('To')}\r\n`;
          if (getCurrentHeader('Cc')) emailContent += `Cc: ${getCurrentHeader('Cc')}\r\n`;
          if (getCurrentHeader('Bcc')) emailContent += `Bcc: ${getCurrentHeader('Bcc')}\r\n`;
          emailContent += `Subject: ${getCurrentHeader('Subject')}\r\n`;
          emailContent += `Content-Type: ${bodyMimeType}; charset=utf-8\r\n`;
          emailContent += `\r\n${bodyContent}`;
        }

        const encodedEmail = Buffer.from(emailContent)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        // Update the draft
        const response = await gmail.users.drafts.update({
          userId: 'me',
          id: args.draftId,
          requestBody: {
            message: {
              raw: encodedEmail,
              threadId: currentMessage?.threadId,
            },
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const draftsLink = getGmailDraftsUrl(accountEmail);

        let result = `Successfully removed attachment "${args.filename}" from draft.\n\n`;
        result += `Draft ID: ${response.data.id}\n`;
        result += `Remaining attachments: ${existingAttachments.length}\n`;
        if (existingAttachments.length > 0) {
          result += `Attachments: ${existingAttachments.map((a) => a.filename).join(', ')}\n`;
        }
        result += `\nView drafts: ${draftsLink}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('removeAttachmentFromDraft', error));
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

  // --- Send Gmail Draft ---
  server.addTool({
    name: 'sendGmailDraft',
    description: 'Send an existing Gmail draft. The draft will be sent and removed from drafts.',
    annotations: {
      title: 'Send Gmail Draft',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      draftId: z.string().describe('The draft ID to send (from createGmailDraft response)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.drafts.send({
          userId: 'me',
          requestBody: {
            id: args.draftId,
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.id
          ? getGmailMessageUrl(response.data.id, accountEmail)
          : undefined;

        let result = 'Successfully sent draft.\n\n';
        result += `Message ID: ${response.data.id}\n`;
        result += `Thread ID: ${response.data.threadId}\n`;
        result += `Labels: ${(response.data.labelIds ?? []).join(', ')}\n`;
        if (link) {
          result += `\nView sent message: ${link}`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('sendGmailDraft', error));
      }
    },
  });

  // --- Delete Gmail Draft ---
  server.addTool({
    name: 'deleteGmailDraft',
    description: 'Permanently delete a Gmail draft. This action cannot be undone.',
    annotations: {
      title: 'Delete Gmail Draft',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      draftId: z.string().describe('The draft ID to delete (from createGmailDraft response)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        await gmail.users.drafts.delete({
          userId: 'me',
          id: args.draftId,
        });

        return `Successfully deleted draft ${args.draftId}.\n\nNote: Draft deletion is permanent and cannot be undone.`;
      } catch (error: unknown) {
        throw new Error(formatToolError('deleteGmailDraft', error));
      }
    },
  });

  // --- Get Gmail Attachment ---
  server.addTool({
    name: 'getGmailAttachment',
    description:
      'Get metadata and a preview of a Gmail attachment. Returns truncated base64 data (first 500 chars). For full attachment data or saving to file, use downloadGmailAttachment instead.',
    annotations: {
      title: 'Get Gmail Attachment',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The ID of the message containing the attachment'),
      attachmentId: z
        .string()
        .describe('The attachment ID (from readGmailMessage attachment info)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: args.messageId,
          id: args.attachmentId,
        });

        const attachment = response.data;
        const size = attachment.size || 0;

        let result = '**Attachment Retrieved**\n\n';
        result += `Message ID: ${args.messageId}\n`;
        result += `Attachment ID: ${args.attachmentId}\n`;
        result += `Size: ${size} bytes (${(size / 1024).toFixed(2)} KB)\n\n`;

        if (attachment.data) {
          // The data is already base64url encoded from Gmail API
          result += `**Base64 Data (first 500 chars):**\n${attachment.data.substring(0, 500)}${attachment.data.length > 500 ? '...' : ''}\n\n`;
          result += `**Full data length:** ${attachment.data.length} characters\n`;
          result +=
            '\nNote: Data is base64url encoded. To decode, replace - with + and _ with /, then base64 decode.';
          result +=
            '\n\nTip: Use downloadGmailAttachment to get full data or save directly to a file.';
        } else {
          result += 'No attachment data available.';
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('getGmailAttachment', error));
      }
    },
  });

  // --- Download Gmail Attachment ---
  server.addTool({
    name: 'downloadGmailAttachment',
    description:
      'Download a Gmail attachment with full data. Returns complete base64-encoded data, or saves directly to a file if savePath is provided. Use this instead of getGmailAttachment when you need the full attachment content.',
    annotations: {
      title: 'Download Gmail Attachment',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The ID of the message containing the attachment'),
      attachmentId: z
        .string()
        .describe('The attachment ID (from readGmailMessage attachment info)'),
      savePath: z
        .string()
        .optional()
        .describe(
          'Optional file path to save the attachment to. If provided, the decoded attachment is written to this path. The path must be absolute.'
        ),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        // First, get attachment metadata from the message to find the filename
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: args.messageId,
          format: 'full',
        });

        // Find attachment info in message parts
        let attachmentFilename = 'attachment';
        let attachmentMimeType = 'application/octet-stream';

        const findAttachmentInfo = (part: MessagePart) => {
          if (part.body?.attachmentId === args.attachmentId && part.filename) {
            attachmentFilename = part.filename;
            attachmentMimeType = part.mimeType || 'application/octet-stream';
            return true;
          }
          if (part.parts) {
            for (const subpart of part.parts) {
              if (findAttachmentInfo(subpart)) return true;
            }
          }
          return false;
        };

        if (messageResponse.data.payload) {
          findAttachmentInfo(messageResponse.data.payload);
        }

        // Get the attachment data
        const response = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: args.messageId,
          id: args.attachmentId,
        });

        const attachment = response.data;
        const size = attachment.size || 0;

        if (!attachment.data) {
          throw new Error('No attachment data available');
        }

        // Convert base64url to standard base64
        const base64Data = attachment.data.replace(/-/g, '+').replace(/_/g, '/');

        let result = '**Attachment Downloaded**\n\n';
        result += `Filename: ${attachmentFilename}\n`;
        result += `MIME Type: ${attachmentMimeType}\n`;
        result += `Size: ${size} bytes (${(size / 1024).toFixed(2)} KB)\n`;
        result += `Message ID: ${args.messageId}\n`;
        result += `Attachment ID: ${args.attachmentId}\n\n`;

        if (args.savePath) {
          // Validate that savePath is absolute
          if (!path.isAbsolute(args.savePath)) {
            throw new Error(`savePath must be an absolute path. Received: ${args.savePath}`);
          }

          // Validate path for security
          const pathValidation = validateWritePath(args.savePath, getServerConfig().pathSecurity);
          if (!pathValidation.valid) {
            throw new Error(`Cannot save to this path: ${pathValidation.error}`);
          }

          // Decode and save to file
          const buffer = Buffer.from(base64Data, 'base64');

          // Ensure parent directory exists
          const parentDir = path.dirname(pathValidation.resolvedPath);
          await fs.mkdir(parentDir, { recursive: true });

          await fs.writeFile(pathValidation.resolvedPath, buffer);

          result += `**Saved to:** ${pathValidation.resolvedPath}\n`;
          result += `File size on disk: ${buffer.length} bytes`;
        } else {
          // Return full base64 data
          result += `**Base64 Data (standard encoding):**\n${base64Data}`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('downloadGmailAttachment', error));
      }
    },
  });

  // --- Save Gmail Attachment to Drive ---
  server.addTool({
    name: 'saveAttachmentToDrive',
    description:
      'Save a Gmail attachment directly to Google Drive. Uploads the attachment as a file to Drive without downloading locally first.',
    annotations: {
      title: 'Save Attachment to Drive',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The ID of the message containing the attachment'),
      attachmentId: z
        .string()
        .describe('The attachment ID (from readGmailMessage attachment info)'),
      fileName: z
        .string()
        .optional()
        .describe(
          'Optional custom file name for the saved file. If not provided, uses the original attachment name.'
        ),
      folderId: z
        .string()
        .optional()
        .describe(
          'Optional Google Drive folder ID to save the file to. If not provided, saves to root of My Drive.'
        ),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);
        const drive = await getDriveClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        // First, get attachment metadata from the message to find the filename
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: args.messageId,
          format: 'full',
        });

        // Find attachment info in message parts
        let attachmentFilename = 'attachment';
        let attachmentMimeType = 'application/octet-stream';

        const findAttachmentInfo = (part: MessagePart) => {
          if (part.body?.attachmentId === args.attachmentId && part.filename) {
            attachmentFilename = part.filename;
            attachmentMimeType = part.mimeType || 'application/octet-stream';
            return true;
          }
          if (part.parts) {
            for (const subpart of part.parts) {
              if (findAttachmentInfo(subpart)) return true;
            }
          }
          return false;
        };

        if (messageResponse.data.payload) {
          findAttachmentInfo(messageResponse.data.payload);
        }

        // Use custom filename if provided
        const finalFileName = args.fileName || attachmentFilename;

        // Get the attachment data
        const attachmentResponse = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: args.messageId,
          id: args.attachmentId,
        });

        const attachment = attachmentResponse.data;
        const size = attachment.size || 0;

        if (!attachment.data) {
          throw new Error('No attachment data available');
        }

        // Convert base64url to standard base64, then to buffer
        const base64Data = attachment.data.replace(/-/g, '+').replace(/_/g, '/');
        const buffer = Buffer.from(base64Data, 'base64');

        // Create a readable stream from the buffer for Drive upload
        const bufferStream = new Readable();
        bufferStream.push(buffer);
        bufferStream.push(null);

        // Upload to Google Drive
        const fileMetadata: { name: string; parents?: string[] } = {
          name: finalFileName,
        };

        if (args.folderId) {
          fileMetadata.parents = [args.folderId];
        }

        const driveResponse = await drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: attachmentMimeType,
            body: bufferStream,
          },
          fields: 'id,name,webViewLink,mimeType,size',
        });

        const driveFile = driveResponse.data;
        const fileId = driveFile.id;

        if (!fileId) {
          throw new Error('Failed to upload file to Drive - no file ID returned');
        }

        const driveLink = getDriveFileUrl(fileId, accountEmail);

        let result = '**Attachment Saved to Drive**\n\n';
        result += `File Name: ${driveFile.name}\n`;
        result += `File ID: ${fileId}\n`;
        result += `MIME Type: ${driveFile.mimeType || attachmentMimeType}\n`;
        result += `Size: ${size} bytes (${(size / 1024).toFixed(2)} KB)\n`;
        if (args.folderId) {
          result += `Folder ID: ${args.folderId}\n`;
        }
        result += `\nView in Drive: ${driveLink}\n`;
        result += `\nSource Message ID: ${args.messageId}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('saveAttachmentToDrive', error));
      }
    },
  });

  // --- Mark as Read ---
  server.addTool({
    name: 'markAsRead',
    description: 'Mark a Gmail message as read by removing the UNREAD label.',
    annotations: {
      title: 'Mark as Read',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The message ID to mark as read'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.messages.modify({
          userId: 'me',
          id: args.messageId,
          requestBody: {
            removeLabelIds: ['UNREAD'],
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.id
          ? getGmailMessageUrl(response.data.id, accountEmail)
          : undefined;

        let result = `Successfully marked message ${args.messageId} as read.\n`;
        result += `Current labels: ${(response.data.labelIds ?? []).join(', ')}\n`;
        if (link) {
          result += `\nView message: ${link}`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('markAsRead', error));
      }
    },
  });

  // --- Mark as Unread ---
  server.addTool({
    name: 'markAsUnread',
    description: 'Mark a Gmail message as unread by adding the UNREAD label.',
    annotations: {
      title: 'Mark as Unread',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageId: z.string().describe('The message ID to mark as unread'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.messages.modify({
          userId: 'me',
          id: args.messageId,
          requestBody: {
            addLabelIds: ['UNREAD'],
          },
        });

        const accountEmail = await getAccountEmail(args.account);
        const link = response.data.id
          ? getGmailMessageUrl(response.data.id, accountEmail)
          : undefined;

        let result = `Successfully marked message ${args.messageId} as unread.\n`;
        result += `Current labels: ${(response.data.labelIds ?? []).join(', ')}\n`;
        if (link) {
          result += `\nView message: ${link}`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('markAsUnread', error));
      }
    },
  });

  // --- List Gmail Threads ---
  server.addTool({
    name: 'listGmailThreads',
    description:
      'List email threads (conversations) from Gmail. Each thread contains all messages in a conversation.',
    annotations: {
      title: 'List Gmail Threads',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      maxResults: z
        .number()
        .optional()
        .default(10)
        .describe('Maximum number of threads to return (default: 10, max: 500)'),
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

        const response = await gmail.users.threads.list({
          userId: 'me',
          maxResults: Math.min(args.maxResults || 10, 500),
          labelIds: args.labelIds,
          q: args.query,
        });

        const threads = response.data.threads ?? [];
        const accountEmail = await getAccountEmail(args.account);

        let result = `Found approximately ${response.data.resultSizeEstimate} threads.\n\n`;

        if (threads.length === 0) {
          result += 'No threads found.';
        } else {
          result += `Showing ${threads.length} threads:\n\n`;
          for (let i = 0; i < threads.length; i++) {
            const t = threads[i];
            const link = t.id ? getGmailMessageUrl(t.id, accountEmail) : 'N/A';
            result += `${i + 1}. Thread ID: ${t.id}\n`;
            result += `   Snippet: ${t.snippet || '(no snippet)'}\n`;
            result += `   Link: ${link}\n\n`;
          }
        }

        if (response.data.nextPageToken) {
          result += `\nMore threads available (next page token: ${response.data.nextPageToken})`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('listGmailThreads', error));
      }
    },
  });

  // --- Read Gmail Thread ---
  server.addTool({
    name: 'readGmailThread',
    description:
      'Read a complete Gmail thread (conversation) including all messages. Returns full content of all messages in the thread.',
    annotations: {
      title: 'Read Gmail Thread',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      threadId: z.string().describe('The ID of the thread to read'),
      format: z
        .enum(['full', 'metadata', 'minimal'])
        .optional()
        .default('full')
        .describe('Response format for messages in the thread'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.threads.get({
          userId: 'me',
          id: args.threadId,
          format: args.format,
        });

        const thread = response.data;
        const messages = thread.messages ?? [];
        const accountEmail = await getAccountEmail(args.account);

        const getHeader = (
          headers: { name?: string | null; value?: string | null }[],
          name: string
        ) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;

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

        let result = '**Email Thread**\n\n';
        result += `Thread ID: ${thread.id}\n`;
        result += `Messages in thread: ${messages.length}\n`;
        result += `History ID: ${thread.historyId}\n\n`;
        result += '---\n\n';

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          const headers = message.payload?.headers ?? [];

          result += `**Message ${i + 1} of ${messages.length}**\n`;
          result += `ID: ${message.id}\n`;
          result += `From: ${getHeader(headers, 'From') || 'N/A'}\n`;
          result += `To: ${getHeader(headers, 'To') || 'N/A'}\n`;
          if (getHeader(headers, 'Cc')) result += `Cc: ${getHeader(headers, 'Cc')}\n`;
          result += `Subject: ${getHeader(headers, 'Subject') || 'N/A'}\n`;
          result += `Date: ${getHeader(headers, 'Date') || 'N/A'}\n`;
          result += `Labels: ${(message.labelIds ?? []).join(', ') || 'None'}\n\n`;

          if (args.format === 'full' && message.payload) {
            const body = extractBody(message.payload);
            // Wrap email body with security warnings to defend against prompt injection
            const from = getHeader(headers, 'From');
            const subject = getHeader(headers, 'Subject');
            const wrappedBody = body
              ? wrapEmailContent(body, from || undefined, subject || undefined)
              : '(empty)';
            result += `**Body:**\n${wrappedBody}\n`;
          } else if (message.snippet) {
            result += `**Snippet:** ${message.snippet}\n`;
          }

          if (i < messages.length - 1) {
            result += '\n---\n\n';
          }
        }

        const link = thread.id ? getGmailMessageUrl(thread.id, accountEmail) : undefined;
        if (link) {
          result += `\n\nView thread in Gmail: ${link}`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('readGmailThread', error));
      }
    },
  });

  // --- Batch Add Gmail Labels ---
  server.addTool({
    name: 'batchAddGmailLabels',
    description:
      'Add labels to multiple Gmail messages at once. More efficient than adding labels one by one.',
    annotations: {
      title: 'Batch Add Gmail Labels',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageIds: z
        .array(z.string())
        .min(1)
        .max(1000)
        .describe('Array of message IDs to modify (max 1000)'),
      labelIds: z
        .array(z.string())
        .min(1)
        .describe('Array of label IDs to add (e.g., ["STARRED", "IMPORTANT"])'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: args.messageIds,
            addLabelIds: args.labelIds,
          },
        });

        let result = `Successfully added labels to ${args.messageIds.length} messages.\n\n`;
        result += `Labels added: ${args.labelIds.join(', ')}\n`;
        result += `Message IDs: ${args.messageIds.slice(0, 10).join(', ')}`;
        if (args.messageIds.length > 10) {
          result += ` ... and ${args.messageIds.length - 10} more`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('batchAddGmailLabels', error));
      }
    },
  });

  // --- Batch Remove Gmail Labels ---
  server.addTool({
    name: 'batchRemoveGmailLabels',
    description:
      'Remove labels from multiple Gmail messages at once. More efficient than removing labels one by one. Use to bulk archive (remove INBOX), bulk mark as read (remove UNREAD), etc.',
    annotations: {
      title: 'Batch Remove Gmail Labels',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      messageIds: z
        .array(z.string())
        .min(1)
        .max(1000)
        .describe('Array of message IDs to modify (max 1000)'),
      labelIds: z
        .array(z.string())
        .min(1)
        .describe(
          'Array of label IDs to remove (e.g., ["UNREAD"] to mark all as read, ["INBOX"] to archive all)'
        ),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: args.messageIds,
            removeLabelIds: args.labelIds,
          },
        });

        let result = `Successfully removed labels from ${args.messageIds.length} messages.\n\n`;
        result += `Labels removed: ${args.labelIds.join(', ')}\n`;
        result += `Message IDs: ${args.messageIds.slice(0, 10).join(', ')}`;
        if (args.messageIds.length > 10) {
          result += ` ... and ${args.messageIds.length - 10} more`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('batchRemoveGmailLabels', error));
      }
    },
  });

  // --- List Gmail Filters ---
  server.addTool({
    name: 'listGmailFilters',
    description:
      'List all Gmail filters (rules that automatically process incoming messages based on criteria).',
    annotations: {
      title: 'List Gmail Filters',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.settings.filters.list({
          userId: 'me',
        });

        const filters = response.data.filter ?? [];

        let result = `**Gmail Filters (${filters.length} total)**\n\n`;

        if (filters.length === 0) {
          result += 'No filters found.';
          return result;
        }

        for (let i = 0; i < filters.length; i++) {
          const filter = filters[i];
          const criteria = filter.criteria || {};
          const action = filter.action || {};

          result += `**${i + 1}. Filter ID: ${filter.id}**\n`;
          result += '   Criteria:\n';
          if (criteria.from) result += `     - From: ${criteria.from}\n`;
          if (criteria.to) result += `     - To: ${criteria.to}\n`;
          if (criteria.subject) result += `     - Subject: ${criteria.subject}\n`;
          if (criteria.query) result += `     - Query: ${criteria.query}\n`;
          if (criteria.hasAttachment) result += '     - Has attachment: yes\n';
          if (criteria.size)
            result += `     - Size: ${criteria.sizeComparison} ${criteria.size} bytes\n`;

          result += '   Actions:\n';
          if (action.addLabelIds?.length)
            result += `     - Add labels: ${action.addLabelIds.join(', ')}\n`;
          if (action.removeLabelIds?.length)
            result += `     - Remove labels: ${action.removeLabelIds.join(', ')}\n`;
          if (action.forward) result += `     - Forward to: ${action.forward}\n`;

          result += '\n';
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('listGmailFilters', error));
      }
    },
  });

  // --- Create Gmail Filter ---
  server.addTool({
    name: 'createGmailFilter',
    description:
      'Create a Gmail filter to automatically process incoming messages. Filters can add/remove labels, forward messages, or archive them.',
    annotations: {
      title: 'Create Gmail Filter',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      // Criteria (at least one required)
      from: z.string().optional().describe('Filter emails from this sender'),
      to: z.string().optional().describe('Filter emails to this recipient'),
      subject: z.string().optional().describe('Filter emails with this subject'),
      query: z
        .string()
        .optional()
        .describe('Filter using Gmail search query syntax (most flexible option)'),
      hasAttachment: z.boolean().optional().describe('Filter emails that have attachments'),
      // Actions (at least one required)
      addLabelIds: z.array(z.string()).optional().describe('Label IDs to add to matching emails'),
      removeLabelIds: z
        .array(z.string())
        .optional()
        .describe('Label IDs to remove (e.g., ["INBOX"] to archive, ["UNREAD"] to mark as read)'),
      forward: z.string().optional().describe('Email address to forward matching emails to'),
    }),
    async execute(args, { log: _log }) {
      try {
        // Validate that at least one criteria is provided
        const hasCriteria =
          args.from || args.to || args.subject || args.query || args.hasAttachment;
        if (!hasCriteria) {
          throw new Error(
            'At least one filter criteria must be provided (from, to, subject, query, or hasAttachment)'
          );
        }

        // Validate that at least one action is provided
        const hasAction =
          (args.addLabelIds && args.addLabelIds.length > 0) ||
          (args.removeLabelIds && args.removeLabelIds.length > 0) ||
          args.forward;
        if (!hasAction) {
          throw new Error(
            'At least one filter action must be provided (addLabelIds, removeLabelIds, or forward)'
          );
        }

        const gmail = await getGmailClient(args.account);

        const response = await gmail.users.settings.filters.create({
          userId: 'me',
          requestBody: {
            criteria: {
              from: args.from,
              to: args.to,
              subject: args.subject,
              query: args.query,
              hasAttachment: args.hasAttachment,
            },
            action: {
              addLabelIds: args.addLabelIds,
              removeLabelIds: args.removeLabelIds,
              forward: args.forward,
            },
          },
        });

        const filter = response.data;

        let result = 'Successfully created Gmail filter.\n\n';
        result += `Filter ID: ${filter.id}\n\n`;
        result += '**Criteria:**\n';
        if (args.from) result += `- From: ${args.from}\n`;
        if (args.to) result += `- To: ${args.to}\n`;
        if (args.subject) result += `- Subject: ${args.subject}\n`;
        if (args.query) result += `- Query: ${args.query}\n`;
        if (args.hasAttachment) result += '- Has attachment: yes\n';
        result += '\n**Actions:**\n';
        if (args.addLabelIds?.length) result += `- Add labels: ${args.addLabelIds.join(', ')}\n`;
        if (args.removeLabelIds?.length)
          result += `- Remove labels: ${args.removeLabelIds.join(', ')}\n`;
        if (args.forward) result += `- Forward to: ${args.forward}\n`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('createGmailFilter', error));
      }
    },
  });

  // --- Delete Gmail Filter ---
  server.addTool({
    name: 'deleteGmailFilter',
    description: 'Delete a Gmail filter by its ID.',
    annotations: {
      title: 'Delete Gmail Filter',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      filterId: z.string().describe('The ID of the filter to delete (from listGmailFilters)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const gmail = await getGmailClient(args.account);

        await gmail.users.settings.filters.delete({
          userId: 'me',
          id: args.filterId,
        });

        return `Successfully deleted filter ${args.filterId}.`;
      } catch (error: unknown) {
        throw new Error(formatToolError('deleteGmailFilter', error));
      }
    },
  });
}
