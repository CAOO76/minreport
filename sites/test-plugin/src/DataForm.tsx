import React, { useState } from 'react';
import * as sdk from '@minreport/sdk';
import './DataForm.css';

export const DataForm: React.FC = () => {
  const [textData, setTextData] = useState('');
  const [status, setStatus] = useState('idle'); // idle | saving | success | error
  const [feedback, setFeedback] = useState('');

  const handleSave = async () => {
    if (!textData) {
      setFeedback('Please enter some data.');
      return;
    }

    setStatus('saving');
    setFeedback('Saving data...');

    try {
      const result = await sdk.savePluginData({ content: textData });
      setStatus('success');
      setFeedback(result.message);
      console.log('[Plugin] Save successful:', result);
    } catch (error: any) {
      setStatus('error');
      setFeedback(error.message);
      console.error('[Plugin] Save failed:', error);
    }
  };

  return (
    <div className="data-form-container">
      <h3>Guardar Datos a través del SDK</h3>
      <div className="form-group">
        <label htmlFor="data-input">Dato de ejemplo:</label>
        <input
          id="data-input"
          type="text"
          value={textData}
          onChange={(e) => setTextData(e.target.value)}
          placeholder="Escribe algo..."
        />
      </div>
      <button className="save-button" onClick={handleSave} disabled={status === 'saving'}>
        {status === 'saving' ? 'Guardando...' : 'Guardar en MINREPORT'}
      </button>
      {feedback && <p>Estado: {feedback}</p>}
    </div>
  );
};
