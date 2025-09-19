import './firebaseConfig';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './theme.css'; // Importar theme.css aquí
import App from './App.tsx';
import { ThemeProvider } from './contexts/ThemeContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
// Test save
