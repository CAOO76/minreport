import i18n from '../../../i18n';
import { initReactI18next } from 'react-i18next';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      resources: {
        es: { translation: es },
        en: { translation: en },
        pt: { translation: pt }
      },
      lng: 'es',
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false
      }
    });
} else {
  i18n.addResourceBundle('es', 'translation', es, true, true);
  i18n.addResourceBundle('en', 'translation', en, true, true);
  i18n.addResourceBundle('pt', 'translation', pt, true, true);
}

export default i18n;
