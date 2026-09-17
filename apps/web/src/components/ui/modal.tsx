import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface ModalProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  /** Extra classes for the card, e.g. max-w-lg, max-h-[85vh] flex flex-col */
  className?: string
}

/**
 * Lightweight modal matching the card style used across Users/Nodes pages:
 * a centered card with its own header/body/footer, fade+zoom entrance,
 * Escape-to-close, and click-outside-to-close.
 * Ensures the header and footer are pinned and the body scrolls cleanly
 * without getting cut off on small viewports.
 */
function Modal({ open, onClose, children, className }: ModalProps) {
  React.useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          "bg-card text-card-foreground rounded-xl border border-border shadow-2xl w-full max-w-md max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] flex flex-col my-auto animate-in fade-in zoom-in-95 duration-150 overflow-hidden",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

function ModalHeader({
  title,
  description,
  onClose,
  icon,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  onClose: () => void
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-between p-5 border-b border-border/50 shrink-0", className)}>
      <div>
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {description && (
          <p className="text-sm text-muted-foreground/70 mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="p-1 text-muted-foreground/70 hover:text-muted-foreground rounded-md shrink-0 cursor-pointer"
        aria-label="Close modal"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

function ModalBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 space-y-4 overflow-y-auto flex-1 min-h-0", className)} {...props} />
}

function ModalFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 p-5 border-t border-border/50 shrink-0",
        className
      )}
      {...props}
    />
  )
}

export { Modal, ModalHeader, ModalBody, ModalFooter }
