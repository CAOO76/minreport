import i18n from '../../../i18n';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

if (i18n.isInitialized) {
  i18n.addResourceBundle('es', 'translation', es, true, true);
  i18n.addResourceBundle('en', 'translation', en, true, true);
  i18n.addResourceBundle('pt', 'translation', pt, true, true);
} else {
  i18n.on('initialized', () => {
    i18n.addResourceBundle('es', 'translation', es, true, true);
    i18n.addResourceBundle('en', 'translation', en, true, true);
    i18n.addResourceBundle('pt', 'translation', pt, true, true);
  });
}

export default i18n;
