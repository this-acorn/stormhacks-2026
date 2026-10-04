// One vocabulary for Explore filters and My Cosmos regions.
export const IMPACT_CATEGORIES = [
  { id: 'wildfire', name: 'Wildfire', description: 'Fire relief and recovery' },
  { id: 'flood', name: 'Flood', description: 'Flood relief and recovery' },
  { id: 'storm', name: 'Storm', description: 'Storm response and recovery' },
  { id: 'nature', name: 'Nature', description: 'Nature and habitat restoration' },
  { id: 'conflict', name: 'War', description: 'Civilian relief and displacement support' },
  { id: 'education', name: 'Education', description: 'Access to learning' },
  {
    id: 'domestic_violence',
    name: 'Intimate Partner Violence',
    description: 'Safety and support services',
  },
] as const
export type CurrentImpactCategory = (typeof IMPACT_CATEGORIES)[number]['id']
