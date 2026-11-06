import './i18n/config';
import { useState, useEffect, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { MobileHome } from './components/MobileHome';
import { CaptureSelection } from './components/CaptureSelection';
import { usePlatform } from './hooks/usePlatform';
import { useTheme } from './hooks/useTheme';
import { MainLayout, type ViewState } from './layouts/MainLayout';
import { dataService } from './services/DataService';
import { StockList } from './components/StockList';
import { GeometrySelection } from './components/GeometrySelection';
import type { GeometryType } from './components/GeometrySelection';
import { ThemeToggle } from './components/ThemeToggle';
import { SyncIndicator } from './components/SyncIndicator';

// Carga diferida obligatoria (Capa 2 MINREPORT — LCP < 1.2s, INP < 100ms, cero bloqueo en render path)
const DesktopAnalytics = lazy(() =>
  import('./components/DesktopAnalytics').then((m) => ({ default: m.DesktopAnalytics }))
);
const MobileScanner = lazy(() =>
  import('./components/MobileScanner').then((m) => ({ default: m.MobileScanner }))
);
const VisionAnalyzer = lazy(() => import('./components/VisionAnalyzer'));
const ManualCapture = lazy(() =>
  import('./components/ManualCapture').then((m) => ({ default: m.ManualCapture }))
);
const StockpileDashboard = lazy(() =>
  import('./components/StockpileDashboard').then((m) => ({ default: m.StockpileDashboard }))
);
const StockpileRegistration = lazy(() =>
  import('./components/StockpileRegistration').then((m) => ({ default: m.StockpileRegistration }))
);
const MeasurementDetail = lazy(() =>
  import('./components/MeasurementDetail').then((m) => ({ default: m.MeasurementDetail }))
);
export const LazyStockpileSummary = lazy(() =>
  import('./components/StockpileSummary').then((m) => ({ default: m.StockpileSummary }))
);

const StockpileViewFallback = () => (
  <div className="h-full w-full min-h-[360px] flex flex-col items-center justify-center gap-[13px] p-[34px] bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] font-mono select-none">
    <span className="material-symbols-outlined text-3xl text-[#C68346] animate-spin">
      progress_activity
    </span>
    <span className="text-[11px] uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
      [Cargando vista técnica...]
    </span>
  </div>
);

export type { ViewState };

export interface StockpileAppProps {
  tenantContext?: {
    tenantId?: string;
    userId?: string;
  };
  embedded?: boolean;
  onTelemetryEvent?: (event: unknown) => void;
}

function App({ tenantContext, embedded = false, onTelemetryEvent }: StockpileAppProps = {}) {
  const { isNative } = usePlatform();
  const { isDark } = useTheme();
  const [view, setView] = useState<ViewState>(isNative ? 'home' : 'management');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [selectedGeometry, setSelectedGeometry] = useState<GeometryType>('CONO_ELIPTICO');

  // Sincronización de contexto multi-tenant con DataService (Firestore + IndexedDB + SyncQueueEngine)
  useEffect(() => {
    dataService.setTenantContext({
      tenantId: tenantContext?.tenantId || '',
      userId: tenantContext?.userId || 'operador'
    });
  }, [tenantContext?.tenantId, tenantContext?.userId]);

  // Pre-seleccionar primer activo disponible si existe para habilitar cubicación directa
  useEffect(() => {
    let active = true;
    if (!selectedAssetId) {
      dataService.getAllAssets().then((assets) => {
        if (active && assets.length > 0 && !selectedAssetId) {
          setSelectedAssetId(assets[0].id);
        }
      }).catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [selectedAssetId, view]);

  useEffect(() => {
    if (isNative) {
      setView('home');
    } else {
      setView('management');
    }
  }, [isNative]);

  // --- Handlers de Flujo ---

  const handleStartRegistration = () => setView('registration');

  const handleRegistrationSuccess = (assetId: string) => {
    setSelectedAssetId(assetId);
    setView('asset_portada');
    if (onTelemetryEvent) {
      onTelemetryEvent({
        type: 'STOCKPILE_REGISTERED',
        assetId,
        tenantId: tenantContext?.tenantId,
        timestamp: Date.now()
      });
    }
  };

  const handleAddMeasurement = () => {
    if (!selectedAssetId) {
      setView('stock_list');
      return;
    }
    setView('selection');
  };

  const handleCaptureSuccess = async (measurementId: string) => {
    if (onTelemetryEvent) {
      onTelemetryEvent({
        type: 'CUBICATION_COMPLETED',
        measurementId,
        tenantId: tenantContext?.tenantId,
        timestamp: Date.now()
      });
    }
    setView('asset_portada');
  };

  const handleAnalysisComplete = (_result: { type: string; image: string }) => {
    if (selectedAssetId) {
      setView('asset_portada');
    } else {
      setView(isNative ? 'home' : 'management');
    }
  };

  const pageVariants = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  };

  const renderOperationalView = () => {
    switch (view) {
      case 'management':
        return <DesktopAnalytics embedded={embedded} />;

      case 'home':
        return (
          <MobileHome
            onStartNewScan={handleStartRegistration}
            onViewRecords={() => setView('stock_list')}
          />
        );

      case 'registration':
        return (
          <StockpileRegistration
            onSuccess={handleRegistrationSuccess}
            onCancel={() => setView(isNative ? 'home' : 'management')}
          />
        );

      case 'stock_list':
        return (
          <StockList
            onSelectAsset={(id) => {
              setSelectedAssetId(id);
              setView('asset_portada');
            }}
            onBack={() => setView(isNative ? 'home' : 'management')}
          />
        );

      case 'asset_portada':
      case 'dashboard':
        if (!selectedAssetId) {
          return (
            <StockList
              onSelectAsset={(id) => {
                setSelectedAssetId(id);
                setView('asset_portada');
              }}
              onBack={() => setView(isNative ? 'home' : 'management')}
            />
          );
        }
        return (
          <StockpileDashboard
            assetId={selectedAssetId}
            onAddMeasurement={handleAddMeasurement}
            onSelectMeasurement={(mid) => {
              setSelectedMeasurementId(mid);
              setView('measurement_detail');
            }}
            onBack={() => setView(isNative ? 'home' : 'stock_list')}
          />
        );

      case 'selection':
        return (
          <CaptureSelection
            onSelection={(type) => {
              if (type === 'digital') setView('capture');
              else setView('geometry_selection');
            }}
            onBack={() => setView(selectedAssetId ? 'asset_portada' : (isNative ? 'home' : 'management'))}
          />
        );

      case 'geometry_selection':
        return (
          <GeometrySelection
            onSelection={(type) => {
              setSelectedGeometry(type);
              setView('manual_capture');
            }}
            onBack={() => setView('selection')}
          />
        );

      case 'capture':
        return selectedAssetId ? (
          <MobileScanner
            assetId={selectedAssetId}
            onSuccess={handleCaptureSuccess}
            onBack={() => setView('selection')}
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-[21px] bg-white dark:bg-[#000000] p-[34px]">
            <span className="material-symbols-outlined text-5xl text-[#C68346]">inventory_2</span>
            <p className="text-[#475569] dark:text-[#8A93A6] text-xs font-bold uppercase tracking-widest text-center">
              Seleccione o registre un acopio antes de iniciar la captura fotogramétrica
            </p>
            <div className="flex items-center gap-[13px]">
              <button
                type="button"
                onClick={() => setView('stock_list')}
                className="px-[21px] py-[13px] bg-[#C68346] text-white font-bold text-xs uppercase tracking-widest rounded-none shadow-none"
              >
                Seleccionar Acopio
              </button>
              <button
                type="button"
                onClick={() => setView('registration')}
                className="px-[21px] py-[13px] border border-[#E2E8F0] dark:border-[#12151C] text-[#0F172A] dark:text-[#F3F4F6] font-bold text-xs uppercase tracking-widest rounded-none shadow-none"
              >
                Registrar Nuevo
              </button>
            </div>
          </div>
        );

      case 'manual_capture':
        return selectedAssetId ? (
          <ManualCapture
            assetId={selectedAssetId}
            initialGeometry={selectedGeometry}
            onSuccess={handleCaptureSuccess}
            onBack={() => setView('geometry_selection')}
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-[21px] bg-white dark:bg-[#000000] p-[34px]">
            <span className="material-symbols-outlined text-5xl text-[#C68346]">straighten</span>
            <p className="text-[#475569] dark:text-[#8A93A6] text-xs font-bold uppercase tracking-widest text-center">
              Seleccione o registre un acopio antes de ingresar mediciones geométricas
            </p>
            <button
              type="button"
              onClick={() => setView('stock_list')}
              className="px-[21px] py-[13px] bg-[#C68346] text-white font-bold text-xs uppercase tracking-widest rounded-none shadow-none"
            >
              Seleccionar Acopio
            </button>
          </div>
        );

      case 'measurement_detail':
        return selectedMeasurementId ? (
          <MeasurementDetail
            measurementId={selectedMeasurementId}
            onBack={() => setView('asset_portada')}
          />
        ) : (
          <DesktopAnalytics embedded={embedded} />
        );

      case 'vision':
        return (
          <div className="w-full h-[calc(100vh-120px)] min-h-[520px]">
            <VisionAnalyzer onAnalysisComplete={handleAnalysisComplete} />
          </div>
        );

      default:
        return <DesktopAnalytics embedded={embedded} />;
    }
  };

  // VERSIÓN MÓVIL NATIVA
  if (isNative) {
    return (
      <div className={`relative ${embedded ? 'h-full w-full flex-1' : 'h-screen w-screen'} overflow-hidden bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="h-full w-full"
          >
            <Suspense fallback={<StockpileViewFallback />}>
              {renderOperationalView()}
            </Suspense>
          </motion.div>
        </AnimatePresence>
        {!embedded && <ThemeToggle />}
        {!embedded && <SyncIndicator />}
        <ToastContainer
          position="bottom-right"
          theme={isDark ? 'dark' : 'light'}
          toastStyle={{ borderRadius: '0', boxShadow: 'none' }}
        />
      </div>
    );
  }

  // VERSIÓN WEB / DUAL-MODE (Integrado en Host o Standalone)
  return (
    <MainLayout
      view={view}
      setView={setView}
      hasActiveStockpile={!!selectedAssetId}
      embedded={embedded}
    >
      {!embedded && <ThemeToggle />}
      {!embedded && <SyncIndicator />}
      <Suspense fallback={<StockpileViewFallback />}>
        {renderOperationalView()}
      </Suspense>
      <ToastContainer
        position="bottom-right"
        theme={isDark ? 'dark' : 'light'}
        toastStyle={{ borderRadius: '0', boxShadow: 'none' }}
      />
    </MainLayout>
  );
}

export default App;
