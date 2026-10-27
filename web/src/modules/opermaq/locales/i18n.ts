import i18n from '../../../i18n';
import es from './es.json';
import en from './en.json';
import pt from './pt.json';

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
