import './forms.css';

const Login = () => {
  return (
    <div className="form-container">
      <h2>Iniciar Sesión</h2>
      <p>Bienvenido de nuevo. Ingresa tus credenciales para acceder a tu cuenta.</p>
      
      <form className="form-layout">
        <div className="form-group">
          <label htmlFor="email">Correo Electrónico</label>
          <input type="email" id="email" name="email" autoComplete="off" required />
        </div>

        <div className="form-group">
          <label htmlFor="password">Contraseña</label>
          <input type="password" id="password" name="password" autoComplete="off" required />
        </div>

        <div style={{ textAlign: 'right', marginTop: '-1rem' }}>
          <a href="#" style={{ fontSize: '0.9rem', color: 'var(--color-primary)' }}>¿Olvidaste tu contraseña?</a>
        </div>

        <button type="submit" className="button-primary">Iniciar Sesión</button>
      </form>
    </div>
  );
};

export default Login;
