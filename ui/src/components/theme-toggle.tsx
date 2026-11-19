import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { words } from "@/lib/i18n";
import { SHELL } from "@/lib/shell-words";

// The three choices, shared by the header toggle and the phone menu.
export function ThemeChoices() {
  const { theme = "system", setTheme } = useTheme();
  const w = words(SHELL);
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
      <DropdownMenuRadioItem value="light"><SunIcon /> {w.themeLight}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark"><MoonIcon /> {w.themeDark}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system"><MonitorIcon /> {w.themeSystem}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

export function ThemeToggle() {
  const w = words(SHELL);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={w.theme}>
          <SunIcon className="dark:hidden" />
          <MoonIcon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ThemeChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The browser chrome (status bar, Android task switcher) takes its colour from theme-color.
// Follow the app's own choice, not only the system's, so a manual Claro/Oscuro matches.
const THEME_COLORS = { light: "#f3f5f9", dark: "#0f1118" } as const;

export function ThemeColor() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = THEME_COLORS[resolvedTheme];
    }
  }, [resolvedTheme]);
  return null;
}
