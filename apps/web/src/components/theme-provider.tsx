import { createContext, useContext, useEffect, useState } from "react"

export type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  attribute?: string
  enableSystem?: boolean
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: "dark" | "light"
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  resolvedTheme: "light",
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  attribute = "class",
  enableSystem = true,
  disableTransitionOnChange = false,
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("light")

  useEffect(() => {
    const root = window.document.documentElement

    const disableTransitions = () => {
      if (!disableTransitionOnChange) return
      const css = document.createElement("style")
      css.appendChild(
        document.createTextNode(
          `*{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}`
        )
      )
      document.head.appendChild(css)

      return () => {
        // Force restyle
        ; (() => window.getComputedStyle(document.body))()

        // Wait for next tick before removing
        setTimeout(() => {
          document.head.removeChild(css)
        }, 1)
      }
    }

    const applyTheme = (t: Theme) => {
      const cls = attribute === "class"
      if (cls) {
        root.classList.remove("light", "dark")
      } else {
        root.removeAttribute(attribute)
      }

      let activeTheme = t

      if (t === "system" && enableSystem) {
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
          .matches
          ? "dark"
          : "light"

        activeTheme = systemTheme
      }

      setResolvedTheme(activeTheme as "dark" | "light")

      if (cls) {
        root.classList.add(activeTheme)
      } else {
        root.setAttribute(attribute, activeTheme)
      }
    }

    const enableTransitions = disableTransitions()
    applyTheme(theme)
    enableTransitions?.()
  }, [theme, attribute, disableTransitionOnChange, enableSystem])

  useEffect(() => {
    if (theme !== "system" || !enableSystem) return

    const media = window.matchMedia("(prefers-color-scheme: dark)")

    const handleChange = () => {
      const root = window.document.documentElement
      const cls = attribute === "class"
      if (cls) {
        root.classList.remove("light", "dark")
        root.classList.add(media.matches ? "dark" : "light")
      } else {
        root.setAttribute(attribute, media.matches ? "dark" : "light")
      }
      setResolvedTheme(media.matches ? "dark" : "light")
    }

    media.addEventListener("change", handleChange)
    return () => media.removeEventListener("change", handleChange)
  }, [theme, attribute, enableSystem])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
    resolvedTheme,
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
