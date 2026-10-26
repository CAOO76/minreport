import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import * as htmlToImage from 'html-to-image';
import jsPDF from 'jspdf';

/**
 * PDF Generation & Sharing Helper
 * Utilities for capturing DOM elements as PDF and sharing/downloading via Capacitor APIs
 */

/**
 * Convert Blob to Base64 string
 */
export const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1]; // Remove data:*/*;base64, prefix
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

/**
 * Capture DOM element and convert to PDF
 * @param elementId - ID of the element to capture
 * @returns PDF blob
 */
export const generatePDFBlob = async (elementId: string): Promise<Blob> => {
    console.log('[PDF Helper] Starting Multi-page PDF generation for element:', elementId);
    const element = document.getElementById(elementId);
    if (!element) {
        throw new Error(`Element with ID "${elementId}" not found`);
    }

    // 1. Wait for images to be ready (Polling data-ready attribute)
    console.log('[PDF Helper] Waiting for images to be pre-loaded...');
    let isReady = false;
    let attempts = 0;
    while (!isReady && attempts < 50) { // Max 5 seconds (100ms * 50)
        isReady = element.getAttribute('data-ready') === 'true';
        if (!isReady) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
    }

    if (!isReady) {
        console.warn('[PDF Helper] Component not ready after timeout, capturing anyway...');
    } else {
        console.log(`[PDF Helper] Content ready after ${attempts * 100}ms`);
    }

    // Extra safety delay for rendering engine
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Force scroll and repaint to "wake up" the WebView rendering
    window.scrollTo(0, 0);
    element.scrollIntoView();

    // Ensure dimension reflow
    const width = 800; // Fixed width for A4 consistency

    try {
        // Step 1: Preliminary call to "prime" the rendering engine
        // This is a known fix for html-to-image on some mobile WebViews
        await htmlToImage.toJpeg(element, { quality: 0.1, pixelRatio: 1 });
        await new Promise(resolve => setTimeout(resolve, 300));

        // Step 2: Final high-quality capture
        console.log('[PDF Helper] Capturing element via html-to-image...');
        const dataUrl = await htmlToImage.toJpeg(element, {
            quality: 0.8,
            pixelRatio: 1, // Stay safe at 1 on mobile to avoid memory crashes
            backgroundColor: '#ffffff',
            width: width,
            style: {
                transform: 'scale(1)',
                transformOrigin: 'top left',
                display: 'flex',
                visibility: 'visible',
                opacity: '1',
            }
        });

        if (!dataUrl || dataUrl === 'data:,') {
            throw new Error('Image capture returned empty data');
        }

        // 2. Setup jsPDF
        console.log('[PDF Helper] Converting to PDF via jsPDF...');
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4',
            compress: true
        });

        const imgProps = pdf.getImageProperties(dataUrl);
        const pdfWidth = pdf.internal.pageSize.getWidth();

        // Prevent Divide by Zero
        if (imgProps.width === 0) throw new Error('Captured image width is zero');

        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        const pageHeight = pdf.internal.pageSize.getHeight();

        let heightLeft = pdfHeight;
        let position = 0;

        // 3. Add pages
        pdf.addImage(dataUrl, 'JPEG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 2) {
            position = heightLeft - pdfHeight;
            pdf.addPage();
            pdf.addImage(dataUrl, 'JPEG', 0, position, pdfWidth, pdfHeight);
            heightLeft -= pageHeight;
        }

        console.log('[PDF Helper] PDF generated successfully');
        return pdf.output('blob');
    } catch (err: any) {
        console.error('[PDF Helper] Generate ERROR:', err);
        throw new Error(`Fallo en generación: ${err.message || 'Error desconocido'}`);
    }
};

/**
 * Download PDF directly to device
 * @param elementId - ID of the element to capture
 * @param fileName - Name for the saved file (without extension)
 */
export const downloadPDF = async (elementId: string, fileName: string): Promise<void> => {
    try {
        const pdfBlob = await generatePDFBlob(elementId);

        if (Capacitor.isNativePlatform()) {
            const base64Data = await blobToBase64(pdfBlob);

            await Filesystem.writeFile({
                path: `${fileName}.pdf`,
                data: base64Data,
                directory: Directory.Documents
            });

            alert(`PDF guardado en Documents/${fileName}.pdf`);
        } else {
            // Browser Web Fallback para Desktop
            const url = window.URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${fileName}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        }
    } catch (error: any) {
        console.error('[PDF Helper] Download ERROR:', error);
        alert(`Error al descargar: ${error.message || 'Error desconocido'}`);
    }
};

/**
 * Share PDF via Android native dialog
 * @param elementId - ID of the element to capture
 * @param fileName - Name for the saved file (without extension)
 * @param title - Share dialog title
 */
export const sharePDF = async (
    elementId: string,
    fileName: string,
    title: string
): Promise<void> => {
    try {
        const pdfBlob = await generatePDFBlob(elementId);
        const base64Data = await blobToBase64(pdfBlob);

        const savedFile = await Filesystem.writeFile({
            path: `${fileName}.pdf`,
            data: base64Data,
            directory: Directory.Cache
        });

        console.log('[PDF Helper] Sharing URI:', savedFile.uri);

        await Share.share({
            title: title,
            text: `Reporte técnico - Stockpile Control`,
            url: savedFile.uri,
            dialogTitle: title
        });

    } catch (error: any) {
        console.error('[PDF Helper] Share ERROR:', error);
        // This is where "undefinded" might come from if error.message missing
        throw new Error(`Error al compartir PDF: ${error.message || error || 'Error desconocido'}`);
    }
};

/**
 * Check if Share API is available
 */
export const isShareAvailable = async (): Promise<boolean> => {
    try {
        const result = await Share.canShare();
        return result.value;
    } catch {
        return false;
    }
};
