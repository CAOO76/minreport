import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebaseConfig';
import { ThemeToggleButton } from './ThemeToggleButton';
import './Login.css';
import './forms.css'; // Importar los estilos de formulario comunes

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); // Limpiar errores previos
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Si el inicio de sesión es exitoso, el hook useAuth manejará la redirección
    } catch (err: any) {
      console.error('Error de inicio de sesión:', err);
      setError(err.message || 'Error al iniciar sesión. Por favor, verifica tus credenciales.');
    }
  };

  return (
    <div className="form-container"> {/* Usar form-container */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>Iniciar Sesión - Panel de Administración</h2>
        <ThemeToggleButton />
      </div>
      <p>Bienvenido de nuevo. Ingresa tus credenciales para acceder a tu cuenta.</p>
      
      <form onSubmit={handleSubmit} className="form-layout"> {/* Usar form-layout */}
        {error && <p className="error-message">{error}</p>}
        <div className="form-group"> {/* Usar form-group */}
          <label htmlFor="email">Correo Electrónico:</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
          />
        </div>
        <div className="form-group"> {/* Usar form-group */}
          <label htmlFor="password">Contraseña:</label>
          <div className="password-input-container">
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="off"
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

        <button type="submit" className="button-primary icon-button">
          <span className="material-symbols-outlined">login</span> Iniciar Sesión
        </button> {/* Usar button-primary */}
      </form>
    </div>
  );
};

export default Login;
