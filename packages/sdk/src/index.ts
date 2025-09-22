/**
 * @minreport/sdk
 * This SDK provides a secure communication channel for plugins to interact with the MINREPORT Core.
 * It abstracts away the complexity of postMessage communication.
 */

// --- Interfaces and Types ---

export interface MinreportUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface MinreportSession {
  user: MinreportUser;
  claims: { [key: string]: any };
  idToken: string;
  theme: { [key: string]: string };
}

type ResolveFunction = (value: any) => void;
type RejectFunction = (reason?: any) => void;

// --- Internal State ---

let coreOrigin: string | null = null;
let minreportSession: MinreportSession | null = null;
const pendingPromises = new Map<string, { resolve: ResolveFunction; reject: RejectFunction }>();

// --- Private Functions ---

/**
 * Applies the theme variables received from the Core to the plugin's root element.
 */
const applyTheme = (theme: { [key: string]: string }) => {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    root.style.setProperty(key, value);
  }
  console.log('[SDK] Theme applied.');
};

/**
 * Handles incoming messages from the MINREPORT Core.
 */
const handleCoreMessage = (event: MessageEvent) => {
  if (event.source !== window.parent) return; // Only accept messages from the parent window
  if (event.origin !== coreOrigin) {
    console.warn(`[SDK] Ignored message from unexpected origin: ${event.origin}`);
    return;
  }

  const { type, payload } = event.data;

  if (type === 'MINREPORT_RESPONSE' && payload.correlationId) {
    const promise = pendingPromises.get(payload.correlationId);
    if (promise) {
      if (payload.error) {
        promise.reject(new Error(payload.error));
      } else {
        promise.resolve(payload.result);
      }
      pendingPromises.delete(payload.correlationId);
    }
  }
};

// --- Public API ---

/**
 * Initializes the SDK. This must be the first function called by the plugin.
 * It establishes a secure listener and waits for the session context from the Core.
 * @param allowedCoreOrigins An array of trusted origins for the MINREPORT Core application.
 * @returns A promise that resolves with the initial session information.
 */
export const init = (allowedCoreOrigins: string[]): Promise<MinreportSession> => {
  return new Promise((resolve, reject) => {
    const handleInit = (event: MessageEvent) => {
      if (!allowedCoreOrigins.includes(event.origin)) return;

      if (event.data?.type === 'MINREPORT_INIT') {
        console.log('[SDK] MINREPORT_INIT received from Core.');
        coreOrigin = event.origin;
        minreportSession = event.data.payload;

        if (!minreportSession?.idToken) {
          return reject(new Error('Initialization failed: No idToken received from Core.'));
        }

        applyTheme(minreportSession.theme);

        // Setup the permanent listener for responses
        window.addEventListener('message', handleCoreMessage);

        // Clean up the init listener
        window.removeEventListener('message', handleInit);

        resolve(minreportSession);
      }
    };

    window.addEventListener('message', handleInit);
    console.log('[SDK] Initialized and waiting for MINREPORT_INIT from Core...');
  });
};

/**
 * Sends an action to the MINREPORT Core and returns a promise that resolves with the result.
 * @param action The name of the action to execute (e.g., 'savePluginData').
 * @param data The payload for the action.
 * @returns A promise with the result from the Core.
 */
const sendAction = <T = any>(action: string, data: any): Promise<T> => {
  if (!coreOrigin || !window.parent) {
    return Promise.reject(new Error('SDK not initialized. Please call init() first.'));
  }

  return new Promise((resolve, reject) => {
    const correlationId = `${action}-${Date.now()}-${Math.random()}`;
    pendingPromises.set(correlationId, { resolve, reject });

    window.parent.postMessage(
      {
        type: 'MINREPORT_ACTION',
        payload: { action, data, correlationId },
      },
      coreOrigin
    );

    // Timeout to prevent memory leaks
    setTimeout(() => {
      if (pendingPromises.has(correlationId)) {
        pendingPromises.delete(correlationId);
        reject(new Error(`Action '${action}' timed out.`));
      }
    }, 30000); // 30-second timeout
  });
};

// --- Exported SDK Functions ---

/**
 * Retrieves the current session information after initialization.
 * @returns The MinreportSession object or null if not initialized.
 */
export const getSession = (): MinreportSession | null => {
  return minreportSession;
};

/**
 * Example function to save data via the Core.
 * @param pluginData The data to save.
 * @returns A promise that resolves with the result of the save operation.
 */
export const savePluginData = (pluginData: any): Promise<{ success: boolean; message: string }> => {
  return sendAction('savePluginData', pluginData);
};
