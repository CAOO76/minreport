import { initializeApp } from 'firebase-admin/app';

// Inicializar Firebase Admin
initializeApp();

// Exportar las funciones
export { 
    validateEmailAndStartProcess, 
    submitCompleteData, 
    processRequestAction, 
    importEmailResult 
} from './requestManagement';