import { describe, expect, it, vi } from 'vitest';
import { interestForProjectType, contactMessageSummary } from '../../../src/lib/contact-form';
import { getAllContacts, logInteraction } from '../../../src/lib/contacts';
import { POST as submitContact } from '../../../src/pages/api/contact';

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function localsFor(kv: KVNamespace | undefined) {
  return { runtime: { env: { ORDERS_KV: kv } } } as Parameters<typeof submitContact>[0]['locals'];
}

describe('contact form project types', () => {
  it('maps current and leftover project types onto interests', () => {
    expect(interestForProjectType('')).toBeNull();
    expect(interestForProjectType('   ')).toBeNull();
    expect(interestForProjectType('hedge-fence-posts')).toBe('hedge-posts');
    expect(interestForProjectType('Hedge fence posts')).toBe('hedge-posts');
    expect(interestForProjectType('privacy-hedge')).toBe('hedge-posts');
    expect(interestForProjectType('Privacy Hedge')).toBe('hedge-posts');
    expect(interestForProjectType('osage-orange-bow-staves')).toBe('bow-stave');
    expect(interestForProjectType('Osage orange bow staves')).toBe('bow-stave');
    expect(interestForProjectType('bow stave')).toBe('bow-stave');
    expect(interestForProjectType('something-else')).toBe('other');
    expect(interestForProjectType('Something else')).toBe('other');
    expect(interestForProjectType('other')).toBe('other');
    expect(interestForProjectType('Other')).toBe('other');
    expect(interestForProjectType('windbreak')).toBe('other');
    expect(interestForProjectType('decorative-border')).toBe('other');
    expect(interestForProjectType('Decorative Border')).toBe('other');
    expect(interestForProjectType('landscaping')).toBe('other');
    expect(interestForProjectType('General Landscaping')).toBe('other');
    expect(interestForProjectType('shed repair')).toBe('other');
  });

  it('builds a readable summary and skips an empty project type', () => {
    expect(
      contactMessageSummary('hedge-fence-posts', '  Checking the contact form lands in the CRM.  ')
    ).toBe('Project: Hedge fence posts\nMessage: Checking the contact form lands in the CRM.');
    expect(contactMessageSummary('privacy-hedge', 'Old label')).toBe(
      'Project: Privacy Hedge\nMessage: Old label'
    );
    expect(contactMessageSummary('', 'Just a note')).toBe('Message: Just a note');
  });
});

describe('POST /api/contact', () => {
  it('creates a contact and stores a web interaction', async () => {
    const kv = memoryKv();
    const res = await submitContact({
      request: jsonRequest({
        firstName: '  Form ',
        lastName: ' Test ',
        email: 'form-test@example.com',
        phone: '7125550101',
        projectType: 'hedge-fence-posts',
        message: 'Checking the contact form lands in the CRM.',
      }),
      locals: localsFor(kv),
    } as Parameters<typeof submitContact>[0]);

    expect(res.status).toBe(200);
    const contacts = await getAllContacts(kv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe('Form Test');
    expect(contacts[0].email).toBe('form-test@example.com');
    expect(contacts[0].phoneKey).toBe('7125550101');
    expect(contacts[0].interests).toEqual(['hedge-posts']);
    expect(contacts[0].interactions).toHaveLength(1);
    expect(contacts[0].interactions[0].channel).toBe('web');
    expect(contacts[0].interactions[0].followUpOn).toBeNull();
    expect(contacts[0].interactions[0].summary).toBe(
      'Project: Hedge fence posts\nMessage: Checking the contact form lands in the CRM.'
    );
  });

  it('matches by phone, keeps the stored name, and merges interests', async () => {
    const kv = memoryKv();
    await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '7125550101',
      email: 'ada@example.com',
      channel: 'phone',
      summary: 'Called about a hunt',
      interests: ['hunting'],
    });

    const res = await submitContact({
      request: jsonRequest({
        firstName: 'Form',
        lastName: 'Test',
        email: 'form-test@example.com',
        phone: '(712) 555-0101',
        projectType: 'hedge-fence-posts',
        message: 'Checking the contact form lands in the CRM.',
      }),
      locals: localsFor(kv),
    } as Parameters<typeof submitContact>[0]);

    expect(res.status).toBe(200);
    const contacts = await getAllContacts(kv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe('Ada Lovelace');
    expect(contacts[0].email).toBe('ada@example.com');
    expect(contacts[0].interests).toEqual(['hedge-posts', 'hunting']);
    expect(contacts[0].interactions).toHaveLength(2);
    const web = contacts[0].interactions.find((item) => item.channel === 'web');
    expect(web?.followUpOn).toBeNull();
    expect(web?.summary).toContain('Project: Hedge fence posts');
    expect(web?.summary).toContain('Message: Checking the contact form lands in the CRM.');
  });

  it('matches by email when the phone is blank and does not invent an interest', async () => {
    const kv = memoryKv();
    const locals = localsFor(kv);
    const first = await submitContact({
      request: jsonRequest({
        firstName: 'Form',
        lastName: 'Test',
        email: 'form-test@example.com',
        phone: '',
        projectType: '',
        message: 'First note',
      }),
      locals,
    } as Parameters<typeof submitContact>[0]);
    const second = await submitContact({
      request: jsonRequest({
        firstName: 'Form',
        lastName: 'Test',
        email: 'Form-Test@example.com',
        phone: '',
        projectType: 'osage-orange-bow-staves',
        message: 'Need a few staves',
      }),
      locals,
    } as Parameters<typeof submitContact>[0]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const contacts = await getAllContacts(kv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].phone).toBe('');
    expect(contacts[0].interests).toEqual(['bow-stave']);
    expect(contacts[0].interactions).toHaveLength(2);
    expect(contacts[0].interactions.map((item) => item.summary)).toEqual([
      'Project: Osage orange bow staves\nMessage: Need a few staves',
      'Message: First note',
    ]);
  });

  it('keeps the phone match when that email belongs to someone else', async () => {
    const kv = memoryKv();
    const byPhone = await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '7125550101',
      email: 'ada@example.com',
      channel: 'phone',
      summary: 'Phone contact',
      interests: ['hunting'],
    });
    const byEmail = await logInteraction(kv, {
      firstName: 'Grace',
      lastName: 'Hopper',
      phone: '7125550199',
      email: 'grace@example.com',
      channel: 'note',
      summary: 'Email contact',
    });

    const res = await submitContact({
      request: jsonRequest({
        firstName: 'Form',
        lastName: 'Test',
        email: 'grace@example.com',
        phone: '7125550101',
        projectType: 'something-else',
        message: 'This should stay on the phone contact.',
      }),
      locals: localsFor(kv),
    } as Parameters<typeof submitContact>[0]);

    expect(res.status).toBe(200);
    const ada = await getAllContacts(kv).then((list) => list.find((item) => item.id === byPhone.contact.id));
    const grace = await getAllContacts(kv).then((list) => list.find((item) => item.id === byEmail.contact.id));
    expect(ada?.interactions).toHaveLength(2);
    expect(ada?.interests).toEqual(['hunting', 'other']);
    expect(ada?.email).toBe('ada@example.com');
    expect(ada?.interactions[0].summary).toContain('Message: This should stay on the phone contact.');
    expect(grace?.interactions).toHaveLength(1);
    expect(grace?.email).toBe('grace@example.com');
  });

  it('rejects a message with no email and does not create a contact', async () => {
    const kv = memoryKv();
    const res = await submitContact({
      request: jsonRequest({
        firstName: 'Form',
        lastName: 'Test',
        email: '',
        phone: '7125550101',
        projectType: 'hedge-fence-posts',
        message: 'Missing email',
      }),
      locals: localsFor(kv),
    } as Parameters<typeof submitContact>[0]);
    expect(res.status).toBe(400);
    expect(await getAllContacts(kv)).toHaveLength(0);
  });

  it('still accepts the message when contact logging throws', async () => {
    const kv = memoryKv();
    (kv as { put: KVNamespace['put'] }).put = async () => {
      throw new Error('kv down');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await submitContact({
        request: jsonRequest({
          firstName: 'Form',
          lastName: 'Test',
          email: 'form-test@example.com',
          phone: '7125550101',
          projectType: 'hedge-fence-posts',
          message: 'Checking the contact form lands in the CRM.',
        }),
        locals: localsFor(kv),
      } as Parameters<typeof submitContact>[0]);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0]?.[0])).toContain('Failed to log contact form message');
    } finally {
      spy.mockRestore();
    }
  });
});
