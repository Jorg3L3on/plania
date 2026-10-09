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

// The three choices, shared by the header toggle and the phone menu.
export function ThemeChoices() {
  const { theme = "system", setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
      <DropdownMenuRadioItem value="light"><SunIcon /> Claro</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark"><MoonIcon /> Oscuro</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system"><MonitorIcon /> Sistema</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

export function ThemeToggle() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Tema">
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
