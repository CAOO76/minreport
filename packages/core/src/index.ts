import admin from "firebase-admin";

let db: admin.firestore.Firestore; // Declare db, but initialize lazily

// Function to get Firestore instance, ensuring it's initialized only once
const getFirestoreInstance = () => {
  if (!admin.apps.length) { // Check if app is already initialized
    admin.initializeApp();
  }
  if (!db) {
    db = admin.firestore();
  }
  return db;
};

/**
 * Valida un RUT chileno usando el algoritmo de Módulo 11.
 * @param rutCompleto El RUT en formato string, con o sin puntos y guion.
 * @returns `true` si el RUT es válido, `false` en caso contrario.
 */
const validateRut = (rutCompleto: string): boolean => {
  if (!rutCompleto) return false;

  // Limpia el RUT de puntos y guion
  const rutLimpio = rutCompleto.replace(/[.-]/g, "");

  // Valida el formato básico (números y un dígito verificador)
  if (!/^[0-9]+[0-9kK]{1}$/.test(rutLimpio)) {
    return false;
  }

  const cuerpo = rutLimpio.slice(0, -1);
  const dv = rutLimpio.slice(-1).toUpperCase();

  let suma = 0;
  let multiplo = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo.charAt(i), 10) * multiplo;
    multiplo = multiplo < 7 ? multiplo + 1 : 2;
  }

  const dvEsperado = 11 - (suma % 11);
  const dvCalculado = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : String(dvEsperado);

  return dvCalculado === dv;
};


/**
 * Función para manejar la solicitud inicial de acceso a MINREPORT.
 * Recibe los datos del formulario, valida y crea un documento en la colección 'requests'.
 */
export const requestInitialRegistration = async (data: any) => {
  const firestore = getFirestoreInstance(); // Get Firestore instance
  // 1. Validar que los datos requeridos estén presentes
  const { requesterName, requesterEmail, rut, institutionName, requestType } = data;

  if (!requesterName || !requesterEmail || !rut || !institutionName || !requestType) {
    throw { code: "invalid-argument", message: "Todos los campos son obligatorios." };
  }

  // Validar formato de email básico
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(requesterEmail)) { // Corrected regex
    throw { code: "invalid-argument", message: "Formato de correo electrónico inválido." };
  }

  // Validar RUT/RUN chileno
  if (!validateRut(rut)) {
      throw { code: "invalid-argument", message: "El RUT o RUN ingresado no es válido." };
  }

  // Validar tipo de solicitud
  if (requestType !== 'B2B' && requestType !== 'EDUCATIONAL') {
    throw { code: "invalid-argument", message: "Tipo de solicitud inválido." };
  }

  // 2. Verificar si ya existe una cuenta activa con este RUT
  const existingAccountSnapshot = await firestore.collection('accounts')
    .where('rut', '==', rut)
    .where('status', '==', 'active')
    .get();

  if (!existingAccountSnapshot.empty) {
    throw { code: "already-exists", message: "Ya existe una cuenta activa asociada a este RUT." };
  }

  // 3. Verificar si ya existe una solicitud pendiente o en proceso para este RUT
  const existingPendingRequestSnapshot = await firestore.collection('requests')
    .where('rut', '==', rut)
    .where('status', 'in', ['pending_review', 'pending_additional_data'])
    .get();

  if (!existingPendingRequestSnapshot.empty) {
    throw { code: "already-exists", message: "Ya existe una solicitud pendiente o en proceso para este RUT." };
  }

  // 4. Crear el nuevo documento de solicitud en Firestore
  const newRequestRef = await firestore.collection('requests').add({
    requesterName,
    requesterEmail,
    rut,
    institutionName,
    requestType,
    status: 'pending_review',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: "Solicitud enviada con éxito.", requestId: newRequestRef.id };
};
