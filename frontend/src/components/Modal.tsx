import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

// Native dialog supplies focus trapping, Escape handling and background inertness.
export default function Modal({
  title,
  eyebrow,
  children,
  onClose,
}: {
  title: string
  eyebrow?: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => {
      dialog.close()
      returnFocus?.focus()
    }
  }, [returnFocus])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose()
        }
      }}
    >
      <div className="modal-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 id="modal-title">{title}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
