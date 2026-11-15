import i18n from '../../../i18n';
import es from './locales/es.json';
import en from './locales/en.json';
import pt from './locales/pt.json';

function registerGeolappBundles(): void {
    i18n.addResourceBundle('es', 'translation', es, true, true);
    i18n.addResourceBundle('en', 'translation', en, true, true);
    i18n.addResourceBundle('pt', 'translation', pt, true, true);
}

if (i18n.isInitialized) {
    registerGeolappBundles();
} else {
    i18n.on('initialized', registerGeolappBundles);
}

export { es, en, pt, registerGeolappBundles };
export default i18n;
