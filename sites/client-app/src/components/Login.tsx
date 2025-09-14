import { useState } from 'react';
import useAuth from '@minreport/core/hooks/useAuth'; // Importar useAuth desde packages/core
import { auth } from '../firebaseConfig'; // Importar auth de firebaseConfig para pasarlo al hook
import './forms.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const { login, loading } = useAuth(auth); // Pasar la instancia de auth al hook

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); // Limpiar errores previos
    try {
      await login(email, password);
      // Si el inicio de sesión es exitoso, el usuario será redirigido por el listener de auth en App.tsx
    } catch (err: any) {
      console.error('Error de inicio de sesión (client):', err.code);
      setError('Credenciales inválidas o acceso no autorizado.');
    }
  };

  return (
    <div className="form-container">
      <h2>Iniciar Sesión</h2>
      <p>Bienvenido de nuevo. Ingresa tus credenciales para acceder a tu cuenta.</p>
      
      <form onSubmit={handleSubmit} className="form-layout" autoComplete="off">
        {error && <p className="error-message">{error}</p>}
        <div className="form-group">
          <label htmlFor="email">Correo Electrónico</label>
          <input
            type="email"
            id="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="one-time-code"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Contraseña</label>
          <div className="password-input-container">
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="toggle-password-visibility"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              <span className="material-symbols-outlined">
                {showPassword ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
        </div>

        <div style={{ textAlign: 'right', marginTop: '-1rem' }}>
          <a href="#" style={{ fontSize: '0.9rem', color: 'var(--color-primary)' }}>¿Olvidaste tu contraseña?</a>
        </div>

        <button type="submit" className="button-primary" disabled={loading}>
          {loading ? 'Iniciando...' : 'Iniciar Sesión'}
        </button>
      </form>
    </div>
  );
};

export default Login;
