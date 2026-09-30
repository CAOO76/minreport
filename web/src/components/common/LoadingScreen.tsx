import React from 'react';

const LoadingScreen: React.FC = () => {
    return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#030406] text-[#F3F4F6] p-8 text-center select-none font-sans">
            <div className="relative mb-6 flex items-center justify-center">
                <img 
                    src="/favicon.svg" 
                    alt="MINREPORT" 
                    className="w-14 h-14 object-contain animate-pulse"
                />
            </div>

            <div className="flex flex-col items-center space-y-2">
                <div className="flex items-center gap-2">
                    <div className="w-4 h-[1px] bg-[#C68346] opacity-60"></div>
                    <span className="text-xs font-mono font-bold tracking-widest text-[#F3F4F6] uppercase">
                        MINREPORT
                    </span>
                    <div className="w-4 h-[1px] bg-[#C68346] opacity-60"></div>
                </div>
                <span className="text-[10px] font-mono text-[#8A93A6] tracking-wider uppercase">
                    Iniciando entorno operativo...
                </span>
            </div>
        </div>
    );
};

export default LoadingScreen;
