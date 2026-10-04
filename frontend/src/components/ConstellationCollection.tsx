import { ArrowUpRight, Lock } from 'lucide-react'
import { isComplete, patternFor, STAR_PATTERNS } from '../constellationCollection'
import type { CollectionSnapshot, StarPattern } from '../constellationCollection'
import { GALAXIES } from '../cosmosModel'

function PatternDrawing({ pattern }: { pattern: StarPattern }) {
  return (
    <svg viewBox="-95 -80 190 160" aria-hidden="true">
      {pattern.edges.map(([a, b], index) => (
        <line
          key={index}
          x1={pattern.points[a][0] * 65}
          y1={-pattern.points[a][1] * 60}
          x2={pattern.points[b][0] * 65}
          y2={-pattern.points[b][1] * 60}
        />
      ))}
      {pattern.points.map(([x, y], index) => (
        <circle key={index} cx={x * 65} cy={-y * 60} r="2.6" />
      ))}
    </svg>
  )
}

export default function ConstellationCollection({
  collection,
  onVisit,
  storageAvailable,
}: {
  collection: CollectionSnapshot
  onVisit: (id: string) => void
  storageAvailable: boolean
}) {
  return (
    <div className="constellation-collection">
      <div className="collection-intro">
        <div>
          <h2>Your constellation collection</h2>
          <p>
            Support within a category to form a constellation. Enter its region to see it connect.
          </p>
        </div>
        <span>
          {collection.seen.length} / {STAR_PATTERNS.length} collected
        </span>
      </div>
      <div className="collection-grid">
        {STAR_PATTERNS.map((pattern) => {
          const plan = collection.plans.find((entry) => entry.patternId === pattern.id)
          const collected = collection.seen.includes(pattern.id)
          const ready = plan && isComplete(plan)
          const category = GALAXIES.find(
            (entry) => entry.id === plan?.category && entry.id !== 'unclassified',
          )?.name
          return (
            <button
              key={pattern.id}
              className={`collection-item ${collected ? 'is-collected' : ready ? 'is-ready' : 'is-locked'}`}
              disabled={!plan}
              onClick={() => onVisit(pattern.id)}
              aria-label={`${pattern.name}, ${collected ? 'collected' : ready ? 'ready to reveal' : plan ? `${plan.contributionIds.length} of ${pattern.points.length} stars` : 'locked'}`}
            >
              <div className="collection-item-top">
                <span>{pattern.points.length} stars</span>
                {collected ? <ArrowUpRight size={14} /> : !ready && <Lock size={13} />}
              </div>
              <PatternDrawing pattern={patternFor(pattern.id)} />
              <h3>{pattern.name}</h3>
              <p>{pattern.description}</p>
              <span className="collection-item-status">
                {collected
                  ? (category ?? 'Collected')
                  : ready
                    ? `Ready to reveal${category ? ` · ${category}` : ''}`
                    : plan
                      ? `${plan.contributionIds.length} / ${pattern.points.length} stars${category ? ` · ${category}` : ''}`
                      : 'Not discovered yet'}
              </span>
            </button>
          )
        })}
      </div>
      <p className="collection-footnote">
        One contribution, one star. Each star belongs to one pattern. Simplified constellation
        drawings.
      </p>
      <p className="collection-footnote">
        {storageAvailable
          ? 'Your collection is saved for this account on this device.'
          : 'Collection changes cannot be saved on this device and will reset when you leave.'}
      </p>
    </div>
  )
}
