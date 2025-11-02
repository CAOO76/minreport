import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import './forms.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged en useAuth se encargará de la redirección
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err) {
        console.error('Error de inicio de sesión (client):', err.code);
        console.error('Error de inicio de sesión (client):', err.code);
      }
      setError('Credenciales inválidas o acceso no autorizado.');
    } finally {
      setLoading(false);
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
          <a href="#" style={{ fontSize: '0.9rem', color: 'var(--color-primary)' }}>
            ¿Olvidaste tu contraseña?
          </a>
        </div>

        <button type="submit" className="button-primary" disabled={loading}>
          {loading ? 'Iniciando...' : 'Iniciar Sesión'}
        </button>
      </form>
    </div>
  );
};

export default Login;
