// sites/client-app/src/components/Input.tsx
import React from 'react';

interface InputProps {
  label: string;
  type: 'text' | 'email' | 'password';
  placeholder?: string;
}

export const Input: React.FC<InputProps> = ({ label, type, placeholder }) => {
  const inputId = `input-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} type={type} placeholder={placeholder} />
    </div>
  );
};
