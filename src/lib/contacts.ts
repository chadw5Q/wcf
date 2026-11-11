import type { StoredOrder } from './order-types';
import { getAllOrders, summarizeItemsForNtfy } from './orders';

export const INTERACTION_CHANNELS = ['phone', 'web', 'walk-in', 'note'] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];

/** What a person asked about. Stored on the contact, not on one interaction. */
export const CONTACT_INTERESTS = ['bow-stave', 'hedge-posts', 'hunting', 'other'] as const;
export type ContactInterest = (typeof CONTACT_INTERESTS)[number];

export interface Interaction {
  id: string;
  createdAt: string;
  channel: InteractionChannel;
  summary: string;
  /** Calendar day YYYY-MM-DD, or null when no follow-up was set. */
  followUpOn: string | null;
  followUpDoneAt: string | null;
  orderId: string | null;
}

export interface Contact {
  id: string;
  createdAt: string;
  updatedAt: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  /** Last 10 digits, or empty when the phone cannot be matched. */
  phoneKey: string;
  /** Trimmed lowercase email, or empty. */
  emailKey: string;
  /** Interests they asked about. Empty when none were recorded. */
  interests: ContactInterest[];
  /** City, state, or whatever was useful to write down. */
  location: string;
  lastInteractionAt: string | null;
  interactions: Interaction[];
}

export interface LogInteractionInput {
  contactId?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  channel: InteractionChannel;
  summary: string;
  followUpOn?: string | null;
  /** ISO timestamp. Defaults to now. Order backfill passes the order time. */
  at?: string;
  orderId?: string | null;
  /** Merged onto the contact. Omitted or empty does not clear interests already stored. */
  interests?: ContactInterest[];
  /** Applied only when non-empty, so a blank log does not wipe a saved place. */
  location?: string;
}

export interface UpdateContactInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Replaces stored interests, including an empty list. */
  interests?: ContactInterest[];
  /** Replaces stored location, including an empty string. */
  location?: string;
}

export class ContactError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ContactError';
    this.status = status;
  }
}

const CONTACT_INDEX_KEY = 'contact_index';
const MAX_CONTACT_INDEX = 5000;
const MAX_INTERACTIONS = 300;
const MAX_SUMMARY = 4000;
const MAX_LOCATION = 120;

export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length >= 10) return digits.slice(-10);
  return '';
}

export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

export function channelLabel(channel: InteractionChannel): string {
  if (channel === 'walk-in') return 'Walk-in';
  if (channel === 'web') return 'Web';
  if (channel === 'phone') return 'Phone';
  return 'Note';
}

export function isInteractionChannel(value: string): value is InteractionChannel {
  return (INTERACTION_CHANNELS as readonly string[]).includes(value);
}

export type InteractionSortDir = 'asc' | 'desc';

/** Display options for one contact's interaction list. Storage is unchanged. */
export interface InteractionListView {
  sort: 'date';
  dir: InteractionSortDir;
  type: InteractionChannel | 'all';
}

/** Unknown or missing params fall back to newest first and every channel. */
export function parseInteractionListQuery(input: {
  sort?: string | null;
  dir?: string | null;
  type?: string | null;
}): InteractionListView {
  const type = input.type && isInteractionChannel(input.type) ? input.type : 'all';
  return {
    sort: 'date',
    dir: input.dir === 'asc' ? 'asc' : 'desc',
    type,
  };
}

/**
 * A new array for the contact page. Filtering hides other channels in the list
 * and does not remove them from the contact.
 */
export function filterAndSortInteractions(
  interactions: readonly Interaction[],
  view: Pick<InteractionListView, 'dir' | 'type'>
): Interaction[] {
  const matched =
    view.type === 'all' ? interactions : interactions.filter((item) => item.channel === view.type);
  return [...matched].sort((a, b) => {
    if (a.createdAt === b.createdAt) return 0;
    const newerFirst = a.createdAt < b.createdAt ? 1 : -1;
    return view.dir === 'asc' ? -newerFirst : newerFirst;
  });
}

/** Query string for the contact URL, or '' for the default (newest, all types). */
export function interactionListSearch(view: Pick<InteractionListView, 'dir' | 'type'>): string {
  if (view.dir === 'desc' && view.type === 'all') return '';
  const params = new URLSearchParams();
  params.set('sort', 'date');
  params.set('dir', view.dir);
  if (view.type !== 'all') params.set('type', view.type);
  return `?${params.toString()}`;
}

export function isContactInterest(value: string): value is ContactInterest {
  return (CONTACT_INTERESTS as readonly string[]).includes(value);
}

export function interestLabel(interest: ContactInterest): string {
  if (interest === 'bow-stave') return 'Bow stave';
  if (interest === 'hedge-posts') return 'Hedge posts';
  if (interest === 'hunting') return 'Hunting';
  return 'Other';
}

/** Keep known interests, drop anything else, and preserve the canonical order. */
export function parseInterests(value: unknown): ContactInterest[] {
  const raw = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  const seen = new Set<ContactInterest>();
  for (const item of raw) {
    const key = String(item);
    if (isContactInterest(key)) seen.add(key);
  }
  return CONTACT_INTERESTS.filter((interest) => seen.has(interest));
}

export function parseLocation(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length > MAX_LOCATION) {
    throw new ContactError(`Location must be ${MAX_LOCATION} characters or fewer.`);
  }
  return text;
}

/** YYYY-MM-DD in US Central. */
export function centralToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function formatFollowUpDay(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function phoneHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const withCountry = digits.length === 10 ? `1${digits}` : digits;
  return `tel:+${withCountry}`;
}

export function mailtoHref(email: string): string | null {
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) return null;
  return `mailto:${trimmed}`;
}

export function channelForStoredOrder(order: StoredOrder): InteractionChannel {
  const walkIn = (order.revisionLog ?? []).some((entry) => entry.details?.source === 'admin_walk_in');
  return walkIn ? 'walk-in' : 'web';
}

function phoneIndexKey(key: string): string {
  return `contact_phone_${key}`;
}

function emailIndexKey(key: string): string {
  return `contact_email_${key}`;
}

function parseFollowUpDay(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ContactError('Follow-up date must be a real calendar day.');
  }
  const [year, month, day] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new ContactError('Follow-up date must be a real calendar day.');
  }
  return raw;
}

function requireSummary(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) throw new ContactError('Write a short summary of the interaction.');
  if (trimmed.length > MAX_SUMMARY) {
    throw new ContactError(`Summary must be ${MAX_SUMMARY} characters or fewer.`);
  }
  return trimmed;
}

async function readIndex(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(CONTACT_INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(kv: KVNamespace, ids: string[]): Promise<void> {
  await kv.put(CONTACT_INDEX_KEY, JSON.stringify(ids.slice(0, MAX_CONTACT_INDEX)));
}

function normalizeContact(contact: Contact): Contact {
  contact.interactions = Array.isArray(contact.interactions) ? contact.interactions : [];
  contact.phoneKey = contact.phoneKey || phoneKey(contact.phone || '');
  contact.emailKey = contact.emailKey || emailKey(contact.email || '');
  contact.firstName = contact.firstName || '';
  contact.lastName = contact.lastName || '';
  contact.name = contact.name || `${contact.firstName} ${contact.lastName}`.trim();
  contact.interests = parseInterests(contact.interests);
  contact.location = typeof contact.location === 'string' ? contact.location : '';
  return contact;
}

export async function getContact(kv: KVNamespace, id: string): Promise<Contact | null> {
  const trimmed = id.trim();
  if (!trimmed.startsWith('contact_')) return null;
  const raw = await kv.get(trimmed);
  if (!raw) return null;
  try {
    return normalizeContact(JSON.parse(raw) as Contact);
  } catch {
    return null;
  }
}

async function saveContact(kv: KVNamespace, contact: Contact): Promise<void> {
  contact.updatedAt = new Date().toISOString();
  await kv.put(contact.id, JSON.stringify(contact));
  const ids = await readIndex(kv);
  await writeIndex(kv, [contact.id, ...ids.filter((x) => x !== contact.id)]);
}

async function releaseIndex(kv: KVNamespace, indexKey: string, contactId: string): Promise<void> {
  const owner = await kv.get(indexKey);
  if (owner === contactId) await kv.delete(indexKey);
}

function blankContact(nowIso: string): Contact {
  return {
    id: `contact_${crypto.randomUUID()}`,
    createdAt: nowIso,
    updatedAt: nowIso,
    firstName: '',
    lastName: '',
    name: '',
    email: '',
    phone: '',
    phoneKey: '',
    emailKey: '',
    interests: [],
    location: '',
    lastInteractionAt: null,
    interactions: [],
  };
}

/** Add interests and, when a place was typed, replace location. Blank location is left alone. */
function mergeProfile(contact: Contact, interests: ContactInterest[], location: string): void {
  const seen = new Set<ContactInterest>([...(contact.interests ?? []), ...interests]);
  contact.interests = CONTACT_INTERESTS.filter((interest) => seen.has(interest));
  if (location) contact.location = location;
  if (typeof contact.location !== 'string') contact.location = '';
}

function applyNameIfBlank(contact: Contact, firstName: string, lastName: string): void {
  if (contact.firstName || contact.lastName) return;
  contact.firstName = firstName.trim();
  contact.lastName = lastName.trim();
  contact.name = `${contact.firstName} ${contact.lastName}`.trim() || contact.name;
}

async function assignPhoneIfBlank(kv: KVNamespace, contact: Contact, phone: string): Promise<string | null> {
  const nextKey = phoneKey(phone);
  const display = phone.trim();
  if (!nextKey) return null;
  if (contact.phoneKey === nextKey) return null;
  if (contact.phoneKey && contact.phoneKey !== nextKey) {
    return `This order's phone (${display}) is different from the phone on this contact (${contact.phone}).`;
  }
  const owner = await kv.get(phoneIndexKey(nextKey));
  if (owner && owner !== contact.id) {
    return `This order's phone (${display}) is already on another contact, so it was not copied here.`;
  }
  contact.phone = display;
  contact.phoneKey = nextKey;
  await kv.put(phoneIndexKey(nextKey), contact.id);
  return null;
}

async function assignEmailIfBlank(kv: KVNamespace, contact: Contact, email: string): Promise<string | null> {
  const nextKey = emailKey(email);
  const display = email.trim();
  if (!nextKey) return null;
  if (contact.emailKey === nextKey) return null;
  if (contact.emailKey && contact.emailKey !== nextKey) {
    return `This order's email (${display}) is different from the email on this contact (${contact.email}).`;
  }
  const owner = await kv.get(emailIndexKey(nextKey));
  if (owner && owner !== contact.id) {
    return `This order's email (${display}) is already on another contact, so it was not copied here.`;
  }
  contact.email = display;
  contact.emailKey = nextKey;
  await kv.put(emailIndexKey(nextKey), contact.id);
  return null;
}

async function findByPhone(kv: KVNamespace, phone: string): Promise<Contact | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  const id = await kv.get(phoneIndexKey(key));
  if (!id) return null;
  return getContact(kv, id);
}

async function findByEmail(kv: KVNamespace, email: string): Promise<Contact | null> {
  const key = emailKey(email);
  if (!key) return null;
  const id = await kv.get(emailIndexKey(key));
  if (!id) return null;
  return getContact(kv, id);
}

/**
 * Find a contact by phone, then email. Phone wins when the two keys point at different people.
 * Fills a blank phone or email. Does not overwrite a name or identifier already stored.
 */
async function resolveContact(
  kv: KVNamespace,
  input: { firstName: string; lastName: string; email: string; phone: string },
  contactId?: string | null
): Promise<{ contact: Contact; notes: string[] }> {
  const notes: string[] = [];
  if (contactId?.trim()) {
    const existing = await getContact(kv, contactId.trim());
    if (!existing) throw new ContactError('Contact not found.', 404);
    applyNameIfBlank(existing, input.firstName, input.lastName);
    const phoneNote = await assignPhoneIfBlank(kv, existing, input.phone);
    const emailNote = await assignEmailIfBlank(kv, existing, input.email);
    if (phoneNote) notes.push(phoneNote);
    if (emailNote) notes.push(emailNote);
    return { contact: existing, notes };
  }

  const byPhone = await findByPhone(kv, input.phone);
  const byEmail = await findByEmail(kv, input.email);
  let contact = byPhone ?? byEmail;

  if (!contact) {
    const nowIso = new Date().toISOString();
    contact = blankContact(nowIso);
    contact.firstName = input.firstName.trim();
    contact.lastName = input.lastName.trim();
    contact.name = `${contact.firstName} ${contact.lastName}`.trim() || 'Contact';
    contact.phone = input.phone.trim();
    contact.email = input.email.trim();
    contact.phoneKey = phoneKey(contact.phone);
    contact.emailKey = emailKey(contact.email);
    if (contact.phoneKey) await kv.put(phoneIndexKey(contact.phoneKey), contact.id);
    if (contact.emailKey) await kv.put(emailIndexKey(contact.emailKey), contact.id);
    return { contact, notes };
  }

  applyNameIfBlank(contact, input.firstName, input.lastName);
  if (byPhone && byEmail && byPhone.id !== byEmail.id) {
    notes.push(
      `Email ${input.email.trim()} is already on another contact, so this stays with the phone number.`
    );
    return { contact, notes };
  }
  const phoneNote = await assignPhoneIfBlank(kv, contact, input.phone);
  const emailNote = await assignEmailIfBlank(kv, contact, input.email);
  if (phoneNote) notes.push(phoneNote);
  if (emailNote) notes.push(emailNote);
  return { contact, notes };
}

function rememberInteraction(contact: Contact, interaction: Interaction): void {
  if (interaction.orderId && contact.interactions.some((item) => item.orderId === interaction.orderId)) {
    return;
  }
  contact.interactions.unshift(interaction);
  contact.interactions.sort((a, b) => {
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  if (contact.interactions.length > MAX_INTERACTIONS) {
    contact.interactions = contact.interactions.slice(0, MAX_INTERACTIONS);
  }
  const latest = contact.interactions[0]?.createdAt ?? interaction.createdAt;
  if (!contact.lastInteractionAt || latest > contact.lastInteractionAt) {
    contact.lastInteractionAt = latest;
  }
}

export async function logInteraction(
  kv: KVNamespace,
  input: LogInteractionInput
): Promise<{ contact: Contact; interaction: Interaction }> {
  if (!isInteractionChannel(input.channel)) throw new ContactError('Choose how this interaction happened.');
  const summary = requireSummary(input.summary);
  const followUpOn = parseFollowUpDay(input.followUpOn);
  const at = input.at?.trim() || new Date().toISOString();
  const firstName = String(input.firstName ?? '').trim();
  const lastName = String(input.lastName ?? '').trim();
  const email = String(input.email ?? '').trim();
  const phone = String(input.phone ?? '').trim();

  if (!input.contactId?.trim()) {
    if (!firstName || !lastName) throw new ContactError('First and last name are required.');
    if (!phone && !email) throw new ContactError('Enter a phone number or an email.');
  }

  const { contact, notes } = await resolveContact(
    kv,
    { firstName, lastName, email, phone },
    input.contactId
  );
  mergeProfile(contact, parseInterests(input.interests), parseLocation(input.location));

  const interaction: Interaction = {
    id: `ix_${crypto.randomUUID()}`,
    createdAt: at,
    channel: input.channel,
    summary: [...notes, summary].filter(Boolean).join('\n'),
    followUpOn,
    followUpDoneAt: null,
    orderId: input.orderId?.trim() || null,
  };
  const alreadyLinked = Boolean(
    interaction.orderId && contact.interactions.some((item) => item.orderId === interaction.orderId)
  );
  rememberInteraction(contact, interaction);
  await saveContact(kv, contact);
  const stored =
    contact.interactions.find((item) => item.id === interaction.id) ??
    contact.interactions.find((item) => item.orderId && item.orderId === interaction.orderId) ??
    interaction;
  if (alreadyLinked) {
    return { contact, interaction: stored };
  }
  return { contact, interaction: stored };
}

export async function updateContact(
  kv: KVNamespace,
  id: string,
  input: UpdateContactInput
): Promise<Contact> {
  const contact = await getContact(kv, id);
  if (!contact) throw new ContactError('Contact not found.', 404);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) throw new ContactError('First and last name are required.');
  const phone = input.phone.trim();
  const email = input.email.trim();
  const nextPhoneKey = phoneKey(phone);
  const nextEmailKey = emailKey(email);

  if (nextPhoneKey && nextPhoneKey !== contact.phoneKey) {
    const owner = await kv.get(phoneIndexKey(nextPhoneKey));
    if (owner && owner !== contact.id) {
      throw new ContactError('That phone number is already on another contact.');
    }
  }
  if (nextEmailKey && nextEmailKey !== contact.emailKey) {
    const owner = await kv.get(emailIndexKey(nextEmailKey));
    if (owner && owner !== contact.id) {
      throw new ContactError('That email is already on another contact.');
    }
  }

  if (contact.phoneKey && contact.phoneKey !== nextPhoneKey) {
    await releaseIndex(kv, phoneIndexKey(contact.phoneKey), contact.id);
  }
  if (contact.emailKey && contact.emailKey !== nextEmailKey) {
    await releaseIndex(kv, emailIndexKey(contact.emailKey), contact.id);
  }
  if (nextPhoneKey && nextPhoneKey !== contact.phoneKey) {
    await kv.put(phoneIndexKey(nextPhoneKey), contact.id);
  }
  if (nextEmailKey && nextEmailKey !== contact.emailKey) {
    await kv.put(emailIndexKey(nextEmailKey), contact.id);
  }

  contact.firstName = firstName;
  contact.lastName = lastName;
  contact.name = `${firstName} ${lastName}`.trim();
  contact.phone = phone;
  contact.email = email;
  contact.phoneKey = nextPhoneKey;
  contact.emailKey = nextEmailKey;
  if (input.interests !== undefined) contact.interests = parseInterests(input.interests);
  if (input.location !== undefined) contact.location = parseLocation(input.location);
  await saveContact(kv, contact);
  return contact;
}

export async function completeFollowUp(
  kv: KVNamespace,
  contactId: string,
  interactionId: string,
  now = new Date()
): Promise<Contact> {
  const contact = await getContact(kv, contactId);
  if (!contact) throw new ContactError('Contact not found.', 404);
  const interaction = contact.interactions.find((item) => item.id === interactionId);
  if (!interaction) throw new ContactError('Interaction not found.', 404);
  if (!interaction.followUpOn) throw new ContactError('This interaction has no follow-up.');
  if (!interaction.followUpDoneAt) {
    interaction.followUpDoneAt = now.toISOString();
    await saveContact(kv, contact);
  }
  return contact;
}

export async function reopenFollowUp(
  kv: KVNamespace,
  contactId: string,
  interactionId: string
): Promise<Contact> {
  const contact = await getContact(kv, contactId);
  if (!contact) throw new ContactError('Contact not found.', 404);
  const interaction = contact.interactions.find((item) => item.id === interactionId);
  if (!interaction) throw new ContactError('Interaction not found.', 404);
  if (!interaction.followUpOn) throw new ContactError('This interaction has no follow-up.');
  if (interaction.followUpDoneAt) {
    interaction.followUpDoneAt = null;
    await saveContact(kv, contact);
  }
  return contact;
}

export const CONTACT_SORT_KEYS = ['first', 'last', 'date'] as const;
export type ContactSortKey = (typeof CONTACT_SORT_KEYS)[number];
export type ContactSortDir = 'asc' | 'desc';

export interface ContactListSort {
  sort: ContactSortKey;
  dir: ContactSortDir;
}

const contactNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Time shown on a contact card: last interaction, otherwise when the contact was created. */
export function contactActivityAt(contact: Contact): string {
  return contact.lastInteractionAt ?? contact.createdAt;
}

export function defaultContactSortDir(sort: ContactSortKey): ContactSortDir {
  return sort === 'date' ? 'desc' : 'asc';
}

/** Read `sort` and `dir`. Unknown values fall back to date, newest first. */
export function parseContactListSort(
  sortParam: string | null | undefined,
  dirParam: string | null | undefined
): ContactListSort {
  const sort: ContactSortKey =
    sortParam === 'first' || sortParam === 'last' || sortParam === 'date' ? sortParam : 'date';
  if (sortParam && sortParam !== sort) return { sort: 'date', dir: 'desc' };
  const dir: ContactSortDir =
    dirParam === 'asc' || dirParam === 'desc' ? dirParam : defaultContactSortDir(sort);
  return { sort, dir };
}

/** Sort chosen by clicking a control. A new field starts at its default direction; the active field flips. */
export function toggledContactSort(current: ContactListSort, key: ContactSortKey): ContactListSort {
  if (current.sort !== key) return { sort: key, dir: defaultContactSortDir(key) };
  return { sort: key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/** Query string for the contacts list. Default date, newest first, is omitted. `q` stays with the sort. */
export function contactListQuery(options: { q?: string; sort?: ContactSortKey; dir?: ContactSortDir } = {}): string {
  const params = new URLSearchParams();
  const q = options.q?.trim() ?? '';
  if (q) params.set('q', q);
  const sort = options.sort ?? 'date';
  const dir = options.dir ?? defaultContactSortDir(sort);
  if (sort !== 'date' || dir !== 'desc') {
    params.set('sort', sort);
    params.set('dir', dir);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function contactActivityTime(contact: Contact): number {
  const time = Date.parse(contactActivityAt(contact));
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Return a new array. Ties keep the incoming order. */
export function sortContacts(
  contacts: readonly Contact[],
  sort: ContactSortKey = 'date',
  dir: ContactSortDir = 'desc'
): Contact[] {
  const factor = dir === 'asc' ? 1 : -1;
  return [...contacts].sort((a, b) => {
    if (sort === 'date') {
      const delta = contactActivityTime(a) - contactActivityTime(b);
      return delta === 0 ? 0 : delta * factor;
    }
    const aName = sort === 'first' ? a.firstName : a.lastName;
    const bName = sort === 'first' ? b.firstName : b.lastName;
    return contactNameCollator.compare(aName, bName) * factor;
  });
}

export async function getAllContacts(kv: KVNamespace): Promise<Contact[]> {
  const ids = await readIndex(kv);
  const contacts: Contact[] = [];
  for (const id of ids) {
    const contact = await getContact(kv, id);
    if (contact) contacts.push(contact);
  }
  return sortContacts(contacts, 'date', 'desc');
}

export function filterContacts(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  const digits = q.replace(/\D/g, '');
  return contacts.filter((contact) => {
    const interestText = (contact.interests ?? []).map(interestLabel).join(' ');
    const blob = `${contact.name} ${contact.firstName} ${contact.lastName} ${contact.email} ${contact.phone} ${contact.location ?? ''} ${interestText}`.toLowerCase();
    if (blob.includes(q)) return true;
    if (digits.length >= 3) {
      const phoneDigits = `${contact.phoneKey}${contact.phone.replace(/\D/g, '')}`;
      if (phoneDigits.includes(digits)) return true;
    }
    return false;
  });
}

export interface OpenFollowUp {
  contactId: string;
  contactName: string;
  phone: string;
  interaction: Interaction;
  overdue: boolean;
}

export function listOpenFollowUps(contacts: Contact[], today: string): OpenFollowUp[] {
  const items: OpenFollowUp[] = [];
  for (const contact of contacts) {
    for (const interaction of contact.interactions) {
      if (!interaction.followUpOn || interaction.followUpDoneAt) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(interaction.followUpOn)) continue;
      items.push({
        contactId: contact.id,
        contactName: contact.name,
        phone: contact.phone,
        interaction,
        overdue: interaction.followUpOn < today,
      });
    }
  }
  items.sort((a, b) => (a.interaction.followUpOn! < b.interaction.followUpOn! ? -1 : 1));
  return items;
}

function orderSummary(order: StoredOrder, notes: string[]): string {
  const items = summarizeItemsForNtfy(order.items);
  const lines = [items ? `Order placed: ${items}` : 'Order placed'];
  if (order.notes?.trim()) lines.push(order.notes.trim());
  for (const note of notes) {
    if (note.trim()) lines.push(note.trim());
  }
  return lines.join('\n');
}

/**
 * Attach an order to a contact and record one interaction. Safe to call again:
 * a second pass does not add another interaction for the same order.
 * Writes the order record in place so the order index stays put.
 */
export async function attachOrderToContact(
  kv: KVNamespace,
  order: StoredOrder,
  opts: { channel?: InteractionChannel; contactId?: string | null } = {}
): Promise<StoredOrder> {
  const channel = opts.channel ?? channelForStoredOrder(order);
  const { contact, notes } = await resolveContact(
    kv,
    {
      firstName: order.customer.firstName,
      lastName: order.customer.lastName,
      email: order.customer.email,
      phone: order.customer.phone,
    },
    opts.contactId ?? order.contactId ?? null
  );

  const already = contact.interactions.some((item) => item.orderId === order.id);
  if (!already) {
    rememberInteraction(contact, {
      id: `ix_${crypto.randomUUID()}`,
      createdAt: order.createdAt,
      channel,
      summary: orderSummary(order, notes),
      followUpOn: null,
      followUpDoneAt: null,
      orderId: order.id,
    });
    await saveContact(kv, contact);
  }

  if (order.contactId !== contact.id) {
    order.contactId = contact.id;
    await kv.put(order.id, JSON.stringify(order));
  }
  return order;
}

/** Link every order that does not yet have a contact. Returns how many were linked. */
export async function linkOrdersMissingContacts(
  kv: KVNamespace,
  orders?: StoredOrder[]
): Promise<number> {
  const list = orders ?? (await getAllOrders(kv));
  let linked = 0;
  for (const order of list) {
    if (order.contactId) continue;
    await attachOrderToContact(kv, order, { channel: channelForStoredOrder(order) });
    linked += 1;
  }
  return linked;
}
