import { Sun, Moon } from "lucide-react";
import { useReviewStore } from "../../store/review";

export function ThemeToggle() {
  const { theme, toggleTheme } = useReviewStore();

  return (
    <button
      onClick={toggleTheme}
      className="p-1.5 rounded text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  );
}
