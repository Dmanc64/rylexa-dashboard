'use client'

import { useEffect, useRef, useCallback, useId, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface AccessibleModalProps {
  /** Controls visibility. When false, renders nothing. */
  isOpen: boolean
  /** Called when the user requests close (Escape, backdrop click, X button). */
  onClose: () => void
  /** Modal title displayed in the header. Used for aria-labelledby. */
  title: string
  /** Optional subtitle below the title. */
  subtitle?: string
  /** Max-width class: 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl'. Default: 'max-w-2xl'. */
  size?: 'max-w-md' | 'max-w-lg' | 'max-w-xl' | 'max-w-2xl'
  /** Header background color class. Default: 'bg-slate-50'. */
  headerBg?: string
  /** Close button icon color class. Default: 'text-slate-400'. */
  closeBtnColor?: string
  /** Header title text color class. Default: 'text-slate-900'. */
  headerTextColor?: string
  /** Modal body content. */
  children: ReactNode
}

/**
 * Accessible modal wrapper with:
 * - role="dialog" + aria-modal="true" + aria-labelledby
 * - Escape key to close
 * - Click-outside (backdrop) to close
 * - Focus trapping (Tab/Shift+Tab cycles within modal)
 * - Focus restoration on close
 * - Body scroll lock while open
 */
export default function AccessibleModal({
  isOpen,
  onClose,
  title,
  subtitle,
  size = 'max-w-2xl',
  headerBg = 'bg-slate-50',
  closeBtnColor = 'text-slate-400',
  headerTextColor = 'text-slate-900',
  children,
}: AccessibleModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const subtitleId = useId()

  // ── Focus Trapping ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        const first = focusableElements[0]
        const last = focusableElements[focusableElements.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }
    },
    [onClose]
  )

  // ── Focus management + scroll lock — runs ONLY when isOpen toggles.
  //    Keeping this effect independent of handleKeyDown prevents it from
  //    re-firing on every parent re-render (which would yank focus out of
  //    the currently-typed input after each keystroke).
  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'

    requestAnimationFrame(() => {
      const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      firstFocusable?.focus()
    })

    return () => {
      document.body.style.overflow = ''
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus()
      }
    }
  }, [isOpen])

  // ── Keydown listener — separate effect so swapping the handler doesn't
  //    retrigger the focus-management cleanup above.
  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    // Backdrop — click to close
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        // Only close if clicking the backdrop itself, not the modal content
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      {/* Dialog Panel */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        className={`bg-white w-full ${size} rounded-[2rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300 max-h-[90vh] flex flex-col`}
      >
        {/* Header */}
        <div className={`${headerBg} px-6 py-4 border-b border-slate-200 flex justify-between items-center shrink-0`}>
          <div>
            <h2 id={titleId} className={`text-lg font-bold ${headerTextColor}`}>
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className={`text-xs mt-0.5 ${headerTextColor === 'text-slate-900' ? 'text-slate-500' : 'text-slate-400'}`}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className={`${closeBtnColor} hover:bg-slate-200 p-2 rounded-xl transition-colors`}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
