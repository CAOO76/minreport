import React, { useState } from 'react';

/**
 * Página para solicitar acceso a la plataforma MINREPORT.
 * Contiene el formulario de solicitud inicial.
 */
const RequestAccess: React.FC = () => {
  const [formData, setFormData] = useState({
    requesterName: '',
    requesterEmail: '',
    rut: '',
    institutionName: '',
    requestType: 'B2B',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prevData => ({ ...prevData, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Formulario enviado:', formData);
    // Aquí se integrará la llamada a la Cloud Function en la Task 11
    alert('Solicitud enviada. Revisa la consola para ver los datos.');
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Solicitar Acceso a MINREPORT</h1>
      <p style={styles.subtitle}>Por favor, completa el siguiente formulario para solicitar acceso a la plataforma.</p>
      
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.formGroup}>
          <label htmlFor="requesterName" style={styles.label}>Nombre Completo:</label>
          <input
            type="text"
            id="requesterName"
            name="requesterName"
            value={formData.requesterName}
            onChange={handleChange}
            required
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label htmlFor="requesterEmail" style={styles.label}>Correo Electrónico:</label>
          <input
            type="email"
            id="requesterEmail"
            name="requesterEmail"
            value={formData.requesterEmail}
            onChange={handleChange}
            required
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label htmlFor="rut" style={styles.label}>RUT (Institución o Personal):</label>
          <input
            type="text"
            id="rut"
            name="rut"
            value={formData.rut}
            onChange={handleChange}
            required
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label htmlFor="institutionName" style={styles.label}>Nombre de la Institución:</label>
          <input
            type="text"
            id="institutionName"
            name="institutionName"
            value={formData.institutionName}
            onChange={handleChange}
            required
            style={styles.input}
          />
        </div>

        <div style={styles.formGroup}>
          <label htmlFor="requestType" style={styles.label}>Tipo de Solicitud:</label>
          <select
            id="requestType"
            name="requestType"
            value={formData.requestType}
            onChange={handleChange}
            style={styles.select}
          >
            <option value="B2B">B2B</option>
            <option value="EDUCATIONAL">Educacional</option>
          </select>
        </div>

        <button type="submit" style={styles.button}>
          Enviar Solicitud
          <span className="material-symbols-outlined" style={{ marginLeft: '8px' }}>send</span>
        </button>
      </form>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '600px',
    margin: '2rem auto',
    padding: '2rem',
    backgroundColor: 'var(--color-surface)',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    color: 'var(--color-text-primary)',
  },
  title: {
    textAlign: 'center',
    color: 'var(--color-primary)',
    marginBottom: '1rem',
  },
  subtitle: {
    textAlign: 'center',
    color: 'var(--color-text-secondary)',
    marginBottom: '2rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as 'column',
    gap: '1rem',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column' as 'column',
  },
  label: {
    marginBottom: '0.5rem',
    fontWeight: 'bold',
    color: 'var(--color-text-primary)',
  },
  input: {
    padding: '0.8rem',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-text-primary)',
    fontSize: '1rem',
  },
  select: {
    padding: '0.8rem',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    backgroundColor: 'var(--color-background)',
    color: 'var(--color-text-primary)',
    fontSize: '1rem',
  },
  button: {
    padding: '1rem 1.5rem',
    backgroundColor: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1.1rem',
    fontWeight: 'bold',
    marginTop: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'background-color 0.3s ease',
  },
};
