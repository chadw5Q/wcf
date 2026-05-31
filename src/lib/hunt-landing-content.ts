/** Static copy and URLs for `/hunt` landing (Phase 3 PRD). */

export const HUNT_PODCAST_LABEL = "Jake Hofer's Land Podcast";
/** Jake Hofer — The Land Podcast (whitetail / land stewardship). */
export const HUNT_PODCAST_URL = 'https://whitetail.land/';

/** Iowa DNR — nonresident hunting application hub. */
export const IOWA_DNR_DEER_URL =
  'https://www.iowadnr.gov/things-do/hunting-trapping/hunting-licenses/nonresident-hunting-application';

export const propertyStats = [
  { value: '725 Acres', description: 'Owned & managed timber' },
  { value: '35+ Stands', description: 'Mix of hang-on, ladder, and Redneck/Banks blinds' },
  { value: 'Zone 4', description: 'Adams & Montgomery County, Iowa' },
  { value: 'Since 2020', description: 'Active habitat management' },
] as const;

export const huntPullQuote = {
  text: 'As archery hunters ourselves, we know every trail, every crossing, every stand. We hunt this property because we believe in it.',
  attribution: 'Chad & Lee Williams',
} as const;

export const huntDetailCards = [
  {
    title: 'Archery Only',
    body: 'Compound or saddle/hang-and-hunt. No gun hunts.',
  },
  {
    title: '6 Nights / 5.5 Days',
    body: 'Arrive Sunday after 2pm. Depart Saturday by noon.',
  },
  {
    title: 'No Wound Policy',
    body: "Your hunt isn't over until we tag your deer.",
  },
  {
    title: 'Flexible Buck Selection',
    body: "We protect up-and-coming bucks but have no point minimums. Shoot one you'd mount.",
  },
] as const;

/** Gallery images under `public/hunt/images/gallery/`. */
export function galleryImagePaths(): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return `/hunt/images/gallery/buck-${n}.jpg`;
  });
}

export const galleryCaption =
  '150"+ bucks harvested every season since 2021. 2025 management buck: 197 lbs field dressed.';

export const pricingRows = [
  {
    label: 'Hunt + Lodging',
    self: '$3,000/person',
    inclusive: '+$1,000 for 1 hunter. $250 for each additional hunter',
  },
  {
    label: 'Food & Cooking',
    self: 'You bring your own',
    inclusive: 'Fully provided',
  },
  {
    label: 'Doe (optional)',
    self: '+$300',
    inclusive: '+$300',
  },
  {
    label: 'Deposit to Reserve',
    self: '$500/person',
    inclusive: '$500/person',
  },
] as const;

export const pricingFootnote =
  'Iowa deer tag and license not included. Purchased separately through Iowa DNR.';

export const bookingSteps = [
  'Place $500/person deposit',
  'We confirm your week',
  'Full balance invoice sent June 1, due July 1',
  'Arrive and hunt',
] as const;
