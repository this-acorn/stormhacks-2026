import type { HazardInfo } from '../layers'

// The card that follows the pointer over a disaster, an area or a country.
export default function HazardTooltip({
  info,
  x,
  y,
  width,
  height,
}: {
  info: HazardInfo
  x: number
  y: number
  width: number
  height: number
}) {
  const flipX = x > width - 340
  const flipY = y > height * 0.55
  return (
    <div
      className={`hazard-tooltip ${flipX ? 'flip-x' : ''} ${flipY ? 'flip-y' : ''}`}
      style={{ left: x, top: y }}
      role="status"
    >
      <span className="hazard-tooltip-eyebrow">
        {info.alert && <i className={`hazard-alert hazard-alert-${info.alert}`} aria-hidden="true" />}
        {info.eyebrow}
      </span>
      <strong className="hazard-tooltip-title">{info.title}</strong>
      {info.subtitle && <span className="hazard-tooltip-subtitle">{info.subtitle}</span>}
      {info.facts.length > 0 && (
        <dl>
          {info.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {info.note && <p>{info.note}</p>}
      <small>{info.source}</small>
    </div>
  )
}
