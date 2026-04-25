import { useEffect, useRef } from 'react'

/** Wires click-outside + Escape to close a popover. Returns a ref to attach
 *  to the popover container; clicks inside are ignored. */
export function usePopoverDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      const node = ref.current
      if (node && e.target instanceof Node && !node.contains(e.target)) close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}
