import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { StarOrigin, StarPoint } from '../cosmosEntry'
import { STAR_TRANSFER_DURATION } from '../cosmosEntry'
import '../star-transfer.css'

// Stable depth layers keep the rush continuous through React updates.
const streaks = Array.from({ length: 48 }, (_, index) => {
  const angle = index * 2.399963
  const radius = 38 + ((index * 79) % 290)
  const length = 5 + ((index * 13) % 24)
  return {
    x1: Math.cos(angle) * radius,
    y1: Math.sin(angle) * radius,
    x2: Math.cos(angle) * (radius + length),
    y2: Math.sin(angle) * (radius + length),
    opacity: 0.2 + (index % 5) * 0.1,
  }
})

export interface StarTransferState {
  id: string
  origin: StarOrigin
  sceneOffset: StarPoint
  destination: StarPoint | null
}

export default function StarTransfer({
  transfer,
  onComplete,
}: {
  transfer: StarTransferState
  onComplete: () => void
}) {
  useEffect(() => {
    if (!transfer.destination) return
    // Also finish if motion preferences change during the animation.
    const timer = setTimeout(onComplete, STAR_TRANSFER_DURATION + 150)
    return () => clearTimeout(timer)
  }, [transfer.destination, onComplete])
  const { origin, destination } = transfer
  return (
    <div
      className={`star-transfer ${destination ? 'is-flying' : 'is-waiting'}`}
      role="status"
      aria-live="polite"
      style={
        {
          '--transfer-duration': `${STAR_TRANSFER_DURATION}ms`,
          '--from-x': `${origin.x}px`,
          '--from-y': `${origin.y}px`,
          '--transfer-dx': `${(destination?.x ?? origin.x) - origin.x}px`,
          '--transfer-dy': `${(destination?.y ?? origin.y) - origin.y}px`,
          '--scene-top': `${transfer.sceneOffset.y}px`,
          '--star-color': origin.color,
        } as CSSProperties
      }
    >
      <span className="sr-only">Opening your contribution in My Cosmos.</span>
      <div className="star-transfer-rush" aria-hidden="true">
        <svg viewBox="-500 -500 1000 1000" fill="none">
          {streaks.map((streak, index) => (
            <line key={index} {...streak} />
          ))}
        </svg>
        <span className="star-transfer-glow" />
      </div>
      <i
        aria-hidden="true"
        onAnimationEnd={(event) => {
          if (event.animationName === 'star-transfer-flight') onComplete()
        }}
      />
    </div>
  )
}
