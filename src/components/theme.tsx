import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { load, save } from "@/lib/storage";

export type Theme = "light" | "dark" | "system";
type ThemeState = { theme: Theme; resolvedTheme: "light" | "dark"; setTheme: (t: Theme) => void };

const ThemeContext = createContext<ThemeState>({ theme: "dark", resolvedTheme: "dark", setTheme: () => {} });

/** Dark-first theme with a light option. index.html applies the stored choice before first paint. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => load<Theme>("theme", "dark"));
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#0a0a0a" : "#ffffff");
  }, [resolvedTheme]);

  const setTheme = (t: Theme) => {
    save("theme", t);
    setThemeState(t);
  };
  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react/only-export-components -- hook belongs with its provider
export const useTheme = () => useContext(ThemeContext);
