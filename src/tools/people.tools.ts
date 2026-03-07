// people.tools.ts - Google People API tool module
import { z } from 'zod';
import { formatToolError } from '../errorHelpers.js';
import { type PeopleToolOptions } from '../types.js';
import { getContactsUrl, getContactPersonUrl } from '../urlHelpers.js';
import { wrapUntrustedContent } from '../securityHelpers.js';

// --- Constants ---

// Maximum photo size in bytes (4MB)
const MAX_PHOTO_SIZE_BYTES = 4 * 1024 * 1024;

// Person fields for list operations (subset for performance)
const LIST_PERSON_FIELDS = [
  'names',
  'emailAddresses',
  'phoneNumbers',
  'organizations',
  'photos',
].join(',');

// Person fields for detailed get operations (comprehensive)
const FULL_PERSON_FIELDS = [
  'names',
  'nicknames',
  'emailAddresses',
  'phoneNumbers',
  'addresses',
  'organizations',
  'birthdays',
  'urls',
  'biographies',
  'events',
  'relations',
  'userDefined',
  'photos',
  'memberships',
  'metadata',
].join(',');

// --- Helper Types ---

interface PersonName {
  givenName?: string;
  familyName?: string;
  middleName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
  displayName?: string;
}

interface PersonEmail {
  value: string;
  type?: string;
}

interface PersonPhone {
  value: string;
  type?: string;
}

interface PersonAddress {
  formattedValue?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  type?: string;
}

interface PersonOrganization {
  name?: string;
  title?: string;
  department?: string;
}

interface PersonBirthday {
  date?: { year?: number; month?: number; day?: number };
  text?: string;
}

interface PersonUrl {
  value: string;
  type?: string;
}

interface PersonEvent {
  date?: { year?: number; month?: number; day?: number };
  type?: string;
}

interface PersonRelation {
  person?: string;
  type?: string;
}

interface PersonUserDefined {
  key?: string;
  value?: string;
}

// --- Helper Functions ---

function formatPersonName(names: PersonName[] | undefined): string {
  if (!names || names.length === 0) return '(No name)';
  const primary = names[0];
  if (primary.displayName) return primary.displayName;
  const parts = [
    primary.honorificPrefix,
    primary.givenName,
    primary.middleName,
    primary.familyName,
    primary.honorificSuffix,
  ].filter(Boolean);
  return parts.join(' ') || '(No name)';
}

function formatEmailList(emails: PersonEmail[] | undefined): string {
  if (!emails || emails.length === 0) return '';
  return emails.map((e) => `${e.value}${e.type ? ` (${e.type})` : ''}`).join(', ');
}

function formatPhoneList(phones: PersonPhone[] | undefined): string {
  if (!phones || phones.length === 0) return '';
  return phones.map((p) => `${p.value}${p.type ? ` (${p.type})` : ''}`).join(', ');
}

function formatOrganization(orgs: PersonOrganization[] | undefined): string {
  if (!orgs || orgs.length === 0) return '';
  const org = orgs[0];
  const parts = [org.name, org.title, org.department].filter(Boolean);
  return parts.join(' - ');
}

function formatDate(date: { year?: number; month?: number; day?: number } | undefined): string {
  if (!date) return '';
  const parts: string[] = [];
  if (date.month) parts.push(String(date.month).padStart(2, '0'));
  if (date.day) parts.push(String(date.day).padStart(2, '0'));
  if (date.year) parts.push(String(date.year));
  return parts.join('/') || '';
}

// Format a contact for list display (subset of fields)
function formatContactForList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  person: any,
  index: number,
  accountEmail: string
): string {
  const resourceName = person.resourceName || '';
  const name = formatPersonName(person.names);
  const email = formatEmailList(person.emailAddresses);
  const phone = formatPhoneList(person.phoneNumbers);
  const org = formatOrganization(person.organizations);

  let result = `${index}. **${name}**\n`;
  if (email) result += `   Email: ${email}\n`;
  if (phone) result += `   Phone: ${phone}\n`;
  if (org) result += `   Organization: ${org}\n`;
  result += `   Resource: ${resourceName}\n`;

  if (resourceName) {
    result += `   Link: ${getContactPersonUrl(resourceName, accountEmail)}\n`;
  }

  return result;
}

// Format a contact for detailed display (all fields)
function formatContactDetailed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  person: any,
  accountEmail: string
): string {
  const resourceName = person.resourceName || '';
  const name = formatPersonName(person.names);

  let result = `**${name}**\n`;
  result += `Resource: ${resourceName}\n\n`;

  // Names (if multiple)
  if (person.names && person.names.length > 1) {
    result += '**Names**\n';
    person.names.forEach((n: PersonName) => {
      result += `- ${formatPersonName([n])}\n`;
    });
    result += '\n';
  }

  // Nicknames
  if (person.nicknames && person.nicknames.length > 0) {
    result += '**Nicknames**\n';
    person.nicknames.forEach((n: { value?: string }) => {
      if (n.value) result += `- ${n.value}\n`;
    });
    result += '\n';
  }

  // Emails
  if (person.emailAddresses && person.emailAddresses.length > 0) {
    result += '**Emails**\n';
    person.emailAddresses.forEach((e: PersonEmail) => {
      result += `- ${e.value}${e.type ? ` (${e.type})` : ''}\n`;
    });
    result += '\n';
  }

  // Phones
  if (person.phoneNumbers && person.phoneNumbers.length > 0) {
    result += '**Phones**\n';
    person.phoneNumbers.forEach((p: PersonPhone) => {
      result += `- ${p.value}${p.type ? ` (${p.type})` : ''}\n`;
    });
    result += '\n';
  }

  // Addresses
  if (person.addresses && person.addresses.length > 0) {
    result += '**Addresses**\n';
    person.addresses.forEach((a: PersonAddress) => {
      const formatted =
        a.formattedValue ||
        [a.streetAddress, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', ');
      result += `- ${formatted}${a.type ? ` (${a.type})` : ''}\n`;
    });
    result += '\n';
  }

  // Organizations
  if (person.organizations && person.organizations.length > 0) {
    result += '**Organizations**\n';
    person.organizations.forEach((o: PersonOrganization) => {
      const parts = [o.name, o.title, o.department].filter(Boolean);
      result += `- ${parts.join(' - ')}\n`;
    });
    result += '\n';
  }

  // Birthdays
  if (person.birthdays && person.birthdays.length > 0) {
    result += '**Birthday**\n';
    person.birthdays.forEach((b: PersonBirthday) => {
      if (b.text) {
        result += `- ${b.text}\n`;
      } else if (b.date) {
        result += `- ${formatDate(b.date)}\n`;
      }
    });
    result += '\n';
  }

  // URLs
  if (person.urls && person.urls.length > 0) {
    result += '**URLs**\n';
    person.urls.forEach((u: PersonUrl) => {
      result += `- ${u.value}${u.type ? ` (${u.type})` : ''}\n`;
    });
    result += '\n';
  }

  // Events (anniversaries, etc.)
  if (person.events && person.events.length > 0) {
    result += '**Events**\n';
    person.events.forEach((e: PersonEvent) => {
      if (e.date) {
        result += `- ${formatDate(e.date)}${e.type ? ` (${e.type})` : ''}\n`;
      }
    });
    result += '\n';
  }

  // Relations
  if (person.relations && person.relations.length > 0) {
    result += '**Relations**\n';
    person.relations.forEach((r: PersonRelation) => {
      if (r.person) {
        result += `- ${r.person}${r.type ? ` (${r.type})` : ''}\n`;
      }
    });
    result += '\n';
  }

  // Biographies (notes) - wrap as untrusted content
  if (person.biographies && person.biographies.length > 0) {
    result += '**Notes**\n';
    person.biographies.forEach((b: { value?: string }) => {
      if (b.value) {
        result += wrapUntrustedContent(b.value, 'Contact notes');
        result += '\n';
      }
    });
    result += '\n';
  }

  // User-defined fields - wrap as untrusted content
  if (person.userDefined && person.userDefined.length > 0) {
    result += '**Custom Fields**\n';
    person.userDefined.forEach((u: PersonUserDefined) => {
      if (u.key && u.value) {
        result += `- ${u.key}: `;
        result += wrapUntrustedContent(u.value, 'Contact custom field');
        result += '\n';
      }
    });
    result += '\n';
  }

  // Group memberships
  if (person.memberships && person.memberships.length > 0) {
    const groupMemberships = person.memberships.filter(
      (m: { contactGroupMembership?: { contactGroupResourceName?: string } }) =>
        m.contactGroupMembership?.contactGroupResourceName
    );
    if (groupMemberships.length > 0) {
      result += '**Groups**\n';
      groupMemberships.forEach(
        (m: { contactGroupMembership?: { contactGroupResourceName?: string } }) => {
          result += `- ${m.contactGroupMembership?.contactGroupResourceName}\n`;
        }
      );
      result += '\n';
    }
  }

  // Photos
  if (person.photos && person.photos.length > 0) {
    const photo = person.photos.find((p: { default?: boolean }) => !p.default);
    if (photo?.url) {
      result += '**Photo**\n';
      result += `URL: ${photo.url}\n\n`;
    }
  }

  // Metadata
  if (person.metadata) {
    result += '**Metadata**\n';
    if (person.metadata.sources && person.metadata.sources.length > 0) {
      const source = person.metadata.sources[0];
      if (source.updateTime) {
        result += `Last updated: ${source.updateTime}\n`;
      }
    }
  }

  // Link to contact
  if (resourceName) {
    result += `\nView in Contacts: ${getContactPersonUrl(resourceName, accountEmail)}`;
  }

  return result;
}

// --- Zod Schemas for Contact Fields ---

const NameSchema = z
  .object({
    givenName: z.string().optional().describe('First name'),
    familyName: z.string().optional().describe('Last name'),
    middleName: z.string().optional().describe('Middle name'),
    honorificPrefix: z.string().optional().describe('Prefix (e.g., Mr., Dr.)'),
    honorificSuffix: z.string().optional().describe('Suffix (e.g., Jr., III)'),
  })
  .describe('Name components');

const EmailSchema = z
  .object({
    value: z.string().email().describe('Email address'),
    type: z.string().optional().describe('Type of email (e.g., home, work, other)'),
  })
  .describe('Email address');

const PhoneSchema = z
  .object({
    value: z.string().describe('Phone number'),
    type: z.string().optional().describe('Type of phone (e.g., mobile, home, work)'),
  })
  .describe('Phone number');

const AddressSchema = z
  .object({
    streetAddress: z.string().optional().describe('Street address'),
    city: z.string().optional().describe('City'),
    region: z.string().optional().describe('State/province/region'),
    postalCode: z.string().optional().describe('Postal/ZIP code'),
    country: z.string().optional().describe('Country'),
    type: z.string().optional().describe('Type of address (e.g., home, work)'),
  })
  .describe('Postal address');

const OrganizationSchema = z
  .object({
    name: z.string().optional().describe('Company/organization name'),
    title: z.string().optional().describe('Job title'),
    department: z.string().optional().describe('Department'),
  })
  .describe('Organization/employer');

const BirthdaySchema = z
  .object({
    year: z.number().int().min(1).max(9999).optional().describe('Birth year'),
    month: z.number().int().min(1).max(12).describe('Birth month (1-12)'),
    day: z.number().int().min(1).max(31).describe('Birth day (1-31)'),
  })
  .describe('Birthday date');

const UrlSchema = z
  .object({
    value: z.string().url().describe('URL'),
    type: z.string().optional().describe('Type of URL (e.g., homepage, blog, profile)'),
  })
  .describe('Website URL');

const EventSchema = z
  .object({
    year: z.number().int().min(1).max(9999).optional().describe('Event year'),
    month: z.number().int().min(1).max(12).describe('Event month (1-12)'),
    day: z.number().int().min(1).max(31).describe('Event day (1-31)'),
    type: z.string().optional().describe('Type of event (e.g., anniversary)'),
  })
  .describe('Important event/date');

const RelationSchema = z
  .object({
    person: z.string().describe('Name of the related person'),
    type: z.string().optional().describe('Relationship type (e.g., spouse, child, parent, friend)'),
  })
  .describe('Relationship');

const UserDefinedSchema = z
  .object({
    key: z.string().describe('Field name/label'),
    value: z.string().describe('Field value'),
  })
  .describe('Custom user-defined field');

// Combined schema for creating/updating contacts
const ContactFieldsSchema = z.object({
  names: z.array(NameSchema).optional().describe('Names (usually just one)'),
  nicknames: z
    .array(z.object({ value: z.string() }))
    .optional()
    .describe('Nicknames'),
  emailAddresses: z.array(EmailSchema).optional().describe('Email addresses'),
  phoneNumbers: z.array(PhoneSchema).optional().describe('Phone numbers'),
  addresses: z.array(AddressSchema).optional().describe('Postal addresses'),
  organizations: z.array(OrganizationSchema).optional().describe('Organizations/employers'),
  birthdays: z.array(BirthdaySchema).optional().describe('Birthdays'),
  urls: z.array(UrlSchema).optional().describe('Website URLs'),
  biographies: z
    .array(z.object({ value: z.string() }))
    .optional()
    .describe('Notes/biography'),
  events: z.array(EventSchema).optional().describe('Important events (anniversaries, etc.)'),
  relations: z.array(RelationSchema).optional().describe('Relationships'),
  userDefined: z.array(UserDefinedSchema).optional().describe('Custom fields'),
});

// Helper to convert schema input to API format
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertContactFieldsToApi(fields: z.infer<typeof ContactFieldsSchema>): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {};

  if (fields.names) {
    result.names = fields.names;
  }
  if (fields.nicknames) {
    result.nicknames = fields.nicknames;
  }
  if (fields.emailAddresses) {
    result.emailAddresses = fields.emailAddresses;
  }
  if (fields.phoneNumbers) {
    result.phoneNumbers = fields.phoneNumbers;
  }
  if (fields.addresses) {
    result.addresses = fields.addresses;
  }
  if (fields.organizations) {
    result.organizations = fields.organizations;
  }
  if (fields.birthdays) {
    result.birthdays = fields.birthdays.map((b) => ({
      date: { year: b.year, month: b.month, day: b.day },
    }));
  }
  if (fields.urls) {
    result.urls = fields.urls;
  }
  if (fields.biographies) {
    result.biographies = fields.biographies;
  }
  if (fields.events) {
    result.events = fields.events.map((e) => ({
      date: { year: e.year, month: e.month, day: e.day },
      type: e.type,
    }));
  }
  if (fields.relations) {
    result.relations = fields.relations;
  }
  if (fields.userDefined) {
    result.userDefined = fields.userDefined;
  }

  return result;
}

// --- Tool Registration ---

export function registerPeopleTools(options: PeopleToolOptions) {
  const { server, getPeopleClient, getAccountEmail } = options;

  // ===========================
  // === CONTACTS TOOLS ===
  // ===========================

  // --- List Contacts ---
  server.addTool({
    name: 'listPeopleContacts',
    description:
      "List contacts from the user's Google Contacts. Returns a subset of fields (name, email, phone, organization). Use getPeopleContact for full details.",
    annotations: {
      title: 'List Contacts',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(50)
        .describe('Number of contacts to return (default: 50, max: 1000)'),
      pageToken: z.string().optional().describe('Page token for pagination'),
      sortOrder: z
        .enum([
          'LAST_MODIFIED_ASCENDING',
          'LAST_MODIFIED_DESCENDING',
          'FIRST_NAME_ASCENDING',
          'LAST_NAME_ASCENDING',
        ])
        .optional()
        .describe('Sort order for results'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.people.connections.list({
          resourceName: 'people/me',
          pageSize: args.pageSize,
          pageToken: args.pageToken,
          personFields: LIST_PERSON_FIELDS,
          sortOrder: args.sortOrder,
        });

        const contacts = response.data.connections ?? [];
        const totalItems = response.data.totalItems ?? contacts.length;
        const nextPageToken = response.data.nextPageToken;

        let result = `**Contacts** (${contacts.length} of ${totalItems} total)\n\n`;

        if (contacts.length === 0) {
          result += 'No contacts found.\n';
        } else {
          contacts.forEach((person, i) => {
            result += formatContactForList(person, i + 1, accountEmail);
            result += '\n';
          });
        }

        if (nextPageToken) {
          result += `\nNext page token: ${nextPageToken}`;
        }

        result += `\n\nView all contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('listPeopleContacts', error));
      }
    },
  });

  // --- Search Contacts ---
  server.addTool({
    name: 'searchPeopleContacts',
    description:
      'Search contacts by name, email, phone number, or other fields. Returns matching contacts with basic info.',
    annotations: {
      title: 'Search Contacts',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      query: z.string().min(1).describe('Search query (name, email, phone, etc.)'),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .default(30)
        .describe('Number of results (default: 30, max: 30)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.people.searchContacts({
          query: args.query,
          pageSize: args.pageSize,
          readMask: LIST_PERSON_FIELDS,
        });

        const results = response.data.results ?? [];

        let result = `**Search Results for:** "${args.query}"\n`;
        result += `Found ${results.length} contacts\n\n`;

        if (results.length === 0) {
          result += 'No contacts matching your query.\n';
        } else {
          results.forEach((r, i) => {
            if (r.person) {
              result += formatContactForList(r.person, i + 1, accountEmail);
              result += '\n';
            }
          });
        }

        result += `\nView all contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('searchPeopleContacts', error));
      }
    },
  });

  // --- Get Contact ---
  server.addTool({
    name: 'getPeopleContact',
    description:
      'Get detailed information for a specific contact by resource name. Returns all available fields.',
    annotations: {
      title: 'Get Contact Details',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      resourceName: z.string().describe('Contact resource name (e.g., "people/c1234567890")'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.people.get({
          resourceName: args.resourceName,
          personFields: FULL_PERSON_FIELDS,
        });

        return formatContactDetailed(response.data, accountEmail);
      } catch (error: unknown) {
        throw new Error(formatToolError('getPeopleContact', error));
      }
    },
  });

  // --- Batch Get Contacts ---
  server.addTool({
    name: 'batchGetPeopleContacts',
    description: 'Get detailed information for multiple contacts at once by their resource names.',
    annotations: {
      title: 'Batch Get Contacts',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      resourceNames: z
        .array(z.string())
        .min(1)
        .max(200)
        .describe('Array of contact resource names (max 200)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.people.getBatchGet({
          resourceNames: args.resourceNames,
          personFields: FULL_PERSON_FIELDS,
        });

        const responses = response.data.responses ?? [];

        let result = `**Batch Get Results** (${responses.length} contacts)\n\n`;

        responses.forEach((r, i) => {
          if (r.person) {
            result += `--- Contact ${i + 1} ---\n`;
            result += formatContactDetailed(r.person, accountEmail);
            result += '\n\n';
          } else if (r.status) {
            result += `--- Contact ${i + 1} ---\n`;
            result += `Error: ${r.status.message || 'Unknown error'}\n\n`;
          }
        });

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('batchGetPeopleContacts', error));
      }
    },
  });

  // --- Create Contact ---
  server.addTool({
    name: 'createPeopleContact',
    description: 'Create a new contact with the specified fields.',
    annotations: {
      title: 'Create Contact',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z
      .object({
        account: z.string().describe('Account name to use'),
      })
      .merge(ContactFieldsSchema)
      .refine(
        (data) => {
          // At least one name or email should be provided
          return (
            (data.names && data.names.length > 0) ||
            (data.emailAddresses && data.emailAddresses.length > 0)
          );
        },
        {
          message: 'At least one name or email address is required',
        }
      ),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const { account: _account, ...fields } = args;
        const requestBody = convertContactFieldsToApi(fields);

        const response = await people.people.createContact({
          personFields: FULL_PERSON_FIELDS,
          requestBody,
        });

        const resourceName = response.data.resourceName;

        let result = 'Successfully created contact.\n\n';
        result += formatContactDetailed(response.data, accountEmail);

        if (resourceName) {
          result += `\n\nView contact: ${getContactPersonUrl(resourceName, accountEmail)}`;
        }

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('createPeopleContact', error));
      }
    },
  });

  // --- Update Contact ---
  server.addTool({
    name: 'updatePeopleContact',
    description:
      'Update an existing contact. Fields provided will replace existing values. Omitted fields remain unchanged.',
    annotations: {
      title: 'Update Contact',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z
      .object({
        account: z.string().describe('Account name to use'),
        resourceName: z.string().describe('Contact resource name (e.g., "people/c1234567890")'),
      })
      .merge(ContactFieldsSchema),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        // First, get the current contact to get the etag
        const current = await people.people.get({
          resourceName: args.resourceName,
          personFields: FULL_PERSON_FIELDS,
        });

        const etag = current.data.etag;
        if (!etag) {
          throw new Error('Could not retrieve contact etag for update');
        }

        const { account: _account, resourceName, ...fields } = args;
        const updateFields = convertContactFieldsToApi(fields);

        // Build the update mask from provided fields
        const updatePersonFields = Object.keys(fields)
          .filter((k) => fields[k as keyof typeof fields] !== undefined)
          .join(',');

        if (!updatePersonFields) {
          throw new Error('At least one field must be provided for update');
        }

        const response = await people.people.updateContact({
          resourceName,
          updatePersonFields,
          personFields: FULL_PERSON_FIELDS,
          requestBody: {
            etag,
            ...updateFields,
          },
        });

        let result = 'Successfully updated contact.\n\n';
        result += formatContactDetailed(response.data, accountEmail);

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('updatePeopleContact', error));
      }
    },
  });

  // --- Update Contact Photo ---
  server.addTool({
    name: 'updatePeopleContactPhoto',
    description: "Upload or update a contact's photo. Photo must be base64-encoded and under 4MB.",
    annotations: {
      title: 'Update Contact Photo',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      resourceName: z.string().describe('Contact resource name (e.g., "people/c1234567890")'),
      photoBase64: z
        .string()
        .describe('Base64-encoded photo data (JPEG, PNG, GIF, BMP, or WebP). Max 4MB.'),
    }),
    async execute(args, { log: _log }) {
      try {
        // Validate photo size
        const photoBytes = Buffer.from(args.photoBase64, 'base64');
        if (photoBytes.length > MAX_PHOTO_SIZE_BYTES) {
          throw new Error(
            `Photo size (${(photoBytes.length / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of 4MB`
          );
        }

        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        await people.people.updateContactPhoto({
          resourceName: args.resourceName,
          requestBody: {
            photoBytes: args.photoBase64,
          },
        });

        let result = 'Successfully updated contact photo.\n\n';
        result += `Resource: ${args.resourceName}\n`;
        result += `View contact: ${getContactPersonUrl(args.resourceName, accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('updatePeopleContactPhoto', error));
      }
    },
  });

  // --- Delete Contact Photo ---
  server.addTool({
    name: 'deletePeopleContactPhoto',
    description: "Remove a contact's photo.",
    annotations: {
      title: 'Delete Contact Photo',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      resourceName: z.string().describe('Contact resource name (e.g., "people/c1234567890")'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        await people.people.deleteContactPhoto({
          resourceName: args.resourceName,
        });

        let result = 'Successfully deleted contact photo.\n\n';
        result += `Resource: ${args.resourceName}\n`;
        result += `View contact: ${getContactPersonUrl(args.resourceName, accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('deletePeopleContactPhoto', error));
      }
    },
  });

  // ===========================
  // === CONTACT GROUPS TOOLS ===
  // ===========================

  // --- List Contact Groups ---
  server.addTool({
    name: 'listPeopleContactGroups',
    description: 'List all contact groups (labels) for the user.',
    annotations: {
      title: 'List Contact Groups',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(50)
        .describe('Number of groups to return (default: 50)'),
      pageToken: z.string().optional().describe('Page token for pagination'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.contactGroups.list({
          pageSize: args.pageSize,
          pageToken: args.pageToken,
        });

        const groups = response.data.contactGroups ?? [];
        const nextPageToken = response.data.nextPageToken;

        let result = `**Contact Groups** (${groups.length} total)\n\n`;

        if (groups.length === 0) {
          result += 'No contact groups found.\n';
        } else {
          groups.forEach((g, i) => {
            const memberCount = g.memberCount ?? 0;
            const groupType = g.groupType ?? 'USER_CONTACT_GROUP';
            result += `${i + 1}. **${g.name || g.formattedName || '(Unnamed)'}**\n`;
            result += `   Resource: ${g.resourceName}\n`;
            result += `   Members: ${memberCount}\n`;
            result += `   Type: ${groupType}\n\n`;
          });
        }

        if (nextPageToken) {
          result += `\nNext page token: ${nextPageToken}`;
        }

        result += `\nView contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('listPeopleContactGroups', error));
      }
    },
  });

  // --- Get Contact Group ---
  server.addTool({
    name: 'getPeopleContactGroup',
    description: 'Get details of a specific contact group, including its members.',
    annotations: {
      title: 'Get Contact Group',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      resourceName: z
        .string()
        .describe('Contact group resource name (e.g., "contactGroups/abc123")'),
      maxMembers: z
        .number()
        .int()
        .min(0)
        .max(1000)
        .optional()
        .default(100)
        .describe('Maximum number of members to return (default: 100)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.contactGroups.get({
          resourceName: args.resourceName,
          maxMembers: args.maxMembers,
        });

        const group = response.data;

        let result = `**Contact Group: ${group.name || group.formattedName || '(Unnamed)'}**\n\n`;
        result += `Resource: ${group.resourceName}\n`;
        result += `Type: ${group.groupType || 'USER_CONTACT_GROUP'}\n`;
        result += `Member count: ${group.memberCount ?? 0}\n`;

        if (group.memberResourceNames && group.memberResourceNames.length > 0) {
          result += `\n**Members** (${group.memberResourceNames.length} shown):\n`;
          group.memberResourceNames.forEach((m, i) => {
            result += `${i + 1}. ${m}\n`;
          });
        }

        if (group.metadata) {
          result += '\n**Metadata**\n';
          if (group.metadata.updateTime) {
            result += `Last updated: ${group.metadata.updateTime}\n`;
          }
        }

        result += `\nView contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('getPeopleContactGroup', error));
      }
    },
  });

  // --- Create Contact Group ---
  server.addTool({
    name: 'createPeopleContactGroup',
    description: 'Create a new contact group (label).',
    annotations: {
      title: 'Create Contact Group',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      name: z.string().min(1).describe('Name for the new contact group'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.contactGroups.create({
          requestBody: {
            contactGroup: {
              name: args.name,
            },
          },
        });

        const group = response.data;

        let result = 'Successfully created contact group.\n\n';
        result += `**${group.name || group.formattedName}**\n`;
        result += `Resource: ${group.resourceName}\n`;
        result += `\nView contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('createPeopleContactGroup', error));
      }
    },
  });

  // --- Update Contact Group ---
  server.addTool({
    name: 'updatePeopleContactGroup',
    description: 'Rename an existing contact group.',
    annotations: {
      title: 'Update Contact Group',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      resourceName: z
        .string()
        .describe('Contact group resource name (e.g., "contactGroups/abc123")'),
      name: z.string().min(1).describe('New name for the contact group'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.contactGroups.update({
          resourceName: args.resourceName,
          requestBody: {
            contactGroup: {
              name: args.name,
            },
            updateGroupFields: 'name',
          },
        });

        const group = response.data;

        let result = 'Successfully updated contact group.\n\n';
        result += `**${group.name || group.formattedName}**\n`;
        result += `Resource: ${group.resourceName}\n`;
        result += `\nView contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('updatePeopleContactGroup', error));
      }
    },
  });

  // --- Delete Contact Group ---
  server.addTool({
    name: 'deletePeopleContactGroup',
    description: 'Delete a contact group. Contacts in the group are not deleted.',
    annotations: {
      title: 'Delete Contact Group',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      resourceName: z
        .string()
        .describe('Contact group resource name (e.g., "contactGroups/abc123")'),
      deleteContacts: z
        .boolean()
        .optional()
        .default(false)
        .describe('Also delete all contacts in the group (default: false)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        await people.contactGroups.delete({
          resourceName: args.resourceName,
          deleteContacts: args.deleteContacts,
        });

        let result = 'Successfully deleted contact group.\n\n';
        result += `Deleted: ${args.resourceName}\n`;
        if (args.deleteContacts) {
          result += 'Note: Contacts in this group were also deleted.\n';
        } else {
          result += 'Note: Contacts in this group were preserved.\n';
        }
        result += `\nView contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('deletePeopleContactGroup', error));
      }
    },
  });

  // --- Modify Contact Group Members ---
  server.addTool({
    name: 'modifyPeopleContactGroupMembers',
    description: 'Add or remove contacts from a contact group.',
    annotations: {
      title: 'Modify Contact Group Members',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      resourceName: z
        .string()
        .describe('Contact group resource name (e.g., "contactGroups/abc123")'),
      addResourceNames: z
        .array(z.string())
        .optional()
        .describe('Contact resource names to add to the group'),
      removeResourceNames: z
        .array(z.string())
        .optional()
        .describe('Contact resource names to remove from the group'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.contactGroups.members.modify({
          resourceName: args.resourceName,
          requestBody: {
            resourceNamesToAdd: args.addResourceNames,
            resourceNamesToRemove: args.removeResourceNames,
          },
        });

        const added = args.addResourceNames?.length ?? 0;
        const removed = args.removeResourceNames?.length ?? 0;

        let result = 'Successfully modified contact group members.\n\n';
        result += `Group: ${args.resourceName}\n`;
        if (added > 0) result += `Added: ${added} contact(s)\n`;
        if (removed > 0) result += `Removed: ${removed} contact(s)\n`;

        if (response.data.notFoundResourceNames && response.data.notFoundResourceNames.length > 0) {
          result += '\nWarning: Some contacts were not found:\n';
          response.data.notFoundResourceNames.forEach((n) => {
            result += `- ${n}\n`;
          });
        }

        result += `\nView contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('modifyPeopleContactGroupMembers', error));
      }
    },
  });

  // ===========================
  // === OTHER CONTACTS TOOLS ===
  // ===========================

  // --- List Other Contacts ---
  server.addTool({
    name: 'listPeopleOtherContacts',
    description:
      'List "Other contacts" - contacts automatically saved from interactions but not added to the main contacts list.',
    annotations: {
      title: 'List Other Contacts',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(50)
        .describe('Number of contacts to return (default: 50)'),
      pageToken: z.string().optional().describe('Page token for pagination'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.otherContacts.list({
          pageSize: args.pageSize,
          pageToken: args.pageToken,
          readMask: LIST_PERSON_FIELDS,
        });

        const contacts = response.data.otherContacts ?? [];
        const nextPageToken = response.data.nextPageToken;

        let result = `**Other Contacts** (${contacts.length} shown)\n`;
        result += 'These are contacts auto-saved from your interactions.\n\n';

        if (contacts.length === 0) {
          result += 'No other contacts found.\n';
        } else {
          contacts.forEach((person, i) => {
            result += formatContactForList(person, i + 1, accountEmail);
            result += '\n';
          });
        }

        if (nextPageToken) {
          result += `\nNext page token: ${nextPageToken}`;
        }

        result += `\nView all contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('listPeopleOtherContacts', error));
      }
    },
  });

  // --- Search Other Contacts ---
  server.addTool({
    name: 'searchPeopleOtherContacts',
    description: 'Search "Other contacts" by name, email, or phone number.',
    annotations: {
      title: 'Search Other Contacts',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      query: z.string().min(1).describe('Search query (name, email, phone, etc.)'),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(30)
        .optional()
        .default(30)
        .describe('Number of results (default: 30, max: 30)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.otherContacts.search({
          query: args.query,
          pageSize: args.pageSize,
          readMask: LIST_PERSON_FIELDS,
        });

        const results = response.data.results ?? [];

        let result = `**Other Contacts Search Results for:** "${args.query}"\n`;
        result += `Found ${results.length} contacts\n\n`;

        if (results.length === 0) {
          result += 'No other contacts matching your query.\n';
        } else {
          results.forEach((r, i) => {
            if (r.person) {
              result += formatContactForList(r.person, i + 1, accountEmail);
              result += '\n';
            }
          });
        }

        result += `\nView all contacts: ${getContactsUrl(accountEmail)}`;

        return result;
      } catch (error: unknown) {
        throw new Error(formatToolError('searchPeopleOtherContacts', error));
      }
    },
  });

  // ===========================
  // === DIRECTORY TOOLS ===
  // ===========================

  // --- List Directory ---
  server.addTool({
    name: 'listPeopleDirectory',
    description:
      'List people in the organization directory. Only works for Google Workspace accounts, not personal Gmail accounts.',
    annotations: {
      title: 'List Directory',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .default(50)
        .describe('Number of people to return (default: 50)'),
      pageToken: z.string().optional().describe('Page token for pagination'),
      sources: z
        .array(
          z.enum(['DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'])
        )
        .optional()
        .default(['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'])
        .describe('Sources to query (default: domain profiles)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.people.listDirectoryPeople({
          pageSize: args.pageSize,
          pageToken: args.pageToken,
          readMask: LIST_PERSON_FIELDS,
          sources: args.sources,
        });

        const contacts = response.data.people ?? [];
        const nextPageToken = response.data.nextPageToken;

        let result = `**Organization Directory** (${contacts.length} shown)\n\n`;

        if (contacts.length === 0) {
          result +=
            'No directory entries found.\n\nNote: This feature only works for Google Workspace accounts. Personal Gmail accounts do not have access to organization directories.\n';
        } else {
          contacts.forEach((person, i) => {
            result += formatContactForList(person, i + 1, accountEmail);
            result += '\n';
          });
        }

        if (nextPageToken) {
          result += `\nNext page token: ${nextPageToken}`;
        }

        return result;
      } catch (error: unknown) {
        // Provide helpful error message for personal accounts
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('403') ||
          errorMessage.includes('PERMISSION_DENIED') ||
          errorMessage.includes('not enabled')
        ) {
          return `**Organization Directory**\n\nThis feature is only available for Google Workspace accounts. Personal Gmail accounts do not have access to organization directories.\n\nError details: ${errorMessage}`;
        }
        throw new Error(formatToolError('listPeopleDirectory', error));
      }
    },
  });

  // --- Search Directory ---
  server.addTool({
    name: 'searchPeopleDirectory',
    description:
      'Search the organization directory by name, email, or other fields. Only works for Google Workspace accounts.',
    annotations: {
      title: 'Search Directory',
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: z.object({
      account: z.string().describe('Account name to use'),
      query: z.string().min(1).describe('Search query (name, email, etc.)'),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(30)
        .describe('Number of results (default: 30, max: 500)'),
      sources: z
        .array(
          z.enum(['DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'])
        )
        .optional()
        .default(['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'])
        .describe('Sources to query (default: domain profiles)'),
    }),
    async execute(args, { log: _log }) {
      try {
        const people = await getPeopleClient(args.account);
        const accountEmail = await getAccountEmail(args.account);

        const response = await people.people.searchDirectoryPeople({
          query: args.query,
          pageSize: args.pageSize,
          readMask: LIST_PERSON_FIELDS,
          sources: args.sources,
        });

        const contacts = response.data.people ?? [];

        let result = `**Directory Search Results for:** "${args.query}"\n`;
        result += `Found ${contacts.length} people\n\n`;

        if (contacts.length === 0) {
          result += 'No directory entries matching your query.\n';
          result +=
            '\nNote: This feature only works for Google Workspace accounts. Personal Gmail accounts do not have access to organization directories.\n';
        } else {
          contacts.forEach((person, i) => {
            result += formatContactForList(person, i + 1, accountEmail);
            result += '\n';
          });
        }

        return result;
      } catch (error: unknown) {
        // Provide helpful error message for personal accounts
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes('403') ||
          errorMessage.includes('PERMISSION_DENIED') ||
          errorMessage.includes('not enabled')
        ) {
          return `**Directory Search Results for:** "${args.query}"\n\nThis feature is only available for Google Workspace accounts. Personal Gmail accounts do not have access to organization directories.\n\nError details: ${errorMessage}`;
        }
        throw new Error(formatToolError('searchPeopleDirectory', error));
      }
    },
  });
}
