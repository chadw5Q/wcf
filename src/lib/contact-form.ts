import type { ContactInterest } from './contacts';

/** Same cap as the contact summary, so a long message still logs. */
const MAX_SUMMARY = 4000;

const PROJECT_LABELS: Record<string, string> = {
  'hedge-fence-posts': 'Hedge fence posts',
  'osage-orange-bow-staves': 'Osage orange bow staves',
  'something-else': 'Something else',
  'privacy-hedge': 'Privacy Hedge',
  'decorative-border': 'Decorative Border',
  windbreak: 'Windbreak',
  landscaping: 'General Landscaping',
  other: 'Other',
};

/** Readable project type for the interaction summary. Unknown values stay as typed. */
export function projectTypeLabel(projectType: string): string {
  const trimmed = projectType.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return PROJECT_LABELS[trimmed] ?? trimmed;
}

function normalizedProjectType(projectType: string): string {
  return projectType.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Map a contact-form project type onto a CRM interest.
 * An empty choice sets nothing. Leftover labels (privacy hedge, windbreak, and so on) still map.
 */
export function interestForProjectType(projectType: string): ContactInterest | null {
  const text = normalizedProjectType(projectType);
  if (!text) return null;
  if (/\bbow\s+staves?\b/.test(text) || text.includes('bowstave')) return 'bow-stave';
  if (text.includes('hedge')) return 'hedge-posts';
  return 'other';
}

/** "Message: …", with the project type on its own line when one was chosen. */
export function contactMessageSummary(projectType: string, message: string): string {
  const label = projectTypeLabel(projectType);
  const body = message.trim();
  const prefix = label ? `Project: ${label}\nMessage: ` : 'Message: ';
  const room = Math.max(0, MAX_SUMMARY - prefix.length);
  const clipped = body.length > room ? body.slice(0, room).trimEnd() : body;
  return `${prefix}${clipped}`;
}
