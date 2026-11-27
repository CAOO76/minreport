package com.minreport.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.ImageFormat;
import android.media.Image;
import android.util.Log;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.ByteBufferExtractor;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.NormalizedKeypoint;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenterResult;
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenter;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.List;
import java.util.Optional;

/**
 * Thread-safe wrapper around Google MediaPipe Tasks Vision InteractiveSegmenter (MagicTouch,
 * Apache-2.0) for real-time tap-to-object silhouette segmentation on CPU (arm64-v8a).
 *
 * Gracefully degrades (isReady() == false, zero crashes) if magic_touch.tflite is absent
 * or fails initialization on device.
 */
public final class InteractiveObjectSegmenter {

    private static final String TAG = "InteractiveObjSeg";
    private static final String MODEL_ASSET_PATH = "magic_touch.tflite";
    private static final int MAX_SCALED_WIDTH = 512;
    private static final int MAX_SCALED_HEIGHT = 384;

    public static final class ObjectMask {
        public final byte[] conf;
        public final int width;
        public final int height;
        public final float fgRatio;
        public final boolean valid;

        public ObjectMask(
            final byte[] conf,
            final int width,
            final int height,
            final float fgRatio,
            final boolean valid
        ) {
            this.conf = conf;
            this.width = width;
            this.height = height;
            this.fgRatio = fgRatio;
            this.valid = valid;
        }

        public static ObjectMask invalid() {
            return new ObjectMask(new byte[0], 0, 0, 0.0f, false);
        }
    }

    private final Context appContext;
    private InteractiveSegmenter segmenter = null;
    private boolean initAttempted = false;
    private boolean closed = false;

    public InteractiveObjectSegmenter(final Context context) {
        this.appContext = context != null ? context.getApplicationContext() : null;
    }

    /**
     * Eagerly loads the TFLite model (intended for background visionExecutor thread).
     */
    public synchronized boolean warmUp() {
        ensureInitializedLocked();
        return !closed && segmenter != null;
    }

    public synchronized boolean isReady() {
        if (closed) {
            return false;
        }
        if (!initAttempted) {
            ensureInitializedLocked();
        }
        return segmenter != null;
    }

    private void ensureInitializedLocked() {
        if (initAttempted || closed) {
            return;
        }
        initAttempted = true;
        if (appContext == null) {
            return;
        }
        try {
            final BaseOptions baseOptions = BaseOptions.builder()
                .setModelAssetPath(MODEL_ASSET_PATH)
                .setDelegate(Delegate.CPU)
                .build();
            final InteractiveSegmenter.InteractiveSegmenterOptions options =
                InteractiveSegmenter.InteractiveSegmenterOptions.builder()
                    .setBaseOptions(baseOptions)
                    .setOutputConfidenceMasks(true)
                    .setOutputCategoryMask(false)
                    .build();
            segmenter = InteractiveSegmenter.createFromOptions(appContext, options);
        } catch (Throwable t) {
            Log.w(TAG, "InteractiveSegmenter unavailable (model asset missing or init failed): " + t.getMessage());
            segmenter = null;
        }
    }

    /**
     * Segments the object containing normalized point (normX, normY) in [0..1] x [0..1].
     * Thread-safe; always returns a non-null ObjectMask (check mask.valid).
     */
    public synchronized ObjectMask segmentAtNormalizedPoint(
        final Bitmap rgbBitmap,
        final float normX,
        final float normY
    ) {
        if (
            closed ||
            rgbBitmap == null ||
            rgbBitmap.isRecycled() ||
            rgbBitmap.getWidth() < 8 ||
            rgbBitmap.getHeight() < 8 ||
            !Float.isFinite(normX) ||
            !Float.isFinite(normY)
        ) {
            return ObjectMask.invalid();
        }
        if (!initAttempted) {
            ensureInitializedLocked();
        }
        if (segmenter == null) {
            return ObjectMask.invalid();
        }

        final float clampedX = Math.max(0.01f, Math.min(0.99f, normX));
        final float clampedY = Math.max(0.01f, Math.min(0.99f, normY));

        Bitmap argbCopy = null;
        MPImage mpImage = null;
        try {
            final Bitmap inputBmp;
            if (rgbBitmap.getConfig() == Bitmap.Config.ARGB_8888) {
                inputBmp = rgbBitmap;
            } else {
                argbCopy = rgbBitmap.copy(Bitmap.Config.ARGB_8888, false);
                if (argbCopy == null) {
                    return ObjectMask.invalid();
                }
                inputBmp = argbCopy;
            }

            mpImage = new BitmapImageBuilder(inputBmp).build();
            final InteractiveSegmenter.RegionOfInterest roi =
                InteractiveSegmenter.RegionOfInterest.create(
                    NormalizedKeypoint.create(clampedX, clampedY)
                );

            final ImageSegmenterResult result = segmenter.segment(mpImage, roi);
            if (result == null) {
                return ObjectMask.invalid();
            }
            final Optional<List<MPImage>> optMasks = result.confidenceMasks();
            if (optMasks == null || !optMasks.isPresent()) {
                return ObjectMask.invalid();
            }
            final List<MPImage> masks = optMasks.get();
            if (masks == null || masks.isEmpty()) {
                return ObjectMask.invalid();
            }

            // Verify polarity across all confidence mask channels by sampling a 5x5 patch at (clampedX, clampedY).
            // Choose the channel with highest mean probability at the tapped point.
            FloatBuffer bestFloatBuf = null;
            int bestMw = 0;
            int bestMh = 0;
            float bestTapMean = -1.0f;

            for (int cIdx = 0; cIdx < masks.size(); cIdx++) {
                final MPImage cand = masks.get(cIdx);
                if (cand == null) {
                    continue;
                }
                final int cw = cand.getWidth();
                final int ch = cand.getHeight();
                final int cTotal = cw * ch;
                if (cw <= 0 || ch <= 0 || cTotal <= 0) {
                    continue;
                }
                final ByteBuffer rawBytes = ByteBufferExtractor.extract(cand);
                if (rawBytes == null) {
                    continue;
                }
                final ByteBuffer dupBytes = rawBytes.duplicate();
                dupBytes.rewind();
                final FloatBuffer fb = dupBytes
                    .order(ByteOrder.nativeOrder())
                    .asFloatBuffer();
                if (fb.remaining() < cTotal) {
                    continue;
                }

                final int cxPx = Math.max(0, Math.min(cw - 1, Math.round(clampedX * (cw - 1))));
                final int cyPx = Math.max(0, Math.min(ch - 1, Math.round(clampedY * (ch - 1))));
                float patchSum = 0.0f;
                int patchCnt = 0;
                for (int dy = -2; dy <= 2; dy++) {
                    final int py = cyPx + dy;
                    if (py < 0 || py >= ch) {
                        continue;
                    }
                    final int rowOff = py * cw;
                    for (int dx = -2; dx <= 2; dx++) {
                        final int px = cxPx + dx;
                        if (px < 0 || px >= cw) {
                            continue;
                        }
                        final float p = fb.get(rowOff + px);
                        final float safeP = Float.isFinite(p) ? Math.max(0.0f, Math.min(1.0f, p)) : 0.0f;
                        patchSum += safeP;
                        patchCnt++;
                    }
                }
                final float candTapMean = patchCnt > 0 ? (patchSum / patchCnt) : 0.0f;
                if (bestFloatBuf == null || candTapMean > bestTapMean) {
                    bestFloatBuf = fb;
                    bestMw = cw;
                    bestMh = ch;
                    bestTapMean = candTapMean;
                }
            }

            if (bestFloatBuf == null || bestMw <= 0 || bestMh <= 0) {
                return ObjectMask.invalid();
            }

            final int mw = bestMw;
            final int mh = bestMh;
            final int totalPx = mw * mh;
            final byte[] conf = new byte[totalPx];
            int fgCount = 0;
            for (int i = 0; i < totalPx; i++) {
                final float p = bestFloatBuf.get(i);
                final float safeP = Float.isFinite(p) ? Math.max(0.0f, Math.min(1.0f, p)) : 0.0f;
                final int q = Math.max(0, Math.min(255, Math.round(safeP * 255.0f)));
                conf[i] = (byte) q;
                if (q >= 128) {
                    fgCount++;
                }
            }

            float fgRatio = fgCount / (float) totalPx;
            float tapMean = bestTapMean;

            // Single-channel inverted-polarity guard (background emitted as 1.0, foreground as 0.0)
            if (masks.size() == 1 && tapMean < 0.35f && fgRatio > 0.65f) {
                int invFgCount = 0;
                for (int i = 0; i < totalPx; i++) {
                    final int q = 255 - (conf[i] & 0xFF);
                    conf[i] = (byte) q;
                    if (q >= 128) {
                        invFgCount++;
                    }
                }
                fgCount = invFgCount;
                fgRatio = fgCount / (float) totalPx;
                tapMean = 1.0f - tapMean;
            }

            final boolean valid = fgCount >= 12 && tapMean >= 0.45f && fgRatio > 0.0005f && fgRatio < 0.82f;
            return new ObjectMask(conf, mw, mh, fgRatio, valid);
        } catch (Throwable t) {
            Log.w(TAG, "InteractiveSegmenter inference failed: " + t.getMessage());
            return ObjectMask.invalid();
        } finally {
            if (mpImage != null) {
                try {
                    mpImage.close();
                } catch (Throwable ignored) {
                }
            }
            if (argbCopy != null && !argbCopy.isRecycled()) {
                argbCopy.recycle();
            }
        }
    }

    public synchronized void close() {
        closed = true;
        if (segmenter != null) {
            try {
                segmenter.close();
            } catch (Throwable ignored) {
            }
            segmenter = null;
        }
    }

    /**
     * Fast zero-JPEG conversion from ARCore YUV_420_888 Image to scaled ARGB_8888 Bitmap (<= 512x384).
     * Does NOT close yuvImage; caller retains ownership and must close it in try/finally.
     */
    public static Bitmap yuv420ToScaledRgbBitmap(final Image yuvImage, final int maxWidth) {
        if (yuvImage == null || yuvImage.getFormat() != ImageFormat.YUV_420_888) {
            return null;
        }
        final int srcW = yuvImage.getWidth();
        final int srcH = yuvImage.getHeight();
        if (srcW < 4 || srcH < 4) {
            return null;
        }
        final Image.Plane[] planes = yuvImage.getPlanes();
        if (planes == null || planes.length < 3 || planes[0] == null || planes[1] == null || planes[2] == null) {
            return null;
        }

        final int capW = Math.max(32, Math.min(maxWidth, MAX_SCALED_WIDTH));
        final float scale = Math.min(1.0f, Math.min(capW / (float) srcW, MAX_SCALED_HEIGHT / (float) srcH));
        final int dstW = Math.max(16, Math.round(srcW * scale));
        final int dstH = Math.max(16, Math.round(srcH * scale));

        final ByteBuffer yBuf = planes[0].getBuffer();
        final ByteBuffer uBuf = planes[1].getBuffer();
        final ByteBuffer vBuf = planes[2].getBuffer();
        final int yRowStride = planes[0].getRowStride();
        final int yPixelStride = planes[0].getPixelStride();
        final int uRowStride = planes[1].getRowStride();
        final int uPixelStride = planes[1].getPixelStride();
        final int vRowStride = planes[2].getRowStride();
        final int vPixelStride = planes[2].getPixelStride();
        final int yLimit = yBuf.limit();
        final int uLimit = uBuf.limit();
        final int vLimit = vBuf.limit();

        final int[] argb = new int[dstW * dstH];
        int outIdx = 0;
        for (int dy = 0; dy < dstH; dy++) {
            final int sy = Math.min(srcH - 1, (dy * srcH) / dstH);
            final int yRowOff = sy * yRowStride;
            final int uvY = sy >> 1;
            final int uRowOff = uvY * uRowStride;
            final int vRowOff = uvY * vRowStride;
            for (int dx = 0; dx < dstW; dx++) {
                final int sx = Math.min(srcW - 1, (dx * srcW) / dstW);
                final int yIdx = yRowOff + sx * yPixelStride;
                final int uvX = sx >> 1;
                final int uIdx = uRowOff + uvX * uPixelStride;
                final int vIdx = vRowOff + uvX * vPixelStride;

                final int yVal = yIdx < yLimit ? (yBuf.get(yIdx) & 0xFF) : 0;
                final int uVal = uIdx < uLimit ? ((uBuf.get(uIdx) & 0xFF) - 128) : 0;
                final int vVal = vIdx < vLimit ? ((vBuf.get(vIdx) & 0xFF) - 128) : 0;

                argb[outIdx++] = yuvToArgb(yVal, uVal, vVal);
            }
        }
        return Bitmap.createBitmap(argb, dstW, dstH, Bitmap.Config.ARGB_8888);
    }

    /**
     * Fast zero-JPEG conversion from NV21 byte buffer to scaled ARGB_8888 Bitmap (<= 512x384).
     */
    public static Bitmap nv21ToScaledRgbBitmap(
        final byte[] nv21,
        final int srcW,
        final int srcH,
        final int maxWidth
    ) {
        return nv21ToScaledRgbBitmapRotated(nv21, srcW, srcH, maxWidth, false);
    }

    /**
     * Fast zero-JPEG conversion from NV21 byte buffer to scaled ARGB_8888 Bitmap (<= 512x384)
     * with optional 180-degree rotation (for Surface.ROTATION_270 upright inference off GLThread).
     */
    public static Bitmap nv21ToScaledRgbBitmapRotated(
        final byte[] nv21,
        final int srcW,
        final int srcH,
        final int maxWidth,
        final boolean rotate180
    ) {
        if (nv21 == null || srcW < 4 || srcH < 4) {
            return null;
        }
        final int frameSize = srcW * srcH;
        if (nv21.length < frameSize + (frameSize / 2)) {
            return null;
        }
        final int capW = Math.max(32, Math.min(maxWidth, MAX_SCALED_WIDTH));
        final float scale = Math.min(1.0f, Math.min(capW / (float) srcW, MAX_SCALED_HEIGHT / (float) srcH));
        final int dstW = Math.max(16, Math.round(srcW * scale));
        final int dstH = Math.max(16, Math.round(srcH * scale));

        final int[] argb = new int[dstW * dstH];
        int outIdx = 0;
        for (int dy = 0; dy < dstH; dy++) {
            final int sampleY = rotate180 ? (dstH - 1 - dy) : dy;
            final int sy = Math.min(srcH - 1, (sampleY * srcH) / dstH);
            final int yRowOff = sy * srcW;
            final int uvRowOff = frameSize + (sy >> 1) * srcW;
            for (int dx = 0; dx < dstW; dx++) {
                final int sampleX = rotate180 ? (dstW - 1 - dx) : dx;
                final int sx = Math.min(srcW - 1, (sampleX * srcW) / dstW);
                final int yVal = nv21[yRowOff + sx] & 0xFF;
                final int uvIdx = uvRowOff + (sx & ~1);
                final int vVal = (uvIdx < nv21.length ? (nv21[uvIdx] & 0xFF) : 128) - 128;
                final int uVal = (uvIdx + 1 < nv21.length ? (nv21[uvIdx + 1] & 0xFF) : 128) - 128;
                argb[outIdx++] = yuvToArgb(yVal, uVal, vVal);
            }
        }
        return Bitmap.createBitmap(argb, dstW, dstH, Bitmap.Config.ARGB_8888);
    }

    /**
     * Converts OpenGL bottom-up RGBA bytes (from glReadPixels) directly into a top-down scaled
     * ARGB_8888 Bitmap (<= 512x384) off the GLThread for lossless GL-fallback MagicTouch inference.
     */
    public static Bitmap rgbaBottomUpToScaledRgbBitmap(
        final byte[] rgba,
        final int srcW,
        final int srcH,
        final int maxWidth
    ) {
        if (rgba == null || srcW < 4 || srcH < 4 || rgba.length < srcW * srcH * 4) {
            return null;
        }
        final int capW = Math.max(32, Math.min(maxWidth, MAX_SCALED_WIDTH));
        final float scale = Math.min(1.0f, Math.min(capW / (float) srcW, MAX_SCALED_HEIGHT / (float) srcH));
        final int dstW = Math.max(16, Math.round(srcW * scale));
        final int dstH = Math.max(16, Math.round(srcH * scale));

        final int[] argb = new int[dstW * dstH];
        int outIdx = 0;
        for (int dy = 0; dy < dstH; dy++) {
            final int syTopDown = Math.min(srcH - 1, (dy * srcH) / dstH);
            final int syGl = (srcH - 1) - syTopDown;
            final int rowOff = syGl * srcW * 4;
            for (int dx = 0; dx < dstW; dx++) {
                final int sx = Math.min(srcW - 1, (dx * srcW) / dstW);
                final int off = rowOff + (sx * 4);
                final int r = rgba[off] & 0xFF;
                final int g = rgba[off + 1] & 0xFF;
                final int b = rgba[off + 2] & 0xFF;
                argb[outIdx++] = 0xFF000000 | (r << 16) | (g << 8) | b;
            }
        }
        return Bitmap.createBitmap(argb, dstW, dstH, Bitmap.Config.ARGB_8888);
    }

    /**
     * Rotates a single-channel confidence mask 180 degrees to re-align an upright ROTATION_270
     * MagicTouch mask back onto unrotated ARCore sensor coordinates.
     */
    public static byte[] rotateMask180(final byte[] conf, final int w, final int h) {
        if (conf == null || w <= 0 || h <= 0) {
            return conf;
        }
        final int total = w * h;
        if (conf.length < total) {
            return conf;
        }
        final byte[] out = new byte[total];
        final int last = total - 1;
        for (int i = 0; i < total; i++) {
            out[i] = conf[last - i];
        }
        return out;
    }

    private static int yuvToArgb(final int y, final int u, final int v) {
        // Fast integer BT.601 YUV -> RGB
        int r = y + ((359 * v) >> 8);
        int g = y - ((88 * u + 183 * v) >> 8);
        int b = y + ((454 * u) >> 8);
        if (r < 0) r = 0; else if (r > 255) r = 255;
        if (g < 0) g = 0; else if (g > 255) g = 255;
        if (b < 0) b = 0; else if (b > 255) b = 255;
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }
}
