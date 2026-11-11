/** Static copy and URLs for `/hunt` landing (Phase 3 PRD). */

export const HUNT_PODCAST_LABEL = "Jake Hofer's Land Podcast";
/** Jake Hofer — The Land Podcast (whitetail / land stewardship). */
export const HUNT_PODCAST_URL = 'https://whitetail.land/';

/** Iowa DNR — nonresident hunting application hub. */
export const IOWA_DNR_DEER_URL =
  'https://www.iowadnr.gov/things-do/hunting-trapping/hunting-licenses/nonresident-hunting-application';

export const propertyStats = [
  { value: '725 Acres', description: 'Timber, crop and CRP. Managed for whitetails.' },
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

export type HuntPhoto = {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
};

function trailCam(year: number, n: number, width: number, height: number, scene: string): HuntPhoto {
  return {
    src: `/hunt/images/seasons/${year}-${n}.webp`,
    width,
    height,
    alt: `${year} trail camera photo: ${scene}`,
  };
}

/** Trail camera bucks grouped by season, newest first (`public/hunt/images/seasons/`). */
export const buckSeasons: readonly { year: number; photos: readonly HuntPhoto[] }[] = [
  {
    year: 2026,
    photos: [
      trailCam(2026, 1, 640, 478, 'mature buck facing the camera at night'),
      trailCam(2026, 2, 960, 536, 'wide-racked buck walking at night'),
      trailCam(2026, 3, 960, 536, 'buck standing in summer grass'),
      trailCam(2026, 4, 715, 536, 'heavy-racked buck passing a waterhole at night'),
    ],
  },
  {
    year: 2025,
    photos: [
      trailCam(2025, 1, 960, 536, 'buck crossing a green field'),
      trailCam(2025, 2, 1280, 960, 'buck on a timber trail in late fall'),
      trailCam(2025, 3, 1280, 960, 'buck in the snow in the timber'),
      trailCam(2025, 4, 1280, 960, 'buck walking at night'),
    ],
  },
  {
    year: 2024,
    photos: [
      trailCam(2024, 1, 644, 478, 'buck in golden evening light'),
      trailCam(2024, 2, 644, 478, 'buck on an open hillside'),
      trailCam(2024, 3, 644, 478, 'heavy-racked buck feeding at night'),
      trailCam(2024, 4, 644, 478, 'buck walking through a meadow'),
    ],
  },
  {
    year: 2023,
    photos: [
      trailCam(2023, 1, 960, 536, 'wide-racked buck walking at night'),
      trailCam(2023, 2, 644, 478, 'buck crossing a snowy pond dam in late season'),
      trailCam(2023, 3, 644, 478, 'buck standing in deep snow at the timber edge'),
      trailCam(2023, 4, 644, 478, 'buck walking through fresh snow'),
    ],
  },
  {
    year: 2022,
    photos: [
      trailCam(2022, 1, 644, 478, 'tall-tined buck facing the camera at night'),
      trailCam(2022, 2, 644, 478, 'buck facing the camera at night'),
      trailCam(2022, 3, 644, 478, 'buck in profile at night'),
      trailCam(2022, 4, 644, 478, 'buck standing in a meadow'),
    ],
  },
];

export const galleryCaption =
  '150"+ bucks harvested every season since 2021. 2025 management buck: 197 lbs field dressed.';

const harvestDims: readonly [number, number][] = [
  [825, 1100],
  [1600, 1200],
  [1100, 733],
  [1600, 1200],
  [805, 1100],
  [1600, 1067],
  [825, 1100],
  [825, 1100],
  [1100, 1086],
  [825, 1100],
  [825, 1100],
];

/** Shown as a fixed top row, in this order (1-based file numbers). */
const featuredHarvestNumbers = [6, 4, 2];

const allHarvestPhotos: readonly HuntPhoto[] = harvestDims.map(([width, height], i) => ({
  src: `/hunt/images/harvests/harvest-${String(i + 1).padStart(2, '0')}.webp`,
  width,
  height,
  alt: 'Hunter with a buck harvested at Williams Creek Farms',
}));

/** Hunters with harvested bucks (`public/hunt/images/harvests/`). */
export const featuredHarvestPhotos: readonly HuntPhoto[] = featuredHarvestNumbers.map(
  (n) => allHarvestPhotos[n - 1],
);

export const harvestPhotos: readonly HuntPhoto[] = allHarvestPhotos.filter(
  (_, i) => !featuredHarvestNumbers.includes(i + 1),
);

/** Habitat work (`public/hunt/images/habitat/`). */
export const habitatPhotos: readonly HuntPhoto[] = [
  {
    src: '/hunt/images/habitat/burn.webp',
    width: 1100,
    height: 825,
    alt: 'Prescribed burn moving through native grass',
    caption: 'Prescribed burns',
  },
  {
    src: '/hunt/images/habitat/water-hole-before-after.webp',
    width: 1100,
    height: 782,
    alt: 'Before and after: a freshly dug water hole, then the same hole holding water',
  },
  {
    src: '/hunt/images/habitat/food-plot.webp',
    width: 825,
    height: 1100,
    alt: 'Soybean food plot bordered by timber',
    caption: 'Food plots',
  },
  {
    src: '/hunt/images/habitat/water-hole-dig.webp',
    width: 1100,
    height: 825,
    alt: 'Skid steer digging out a water hole',
    caption: 'Dirt work',
  },
  {
    src: '/hunt/images/habitat/brush-burn.webp',
    width: 1100,
    height: 825,
    alt: 'Burning cleared brush piles',
    caption: 'Timber stand improvement',
  },
  {
    src: '/hunt/images/habitat/bedding-cover.webp',
    width: 825,
    height: 1100,
    alt: 'Thick shrub and grass bedding cover',
    caption: 'Bedding cover',
  },
];

/** Lodge photos (`public/hunt/images/lodge/`). */
export const lodgePhotos: readonly HuntPhoto[] = [
  {
    src: '/hunt/images/lodge/great-room.webp',
    width: 1920,
    height: 881,
    alt: 'Lodge great room with kitchen, dining table, and couches',
  },
  {
    src: '/hunt/images/lodge/interior.webp',
    width: 1050,
    height: 1400,
    alt: 'Lodge interior with turkey and bobcat mounts',
  },
  {
    src: '/hunt/images/lodge/mount.webp',
    width: 900,
    height: 1200,
    alt: 'Whitetail shoulder mount on the lodge wall',
  },
];

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
  'Let Chad know when you receive your tags for the year',
  'Full balance invoice sent June 1, due July 1',
  'Arrive and hunt',
] as const;
