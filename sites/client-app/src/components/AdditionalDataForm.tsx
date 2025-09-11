import './forms.css';

const AdditionalDataForm = () => {
  return (
    <div className="form-container">
      <h2>Completar Registro</h2>
      <p>Por favor, completa la información de tu institución para finalizar el proceso de registro.</p>
      
      <form className="form-layout">
        <div className="form-group">
          <label htmlFor="institutionName">Nombre de la Institución</label>
          <input type="text" id="institutionName" name="institutionName" autoComplete="off" required />
        </div>

        <div className="form-group">
          <label htmlFor="rut">RUT de la Institución</label>
          <input type="text" id="rut" name="rut" autoComplete="off" required />
        </div>

        <div className="form-group">
          <label htmlFor="address">Dirección</label>
          <input type="text" id="address" name="address" autoComplete="off" required />
        </div>

        <div className="form-group">
          <label htmlFor="city">Ciudad</label>
          <input type="text" id="city" name="city" autoComplete="off" required />
        </div>

        <div className="form-group">
          <label htmlFor="country">País</label>
          <input type="text" id="country" name="country" autoComplete="off" required />
        </div>

        <button type="submit" className="button-primary">Enviar Información</button>
      </form>
    </div>
  );
};

export default AdditionalDataForm;
