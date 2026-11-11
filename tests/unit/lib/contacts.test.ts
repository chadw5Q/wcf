import { describe, expect, it } from 'vitest';
import {
  attachOrderToContact,
  centralToday,
  completeFollowUp,
  ContactError,
  reopenFollowUp,
  contactListQuery,
  filterAndSortInteractions,
  filterContacts,
  interactionListSearch,
  linkOrdersMissingContacts,
  listOpenFollowUps,
  logInteraction,
  parseContactListSort,
  parseInteractionListQuery,
  phoneKey,
  sortContacts,
  toggledContactSort,
  updateContact,
  getAllContacts,
  getContact,
  type Contact,
  type Interaction,
} from '../../../src/lib/contacts';
import { getOrder, saveOrder } from '../../../src/lib/orders';
import type { StoredOrder } from '../../../src/lib/order-types';

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

function sampleOrder(partial: Partial<StoredOrder> & Pick<StoredOrder, 'id'>): StoredOrder {
  const { customer, ...rest } = partial;
  return {
    createdAt: '2026-03-01T15:00:00.000Z',
    items: [
      {
        product: 'Premium Line',
        fieldName: 'premiumLine',
        quantity: 4,
        unitPrice: 12,
        lineTotal: 48,
      },
    ],
    subtotal: 48,
    volumeDiscount: { applied: false, amount: 0, mode: 'auto', rate: 0.1 },
    discountedSubtotal: 48,
    deposit: { selected: false, rate: 0.1, amount: 0 },
    orderTotal: 48,
    depositAmount: 0,
    balanceDue: 48,
    notes: 'Need corners too',
    deliverySlot: null,
    status: 'pending',
    ...rest,
    customer: {
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '(712) 555-0199',
      ...customer,
    },
  };
}

describe('phoneKey', () => {
  it('keeps the last 10 digits and strips a leading country code', () => {
    expect(phoneKey('(712) 555-0199')).toBe('7125550199');
    expect(phoneKey('1-712-555-0199')).toBe('7125550199');
    expect(phoneKey('712555019')).toBe('');
    expect(phoneKey('')).toBe('');
  });
});

describe('contacts', () => {
  it('records many interactions on one contact matched by phone', async () => {
    const kv = memoryKv();
    const first = await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '712-555-0199',
      email: '',
      channel: 'phone',
      summary: 'Asked about line posts',
      followUpOn: '2026-04-02',
    });
    const second = await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Byron',
      phone: '(712) 555-0199',
      channel: 'phone',
      summary: 'Called again about pickup',
    });

    expect(second.contact.id).toBe(first.contact.id);
    expect(second.contact.name).toBe('Ada Lovelace');
    expect(second.contact.interactions).toHaveLength(2);
    expect(second.contact.interactions[0].summary).toBe('Called again about pickup');

    const open = listOpenFollowUps(await getAllContacts(kv), '2026-04-01');
    expect(open).toHaveLength(1);
    expect(open[0].overdue).toBe(false);
    expect(listOpenFollowUps(await getAllContacts(kv), '2026-04-03')[0].overdue).toBe(true);

    await completeFollowUp(kv, first.contact.id, first.interaction.id);
    expect(listOpenFollowUps(await getAllContacts(kv), '2026-04-03')).toHaveLength(0);
  });

  it('reopens a completed follow-up and leaves an open one stored as-is', async () => {
    const kv = memoryKv();
    let puts = 0;
    const counting = {
      get: (key: string) => kv.get(key),
      put: async (key: string, value: string) => {
        puts += 1;
        await kv.put(key, value);
      },
      delete: (key: string) => kv.delete(key),
    } as unknown as KVNamespace;

    const logged = await logInteraction(counting, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '712-555-0199',
      channel: 'phone',
      summary: 'Asked about line posts',
      followUpOn: '2026-04-02',
    });

    await expect(reopenFollowUp(counting, 'contact_missing', logged.interaction.id)).rejects.toBeInstanceOf(
      ContactError
    );
    await expect(reopenFollowUp(counting, 'contact_missing', logged.interaction.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(reopenFollowUp(counting, logged.contact.id, 'ix_missing')).rejects.toMatchObject({
      status: 404,
      message: 'Interaction not found.',
    });

    const putsAfterOpen = puts;
    const stillOpen = await reopenFollowUp(counting, logged.contact.id, logged.interaction.id);
    expect(stillOpen.interactions.find((item) => item.id === logged.interaction.id)?.followUpDoneAt).toBeNull();
    expect(puts).toBe(putsAfterOpen);

    await completeFollowUp(
      counting,
      logged.contact.id,
      logged.interaction.id,
      new Date('2026-04-03T12:00:00.000Z')
    );
    expect(listOpenFollowUps(await getAllContacts(counting), '2026-04-01')).toHaveLength(0);

    const reopened = await reopenFollowUp(counting, logged.contact.id, logged.interaction.id);
    expect(reopened.interactions.find((item) => item.id === logged.interaction.id)?.followUpDoneAt).toBeNull();
    const open = listOpenFollowUps(await getAllContacts(counting), '2026-04-01');
    expect(open).toHaveLength(1);
    expect(open[0].interaction.id).toBe(logged.interaction.id);

    const note = await logInteraction(counting, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '712-555-0199',
      channel: 'note',
      summary: 'No follow-up date',
    });
    await expect(reopenFollowUp(counting, note.contact.id, note.interaction.id)).rejects.toMatchObject({
      status: 400,
      message: 'This interaction has no follow-up.',
    });
  });

  it('keeps the phone match when email belongs to someone else', async () => {
    const kv = memoryKv();
    const byPhone = await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '7125550199',
      email: 'ada@example.com',
      channel: 'phone',
      summary: 'First call',
    });
    await logInteraction(kv, {
      firstName: 'Grace',
      lastName: 'Hopper',
      phone: '5155550100',
      email: 'grace@example.com',
      channel: 'note',
      summary: 'Left a note',
    });

    const order = sampleOrder({
      id: 'order-conflict',
      customer: {
        name: 'Ada Lovelace',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'grace@example.com',
        phone: '7125550199',
      },
    });
    await saveOrder(kv, order);
    await attachOrderToContact(kv, order, { channel: 'web' });

    const ada = await getContact(kv, byPhone.contact.id);
    expect(order.contactId).toBe(byPhone.contact.id);
    expect(ada?.email).toBe('ada@example.com');
    expect(ada?.interactions.some((item) => item.summary.includes('another contact'))).toBe(true);
    expect((await getAllContacts(kv)).length).toBe(2);
  });

  it('links existing orders once and keeps walk-in calls on the walk-in channel', async () => {
    const kv = memoryKv();
    const web = sampleOrder({ id: 'order-web', createdAt: '2026-02-01T15:00:00.000Z' });
    const walkIn = sampleOrder({
      id: 'order-walk',
      createdAt: '2026-05-01T15:00:00.000Z',
      revisionLog: [
        {
          at: '2026-05-01T15:00:00.000Z',
          action: 'meta',
          summary: 'Walk-in order created (no schedule email).',
          details: { source: 'admin_walk_in' },
        },
      ],
    });
    await saveOrder(kv, web);
    await saveOrder(kv, walkIn);

    expect(await linkOrdersMissingContacts(kv)).toBe(2);
    expect(await linkOrdersMissingContacts(kv)).toBe(0);

    const linkedWeb = await getOrder(kv, web.id);
    const linkedWalk = await getOrder(kv, walkIn.id);
    expect(linkedWeb?.contactId).toBe(linkedWalk?.contactId);
    const contact = await getContact(kv, linkedWeb!.contactId!);
    expect(contact?.interactions).toHaveLength(2);
    const walkInteraction = contact?.interactions.find((item) => item.orderId === walkIn.id);
    const webInteraction = contact?.interactions.find((item) => item.orderId === web.id);
    expect(walkInteraction?.channel).toBe('walk-in');
    expect(webInteraction?.channel).toBe('web');
    expect(webInteraction?.summary).toContain('Premium Line');
    expect(webInteraction?.summary).toContain('Need corners too');
    expect(webInteraction?.createdAt).toBe(web.createdAt);
    expect(contact?.lastInteractionAt).toBe(walkIn.createdAt);
  });

  it('refuses to move a phone number onto a second contact', async () => {
    const kv = memoryKv();
    const ada = await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '7125550199',
      email: 'ada@example.com',
      channel: 'phone',
      summary: 'Call',
    });
    const grace = await logInteraction(kv, {
      firstName: 'Grace',
      lastName: 'Hopper',
      phone: '5155550100',
      email: 'grace@example.com',
      channel: 'phone',
      summary: 'Call',
    });

    await expect(
      updateContact(kv, grace.contact.id, {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        phone: '(712) 555-0199',
      })
    ).rejects.toThrow(/phone number is already/);

    const stillGrace = await getContact(kv, grace.contact.id);
    expect(stillGrace?.phoneKey).toBe('5155550100');
    expect((await getContact(kv, ada.contact.id))?.phoneKey).toBe('7125550199');
  });

  it('finds contacts by name or part of a phone number', async () => {
    const kv = memoryKv();
    await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '7125550199',
      email: 'ada@example.com',
      channel: 'phone',
      summary: 'Call',
    });
    const contacts = await getAllContacts(kv);
    expect(filterContacts(contacts, 'love')).toHaveLength(1);
    expect(filterContacts(contacts, '0199')).toHaveLength(1);
    expect(filterContacts(contacts, '999')).toHaveLength(0);
    expect(centralToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('finds contacts by full email or the part before @', async () => {
    const kv = memoryKv();
    await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '7125550199',
      email: 'countess@example.com',
      channel: 'phone',
      summary: 'Call',
    });
    const contacts = await getAllContacts(kv);
    expect(filterContacts(contacts, 'countess@example.com')).toHaveLength(1);
    expect(filterContacts(contacts, 'COUNTESS@EXAMPLE.COM')).toHaveLength(1);
    expect(filterContacts(contacts, 'countess')).toHaveLength(1);
    expect(filterContacts(contacts, 'love')).toHaveLength(1);
    expect(filterContacts(contacts, '0199')).toHaveLength(1);
    expect(filterContacts(contacts, 'nobody@example.com')).toHaveLength(0);
  });

  it('merges interests onto a matching contact and replaces them on edit', async () => {
    const kv = memoryKv();
    const first = await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '7125550199',
      email: '',
      channel: 'phone',
      summary: 'Asked about a hunt',
      interests: ['hunting', 'bow-stave'],
      location: 'Cumberland, IA',
    });
    expect(first.contact.interests).toEqual(['bow-stave', 'hunting']);
    expect(first.contact.location).toBe('Cumberland, IA');

    const second = await logInteraction(kv, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '(712) 555-0199',
      channel: 'phone',
      summary: 'Also wants posts',
      interests: ['hedge-posts'],
      location: '',
    });
    expect(second.contact.id).toBe(first.contact.id);
    expect(second.contact.interests).toEqual(['bow-stave', 'hedge-posts', 'hunting']);
    expect(second.contact.location).toBe('Cumberland, IA');

    const cleared = await updateContact(kv, first.contact.id, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: '',
      phone: '7125550199',
      interests: [],
      location: '',
    });
    expect(cleared.interests).toEqual([]);
    expect(cleared.location).toBe('');

    const found = filterContacts(await getAllContacts(kv), 'hunting');
    expect(found).toHaveLength(0);
  });

  it('loads a contact saved before interests and location existed', async () => {
    const kv = memoryKv();
    const id = 'contact_legacy';
    await kv.put(
      id,
      JSON.stringify({
        id,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        firstName: 'Old',
        lastName: 'Record',
        name: 'Old Record',
        email: '',
        phone: '5155550100',
        phoneKey: '5155550100',
        emailKey: '',
        lastInteractionAt: null,
        interactions: [],
      })
    );
    await kv.put('contact_index', JSON.stringify([id]));
    const contact = await getContact(kv, id);
    expect(contact?.interests).toEqual([]);
    expect(contact?.location).toBe('');
    expect(filterContacts([contact!], 'hunting')).toHaveLength(0);
  });

  it('finds a hunting inquiry by interest or place', async () => {
    const kv = memoryKv();
    await logInteraction(kv, {
      firstName: 'Grace',
      lastName: 'Hopper',
      phone: '5155550100',
      channel: 'phone',
      summary: 'Wants a week next fall',
      interests: ['hunting'],
      location: 'Des Moines',
    });
    const contacts = await getAllContacts(kv);
    expect(filterContacts(contacts, 'hunting')).toHaveLength(1);
    expect(filterContacts(contacts, 'des moines')).toHaveLength(1);
  });
});

function listedInteraction(
  partial: Pick<Interaction, 'id' | 'createdAt' | 'channel'> & Partial<Interaction>
): Interaction {
  return {
    summary: partial.id,
    followUpOn: null,
    followUpDoneAt: null,
    orderId: null,
    ...partial,
  };
}

describe('interaction list view', () => {
  const stored = [
    listedInteraction({ id: 'newer-note', createdAt: '2026-03-03T12:00:00.000Z', channel: 'note' }),
    listedInteraction({ id: 'older-phone', createdAt: '2026-03-01T12:00:00.000Z', channel: 'phone' }),
    listedInteraction({ id: 'mid-web', createdAt: '2026-03-02T12:00:00.000Z', channel: 'web' }),
    listedInteraction({ id: 'mid-walk', createdAt: '2026-03-02T18:00:00.000Z', channel: 'walk-in' }),
  ];

  it('defaults to newest first and leaves the stored list alone', () => {
    const view = parseInteractionListQuery({});
    expect(view).toEqual({ sort: 'date', dir: 'desc', type: 'all' });
    const shown = filterAndSortInteractions(stored, view);
    expect(shown.map((item) => item.id)).toEqual([
      'newer-note',
      'mid-walk',
      'mid-web',
      'older-phone',
    ]);
    expect(stored.map((item) => item.id)).toEqual([
      'newer-note',
      'older-phone',
      'mid-web',
      'mid-walk',
    ]);
    expect(interactionListSearch(view)).toBe('');
  });

  it('flips to oldest first and can hide every channel except one', () => {
    const view = parseInteractionListQuery({ sort: 'date', dir: 'asc', type: 'phone' });
    expect(view).toEqual({ sort: 'date', dir: 'asc', type: 'phone' });
    const shown = filterAndSortInteractions(stored, view);
    expect(shown.map((item) => item.id)).toEqual(['older-phone']);
    expect(stored).toHaveLength(4);
    expect(interactionListSearch(view)).toBe('?sort=date&dir=asc&type=phone');
    expect(interactionListSearch({ dir: 'desc', type: 'walk-in' })).toBe(
      '?sort=date&dir=desc&type=walk-in'
    );
    const oldest = filterAndSortInteractions(stored, { dir: 'asc', type: 'all' });
    expect(oldest.map((item) => item.id)).toEqual([
      'older-phone',
      'mid-web',
      'mid-walk',
      'newer-note',
    ]);
  });

  it('ignores an unknown type and keeps equal timestamps in their previous order', () => {
    expect(parseInteractionListQuery({ dir: 'sideways', type: 'fax' })).toEqual({
      sort: 'date',
      dir: 'desc',
      type: 'all',
    });
    const tied = [
      listedInteraction({ id: 'first', createdAt: '2026-01-01T00:00:00.000Z', channel: 'note' }),
      listedInteraction({ id: 'second', createdAt: '2026-01-01T00:00:00.000Z', channel: 'web' }),
    ];
    expect(filterAndSortInteractions(tied, { dir: 'asc', type: 'all' }).map((item) => item.id)).toEqual([
      'first',
      'second',
    ]);
  });
});

function listContact(partial: Pick<Contact, 'id' | 'firstName' | 'lastName'> & Partial<Contact>): Contact {
  const { firstName, lastName, ...rest } = partial;
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    name: `${firstName} ${lastName}`.trim(),
    email: '',
    phone: '',
    phoneKey: '',
    emailKey: '',
    interests: [],
    location: '',
    lastInteractionAt: null,
    interactions: [],
    firstName,
    lastName,
    ...rest,
  };
}

describe('sortContacts', () => {
  const ada = listContact({
    id: 'ada',
    firstName: 'ada',
    lastName: 'Lovelace',
    createdAt: '2026-03-01T00:00:00.000Z',
    lastInteractionAt: null,
  });
  const grace = listContact({
    id: 'grace',
    firstName: 'Grace',
    lastName: 'Hopper',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastInteractionAt: '2026-06-01T00:00:00.000Z',
  });
  const zoe = listContact({
    id: 'zoe',
    firstName: 'Zoe',
    lastName: 'Adams',
    createdAt: '2026-02-01T00:00:00.000Z',
    lastInteractionAt: '2026-02-02T00:00:00.000Z',
  });
  const bob = listContact({
    id: 'bob',
    firstName: 'Bob',
    lastName: 'Adams',
    createdAt: '2026-04-01T00:00:00.000Z',
    lastInteractionAt: '2026-04-02T00:00:00.000Z',
  });
  const contacts = [zoe, ada, grace, bob];

  it('defaults to newest activity first, using createdAt when there is no interaction', () => {
    expect(sortContacts(contacts).map((contact) => contact.id)).toEqual(['grace', 'bob', 'ada', 'zoe']);
    expect(sortContacts(contacts, 'date', 'asc').map((contact) => contact.id)).toEqual([
      'zoe',
      'ada',
      'bob',
      'grace',
    ]);
  });

  it('sorts first and last names without changing the source list', () => {
    expect(sortContacts(contacts, 'first', 'asc').map((contact) => contact.id)).toEqual([
      'ada',
      'bob',
      'grace',
      'zoe',
    ]);
    expect(sortContacts(contacts, 'first', 'desc').map((contact) => contact.id)).toEqual([
      'zoe',
      'grace',
      'bob',
      'ada',
    ]);
    expect(sortContacts(contacts, 'last', 'asc').map((contact) => contact.id)).toEqual([
      'zoe',
      'bob',
      'grace',
      'ada',
    ]);
    expect(contacts.map((contact) => contact.id)).toEqual(['zoe', 'ada', 'grace', 'bob']);
  });

  it('sorts only the contacts that already match the search', () => {
    const visible = sortContacts(filterContacts(contacts, 'adams'), 'first', 'desc');
    expect(visible.map((contact) => contact.id)).toEqual(['zoe', 'bob']);
  });

  it('reads the query and flips the active sort', () => {
    expect(parseContactListSort(null, null)).toEqual({ sort: 'date', dir: 'desc' });
    expect(parseContactListSort('first', null)).toEqual({ sort: 'first', dir: 'asc' });
    expect(parseContactListSort('date', 'asc')).toEqual({ sort: 'date', dir: 'asc' });
    expect(parseContactListSort('nope', 'asc')).toEqual({ sort: 'date', dir: 'desc' });
    expect(parseContactListSort('last', 'sideways')).toEqual({ sort: 'last', dir: 'asc' });

    const newest = parseContactListSort(null, null);
    expect(toggledContactSort(newest, 'date')).toEqual({ sort: 'date', dir: 'asc' });
    expect(toggledContactSort(newest, 'first')).toEqual({ sort: 'first', dir: 'asc' });
    expect(toggledContactSort({ sort: 'first', dir: 'asc' }, 'first')).toEqual({ sort: 'first', dir: 'desc' });
    expect(toggledContactSort({ sort: 'first', dir: 'desc' }, 'date')).toEqual({ sort: 'date', dir: 'desc' });

    expect(contactListQuery()).toBe('');
    expect(contactListQuery({ q: ' ada ' })).toBe('?q=ada');
    expect(contactListQuery({ q: 'ada', sort: 'first', dir: 'asc' })).toBe('?q=ada&sort=first&dir=asc');
    expect(contactListQuery({ sort: 'date', dir: 'asc' })).toBe('?sort=date&dir=asc');
    expect(contactListQuery({ q: 'ada', sort: 'date', dir: 'desc' })).toBe('?q=ada');
  });
});
