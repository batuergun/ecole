import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sun, Moon } from "lucide-react";

const titleMap: Record<string, string> = {
  "/": "",
  "/projects/new": "New Model",
  "/jobs": "Jobs",
  "/settings": "Settings",
};

export function Header() {
  const location = useLocation();
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ecole-theme", dark ? "dark" : "light");
  }, [dark]);

  // Initialize from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("ecole-theme");
    if (saved === "dark") {
      setDark(true);
    } else if (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setDark(true);
    }
  }, []);

  const title =
    titleMap[location.pathname] ||
    (location.pathname.startsWith("/projects/") ? "Project" : "");

  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-6">
      <h1 className="text-sm font-mono font-medium text-foreground tracking-wide">
        {title}
      </h1>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDark(!dark)}
        className="h-8 w-8 p-0"
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </header>
  );
}
