// Configuración de APIs para el entorno de desarrollo y producción

const isDevelopment = import.meta.env.MODE === 'development';

export const API_CONFIG = {
  // Firebase Functions URL base
  FUNCTIONS_BASE_URL: isDevelopment 
    ? 'http://localhost:9196/minreport-8f2a8/southamerica-west1'
    : 'https://southamerica-west1-minreport-42b14.cloudfunctions.net',
  
  // Endpoints específicos
  ENDPOINTS: {
    VALIDATE_ACTIVATION_TOKEN: '/validateActivationToken',
    SETUP_ACCOUNT_PASSWORD: '/setupAccountPassword',
    VALIDATE_DATA_TOKEN: '/validateDataToken',
    SUBMIT_COMPLETE_DATA: '/submitCompleteData',
    PROCESS_INITIAL_DECISION: '/processInitialDecisionFunction',
    PROCESS_FINAL_DECISION: '/processFinalDecisionFunction',
    REQUEST_CLARIFICATION: '/requestClarificationFunction'
  }
};

// Helper para construir URLs completas
export const getApiUrl = (endpoint: keyof typeof API_CONFIG.ENDPOINTS): string => {
  return `${API_CONFIG.FUNCTIONS_BASE_URL}${API_CONFIG.ENDPOINTS[endpoint]}`;
};

// Helper para realizar fetch con configuración consistente
export const apiCall = async (
  endpoint: keyof typeof API_CONFIG.ENDPOINTS,
  data: any,
  options: RequestInit = {}
): Promise<any> => {
  const url = getApiUrl(endpoint);
  
  const defaultOptions: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  };

  const response = await fetch(url, { ...defaultOptions, ...options });
  
  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
};