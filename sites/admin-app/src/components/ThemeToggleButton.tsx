import { useTheme } from '../contexts/ThemeContext.tsx';
import './ThemeToggleButton.css';

export const ThemeToggleButton = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button onClick={toggleTheme} className="theme-toggle-button" aria-label="Cambiar tema">
      <span className="material-symbols-outlined">
        {theme === 'light' ? 'dark_mode' : 'light_mode'}
      </span>
    </button>
  );
};
