import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

/** Visual severity, matching the palettes already used on Nodes and Sessions. */
export type ConfirmTone = 'danger' | 'warning' | 'default'

export interface ConfirmOptions {
  /** Dialog heading, e.g. "Decommission VPN Node?" */
  title: React.ReactNode
  /** Sub-heading rendered under the title in the modal header */
  subtitle?: React.ReactNode
  /** Main body copy explaining the consequence of the action */
  description?: React.ReactNode
  /** Tinted callout naming the exact record being acted on */
  target?: { label: React.ReactNode; value: React.ReactNode }
  /** Extra emphasis line rendered inside a tinted warning callout */
  warning?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Icon shown in the header badge. Defaults to a triangle warning. */
  icon?: React.ReactNode
  /** Defaults to `danger`. */
  tone?: ConfirmTone
}

const toneStyles: Record<
  ConfirmTone,
  { badge: string; callout: string; confirm: string; defaultLabel: string }
> = {
  danger: {
    badge: 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400',
    callout:
      'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400',
    confirm: 'bg-red-600 hover:bg-red-700 text-white',
    defaultLabel: 'Delete',
  },
  warning: {
    badge: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
    callout:
      'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    confirm: 'bg-amber-600 hover:bg-amber-700 text-white',
    defaultLabel: 'Continue',
  },
  default: {
    badge: 'bg-primary/10 border-primary/20 text-primary',
    callout: 'border-border bg-muted/40 text-muted-foreground',
    confirm: '',
    defaultLabel: 'Confirm',
  },
}

type Resolver = (value: boolean) => void

interface ConfirmState extends ConfirmOptions {
  resolve: Resolver
}

const ConfirmContext = React.createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(
  null,
)

/**
 * Provides a promise-based replacement for the native `window.confirm()`.
 * Renders a single themed modal shared by the whole app so destructive
 * actions look consistent instead of showing the browser chrome dialog.
 */
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ConfirmState | null>(null)

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...options, resolve })
      }),
    [],
  )

  const settle = React.useCallback((result: boolean) => {
    setState((current) => {
      current?.resolve(result)
      return null
    })
  }, [])

  const handleCancel = React.useCallback(() => settle(false), [settle])
  const handleConfirm = React.useCallback(() => settle(true), [settle])

  const tone = state?.tone ?? 'danger'
  const styles = toneStyles[tone]

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={state !== null} onClose={handleCancel} className="max-w-md">
        {state && (
          <>
            <ModalHeader
              title={state.title}
              description={state.subtitle}
              onClose={handleCancel}
              icon={
                <span
                  className={`size-8 rounded-full border flex items-center justify-center shrink-0 [&_svg]:size-4 ${styles.badge}`}
                >
                  {state.icon ?? <AlertTriangle />}
                </span>
              }
            />
            <ModalBody className="space-y-3">
              {state.target && (
                <div
                  className={`rounded-xl border p-3.5 text-xs space-y-1 ${styles.callout}`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="size-4 shrink-0" />
                    {state.target.label}
                  </div>
                  <p className="font-mono break-all">{state.target.value}</p>
                </div>
              )}
              {state.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">{state.description}</p>
              )}
              {state.warning && (
                <p className="text-xs font-semibold text-red-600 dark:text-red-400 leading-relaxed">
                  {state.warning}
                </p>
              )}
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="outline" size="sm" onClick={handleCancel} className="text-xs">
                {state.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirm}
                autoFocus
                className={`text-xs shadow-xs ${styles.confirm}`}
              >
                {state.confirmLabel ?? styles.defaultLabel}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </ConfirmContext.Provider>
  )
}

/**
 * Returns an async `confirm(options)` function that resolves to `true` when the
 * user accepts. Must be used below a `ConfirmDialogProvider`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const context = React.useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmDialogProvider')
  }
  return context
}
