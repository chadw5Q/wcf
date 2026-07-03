import { describe, it, expect } from 'vitest';
import {
  buildHuntWaiverNotifyText,
  createHuntWaiverRecord,
  parseHuntWaiverBody,
} from '../../../src/lib/hunt-waiver';

const validBody = {
  guestSlug: 'allen-wright',
  huntLabel: 'Week 1 Gun Season 2026',
  buckChoice: 'reserved',
  fullName: 'Allen Wright',
  releaseDate: '2026-07-02',
  minorName: null,
  address: '123 Main St, Cumberland, IA',
  phone: '712-555-0100',
  releaseSignature: 'Allen Wright',
  agreedToRelease: true,
  medicalSignature: 'Allen Wright',
  medicalDate: '2026-07-02',
  emergencyContactName: 'Jane Wright',
  emergencyContactPhone: '712-555-0101',
};

describe('parseHuntWaiverBody', () => {
  it('accepts a valid submission', () => {
    const res = parseHuntWaiverBody(validBody);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.buckChoice).toBe('reserved');
      expect(res.value.fullName).toBe('Allen Wright');
      expect(res.value.minorName).toBeNull();
    }
  });

  it('trims fields and normalizes empty minorName to null', () => {
    const res = parseHuntWaiverBody({ ...validBody, fullName: '  Allen Wright  ', minorName: '   ' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.fullName).toBe('Allen Wright');
      expect(res.value.minorName).toBeNull();
    }
  });

  it('rejects non-object bodies', () => {
    for (const raw of [null, 'x', 42, ['a']]) {
      const res = parseHuntWaiverBody(raw);
      expect(res.ok).toBe(false);
    }
  });

  it('rejects missing required fields', () => {
    for (const key of ['fullName', 'releaseSignature', 'medicalSignature', 'emergencyContactName']) {
      const res = parseHuntWaiverBody({ ...validBody, [key]: '  ' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain(key);
    }
  });

  it('rejects an invalid buck choice', () => {
    const res = parseHuntWaiverBody({ ...validBody, buckChoice: 'trophy' });
    expect(res.ok).toBe(false);
  });

  it('requires agreedToRelease to be exactly true', () => {
    for (const v of [false, 'true', 1, undefined]) {
      const res = parseHuntWaiverBody({ ...validBody, agreedToRelease: v });
      expect(res.ok).toBe(false);
    }
  });

  it('rejects oversized fields', () => {
    const res = parseHuntWaiverBody({ ...validBody, address: 'x'.repeat(501) });
    expect(res.ok).toBe(false);
  });
});

describe('waiver record + notify text', () => {
  it('assigns an id and timestamp', () => {
    const parsed = parseHuntWaiverBody(validBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const record = createHuntWaiverRecord(parsed.value);
    expect(record.id).toMatch(/[0-9a-f-]{36}/);
    expect(Date.parse(record.submittedAt)).not.toBeNaN();
  });

  it('mentions Venmo and the August 1 deadline for reserved bucks', () => {
    const parsed = parseHuntWaiverBody(validBody);
    if (!parsed.ok) throw new Error('expected ok');
    const text = buildHuntWaiverNotifyText(createHuntWaiverRecord(parsed.value));
    expect(text).toContain('Reserved Bucks ($3,000)');
    expect(text).toContain('@cchadww');
    expect(text).toContain('August 1, 2026');
    expect(text).toContain('Allen Wright');
  });

  it('mentions the $5,000 reserved-buck note for cull bucks', () => {
    const parsed = parseHuntWaiverBody({ ...validBody, buckChoice: 'cull' });
    if (!parsed.ok) throw new Error('expected ok');
    const text = buildHuntWaiverNotifyText(createHuntWaiverRecord(parsed.value));
    expect(text).toContain('Cull Bucks');
    expect(text).toContain('$5,000');
  });
});
