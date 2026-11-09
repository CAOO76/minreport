/**
 * equipmentPhotoFraming.ts
 * Motor de Auto-Encuadre Óptico 88% y Normalización 4:3 en Estudio para Fotografía Oficial de Equipos (OPERMAQ / MINREPORT).
 *
 * Integra y evoluciona los algoritmos de detección bimodal de Bounding Box y centrado perimetral al 88%
 * hacia el pipeline soberano `MINREPORT-MEDIA-DIGESTOR-CAS` (`SHA-256`, `0` EXIF/GPS, WebP HD `4:3`).
 */

export interface EquipmentBoundingBoxResult {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  hasVisiblePixels: boolean;
  isIsolatedStudioOrAlpha: boolean;
  hasTransparency: boolean;
}

export interface FramedEquipmentPhotoResult {
  framedFile: File;
  framedBlob: Blob;
  previewDataUrl: string;
  sha256: string;
  originalBytes: number;
  optimizedBytes: number;
  savingsPct: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  framingMode: 'STUDIO_88' | 'VLM_BOX_4X3' | 'CENTER_4X3';
}

export interface FrameEquipmentPhotoOptions {
  targetWidth?: number; // Por defecto 1600px (lienzo 4:3 -> 1600x1200)
  quality?: number; // Por defecto 0.88
  fillRatio?: number; // Por defecto 0.88 (6% margen simétrico por lado)
  subjectBox2d?: [number, number, number, number] | null; // [ymin, xmin, ymax, xmax] en escala 0..1000
  originalBytes?: number;
  fileName?: string;
  forceStudio88?: boolean;
}

async function computeSha256HexBrowser(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Detecta el Bounding Box real del equipo examinando tanto el canal alfa (transparencia)
 * como el contraste contra fondos blancos/claros de estudio fotográfico OEM.
 */
export function detectEquipmentSubjectBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  alphaThreshold = 15
): EquipmentBoundingBoxResult {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let perimeterPixels = 0;
  let perimeterTransparent = 0;
  let perimeterNearWhite = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        perimeterPixels++;
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        if (a <= alphaThreshold) {
          perimeterTransparent++;
        } else if (r >= 238 && g >= 238 && b >= 238) {
          perimeterNearWhite++;
        }
      }
    }
  }

  const isIsolatedStudioOrAlpha =
    perimeterPixels > 0 && (perimeterTransparent + perimeterNearWhite) / perimeterPixels >= 0.75;
  const shouldFilterWhiteStudio =
    isIsolatedStudioOrAlpha && perimeterNearWhite / Math.max(1, perimeterPixels) > 0.08;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let contentPixels = 0;
  let transparentPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (a <= alphaThreshold) {
        transparentPixels++;
        continue;
      }

      if (shouldFilterWhiteStudio && r >= 240 && g >= 240 && b >= 240) {
        continue;
      }

      contentPixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY || contentPixels < 32) {
    return {
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
      hasVisiblePixels: false,
      isIsolatedStudioOrAlpha: false,
      hasTransparency: transparentPixels > 0,
    };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    hasVisiblePixels: true,
    isIsolatedStudioOrAlpha,
    hasTransparency: transparentPixels > 0,
  };
}

/**
 * Encuadra y optimiza una fotografía de equipo hacia un lienzo canónico 4:3 (1600×1200 WebP HD),
 * aplicando centrado óptico al 88% en tomas de estudio/catálogo o encuadre guiado por VLM `box_2d`.
 */
export async function frameEquipmentPhotoToStudio4x3(
  fileOrBlob: File | Blob,
  options: FrameEquipmentPhotoOptions = {}
): Promise<FramedEquipmentPhotoResult> {
  const targetWidth = options.targetWidth ?? 1600;
  const targetHeight = Math.round((targetWidth * 3) / 4); // 4:3 estricto (1600x1200)
  const quality = options.quality ?? 0.88;
  const fillRatio = options.fillRatio ?? 0.88;
  const originalBytes = options.originalBytes ?? fileOrBlob.size;

  const objectUrl = URL.createObjectURL(fileOrBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo decodificar la imagen para encuadre óptico.'));
      el.src = objectUrl;
    });

    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;

    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = originalWidth;
    scanCanvas.height = originalHeight;
    const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
    if (!scanCtx) {
      throw new Error('No se pudo inicializar el contexto 2D de análisis óptico.');
    }

    scanCtx.clearRect(0, 0, originalWidth, originalHeight);
    scanCtx.drawImage(img, 0, 0, originalWidth, originalHeight);

    const bbox = detectEquipmentSubjectBounds(scanCtx, originalWidth, originalHeight, 15);
    scanCanvas.width = 0;
    scanCanvas.height = 0;

    const destCanvas = document.createElement('canvas');
    destCanvas.width = targetWidth;
    destCanvas.height = targetHeight;
    const destCtx = destCanvas.getContext('2d');
    if (!destCtx) {
      throw new Error('No se pudo inicializar el lienzo 4:3 de estudio.');
    }

    destCtx.imageSmoothingEnabled = true;
    destCtx.imageSmoothingQuality = 'high';

    let framingMode: FramedEquipmentPhotoResult['framingMode'] = 'CENTER_4X3';

    if (
      (bbox.isIsolatedStudioOrAlpha && bbox.hasVisiblePixels) ||
      (options.forceStudio88 && bbox.hasVisiblePixels)
    ) {
      // Modo Estudio 88%: Fondo blanco técnico #FFFFFF + sujeto aislado centrado al 88%
      framingMode = 'STUDIO_88';
      destCtx.fillStyle = '#FFFFFF';
      destCtx.fillRect(0, 0, targetWidth, targetHeight);

      let minX = bbox.minX;
      let minY = bbox.minY;
      let contentWidth = bbox.maxX - bbox.minX + 1;
      let contentHeight = bbox.maxY - bbox.minY + 1;

      if (
        !bbox.isIsolatedStudioOrAlpha &&
        options.subjectBox2d &&
        options.subjectBox2d.length === 4
      ) {
        const [ymin, xmin, ymax, xmax] = options.subjectBox2d;
        if (ymax > ymin + 50 && xmax > xmin + 50) {
          minX = Math.max(0, Math.floor((xmin / 1000) * originalWidth));
          minY = Math.max(0, Math.floor((ymin / 1000) * originalHeight));
          contentWidth = Math.min(originalWidth - minX, Math.ceil(((xmax - xmin) / 1000) * originalWidth));
          contentHeight = Math.min(originalHeight - minY, Math.ceil(((ymax - ymin) / 1000) * originalHeight));
        }
      }

      const scale = Math.min(
        (targetWidth * fillRatio) / Math.max(1, contentWidth),
        (targetHeight * fillRatio) / Math.max(1, contentHeight)
      );
      const drawWidth = Math.max(1, Math.round(contentWidth * scale));
      const drawHeight = Math.max(1, Math.round(contentHeight * scale));
      const offsetX = Math.round((targetWidth - drawWidth) / 2);
      const offsetY = Math.round((targetHeight - drawHeight) / 2);

      destCtx.drawImage(
        img,
        minX,
        minY,
        contentWidth,
        contentHeight,
        offsetX,
        offsetY,
        drawWidth,
        drawHeight
      );
    } else if (options.subjectBox2d && options.subjectBox2d.length === 4) {
      // Modo Escénico OEM Guiado por VLM: recorte 4:3 centrado en el equipo sin mutilar extremos
      const [ymin, xmin, ymax, xmax] = options.subjectBox2d;
      const boxW = ((xmax - xmin) / 1000) * originalWidth;
      const boxH = ((ymax - ymin) / 1000) * originalHeight;
      const cx = (((xmin + xmax) / 2) / 1000) * originalWidth;
      const cy = (((ymin + ymax) / 2) / 1000) * originalHeight;

      if (boxW > 64 && boxH > 64) {
        framingMode = 'VLM_BOX_4X3';
        const targetAspect = 4 / 3;
        // Garantizar que el equipo ocupe ~88% del recorte 4:3 si la foto original tiene suficiente entorno
        let cropW = Math.max(boxW / fillRatio, (boxH / fillRatio) * targetAspect);
        let cropH = cropW / targetAspect;

        if (cropW > originalWidth) {
          cropW = originalWidth;
          cropH = cropW / targetAspect;
        }
        if (cropH > originalHeight) {
          cropH = originalHeight;
          cropW = cropH * targetAspect;
        }

        const sx = Math.max(0, Math.min(originalWidth - cropW, cx - cropW / 2));
        const sy = Math.max(0, Math.min(originalHeight - cropH, cy - cropH / 2));

        destCtx.fillStyle = '#FFFFFF';
        destCtx.fillRect(0, 0, targetWidth, targetHeight);
        destCtx.drawImage(img, sx, sy, cropW, cropH, 0, 0, targetWidth, targetHeight);
      }
    }

    if (framingMode === 'CENTER_4X3') {
      // Encuadre 4:3 inteligente: si la proporción ya es cercana a 4:3 hace cover centrado; si es muy panorámica/vertical encuadra al 88% sobre estudio
      const srcAspect = originalWidth / Math.max(1, originalHeight);
      const targetAspect = 4 / 3;
      if (Math.abs(srcAspect - targetAspect) <= 0.35) {
        let cropW = originalWidth;
        let cropH = originalWidth / targetAspect;
        if (cropH > originalHeight) {
          cropH = originalHeight;
          cropW = cropH * targetAspect;
        }
        const sx = Math.max(0, (originalWidth - cropW) / 2);
        const sy = Math.max(0, (originalHeight - cropH) / 2);
        destCtx.drawImage(img, sx, sy, cropW, cropH, 0, 0, targetWidth, targetHeight);
      } else {
        destCtx.fillStyle = '#FFFFFF';
        destCtx.fillRect(0, 0, targetWidth, targetHeight);
        const scale = Math.min(
          (targetWidth * fillRatio) / originalWidth,
          (targetHeight * fillRatio) / originalHeight
        );
        const drawW = Math.max(1, Math.round(originalWidth * scale));
        const drawH = Math.max(1, Math.round(originalHeight * scale));
        const ox = Math.round((targetWidth - drawW) / 2);
        const oy = Math.round((targetHeight - drawH) / 2);
        destCtx.drawImage(img, 0, 0, originalWidth, originalHeight, ox, oy, drawW, drawH);
        framingMode = 'STUDIO_88';
      }
    }

    const previewDataUrl = destCanvas.toDataURL('image/webp', quality);
    const framedBlob = await new Promise<Blob>((resolve, reject) => {
      destCanvas.toBlob(
        (b) => {
          if (!b) return reject(new Error('Fallo al codificar Blob WebP 4:3.'));
          resolve(b);
        },
        'image/webp',
        quality
      );
    });

    destCanvas.width = 0;
    destCanvas.height = 0;

    const sha256 = await computeSha256HexBrowser(framedBlob);
    const optimizedBytes = framedBlob.size;
    const effectiveOriginal = Math.max(originalBytes, optimizedBytes);
    const savingsPct =
      effectiveOriginal > 0
        ? Math.max(0, Number((((effectiveOriginal - optimizedBytes) / effectiveOriginal) * 100).toFixed(1)))
        : 0;

    const rawName =
      options.fileName ||
      (fileOrBlob instanceof File ? fileOrBlob.name : 'official_equipment_photo.webp');
    const cleanBase = rawName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const framedFile = new File([framedBlob], `${cleanBase}_studio88.webp`, {
      type: 'image/webp',
    });

    return {
      framedFile,
      framedBlob,
      previewDataUrl,
      sha256,
      originalBytes: effectiveOriginal,
      optimizedBytes,
      savingsPct,
      width: targetWidth,
      height: targetHeight,
      originalWidth,
      originalHeight,
      framingMode,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Re-encuadra al 88% una fotografía de equipo ya existente a partir de su URL.
 */
export async function reframeExistingEquipmentPhotoUrl(
  imageUrl: string,
  options: FrameEquipmentPhotoOptions = {}
): Promise<FramedEquipmentPhotoResult> {
  const response = await fetch(imageUrl, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen actual (${response.status}).`);
  }
  const blob = await response.blob();
  return frameEquipmentPhotoToStudio4x3(blob, {
    ...options,
    originalBytes: options.originalBytes ?? blob.size,
    forceStudio88: true,
  });
}

