import i18n from '../../../i18n';
import es from './es.json';
import en from './en.json';
import pt from './pt.json';

let registered = false;

export function registerSupplyLocales(): void {
    if (registered) return;
    const applyBundles = () => {
        i18n.addResourceBundle('es', 'translation', es, true, true);
        i18n.addResourceBundle('en', 'translation', en, true, true);
        i18n.addResourceBundle('pt', 'translation', pt, true, true);
        registered = true;
    };

    if (i18n.isInitialized) {
        applyBundles();
    } else {
        i18n.on('initialized', applyBundles);
    }
}

registerSupplyLocales();

export default registerSupplyLocales;
