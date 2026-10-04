import type { Coordinates, Organization } from './types'

export function organizationRegions(organizations: Organization[]) {
  const grouped = new Map<string, Organization[]>()
  for (const organization of organizations) {
    const region = organization.location.split(',').at(-1)?.trim() || organization.location
    grouped.set(region, [...(grouped.get(region) ?? []), organization])
  }
  return [...grouped].map(([name, members]) => {
    // Circular longitude averaging also works for regions crossing the date line.
    const x = members.reduce(
      (sum, entry) => sum + Math.cos((entry.coordinates[0] * Math.PI) / 180),
      0,
    )
    const y = members.reduce(
      (sum, entry) => sum + Math.sin((entry.coordinates[0] * Math.PI) / 180),
      0,
    )
    const center: Coordinates = [
      (Math.atan2(y, x) * 180) / Math.PI,
      members.reduce((sum, entry) => sum + entry.coordinates[1], 0) / members.length,
    ]
    return { name, members, center }
  })
}
