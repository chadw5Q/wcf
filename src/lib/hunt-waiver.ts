import { Resend } from 'resend';
import { getServerEnv } from './server-env';

export type HuntBuckChoice = 'cull' | 'reserved';

export const HUNT_WAIVER_KV_PREFIX = 'waiver:';

export type HuntWaiverRequestBody = {
  guestSlug: string;
  huntLabel: string;
  buckChoice: HuntBuckChoice;
  fullName: string;
  releaseDate: string;
  minorName: string | null;
  address: string;
  phone: string;
  releaseSignature: string;
  agreedToRelease: true;
  medicalSignature: string;
  medicalDate: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export type HuntWaiverRecord = HuntWaiverRequestBody & {
  id: string;
  submittedAt: string;
};

export type ParseHuntWaiverBodyResult =
  | { ok: true; value: HuntWaiverRequestBody }
  | { ok: false; error: string; status: number };

const REQUIRED_STRINGS = [
  'guestSlug',
  'huntLabel',
  'fullName',
  'releaseDate',
  'address',
  'phone',
  'releaseSignature',
  'medicalSignature',
  'medicalDate',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

const MAX_FIELD_LEN = 500;

export function parseHuntWaiverBody(raw: unknown): ParseHuntWaiverBodyResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Body must be a JSON object', status: 400 };
  }
  const o = raw as Record<string, unknown>;

  const values: Record<string, string> = {};
  for (const key of REQUIRED_STRINGS) {
    const v = o[key];
    if (typeof v !== 'string' || !v.trim()) {
      return { ok: false, error: `${key} is required`, status: 400 };
    }
    if (v.length > MAX_FIELD_LEN) {
      return { ok: false, error: `${key} is too long`, status: 400 };
    }
    values[key] = v.trim();
  }

  if (o.buckChoice !== 'cull' && o.buckChoice !== 'reserved') {
    return { ok: false, error: 'buckChoice must be "cull" or "reserved"', status: 400 };
  }

  if (o.agreedToRelease !== true) {
    return { ok: false, error: 'agreedToRelease must be true', status: 400 };
  }

  let minorName: string | null = null;
  if (o.minorName !== undefined && o.minorName !== null) {
    if (typeof o.minorName !== 'string') {
      return { ok: false, error: 'minorName must be a string or null', status: 400 };
    }
    if (o.minorName.length > MAX_FIELD_LEN) {
      return { ok: false, error: 'minorName is too long', status: 400 };
    }
    const t = o.minorName.trim();
    minorName = t.length ? t : null;
  }

  return {
    ok: true,
    value: {
      guestSlug: values.guestSlug,
      huntLabel: values.huntLabel,
      buckChoice: o.buckChoice,
      fullName: values.fullName,
      releaseDate: values.releaseDate,
      minorName,
      address: values.address,
      phone: values.phone,
      releaseSignature: values.releaseSignature,
      agreedToRelease: true,
      medicalSignature: values.medicalSignature,
      medicalDate: values.medicalDate,
      emergencyContactName: values.emergencyContactName,
      emergencyContactPhone: values.emergencyContactPhone,
    },
  };
}

export function createHuntWaiverRecord(value: HuntWaiverRequestBody): HuntWaiverRecord {
  return {
    ...value,
    id: crypto.randomUUID(),
    submittedAt: new Date().toISOString(),
  };
}

export function buckChoiceLabel(choice: HuntBuckChoice): string {
  return choice === 'reserved' ? 'Reserved Bucks ($3,000)' : 'Cull Bucks';
}

export function buildHuntWaiverNotifyText(r: HuntWaiverRecord): string {
  const lines = [
    'Signed liability release + medical authorization received.',
    '',
    `Hunt: ${r.huntLabel}`,
    `Guest page: ${r.guestSlug}`,
    `Buck choice: ${buckChoiceLabel(r.buckChoice)}`,
    r.buckChoice === 'reserved'
      ? 'Payment: $3,000 via Venmo @cchadww — due August 1, 2026.'
      : 'Payment: none due (cull buck). Note: shooting a reserved buck costs $5,000.',
    '',
    '--- Liability Release ---',
    `Name: ${r.fullName}`,
    `Date: ${r.releaseDate}`,
    `Name of minor: ${r.minorName ?? '(none)'}`,
    `Address: ${r.address}`,
    `Phone: ${r.phone}`,
    `Signature (typed): ${r.releaseSignature}`,
    'Agreed to release: yes',
    '',
    '--- Authorization for Medical Treatment ---',
    `Signature (typed): ${r.medicalSignature}`,
    `Printed name: ${r.fullName}`,
    `Date: ${r.medicalDate}`,
    `Emergency contact: ${r.emergencyContactName} — ${r.emergencyContactPhone}`,
    '',
    `Submitted at: ${r.submittedAt}`,
    `KV key: ${HUNT_WAIVER_KV_PREFIX}${r.id}`,
  ];
  return lines.join('\n');
}

/** Returns true when the email was accepted by Resend. */
export async function sendHuntWaiverNotifyEmail(r: HuntWaiverRecord): Promise<boolean> {
  const apiKey = getServerEnv('RESEND_API_KEY');
  if (!apiKey?.trim()) {
    console.warn('[hunt-waiver] RESEND_API_KEY missing; skipping waiver notify email');
    return false;
  }
  const to = getServerEnv('HUNT_NOTIFY_EMAIL')?.trim() || 'cchadww@gmail.com';
  const fromAddress =
    getServerEnv('RESEND_FROM') ||
    (import.meta.env.DEV
      ? 'Williams Creek Whitetails <onboarding@resend.dev>'
      : 'Williams Creek Whitetails <cchadww@gmail.com>');
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject: `[Hunt] Waiver signed — ${r.fullName} — ${buckChoiceLabel(r.buckChoice)}`,
    text: buildHuntWaiverNotifyText(r),
  });
  if (error) {
    console.error('[hunt-waiver] Resend error', to, error);
    return false;
  }
  console.log('[hunt-waiver] Waiver notify sent to', to);
  return true;
}
