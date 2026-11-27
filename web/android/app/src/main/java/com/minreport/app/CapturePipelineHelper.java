package com.minreport.app;

import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Pure-Java, unit-testable capture pipeline helpers for MINREPORT · ACOPIOS:
 * - Fast row-block YUV_420_888 -> NV21 conversion with MediaTek off-by-1 UV limit guards
 * - L1-cache Laplacian sharpness variance and 2x2 box downscale directly from NV21 Y-plane
 * - GLES glReadPixels RGBA -> NV21 conversion with OpenGL vertical flip
 * - Safe camera intrinsics scaling & synthetic fallback
 * - Atomic Best-of-Burst state machine with anti-deadlock timeout commit & GL fallback escalation
 * - Live visual 3D point cloud extraction (conf >= 0.1f, capped <= 1024 points)
 */
public final class CapturePipelineHelper {

    public static final long BURST_WINDOW_MS = 220L;
    public static final double BLUR_VARIANCE_THRESHOLD = 8.0;
    public static final double BLUR_EARLY_COMMIT_THRESHOLD = BLUR_VARIANCE_THRESHOLD * 2.2; // 17.6
    public static final double BLUR_LOW_THRESHOLD = 4.0;
    public static final int GL_FALLBACK_FAILURE_THRESHOLD = 5;
    public static final long GL_FALLBACK_GRACE_MS = 280L;
    public static final long DIAG_DISPLAY_DELAY_MS = 1000L;

    public static final String DIAG_NYA = "IMG · NYA";
    public static final String DIAG_ERR = "IMG · ERR";
    public static final String DIAG_FMT = "IMG · FMT";
    public static final String DIAG_INT = "IMG · INT";
    public static final String DIAG_GYR = "IMG · GYR";
    public static final String DIAG_GLF = "IMG · GLF";

    private CapturePipelineHelper() {}

    /**
     * Computes adaptive keyframe step Δd = clamp(0.14 * R_est, minStepM, maxStepM)
     * from a 3D camera position (x, y, z) and a 2D horizontal center (cx, cz).
     * Strictly indexes autoCenterXZ[1] for Z and guards against null, short, or non-finite inputs.
     */
    public static float computeAdaptiveKeyframeStepM(
        final float[] camPos,
        final float[] autoCenterXZ,
        final float minStepM,
        final float maxStepM
    ) {
        if (
            camPos == null || camPos.length < 3 ||
            autoCenterXZ == null || autoCenterXZ.length < 2 ||
            !Float.isFinite(camPos[0]) || !Float.isFinite(camPos[2]) ||
            !Float.isFinite(autoCenterXZ[0]) || !Float.isFinite(autoCenterXZ[1])
        ) {
            return minStepM;
        }
        final float rEst = Math.max(
            1.5f,
            (float) Math.hypot(camPos[0] - autoCenterXZ[0], camPos[2] - autoCenterXZ[1])
        );
        if (!Float.isFinite(rEst)) {
            return minStepM;
        }
        return Math.max(minStepM, Math.min(maxStepM, 0.14f * rEst));
    }

    /**
     * Converts YUV_420_888 plane ByteBuffers into packed NV21 (Y followed by interleaved VU).
     * Assumes yPixelStride == 1 (standard Android camera Y plane).
     */
    public static byte[] extractNv21FromPlanes(
        final ByteBuffer yBuf,
        final int yRowStride,
        final ByteBuffer uBuf,
        final int uRowStride,
        final int uPixelStride,
        final ByteBuffer vBuf,
        final int vRowStride,
        final int vPixelStride,
        final int width,
        final int height
    ) {
        return extractNv21FromPlanes(
            yBuf,
            yRowStride,
            1,
            uBuf,
            uRowStride,
            uPixelStride,
            vBuf,
            vRowStride,
            vPixelStride,
            width,
            height
        );
    }

    /**
     * Converts YUV_420_888 plane ByteBuffers into packed NV21 using bulk row reads (eliminating
     * 300k-1M per-byte DirectByteBuffer.get(int) calls on GLThread) with strict limit() guards
     * immune to MediaTek Dimensity off-by-1 UV buffer truncation.
     */
    public static byte[] extractNv21FromPlanes(
        final ByteBuffer yBuf,
        final int yRowStride,
        final int yPixelStride,
        final ByteBuffer uBuf,
        final int uRowStride,
        final int uPixelStride,
        final ByteBuffer vBuf,
        final int vRowStride,
        final int vPixelStride,
        final int width,
        final int height
    ) {
        if (width <= 0 || height <= 0 || yBuf == null || uBuf == null || vBuf == null) {
            return new byte[0];
        }
        final int ySize = width * height;
        final int chromaWidth = width / 2;
        final int chromaHeight = height / 2;
        final int nv21Size = ySize + (chromaWidth * chromaHeight * 2);
        final byte[] nv21 = new byte[nv21Size];

        // 1. Copy Y plane in bulk
        final ByteBuffer yDup = yBuf.duplicate();
        final int yLimit = yDup.limit();
        final int safeYPixelStride = Math.max(1, yPixelStride);
        if (safeYPixelStride == 1 && yRowStride == width) {
            yDup.position(0);
            final int copyLen = Math.min(ySize, yLimit);
            if (copyLen > 0) {
                yDup.get(nv21, 0, copyLen);
            }
        } else if (safeYPixelStride == 1) {
            for (int row = 0; row < height; row++) {
                final int rowOffset = row * yRowStride;
                if (rowOffset >= yLimit) {
                    break;
                }
                final int len = Math.min(width, yLimit - rowOffset);
                if (len <= 0) {
                    break;
                }
                yDup.position(rowOffset);
                yDup.get(nv21, row * width, len);
            }
        } else {
            final int yRowNeed = (width - 1) * safeYPixelStride + 1;
            final byte[] yRowBuf = new byte[Math.max(1, yRowNeed)];
            int dst = 0;
            for (int row = 0; row < height; row++) {
                final int rowOffset = row * yRowStride;
                if (rowOffset >= yLimit) {
                    break;
                }
                final int len = Math.min(yRowNeed, yLimit - rowOffset);
                yDup.position(rowOffset);
                yDup.get(yRowBuf, 0, len);
                for (int col = 0; col < width && dst < ySize; col++) {
                    final int idx = col * safeYPixelStride;
                    nv21[dst++] = idx < len ? yRowBuf[idx] : 0;
                }
            }
        }

        if (chromaWidth <= 0 || chromaHeight <= 0) {
            return nv21;
        }

        // 2. Copy UV planes into NV21 interleaved VU order
        final ByteBuffer uDup = uBuf.duplicate();
        final ByteBuffer vDup = vBuf.duplicate();
        final int uLimit = uDup.limit();
        final int vLimit = vDup.limit();
        final int safeUPixelStride = Math.max(1, uPixelStride);
        final int safeVPixelStride = Math.max(1, vPixelStride);
        final int chromaRowBytes = chromaWidth * 2;

        // Provably adjacent NV21 heap-buffer fast-path (vBuf starts 1 byte before uBuf in same array)
        final boolean provablyAdjacentNv21Heap =
            safeVPixelStride == 2 &&
            safeUPixelStride == 2 &&
            vRowStride == uRowStride &&
            vRowStride >= chromaRowBytes &&
            vDup.hasArray() &&
            uDup.hasArray() &&
            vDup.array() == uDup.array() &&
            (vDup.arrayOffset() + 1 == uDup.arrayOffset());

        int pos = ySize;
        if (provablyAdjacentNv21Heap) {
            final byte[] backing = vDup.array();
            final int vBase = vDup.arrayOffset();
            final int uBase = uDup.arrayOffset();
            for (int row = 0; row < chromaHeight && pos + chromaRowBytes <= nv21Size; row++) {
                final int vRowOff = row * vRowStride;
                final int uRowOff = row * uRowStride;
                if (vRowOff >= vLimit && uRowOff >= uLimit) {
                    fillNeutralChroma(nv21, pos, chromaRowBytes);
                    pos += chromaRowBytes;
                    continue;
                }
                final int vAvail = Math.max(0, Math.min(chromaRowBytes, vLimit - vRowOff));
                if (vAvail == chromaRowBytes) {
                    System.arraycopy(backing, vBase + vRowOff, nv21, pos, chromaRowBytes);
                    pos += chromaRowBytes;
                } else {
                    // MediaTek off-by-1 last row: vAvail == chromaRowBytes - 1, final U byte lives in uBuf
                    if (vAvail > 0) {
                        System.arraycopy(backing, vBase + vRowOff, nv21, pos, vAvail);
                    }
                    for (int k = vAvail; k < chromaRowBytes; k++) {
                        if ((k & 1) == 1) {
                            final int uIdx = uRowOff + (k - 1);
                            nv21[pos + k] = (uIdx >= 0 && uIdx < uLimit) ? backing[uBase + uIdx] : (byte) 128;
                        } else {
                            nv21[pos + k] = (byte) 128;
                        }
                    }
                    pos += chromaRowBytes;
                }
            }
            return nv21;
        }

        // General high-speed row-block copy (2*chromaHeight bulk reads instead of 300k-1M byte JNI calls)
        // Exact required bytes per row avoids MediaTek off-by-1 BufferUnderflowException on the final row.
        final int vRowNeed = (chromaWidth - 1) * safeVPixelStride + 1;
        final int uRowNeed = (chromaWidth - 1) * safeUPixelStride + 1;
        final byte[] vRowBuf = new byte[Math.max(1, vRowNeed)];
        final byte[] uRowBuf = new byte[Math.max(1, uRowNeed)];

        for (int row = 0; row < chromaHeight && pos + 1 < nv21Size; row++) {
            final int vRowOffset = row * vRowStride;
            final int uRowOffset = row * uRowStride;
            final int vLen = vRowOffset < vLimit ? Math.min(vRowNeed, vLimit - vRowOffset) : 0;
            final int uLen = uRowOffset < uLimit ? Math.min(uRowNeed, uLimit - uRowOffset) : 0;

            if (vLen > 0) {
                vDup.position(vRowOffset);
                vDup.get(vRowBuf, 0, vLen);
            }
            if (uLen > 0) {
                uDup.position(uRowOffset);
                uDup.get(uRowBuf, 0, uLen);
            }

            if (safeVPixelStride == 2 && safeUPixelStride == 2) {
                for (int col = 0, idx = 0; col < chromaWidth && pos + 1 < nv21Size; col++, idx += 2) {
                    nv21[pos++] = idx < vLen ? vRowBuf[idx] : (byte) 128;
                    nv21[pos++] = idx < uLen ? uRowBuf[idx] : (byte) 128;
                }
            } else if (safeVPixelStride == 1 && safeUPixelStride == 1) {
                for (int col = 0; col < chromaWidth && pos + 1 < nv21Size; col++) {
                    nv21[pos++] = col < vLen ? vRowBuf[col] : (byte) 128;
                    nv21[pos++] = col < uLen ? uRowBuf[col] : (byte) 128;
                }
            } else {
                for (int col = 0; col < chromaWidth && pos + 1 < nv21Size; col++) {
                    final int vIdx = col * safeVPixelStride;
                    final int uIdx = col * safeUPixelStride;
                    nv21[pos++] = vIdx < vLen ? vRowBuf[vIdx] : (byte) 128;
                    nv21[pos++] = uIdx < uLen ? uRowBuf[uIdx] : (byte) 128;
                }
            }
        }
        return nv21;
    }

    private static void fillNeutralChroma(final byte[] dst, final int offset, final int len) {
        final int end = Math.min(dst.length, offset + len);
        for (int i = offset; i < end; i++) {
            dst[i] = (byte) 128;
        }
    }

    /**
     * Laplacian sharpness variance on central ROI (20%..80%) with step=2, operating directly on
     * the already-copied NV21 Y-plane in L1 cache (< 0.3 ms, zero DirectByteBuffer accesses).
     */
    public static double computeLaplacianVarianceFromY(
        final byte[] nv21,
        final int width,
        final int height
    ) {
        final int step = 2;
        if (nv21 == null || width <= step * 4 || height <= step * 4) {
            return 0.0;
        }
        final int yLimit = Math.min(nv21.length, width * height);
        if (yLimit < width * height) {
            return 0.0;
        }

        final int startX = Math.max(step, width / 5);
        final int endX = Math.min(width - step - 1, (width * 4) / 5);
        final int startY = Math.max(step, height / 5);
        final int endY = Math.min(height - step - 1, (height * 4) / 5);

        double sum = 0.0;
        double sumSq = 0.0;
        int count = 0;

        for (int y = startY; y < endY; y += step * 2) {
            final int rowOff = y * width;
            final int upOff = (y - step) * width;
            final int dnOff = (y + step) * width;
            for (int x = startX; x < endX; x += step * 2) {
                final int c = nv21[rowOff + x] & 0xFF;
                final int l = nv21[rowOff + (x - step)] & 0xFF;
                final int r = nv21[rowOff + (x + step)] & 0xFF;
                final int u = nv21[upOff + x] & 0xFF;
                final int d = nv21[dnOff + x] & 0xFF;
                final double lap = (4.0 * c) - l - r - u - d;
                sum += lap;
                sumSq += lap * lap;
                count++;
            }
        }
        if (count < 16) {
            return 0.0;
        }
        final double mean = sum / count;
        return Math.max(0.0, (sumSq / count) - (mean * mean));
    }

    /**
     * Downscales the Y-plane of an already-copied NV21 buffer using a 2x2 box filter in L1 cache
     * (< 0.5 ms for 640x480 -> 320x240, zero extra ArImage buffer reads).
     */
    public static byte[] downscaleLumaFromNv21(
        final byte[] nv21,
        final int width,
        final int height,
        final int targetW,
        final int targetH
    ) {
        if (targetW <= 0 || targetH <= 0) {
            return new byte[0];
        }
        final byte[] out = new byte[targetW * targetH];
        if (nv21 == null || width <= 0 || height <= 0) {
            return out;
        }
        final int yLimit = Math.min(nv21.length, width * height);
        final float stepX = width / (float) targetW;
        final float stepY = height / (float) targetH;

        for (int y = 0; y < targetH; y++) {
            final int sy0 = Math.min(height - 1, (int) (y * stepY));
            final int sy1 = Math.min(height - 1, sy0 + 1);
            final int srcRow0 = sy0 * width;
            final int srcRow1 = sy1 * width;
            final int dstRow = y * targetW;
            for (int x = 0; x < targetW; x++) {
                final int sx0 = Math.min(width - 1, (int) (x * stepX));
                final int sx1 = Math.min(width - 1, sx0 + 1);
                final int i00 = srcRow0 + sx0;
                final int i10 = srcRow0 + sx1;
                final int i01 = srcRow1 + sx0;
                final int i11 = srcRow1 + sx1;
                final int p00 = i00 < yLimit ? (nv21[i00] & 0xFF) : 0;
                final int p10 = i10 < yLimit ? (nv21[i10] & 0xFF) : p00;
                final int p01 = i01 < yLimit ? (nv21[i01] & 0xFF) : p00;
                final int p11 = i11 < yLimit ? (nv21[i11] & 0xFF) : p00;
                out[dstRow + x] = (byte) ((p00 + p10 + p01 + p11 + 2) >> 2);
            }
        }
        return out;
    }

    /**
     * Converts OpenGL ES GL_RGBA/GL_UNSIGNED_BYTE readback bytes [R, G, B, A, ...] into NV21,
     * applying the mandatory OpenGL bottom-to-top vertical flip (srcRow = height - 1 - row).
     */
    public static byte[] rgbToNv21(final byte[] rgbaBytes, final int width, final int height) {
        if (rgbaBytes == null || width <= 0 || height <= 0) {
            return new byte[0];
        }
        final int ySize = width * height;
        final int chromaWidth = width / 2;
        final int chromaHeight = height / 2;
        final byte[] nv21 = new byte[ySize + chromaWidth * chromaHeight * 2];
        final int srcRowBytes = width * 4;
        int uvPos = ySize;

        for (int y = 0; y < height; y++) {
            final int srcY = height - 1 - y;
            final int srcRowOff = srcY * srcRowBytes;
            final int dstYOff = y * width;
            final boolean sampleChromaRow = ((y & 1) == 0) && ((y >> 1) < chromaHeight);

            for (int x = 0; x < width; x++) {
                final int pxOff = srcRowOff + (x * 4);
                final int r = pxOff + 2 < rgbaBytes.length ? (rgbaBytes[pxOff] & 0xFF) : 0;
                final int g = pxOff + 2 < rgbaBytes.length ? (rgbaBytes[pxOff + 1] & 0xFF) : 0;
                final int b = pxOff + 2 < rgbaBytes.length ? (rgbaBytes[pxOff + 2] & 0xFF) : 0;

                final int yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                nv21[dstYOff + x] = (byte) clampByte(yVal);

                if (sampleChromaRow && ((x & 1) == 0) && ((x >> 1) < chromaWidth) && uvPos + 1 < nv21.length) {
                    final int uVal = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                    final int vVal = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                    nv21[uvPos++] = (byte) clampByte(vVal);
                    nv21[uvPos++] = (byte) clampByte(uVal);
                }
            }
        }
        return nv21;
    }

    /**
     * Converts OpenGL ES GL_RGBA little-endian int[] pixels (R in bits 0..7, G in 8..15, B in 16..23)
     * into NV21, applying the mandatory OpenGL bottom-to-top vertical flip (srcRow = height - 1 - row).
     */
    public static byte[] rgbToNv21(final int[] rgbaPixels, final int width, final int height) {
        if (rgbaPixels == null || width <= 0 || height <= 0) {
            return new byte[0];
        }
        final int ySize = width * height;
        final int chromaWidth = width / 2;
        final int chromaHeight = height / 2;
        final byte[] nv21 = new byte[ySize + chromaWidth * chromaHeight * 2];
        int uvPos = ySize;

        for (int y = 0; y < height; y++) {
            final int srcY = height - 1 - y;
            final int srcRowOff = srcY * width;
            final int dstYOff = y * width;
            final boolean sampleChromaRow = ((y & 1) == 0) && ((y >> 1) < chromaHeight);

            for (int x = 0; x < width; x++) {
                final int idx = srcRowOff + x;
                final int px = idx < rgbaPixels.length ? rgbaPixels[idx] : 0;
                final int r = px & 0xFF;
                final int g = (px >>> 8) & 0xFF;
                final int b = (px >>> 16) & 0xFF;

                final int yVal = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                nv21[dstYOff + x] = (byte) clampByte(yVal);

                if (sampleChromaRow && ((x & 1) == 0) && ((x >> 1) < chromaWidth) && uvPos + 1 < nv21.length) {
                    final int uVal = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                    final int vVal = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                    nv21[uvPos++] = (byte) clampByte(vVal);
                    nv21[uvPos++] = (byte) clampByte(uVal);
                }
            }
        }
        return nv21;
    }

    /**
     * Scales camera intrinsics to (targetW, targetH) or falls back to a safe synthetic pinhole model
     * (fx = fy = 0.85 * max(w, h), cx = w / 2, cy = h / 2) if intrDims are missing or invalid.
     */
    public static float[] resolveSafeIntrinsics(
        final float[] primaryFocal,
        final float[] primaryPrincipal,
        final int[] primaryDims,
        final float[] fallbackFocal,
        final float[] fallbackPrincipal,
        final int[] fallbackDims,
        final int targetW,
        final int targetH
    ) {
        final float[] primary = tryScaleIntrinsics(primaryFocal, primaryPrincipal, primaryDims, targetW, targetH);
        if (primary != null) {
            return primary;
        }
        final float[] secondary = tryScaleIntrinsics(fallbackFocal, fallbackPrincipal, fallbackDims, targetW, targetH);
        if (secondary != null) {
            return secondary;
        }
        final float f = 0.85f * Math.max(targetW, targetH);
        return new float[] { f, f, targetW * 0.5f, targetH * 0.5f };
    }

    private static float[] tryScaleIntrinsics(
        final float[] focal,
        final float[] principal,
        final int[] dims,
        final int targetW,
        final int targetH
    ) {
        if (
            focal == null || focal.length < 2 ||
            principal == null || principal.length < 2 ||
            dims == null || dims.length < 2 ||
            dims[0] <= 0 || dims[1] <= 0 ||
            targetW <= 0 || targetH <= 0
        ) {
            return null;
        }
        if (
            !Float.isFinite(focal[0]) || focal[0] <= 0.0f ||
            !Float.isFinite(focal[1]) || focal[1] <= 0.0f ||
            !Float.isFinite(principal[0]) || !Float.isFinite(principal[1])
        ) {
            return null;
        }
        final float sx = targetW / (float) dims[0];
        final float sy = targetH / (float) dims[1];
        return new float[] {
            focal[0] * sx,
            focal[1] * sy,
            principal[0] * sx,
            principal[1] * sy
        };
    }

    /**
     * Filters an ARCore PointCloud FloatBuffer (x, y, z, confidence) into packed XYZ vertices for
     * immediate live GL_POINTS feedback from Frame 1 (0 KF), keeping conf >= minConfidence up to maxPoints.
     */
    public static float[] extractVisualPointCloudVertices(
        final FloatBuffer pointsBuf,
        final float minConfidence,
        final int maxPoints
    ) {
        if (pointsBuf == null || maxPoints <= 0) {
            return new float[0];
        }
        final int limit = pointsBuf.limit();
        final int totalPts = limit / 4;
        if (totalPts <= 0) {
            return new float[0];
        }
        final int cap = Math.min(totalPts, maxPoints);
        final float[] tmp = new float[cap * 3];
        int outIdx = 0;
        for (int i = 0; i + 3 < limit && outIdx + 2 < tmp.length; i += 4) {
            final float conf = pointsBuf.get(i + 3);
            if (conf >= minConfidence) {
                final float px = pointsBuf.get(i);
                final float py = pointsBuf.get(i + 1);
                final float pz = pointsBuf.get(i + 2);
                if (Float.isFinite(px) && Float.isFinite(py) && Float.isFinite(pz)) {
                    tmp[outIdx++] = px;
                    tmp[outIdx++] = py;
                    tmp[outIdx++] = pz;
                }
            }
        }
        if (outIdx == tmp.length) {
            return tmp;
        }
        final float[] exact = new float[outIdx];
        System.arraycopy(tmp, 0, exact, 0, outIdx);
        return exact;
    }

    /**
     * Persistent circular ring buffer of world-space 3D VIO points (x, y, z) so live GL_POINTS
     * remain visible as the operator walks around the stockpile even across sparse/empty frames.
     */
    public static final class LivePointCloudAccumulator {
        private final int maxPoints;
        private final float[] buffer;
        private int writeIdx = 0;
        private int count = 0;

        public LivePointCloudAccumulator(final int maxPoints) {
            this.maxPoints = Math.max(1, maxPoints);
            this.buffer = new float[this.maxPoints * 3];
        }

        public synchronized void clear() {
            writeIdx = 0;
            count = 0;
        }

        public synchronized int size() {
            return count;
        }

        public synchronized int appendFromPointCloud(
            final FloatBuffer pointsBuf,
            final float minConfidence,
            final int maxPerFrame
        ) {
            if (pointsBuf == null || maxPerFrame <= 0) {
                return 0;
            }
            final int limit = pointsBuf.limit();
            final int totalPts = limit / 4;
            if (totalPts <= 0) {
                return 0;
            }
            final int stride = totalPts > maxPerFrame ? Math.max(1, totalPts / maxPerFrame) : 1;
            int added = 0;
            for (int p = 0; p < totalPts && added < maxPerFrame; p += stride) {
                final int i = p * 4;
                if (i + 3 >= limit) {
                    break;
                }
                final float conf = pointsBuf.get(i + 3);
                if (conf < minConfidence) {
                    continue;
                }
                final float px = pointsBuf.get(i);
                final float py = pointsBuf.get(i + 1);
                final float pz = pointsBuf.get(i + 2);
                if (!Float.isFinite(px) || !Float.isFinite(py) || !Float.isFinite(pz)) {
                    continue;
                }
                final int base = writeIdx * 3;
                buffer[base] = px;
                buffer[base + 1] = py;
                buffer[base + 2] = pz;
                writeIdx = (writeIdx + 1) % maxPoints;
                if (count < maxPoints) {
                    count++;
                }
                added++;
            }
            return added;
        }

        public synchronized float[] snapshot() {
            if (count <= 0) {
                return null;
            }
            final float[] out = new float[count * 3];
            System.arraycopy(buffer, 0, out, 0, count * 3);
            return out;
        }
    }

    private static int clampByte(final int v) {
        if (v < 0) return 0;
        if (v > 255) return 255;
        return v;
    }

    /**
     * Immutable atomic burst candidate container.
     */
    public static final class BurstCandidate {
        public final double blurScore;
        public final byte[] nv21;
        public final byte[] lumaSmall;
        public final int width;
        public final int height;
        public final float[] rWc;
        public final float[] tWc;
        public final float[] intr;
        public final long timestampNs;
        public final float pitchDeg;
        public final float rollDeg;
        public final boolean fromGlFallback;

        public BurstCandidate(
            final double blurScore,
            final byte[] nv21,
            final byte[] lumaSmall,
            final int width,
            final int height,
            final float[] rWc,
            final float[] tWc,
            final float[] intr,
            final long timestampNs,
            final float pitchDeg,
            final float rollDeg,
            final boolean fromGlFallback
        ) {
            this.blurScore = blurScore;
            this.nv21 = nv21;
            this.lumaSmall = lumaSmall;
            this.width = width;
            this.height = height;
            this.rWc = rWc;
            this.tWc = tWc;
            this.intr = intr;
            this.timestampNs = timestampNs;
            this.pitchDeg = pitchDeg;
            this.rollDeg = rollDeg;
            this.fromGlFallback = fromGlFallback;
        }

        public boolean isComplete() {
            return Double.isFinite(blurScore) &&
                blurScore >= 0.0 &&
                nv21 != null && nv21.length > 0 &&
                lumaSmall != null && lumaSmall.length > 0 &&
                width > 0 && height > 0 &&
                rWc != null && rWc.length == 9 &&
                tWc != null && tWc.length == 3 &&
                intr != null && intr.length == 4;
        }
    }

    public interface CandidateExtractor {
        BurstCandidate extract() throws Exception;
    }

    /**
     * Pure atomic Best-of-Burst state machine:
     * - Never mutates bestBlur before full extraction succeeds (eliminates atomic corruption bug).
     * - Retains any valid frame (blurScore >= 0.0), prioritizing frames >= 8.0 and allowing low-contrast
     *   timeout commit at BURST_WINDOW_MS (220 ms) so 0 KF deadlock is impossible.
     * - Escalates to GL readback fallback after >= 8 consecutive acquireCameraImage() failures.
     * - Emits concise Dark Cockpit diagnostic codes (IMG · NYA / ERR / FMT / INT / GYR / GLF).
     */
    public static final class BurstCaptureState {
        private boolean active = false;
        private long burstStartMs = 0L;
        private double bestBlur = -1.0;
        private BurstCandidate bestCandidate = null;

        private int consecutiveAcquireFailures = 0;
        private boolean glFallbackActive = false;
        private long glFallbackRequestedAtMs = 0L;
        private String lastDiagCode = null;
        private long capturingStartedAtMs = 0L;
        private long lastCandidateAcceptedAtMs = 0L;

        public void resetAll(final long nowMs) {
            clearBurst();
            consecutiveAcquireFailures = 0;
            glFallbackActive = false;
            glFallbackRequestedAtMs = 0L;
            lastDiagCode = null;
            capturingStartedAtMs = nowMs;
            lastCandidateAcceptedAtMs = 0L;
        }

        public void clearBurst() {
            active = false;
            burstStartMs = 0L;
            bestBlur = -1.0;
            bestCandidate = null;
            glFallbackRequestedAtMs = 0L;
        }

        public void markGlFallbackRequested(final long nowMs) {
            if (active && glFallbackRequestedAtMs == 0L) {
                glFallbackRequestedAtMs = nowMs;
            }
        }

        public boolean isTimedOutWithNoCandidate(final long nowMs, final long thresholdMs) {
            return active && bestCandidate == null && burstStartMs > 0L && (nowMs - burstStartMs) >= thresholdMs;
        }

        public boolean shouldBypassGyroForDeadlock(final long nowMs, final long thresholdMs) {
            if (!active || bestCandidate != null) {
                return false;
            }
            final long refMs = Math.max(capturingStartedAtMs, lastCandidateAcceptedAtMs);
            return refMs > 0L && (nowMs - refMs) >= thresholdMs;
        }

        public void beginBurstIfNeeded(final long nowMs) {
            if (!active) {
                active = true;
                burstStartMs = nowMs;
                bestBlur = -1.0;
                bestCandidate = null;
            }
        }

        public boolean isActive() {
            return active;
        }

        public long getBurstStartMs() {
            return burstStartMs;
        }

        public double getBestBlur() {
            return bestBlur;
        }

        public BurstCandidate getBestCandidate() {
            return bestCandidate;
        }

        public int getConsecutiveAcquireFailures() {
            return consecutiveAcquireFailures;
        }

        public boolean isGlFallbackActive() {
            return glFallbackActive;
        }

        public String getLastDiagCode() {
            return lastDiagCode;
        }

        public boolean shouldRequestGlFallback() {
            return active &&
                bestCandidate == null &&
                (glFallbackActive || consecutiveAcquireFailures >= GL_FALLBACK_FAILURE_THRESHOLD);
        }

        /**
         * Returns true if blurScore can improve the current burst candidate.
         * Always accepts >= 0.0 when no candidate exists yet; higher scores win (automatically prioritizing >= 8.0).
         */
        public boolean shouldEvaluateScore(final double blurScore) {
            if (!Double.isFinite(blurScore) || blurScore < 0.0) {
                return false;
            }
            return bestCandidate == null || blurScore > bestBlur;
        }

        /**
         * Atomically runs extractor and updates bestBlur + bestCandidate ONLY if extraction succeeds
         * completely. Any thrown exception leaves previous bestBlur and bestCandidate intact.
         */
        public boolean tryAcceptCandidate(
            final double blurScore,
            final long nowMs,
            final CandidateExtractor extractor
        ) {
            if (!active || !shouldEvaluateScore(blurScore) || extractor == null) {
                return false;
            }
            final BurstCandidate candidate;
            try {
                candidate = extractor.extract();
            } catch (Throwable t) {
                recordAcquireFailure(DIAG_ERR, nowMs);
                return false;
            }
            if (candidate == null || !candidate.isComplete()) {
                recordAcquireFailure(DIAG_ERR, nowMs);
                return false;
            }
            return commitExtractedCandidate(candidate, nowMs);
        }

        /**
         * Atomically accepts a pre-built candidate if complete and strictly better than current best.
         */
        public boolean commitExtractedCandidate(final BurstCandidate candidate, final long nowMs) {
            if (!active || candidate == null || !candidate.isComplete()) {
                return false;
            }
            if (bestCandidate != null && candidate.blurScore <= bestBlur) {
                return false;
            }
            // Atomic swap of both score and payload
            this.bestCandidate = candidate;
            this.bestBlur = candidate.blurScore;
            this.lastCandidateAcceptedAtMs = nowMs;
            this.glFallbackRequestedAtMs = 0L;
            if (candidate.fromGlFallback) {
                this.lastDiagCode = DIAG_GLF;
            } else {
                recordAcquireSuccess();
            }
            return true;
        }

        public void recordAcquireSuccess() {
            consecutiveAcquireFailures = 0;
            glFallbackActive = false;
            if (
                DIAG_NYA.equals(lastDiagCode) ||
                DIAG_ERR.equals(lastDiagCode) ||
                DIAG_FMT.equals(lastDiagCode) ||
                DIAG_GLF.equals(lastDiagCode)
            ) {
                lastDiagCode = null;
            }
        }

        public void recordAcquireFailure(final String diagCode, final long nowMs) {
            consecutiveAcquireFailures++;
            lastDiagCode = diagCode != null ? diagCode : DIAG_ERR;
            if (consecutiveAcquireFailures >= GL_FALLBACK_FAILURE_THRESHOLD) {
                glFallbackActive = true;
            }
        }

        public void recordNonAcquireDiag(final String diagCode) {
            if (!DIAG_GLF.equals(lastDiagCode)) {
                lastDiagCode = diagCode;
            }
        }

        public boolean isBurstFinished(
            final long nowMs,
            final float gyroNormRadS,
            final float speedAlertGyroRadS
        ) {
            if (!active) {
                return false;
            }
            if (
                bestCandidate == null &&
                glFallbackRequestedAtMs > 0L &&
                (nowMs - glFallbackRequestedAtMs) < GL_FALLBACK_GRACE_MS
            ) {
                return false;
            }
            final boolean timedOut = (nowMs - burstStartMs) >= BURST_WINDOW_MS;
            final boolean earlySharpReady =
                bestCandidate != null &&
                bestBlur >= BLUR_EARLY_COMMIT_THRESHOLD &&
                gyroNormRadS < speedAlertGyroRadS;
            return timedOut || earlySharpReady;
        }

        public BurstCandidate consumeCommittedCandidate() {
            final BurstCandidate winner = bestCandidate;
            clearBurst();
            return winner;
        }

        /**
         * Dark Cockpit visibility rule: show diagnostic code in Copper only when GL fallback is active
         * OR CAPTURING_WALK has gone > 1000 ms without accepting a capture candidate.
         */
        public boolean shouldShowDiagCode(final long nowMs) {
            if (lastDiagCode == null) {
                return false;
            }
            if (DIAG_GLF.equals(lastDiagCode)) {
                return true;
            }
            final long refMs = Math.max(capturingStartedAtMs, lastCandidateAcceptedAtMs);
            return refMs > 0L && (nowMs - refMs) > DIAG_DISPLAY_DELAY_MS;
        }
    }

    /**
     * Per-cell trimmed-median ground aggregator (0.25 m cells) replacing biased min(y) retention.
     * Prevents -3*sigma floor sink from downward ARCore plane noise while rejecting elevated outliers.
     */
    public static final class GroundCellAggregator {
        public static final float DEFAULT_CELL_SIZE_M = 0.25f;
        private static final int MAX_SAMPLES_PER_CELL = 15;

        private static final class CellBucket {
            final float[] xs = new float[MAX_SAMPLES_PER_CELL];
            final float[] ys = new float[MAX_SAMPLES_PER_CELL];
            final float[] zs = new float[MAX_SAMPLES_PER_CELL];
            int count = 0;
            int writeIdx = 0;

            void add(final float x, final float y, final float z) {
                xs[writeIdx] = x;
                ys[writeIdx] = y;
                zs[writeIdx] = z;
                writeIdx = (writeIdx + 1) % MAX_SAMPLES_PER_CELL;
                if (count < MAX_SAMPLES_PER_CELL) {
                    count++;
                }
            }

            float[] computeTrimmedMedianPoint() {
                final int n = count;
                if (n <= 0) {
                    return null;
                }
                if (n == 1) {
                    return new float[] { xs[0], ys[0], zs[0] };
                }
                final float[] sortedY = Arrays.copyOf(ys, n);
                Arrays.sort(sortedY);
                final int trim = n >= 5 ? Math.max(1, (int) Math.floor(n * 0.15)) : 0;
                final int lo = Math.min(trim, (n - 1) / 2);
                final int hi = Math.max(lo, n - 1 - lo);
                final float yLo = sortedY[lo];
                final float yHi = sortedY[hi];
                final int mid = (lo + hi) / 2;
                final float medY = ((hi - lo) % 2 == 1)
                    ? 0.5f * (sortedY[mid] + sortedY[mid + 1])
                    : sortedY[mid];

                double sumX = 0.0;
                double sumZ = 0.0;
                int kept = 0;
                for (int i = 0; i < n; i++) {
                    if (ys[i] >= yLo - 1e-6f && ys[i] <= yHi + 1e-6f) {
                        sumX += xs[i];
                        sumZ += zs[i];
                        kept++;
                    }
                }
                if (kept <= 0) {
                    return new float[] { xs[0], medY, zs[0] };
                }
                return new float[] { (float) (sumX / kept), medY, (float) (sumZ / kept) };
            }
        }

        private final float cellSizeM;
        private final int maxCells;
        private final Map<Long, CellBucket> cells = new HashMap<>();

        public GroundCellAggregator(final int maxCells) {
            this(DEFAULT_CELL_SIZE_M, maxCells);
        }

        public GroundCellAggregator(final float cellSizeM, final int maxCells) {
            this.cellSizeM = Math.max(0.05f, cellSizeM);
            this.maxCells = Math.max(1, maxCells);
        }

        public void clear() {
            cells.clear();
        }

        public int size() {
            return cells.size();
        }

        public void addSample(final float[] pt, final float maxAllowedY) {
            if (
                pt == null || pt.length < 3 ||
                !Float.isFinite(pt[0]) || !Float.isFinite(pt[1]) || !Float.isFinite(pt[2]) ||
                pt[1] > maxAllowedY
            ) {
                return;
            }
            final int gx = (int) Math.floor(pt[0] / cellSizeM);
            final int gz = (int) Math.floor(pt[2] / cellSizeM);
            final long key = (((long) (gx & 0xFFFFFFFFL)) << 32) | ((long) (gz & 0xFFFFFFFFL));
            CellBucket bucket = cells.get(key);
            if (bucket == null) {
                if (cells.size() >= maxCells) {
                    return;
                }
                bucket = new CellBucket();
                cells.put(key, bucket);
            }
            bucket.add(pt[0], pt[1], pt[2]);
        }

        public List<float[]> snapshotTrimmedMedians() {
            final List<float[]> out = new ArrayList<>(cells.size());
            for (CellBucket bucket : cells.values()) {
                final float[] med = bucket.computeTrimmedMedianPoint();
                if (med != null) {
                    out.add(med);
                }
            }
            return out;
        }
    }
}
