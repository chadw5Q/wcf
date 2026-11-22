import { describe, expect, it, vi } from 'vitest';
import PostalMime from 'postal-mime';
import { getAllContacts, getContact, logInteraction } from '../../../src/lib/contacts';
import {
  buildSummary,
  cloudflareDkimPassed,
  ingestInboundEmail,
  interpretEmail,
  nameParts,
  parseAllowlist,
  parseForwardedDate,
  parseMailbox,
  parseMailboxList,
  stripQuotedHistory,
  UNKNOWN_LAST_NAME,
} from '../../../src/lib/inbound-email';
import type { PublishNtfyOptions } from '../../../src/lib/ntfy';

function memoryKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

const GMAIL_AUTH =
  'mx.cloudflare.net; dkim=pass header.d=gmail.com header.s=20230601 header.b=abc123; dmarc=pass header.from=gmail.com policy.dmarc=none; spf=pass smtp.mailfrom=cchadww@gmail.com';

const NOW = new Date('2026-11-21T23:00:00.000Z');

function mime(options: {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  auth?: string[];
  date?: string;
}): string {
  const headers = [
    ...(options.auth ?? [GMAIL_AUTH]).map((value) => `Authentication-Results: ${value}`),
    `From: ${options.from ?? 'Chad Williams <cchadww@gmail.com>'}`,
    `To: ${options.to ?? 'crm@williamscreekfarms.com'}`,
    `Subject: ${options.subject ?? 'Fwd: Hedge posts for my fence'}`,
    `Date: ${options.date ?? 'Sat, 21 Nov 2026 16:40:00 -0600'}`,
    'Message-ID: <outer-1@mail.gmail.com>',
    'MIME-Version: 1.0',
  ];
  if (options.html && !options.text) {
    return [...headers, 'Content-Type: text/html; charset=UTF-8', '', options.html].join('\r\n');
  }
  return [...headers, 'Content-Type: text/plain; charset=UTF-8', '', options.text ?? ''].join('\r\n');
}

const GMAIL_FORWARD = [
  'He wants 40 posts, call him Monday.',
  '',
  '---------- Forwarded message ---------',
  'From: Jeff Smith <Jeff@Example.com>',
  'Date: Sat, Nov 21, 2026 at 3:10 PM',
  'Subject: Hedge posts for my fence',
  'To: <cchadww@gmail.com>',
  '',
  '',
  'Hi Chad,',
  '',
  'Do you have 40 line posts available this spring?',
  '',
  'Jeff',
  '',
  'On Fri, Nov 20, 2026 at 9:00 AM Chad Williams <',
  'cchadww@gmail.com> wrote:',
  '> Thanks for asking about posts.',
].join('\n');

async function parse(raw: string) {
  return PostalMime.parse(raw);
}

const allowlist = ['cchadww@gmail.com'];

describe('parseMailbox', () => {
  it('reads name and address forms', () => {
    expect(parseMailbox('Jeff Smith <Jeff@Example.com>')).toEqual({ name: 'Jeff Smith', email: 'jeff@example.com' });
    expect(parseMailbox('*Jeff Smith* <jeff@example.com>')).toEqual({ name: 'Jeff Smith', email: 'jeff@example.com' });
    expect(parseMailbox('<jeff@example.com>')).toEqual({ name: '', email: 'jeff@example.com' });
    expect(parseMailbox('jeff@example.com')).toEqual({ name: '', email: 'jeff@example.com' });
    expect(parseMailbox('Jeff Smith [mailto:jeff@example.com]')).toEqual({
      name: 'Jeff Smith',
      email: 'jeff@example.com',
    });
    expect(parseMailbox('"Smith, Jeff" <jeff@example.com>').name).toBe('Smith, Jeff');
    expect(parseMailbox('Jeff Smith')).toEqual({ name: 'Jeff Smith', email: '' });
  });
});

describe('parseMailboxList', () => {
  it('splits on commas outside quotes and brackets', () => {
    expect(parseMailboxList('"Smith, Jeff" <jeff@example.com>, <pat@example.com>; amy@example.com')).toEqual([
      { name: 'Smith, Jeff', email: 'jeff@example.com' },
      { name: '', email: 'pat@example.com' },
      { name: '', email: 'amy@example.com' },
    ]);
  });
});

describe('nameParts', () => {
  it('splits first and last, and fills a placeholder last name', () => {
    expect(nameParts('Jeff Smith', 'jeff@example.com')).toEqual({ firstName: 'Jeff', lastName: 'Smith' });
    expect(nameParts('Mary Ann van Dyke', '')).toEqual({ firstName: 'Mary', lastName: 'Ann van Dyke' });
    expect(nameParts('Smith, Jeff', '')).toEqual({ firstName: 'Jeff', lastName: 'Smith' });
    expect(nameParts('Jeff', 'jeff@example.com')).toEqual({ firstName: 'Jeff', lastName: UNKNOWN_LAST_NAME });
    expect(nameParts('', 'jsmith@example.com')).toEqual({ firstName: 'jsmith', lastName: UNKNOWN_LAST_NAME });
  });
});

describe('parseAllowlist', () => {
  it('defaults to Chad and accepts a comma-separated override', () => {
    expect(parseAllowlist(undefined)).toEqual(['cchadww@gmail.com']);
    expect(parseAllowlist(' A@x.com, b@y.com ')).toEqual(['a@x.com', 'b@y.com']);
  });
});

describe('parseForwardedDate', () => {
  it('reads a Gmail date with no zone as US Central', () => {
    expect(parseForwardedDate('Sat, Nov 21, 2026 at 3:10 PM', NOW)).toBe('2026-11-21T21:10:00.000Z');
  });
  it('reads a summer Gmail date as daylight time', () => {
    expect(parseForwardedDate('Mon, Jul 6, 2026 at 9:00 AM', NOW)).toBe('2026-07-06T14:00:00.000Z');
  });
  it('honors an explicit zone', () => {
    expect(parseForwardedDate('November 21, 2026 at 3:10:00 PM CST', NOW)).toBe('2026-11-21T21:10:00.000Z');
  });
  it('rejects junk and far-future dates', () => {
    expect(parseForwardedDate('not a date', NOW)).toBeNull();
    expect(parseForwardedDate('Sat, Nov 21, 2027 at 3:10 PM', NOW)).toBeNull();
  });
});

describe('stripQuotedHistory', () => {
  it('cuts a quoted reply that wraps across lines', () => {
    expect(stripQuotedHistory('Hello\n\nOn Fri, Nov 20, 2026 Chad <\nc@x.com> wrote:\n> old')).toBe('Hello');
  });
});

describe('interpretEmail', () => {
  it('reads a Gmail forward: sender, note, subject, body, and date', async () => {
    const result = interpretEmail(await parse(mime({ text: GMAIL_FORWARD })), { allowlist, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toMatchObject({
      kind: 'forward',
      contact: { name: 'Jeff Smith', email: 'jeff@example.com' },
      subject: 'Hedge posts for my fence',
      note: 'He wants 40 posts, call him Monday.',
      dateIso: '2026-11-21T21:10:00.000Z',
    });
    expect(result.message.body).toBe('Hi Chad,\n\nDo you have 40 line posts available this spring?\n\nJeff');
  });

  it('reads a Gmail forward from a bare address', async () => {
    const text = GMAIL_FORWARD.replace('From: Jeff Smith <Jeff@Example.com>', 'From: <jeff@example.com>');
    const result = interpretEmail(await parse(mime({ text })), { allowlist, now: NOW });
    expect(result.ok && result.message.contact).toEqual({ name: '', email: 'jeff@example.com' });
  });

  it('reads a Gmail forward with no note above it', async () => {
    const text = GMAIL_FORWARD.split('\n').slice(2).join('\n');
    const result = interpretEmail(await parse(mime({ text })), { allowlist, now: NOW });
    expect(result.ok && result.message.note).toBe('');
  });

  it('reads an HTML-only Gmail forward', async () => {
    const html =
      '<div dir="ltr">FYI</div><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>' +
      'From: <strong class="gmail_sendername" dir="auto">Jeff Smith</strong> <span dir="auto">&lt;<a href="mailto:jeff@example.com">jeff@example.com</a>&gt;</span><br>' +
      'Date: Sat, Nov 21, 2026 at 3:10 PM<br>Subject: Hedge posts for my fence<br>To: &lt;<a href="mailto:cchadww@gmail.com">cchadww@gmail.com</a>&gt;<br></div><br><br>' +
      '<div dir="ltr">Posts &amp; braces?</div></div>';
    const result = interpretEmail(await parse(mime({ html })), { allowlist, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.contact).toEqual({ name: 'Jeff Smith', email: 'jeff@example.com' });
    expect(result.message.note).toBe('FYI');
    expect(result.message.body).toBe('Posts & braces?');
  });

  it('reads an Apple Mail forward', async () => {
    const text = [
      'Begin forwarded message:',
      '',
      'From: Jeff Smith <jeff@example.com>',
      'Subject: Hedge posts for my fence',
      'Date: November 21, 2026 at 3:10:00 PM CST',
      'To: Chad Williams <cchadww@gmail.com>',
      '',
      'Do you deliver?',
    ].join('\n');
    const result = interpretEmail(await parse(mime({ text })), { allowlist, now: NOW });
    expect(result.ok && result.message).toMatchObject({
      contact: { email: 'jeff@example.com' },
      dateIso: '2026-11-21T21:10:00.000Z',
      body: 'Do you deliver?',
    });
  });

  it('reads an Outlook forward', async () => {
    const text = [
      'See below.',
      '',
      '________________________________',
      'From: Jeff Smith <jeff@example.com>',
      'Sent: Saturday, November 21, 2026 3:10 PM',
      'To: Chad Williams <cchadww@gmail.com>',
      'Subject: Hedge posts for my fence',
      '',
      'Are corner posts extra?',
    ].join('\n');
    const result = interpretEmail(await parse(mime({ text })), { allowlist, now: NOW });
    expect(result.ok && result.message).toMatchObject({
      contact: { name: 'Jeff Smith', email: 'jeff@example.com' },
      note: 'See below.',
      body: 'Are corner posts extra?',
      dateIso: '2026-11-21T21:10:00.000Z',
    });
  });

  it('uses the recipient when crm@ was BCCd on an email you sent', async () => {
    const raw = mime({
      to: 'Jeff Smith <jeff@example.com>',
      subject: 'Re: Hedge posts for my fence',
      text: 'Yes, 40 posts are ready.\n\nOn Sat, Nov 21, 2026 at 3:10 PM Jeff Smith <jeff@example.com> wrote:\n> Do you have posts?',
    });
    const result = interpretEmail(await parse(raw), { allowlist, now: NOW });
    expect(result.ok && result.message).toMatchObject({
      kind: 'sent',
      contact: { name: 'Jeff Smith', email: 'jeff@example.com' },
      subject: 'Re: Hedge posts for my fence',
      body: 'Yes, 40 posts are ready.',
    });
  });

  it('logs a forwarded reply you sent under the person you sent it to', async () => {
    const text = [
      '---------- Forwarded message ---------',
      'From: Chad Williams <cchadww@gmail.com>',
      'Date: Sat, Nov 21, 2026 at 4:55 PM',
      'Subject: Re: Osage Orange Fence Posts',
      'To: "Schaffer, Jeff" <Jeff@jeffsoffice.com>, Pat <pat@example.com>',
      'Cc: orders@williamscreekfarms.com',
      '',
      'January is best for straight premium posts.',
      '',
      'On Thu, Nov 19, 2026 at 7:28 PM Jeff Schaffer <Jeff@jeffsoffice.com> wrote:',
      '> Is there a month when you can get the better posts?',
    ].join('\n');
    const result = interpretEmail(await parse(mime({ text })), { allowlist, now: NOW });
    expect(result.ok && result.message).toMatchObject({
      kind: 'sent',
      contact: { name: 'Schaffer, Jeff', email: 'jeff@jeffsoffice.com' },
      subject: 'Re: Osage Orange Fence Posts',
      body: 'January is best for straight premium posts.',
      dateIso: '2026-11-21T22:55:00.000Z',
    });
    if (result.ok) expect(buildSummary(result.message)).toMatch(/^Email you sent: Re: Osage/);
  });

  it('refuses a forward of your own message with no other recipient', async () => {
    const text = GMAIL_FORWARD.replace('From: Jeff Smith <Jeff@Example.com>', 'From: Chad Williams <cchadww@gmail.com>');
    const result = interpretEmail(await parse(mime({ text })), { allowlist, now: NOW });
    expect(result.ok).toBe(false);
  });

  it('fails when there is no forward and no outside recipient', async () => {
    const result = interpretEmail(await parse(mime({ text: 'Just a note to myself.' })), { allowlist, now: NOW });
    expect(result.ok).toBe(false);
  });
});

describe('buildSummary', () => {
  it('puts subject, note, then body, and stays under the summary limit', () => {
    const summary = buildSummary({
      kind: 'forward',
      contact: { name: 'Jeff', email: 'jeff@example.com' },
      subject: 'Posts',
      dateIso: null,
      dateRaw: '',
      note: 'Call Monday',
      body: 'x'.repeat(5000),
    });
    expect(summary.startsWith('Subject: Posts\nNote: Call Monday\n\nxxx')).toBe(true);
    expect(summary.length).toBe(4000);
    expect(summary.endsWith('…')).toBe(true);
  });
});

describe('cloudflareDkimPassed', () => {
  const header = (value: string) => ({ key: 'authentication-results', originalKey: 'Authentication-Results', value });

  it('passes on a Cloudflare DKIM pass for the domain', () => {
    expect(cloudflareDkimPassed([header(GMAIL_AUTH)], 'gmail.com')).toBe(true);
  });
  it('fails on a DKIM pass for another domain, or a non-Cloudflare stamp', () => {
    expect(cloudflareDkimPassed([header('mx.cloudflare.net; dkim=pass header.d=evil.com')], 'gmail.com')).toBe(false);
    expect(cloudflareDkimPassed([header('mx.evil.com; dkim=pass header.d=gmail.com')], 'gmail.com')).toBe(false);
  });
  it('trusts only the topmost Cloudflare stamp', () => {
    expect(
      cloudflareDkimPassed(
        [header('mx.cloudflare.net; dkim=fail header.d=gmail.com'), header(GMAIL_AUTH)],
        'gmail.com'
      )
    ).toBe(false);
  });
});

describe('ingestInboundEmail', () => {
  function setup() {
    const kv = memoryKv();
    const notify = vi.fn(async (_options: PublishNtfyOptions) => {});
    const env = { ORDERS_KV: kv, SITE_URL: 'https://example.test' };
    const run = (raw: string, from = 'cchadww@gmail.com', extraEnv: Record<string, unknown> = {}) =>
      ingestInboundEmail({ raw, from }, { ...env, ...extraEnv }, { notify, now: () => NOW });
    return { kv, notify, run };
  }

  it('creates a contact with an Email interaction and pushes a link', async () => {
    const { kv, notify, run } = setup();
    const outcome = await run(mime({ text: GMAIL_FORWARD }));
    expect(outcome.status).toBe('logged');
    if (outcome.status !== 'logged') return;

    const contact = await getContact(kv, outcome.contactId);
    expect(contact).toMatchObject({ firstName: 'Jeff', lastName: 'Smith', email: 'jeff@example.com' });
    expect(contact?.interactions[0]).toMatchObject({
      channel: 'email',
      createdAt: '2026-11-21T21:10:00.000Z',
    });
    expect(contact?.interactions[0].summary).toContain('Note: He wants 40 posts');
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Email logged: Jeff Smith',
        click: `https://example.test/admin/contacts/${outcome.contactId}`,
      })
    );
  });

  it('adds to an existing contact matched by email without renaming them', async () => {
    const { kv, run } = setup();
    const { contact: existing } = await logInteraction(kv, {
      firstName: 'Jeffrey',
      lastName: 'Smith',
      phone: '712-555-0100',
      email: 'jeff@example.com',
      channel: 'phone',
      summary: 'Called about posts',
    });
    const outcome = await run(mime({ text: GMAIL_FORWARD }));
    expect(outcome.status === 'logged' && outcome.contactId).toBe(existing.id);
    const contact = await getContact(kv, existing.id);
    expect(contact?.firstName).toBe('Jeffrey');
    expect(contact?.interactions.map((item) => item.channel).sort()).toEqual(['email', 'phone']);
    expect(await getAllContacts(kv)).toHaveLength(1);
  });

  it('skips a duplicate of the same forwarded message', async () => {
    const { kv, notify, run } = setup();
    const first = await run(mime({ text: GMAIL_FORWARD }));
    const second = await run(mime({ text: GMAIL_FORWARD }));
    expect(second).toEqual({ status: 'duplicate', contactId: first.status === 'logged' ? first.contactId : '' });
    const contact = await getContact(kv, second.status === 'duplicate' ? second.contactId : '');
    expect(contact?.interactions).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('rejects a sender not on the allowlist, quietly', async () => {
    const { kv, notify, run } = setup();
    const raw = mime({ from: 'Stranger <stranger@example.com>', text: GMAIL_FORWARD });
    const outcome = await run(raw, 'stranger@example.com');
    expect(outcome.status).toBe('rejected');
    expect(kv.store.size).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted From without a Gmail DKIM pass', async () => {
    const { kv, notify, run } = setup();
    const raw = mime({
      text: GMAIL_FORWARD,
      auth: ['mx.cloudflare.net; dkim=none; dmarc=fail header.from=gmail.com; spf=fail'],
    });
    expect((await run(raw)).status).toBe('rejected');
    expect(kv.store.size).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('accepts a missing DKIM result only when the debug switch is on', async () => {
    const { run } = setup();
    const raw = mime({ text: GMAIL_FORWARD, auth: [] });
    expect((await run(raw)).status).toBe('rejected');
    expect((await run(raw, 'cchadww@gmail.com', { INBOUND_EMAIL_SKIP_DKIM: '1' })).status).toBe('logged');
  });

  it('pushes a warning and saves nothing when it cannot find a customer', async () => {
    const { kv, notify, run } = setup();
    const outcome = await run(mime({ subject: 'Note to self', text: 'Remember the posts.' }));
    expect(outcome.status).toBe('unreadable');
    expect(await getAllContacts(kv)).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Could not log forwarded email', tags: 'warning' })
    );
  });
});
