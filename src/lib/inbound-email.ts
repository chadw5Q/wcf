import PostalMime, { type Address, type Email, type Header, type RawEmail } from 'postal-mime';
import { logInteraction, MAX_SUMMARY } from './contacts';
import { publishNtfyNotification, type PublishNtfyOptions } from './ntfy';

/** Used when INBOUND_EMAIL_ALLOWLIST is unset. */
export const DEFAULT_INBOUND_ALLOWLIST = ['cchadww@gmail.com'];

const OWN_DOMAIN = 'williamscreekfarms.com';
const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_SITE_URL = 'https://williamscreekfarms.com';

/** Placeholder last name when the sender gave only one name or none. */
export const UNKNOWN_LAST_NAME = '—';

export interface InboundMessage {
  /** `forward`: you forwarded their message. `sent`: you BCC'd crm@ on your own email to them. */
  kind: 'forward' | 'sent';
  contact: { name: string; email: string };
  subject: string;
  dateIso: string | null;
  /** Date text as it appeared in the forwarded block, for dedupe. */
  dateRaw: string;
  note: string;
  body: string;
}

export type InboundParse = { ok: true; message: InboundMessage } | { ok: false; reason: string };

export type IngestOutcome =
  | { status: 'rejected'; reason: string }
  | { status: 'duplicate'; contactId: string }
  | { status: 'logged'; contactId: string; interactionId: string; contactName: string; subject: string }
  | { status: 'unreadable'; reason: string; subject: string };

export interface InboundEnvelope {
  raw: RawEmail;
  /** SMTP envelope sender (`message.from` in the Worker). */
  from: string;
}

export interface IngestDeps {
  notify?: (options: PublishNtfyOptions) => Promise<void>;
  now?: () => Date;
}

export function parseAllowlist(value: unknown): string[] {
  const raw = typeof value === 'string' ? value : '';
  const list = raw
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.includes('@'));
  return list.length ? list : [...DEFAULT_INBOUND_ALLOWLIST];
}

function isOwnAddress(email: string, allowlist: readonly string[]): boolean {
  const key = email.trim().toLowerCase();
  return allowlist.includes(key) || key.endsWith(`@${OWN_DOMAIN}`);
}

function cleanName(value: string): string {
  return value
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Name <addr>`, `<addr>`, `addr`, `Name [mailto:addr]`, or a name alone (email ''). */
export function parseMailbox(value: string): { name: string; email: string } {
  const text = value.replace(/\*/g, '').replace(/mailto:/gi, '').trim();
  const bracketed = /^(.*?)\s*[<[]\s*([^\s<>[\]]+@[^\s<>[\]]+)\s*[>\]]/.exec(text);
  if (bracketed) return { name: cleanName(bracketed[1]), email: bracketed[2].toLowerCase() };
  const bare = /[^\s<>"'()[\]]+@[^\s<>"'()[\]]+\.[a-z]{2,}/i.exec(text);
  if (bare) return { name: cleanName(text.replace(bare[0], '')), email: bare[0].toLowerCase() };
  return { name: cleanName(text), email: '' };
}

/** Split a To/Cc header line on commas that are outside quotes and angle brackets. */
export function parseMailboxList(value: string): { name: string; email: string }[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === '<' && !quoted) angle++;
    else if (ch === '>' && !quoted && angle > 0) angle--;
    if ((ch === ',' || ch === ';') && !quoted && angle === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((part) => parseMailbox(part)).filter((box) => box.email);
}

export function nameParts(name: string, email: string): { firstName: string; lastName: string } {
  let text = cleanName(name);
  if (text.includes('@')) text = '';
  const comma = /^([^,]+),\s*(.+)$/.exec(text);
  if (comma) text = `${comma[2]} ${comma[1]}`;
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
  if (parts.length === 1) return { firstName: parts[0], lastName: UNKNOWN_LAST_NAME };
  const local = email.split('@')[0]?.trim();
  return { firstName: local || 'Unknown', lastName: UNKNOWN_LAST_NAME };
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, '\n');
}

const FORWARD_MARKERS = [
  /^-{2,}\s*Forwarded message\s*-{2,}$/i,
  /^Begin forwarded message:?$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^_{8,}$/,
];

const HEADER_LINE = /^\*?(From|Date|Sent|Subject|To|Cc|Reply-To):\*?\s*(.*)$/i;

function isMarker(line: string): boolean {
  const trimmed = line.trim();
  return FORWARD_MARKERS.some((re) => re.test(trimmed));
}

/** Outlook without a separator line: `From:` followed shortly by `Sent:` or `Date:`. */
function isBareHeaderStart(lines: string[], index: number): boolean {
  if (!/^\*?From:\*?\s+\S/i.test(lines[index].trim())) return false;
  return lines.slice(index + 1, index + 7).some((line) => /^\*?(Sent|Date):/i.test(line.trim()));
}

interface ForwardBlock {
  note: string;
  headers: Record<string, string>;
  body: string;
}

function findForwardBlock(text: string): ForwardBlock | null {
  const lines = text.split('\n');
  let noteEnd = lines.findIndex(isMarker);
  let headerStart = noteEnd + 1;
  if (noteEnd < 0) {
    noteEnd = lines.findIndex((_, i) => isBareHeaderStart(lines, i));
    if (noteEnd < 0) return null;
    headerStart = noteEnd;
  }

  let i = headerStart;
  while (i < lines.length && !lines[i].trim()) i++;
  const headers: Record<string, string> = {};
  let lastKey = '';
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (lastKey) break;
      continue;
    }
    const match = HEADER_LINE.exec(line);
    if (match) {
      lastKey = match[1].toLowerCase();
      headers[lastKey] = match[2].trim();
    } else if (lastKey) {
      headers[lastKey] = `${headers[lastKey]} ${line}`.trim();
    } else {
      break;
    }
  }
  if (!headers.from) return null;

  return {
    note: lines.slice(0, noteEnd).join('\n').trim(),
    headers,
    body: lines.slice(i).join('\n').trim(),
  };
}

/** Cut older quoted replies and nested forwards so the log holds just this message. */
export function stripQuotedHistory(body: string): string {
  const lines = body.split('\n');
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^On\b/.test(line) && lines.slice(i, i + 3).some((next) => /wrote:\s*$/.test(next))) {
      end = i;
      break;
    }
    if (i > 0 && (isMarker(line) || isBareHeaderStart(lines, i))) {
      end = i;
      break;
    }
  }
  const kept = lines.slice(0, end);
  while (kept.length && (!kept[kept.length - 1].trim() || kept[kept.length - 1].trim().startsWith('>'))) {
    kept.pop();
  }
  return kept.join('\n').trim();
}

function stripSubjectPrefixes(subject: string): string {
  let text = subject.trim();
  while (/^(fwd?|fw):\s*/i.test(text)) text = text.replace(/^(fwd?|fw):\s*/i, '');
  return text;
}

function chicagoOffsetMinutes(utcMs: number): number {
  const label =
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(utcMs))
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) return -360;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + Math.sign(hours) * minutes;
}

/**
 * Dates from forwarded blocks. Gmail and Outlook omit the zone; those are read as US Central.
 * Returns null when unreadable or more than a day in the future.
 */
export function parseForwardedDate(raw: string, now = new Date()): string | null {
  const text = raw.replace(/\*/g, '').replace(/\s+at\s+/i, ' ').trim();
  if (!text) return null;
  const hasZone = /([+-]\d{4}\b|\b(GMT|UTC|[ECMP][SD]T)\b|Z$)/.test(text);
  let ms: number;
  if (hasZone) {
    ms = Date.parse(text);
  } else {
    const naive = Date.parse(`${text} UTC`);
    ms = Number.isNaN(naive) ? NaN : naive - chicagoOffsetMinutes(naive) * 60_000;
  }
  if (Number.isNaN(ms) || ms > now.getTime() + 86_400_000) return null;
  return new Date(ms).toISOString();
}

function mailboxes(addresses: Address[] | undefined): { name: string; address: string }[] {
  const out: { name: string; address: string }[] = [];
  for (const item of addresses ?? []) {
    if (item.group) out.push(...item.group);
    else if (item.address) out.push({ name: item.name, address: item.address });
  }
  return out;
}

function outerDateIso(email: Email, now: Date): string | null {
  return email.date ? parseForwardedDate(email.date, now) : null;
}

/** Find who this email is about: the original sender of a forward, or the recipient of a BCC'd email. */
export function interpretEmail(email: Email, opts: { allowlist: readonly string[]; now?: Date }): InboundParse {
  const now = opts.now ?? new Date();
  const text = (email.text?.trim() ? email.text : htmlToText(email.html ?? '')).replace(/\r\n?/g, '\n');
  const block = findForwardBlock(text);

  if (block) {
    let sender = parseMailbox(block.headers.from);
    if (!sender.email && block.headers['reply-to']) {
      sender = { ...parseMailbox(block.headers['reply-to']), name: sender.name };
    }
    if (!sender.email) {
      return { ok: false, reason: 'The forwarded message has no sender email address.' };
    }
    let kind: InboundMessage['kind'] = 'forward';
    let contact = sender;
    if (isOwnAddress(sender.email, opts.allowlist)) {
      const recipient = [
        ...parseMailboxList(block.headers.to ?? ''),
        ...parseMailboxList(block.headers.cc ?? ''),
      ].find((box) => !isOwnAddress(box.email, opts.allowlist));
      if (!recipient) {
        return {
          ok: false,
          reason: 'The forwarded message is from you and has no other recipient to log it under.',
        };
      }
      kind = 'sent';
      contact = recipient;
    }
    const dateRaw = block.headers.date || block.headers.sent || '';
    return {
      ok: true,
      message: {
        kind,
        contact,
        subject: stripSubjectPrefixes(block.headers.subject || email.subject || ''),
        dateIso: parseForwardedDate(dateRaw, now) ?? outerDateIso(email, now),
        dateRaw,
        note: block.note,
        body: stripQuotedHistory(block.body),
      },
    };
  }

  const recipient = [...mailboxes(email.to), ...mailboxes(email.cc)].find(
    (box) => !isOwnAddress(box.address, opts.allowlist)
  );
  if (!recipient) {
    return {
      ok: false,
      reason: 'No forwarded message was found. Use Forward in Gmail, or BCC crm@ on a reply.',
    };
  }
  return {
    ok: true,
    message: {
      kind: 'sent',
      contact: { name: cleanName(recipient.name), email: recipient.address.toLowerCase() },
      subject: (email.subject ?? '').trim(),
      dateIso: outerDateIso(email, now),
      dateRaw: email.date ?? '',
      note: '',
      body: stripQuotedHistory(text.trim()),
    },
  };
}

export function buildSummary(message: InboundMessage): string {
  const lines: string[] = [];
  if (message.kind === 'sent') {
    lines.push(message.subject ? `Email you sent: ${message.subject}` : 'Email you sent');
  } else if (message.subject) {
    lines.push(`Subject: ${message.subject}`);
  }
  if (message.note) lines.push(`Note: ${message.note}`);
  if (message.body) lines.push('', message.body);
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() || '(no message text)';
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1).trimEnd()}…` : text;
}

const AUTH_HEADER_KEYS = new Set(['authentication-results', 'arc-authentication-results']);

/** Topmost auth result stamped by Cloudflare's MX shows a DKIM pass for `domain`. */
export function cloudflareDkimPassed(headers: readonly Header[], domain: string): boolean {
  const stamped = headers.find(
    (header) => AUTH_HEADER_KEYS.has(header.key) && /^\s*(i=\d+;\s*)?mx\.cloudflare\.net\b/i.test(header.value)
  );
  if (!stamped) return false;
  const want = domain.toLowerCase();
  return stamped.value.split(';').some((part) => {
    if (!/^\s*dkim=pass\b/i.test(part)) return false;
    const signer = /header\.d=([^\s;]+)/i.exec(part)?.[1] ?? /header\.i=@?([^\s;]+)/i.exec(part)?.[1] ?? '';
    return signer.toLowerCase() === want;
  });
}

function headerFromAddress(email: Email): string {
  const from = email.from;
  return from && !from.group ? (from.address ?? '').trim().toLowerCase() : '';
}

export function verifySender(
  email: Email,
  envelopeFrom: string,
  allowlist: readonly string[],
  env: Record<string, unknown>
): { ok: true } | { ok: false; reason: string } {
  const envelope = envelopeFrom.trim().toLowerCase();
  if (!allowlist.includes(envelope)) {
    return { ok: false, reason: `envelope sender ${envelope || '(none)'} is not allowed` };
  }
  const headerFrom = headerFromAddress(email);
  if (!allowlist.includes(headerFrom)) {
    return { ok: false, reason: `From header ${headerFrom || '(none)'} is not allowed` };
  }
  const skip = String(env.INBOUND_EMAIL_SKIP_DKIM ?? '').trim();
  if (skip === '1' || skip.toLowerCase() === 'true') return { ok: true };
  const domain = headerFrom.split('@')[1] ?? '';
  if (!cloudflareDkimPassed(email.headers, domain)) {
    return { ok: false, reason: `no Cloudflare DKIM pass for ${domain}` };
  }
  return { ok: true };
}

async function dedupeKey(message: InboundMessage): Promise<string> {
  const material = [message.kind, message.contact.email, message.dateRaw, message.subject, message.body.slice(0, 500)].join(
    '\n'
  );
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `inbound_email_${hex.slice(0, 32)}`;
}

function siteUrl(env: Record<string, unknown>): string {
  const raw = typeof env.SITE_URL === 'string' && env.SITE_URL.trim() ? env.SITE_URL.trim() : DEFAULT_SITE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * Handle one message delivered to crm@. `rejected` means the caller should bounce it.
 * Every other outcome sends an ntfy push except `duplicate`.
 */
export async function ingestInboundEmail(
  envelope: InboundEnvelope,
  env: Record<string, unknown>,
  deps: IngestDeps = {}
): Promise<IngestOutcome> {
  const notify = deps.notify ?? publishNtfyNotification;
  const now = deps.now?.() ?? new Date();
  const allowlist = parseAllowlist(env.INBOUND_EMAIL_ALLOWLIST);

  let email: Email;
  try {
    email = await PostalMime.parse(envelope.raw);
  } catch (e) {
    console.warn('[inbound-email] could not parse MIME', e);
    return { status: 'rejected', reason: 'unparseable message' };
  }

  const sender = verifySender(email, envelope.from, allowlist, env);
  if (!sender.ok) {
    const auth = email.headers
      .filter((h) => AUTH_HEADER_KEYS.has(h.key))
      .map((h) => `${h.key}: ${h.value.slice(0, 300)}`);
    console.warn('[inbound-email] rejected:', sender.reason, auth);
    return { status: 'rejected', reason: sender.reason };
  }

  const outerSubject = (email.subject ?? '').trim();
  const fail = async (reason: string): Promise<IngestOutcome> => {
    console.warn('[inbound-email] not logged:', reason);
    await notify({
      title: 'Could not log forwarded email',
      message: `${reason}\n\nSubject: ${outerSubject || '(none)'}`,
      tags: 'warning',
      workerEnv: env,
    });
    return { status: 'unreadable', reason, subject: outerSubject };
  };

  const kv = env.ORDERS_KV as KVNamespace | undefined;
  if (!kv) return fail('Contacts storage (ORDERS_KV) is not configured.');

  const parsed = interpretEmail(email, { allowlist, now });
  if (!parsed.ok) return fail(parsed.reason);
  const message = parsed.message;

  const key = await dedupeKey(message);
  const prior = await kv.get(key);
  if (prior) return { status: 'duplicate', contactId: prior };

  const { firstName, lastName } = nameParts(message.contact.name, message.contact.email);
  try {
    const { contact, interaction } = await logInteraction(kv, {
      firstName,
      lastName,
      email: message.contact.email,
      channel: 'email',
      summary: buildSummary(message),
      at: message.dateIso ?? undefined,
    });
    await kv.put(key, contact.id, { expirationTtl: DEDUPE_TTL_SECONDS });
    await notify({
      title: `Email logged: ${contact.name}`,
      message: message.subject || '(no subject)',
      click: `${siteUrl(env)}/admin/contacts/${contact.id}`,
      tags: 'email',
      workerEnv: env,
    });
    return {
      status: 'logged',
      contactId: contact.id,
      interactionId: interaction.id,
      contactName: contact.name,
      subject: message.subject,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
