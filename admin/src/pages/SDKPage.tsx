import { Download, Code, Library, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const SDKPage = () => {
    const { t } = useTranslation();

    const sections = [
        {
            title: 'SDK Core',
            icon: <Library className="text-antigravity-accent" size={24} />,
            description: 'Motor de registro y gestión de ciclo de vida de plugins.',
            path: 'src/sdk/core'
        },
        {
            title: 'Data Layer',
            icon: <Layers className="text-antigravity-accent" size={24} />,
            description: 'Shared Entity Pattern para manipulación segura de Firestore.',
            path: 'src/sdk/data'
        },
        {
            title: 'UI Kit',
            icon: <Code className="text-antigravity-accent" size={24} />,
            description: 'Componentes con herencia visual estricta (Atkinson Hyperlegible).',
            path: 'src/sdk/ui'
        }
    ];

    return (
        <div className="p-8 max-w-5xl mx-auto space-y-12">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-antigravity-light-border dark:border-antigravity-dark-border pb-8">
                <div>
                    <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
                        MinReport SDK <span className="text-antigravity-accent">v1.0</span>
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
                        Cimiento oficial para el desarrollo de módulos y plugins de MinReport.
                    </p>
                </div>
                <button
                    className="flex items-center gap-2 px-6 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl hover:scale-105 transition-transform shadow-xl shadow-black/10"
                    onClick={() => alert('Generando paquete SDK... (En producción esto descargaría un .zip)')}
                >
                    <Download size={20} />
                    Descargar Source
                </button>
            </header>

            {/* Architecture Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {sections.map((section, i) => (
                    <div key={i} className="p-6 bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-3xl space-y-4">
                        <div className="w-12 h-12 bg-antigravity-accent/10 rounded-2xl flex items-center justify-center">
                            {section.icon}
                        </div>
                        <h3 className="text-xl font-bold dark:text-white">{section.title}</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                            {section.description}
                        </p>
                        <code className="block text-[10px] bg-slate-50 dark:bg-black/20 p-2 rounded-lg text-slate-400 dark:text-slate-500 font-mono">
                            {section.path}
                        </code>
                    </div>
                ))}
            </div>

            {/* Documentation Placeholder */}
            <div className="bg-antigravity-accent/5 border border-antigravity-accent/10 rounded-3xl p-10 space-y-6">
                <h2 className="text-2xl font-bold dark:text-white flex items-center gap-3">
                    <span className="material-symbols-rounded text-antigravity-accent">terminal</span>
                    Integración Rápida
                </h2>
                <div className="bg-slate-950 rounded-2xl p-6 overflow-x-auto">
                    <pre className="text-sm text-slate-300 font-mono leading-relaxed">
                        {`import { MinReport } from './sdk';

const manifest = {
  id: 'my-plugin',
  category: 'COST_OPERATIONAL',
  name: 'Analizador Geotécnico'
};

// Registro de Plugin
MinReport.Core.register(manifest, new MyPlugin());`}
                    </pre>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                    * El SDK garantiza que los datos en Firestore se guarden bajo el namespace 'extensions.my-plugin' de forma automática.
                </p>
            </div>
        </div>
    );
};
