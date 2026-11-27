package com.minreport.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.ByteBuffer;
import java.nio.FloatBuffer;
import org.junit.Test;

/**
 * Deterministic JVM unit tests for CapturePipelineHelper and Live3DOverlayRenderer covering:
 * 1. MediaTek off-by-1 UV plane limit with pixelStride=2 (both DirectByteBuffer and adjacent heap NV21)
 * 2. Atomic BurstCaptureState update (extraction failure never corrupts bestBlur or aborts burst early)
 * 3. Anti-deadlock low-contrast KF #1 timeout commit + priority for sharp frames (>= 8.0)
 * 4. Persistent acquireCameraImage() failure -> GL Readback fallback escalation + Dark Cockpit diag codes
 * 5. Live 3D point cloud overlay population from Frame 1 at 0 KF (conf >= 0.1f, cap 1024)
 * 6. OpenGL ES RGBA -> NV21 vertical flip and BT.601 color conversion (byte[] and int[])
 * 7. Direct NV21 Y-plane 2x2 box downscale, Laplacian variance, and safe intrinsics fallback
 */
public class CapturePipelineUnitTest {

    private static CapturePipelineHelper.BurstCandidate makeCandidate(
        final double blurScore,
        final boolean fromGlFallback
    ) {
        return new CapturePipelineHelper.BurstCandidate(
            blurScore,
            new byte[] { 10, 20, 30, 40, (byte) 128, (byte) 128 },
            new byte[] { 15, 25, 35, 45 },
            2,
            2,
            new float[] { 1, 0, 0, 0, 1, 0, 0, 0, 1 },
            new float[] { 0.5f, 1.4f, -2.0f },
            new float[] { 544.0f, 544.0f, 320.0f, 240.0f },
            1_000_000L,
            -18.0f,
            0.5f,
            fromGlFallback
        );
    }

    @Test
    public void testUvPlaneOffByOneMediaTekStride2DoesNotThrow() {
        final int width = 640;
        final int height = 480;
        final int chromaW = width / 2;
        final int chromaH = height / 2;
        final int rowStride = 640;
        // Exact MediaTek Dimensity off-by-1 limit: rowStride * (chromaH - 1) + width - 1 = 153599
        final int offByOneLimit = rowStride * (chromaH - 1) + width - 1;

        // Case A: DirectByteBuffers (realistic MediaTek Image.Plane buffers)
        final ByteBuffer yDirect = ByteBuffer.allocateDirect(width * height);
        for (int i = 0; i < width * height; i++) {
            yDirect.put((byte) ((i * 7) & 0xFF));
        }
        yDirect.flip();

        final ByteBuffer vDirect = ByteBuffer.allocateDirect(offByOneLimit);
        final ByteBuffer uDirect = ByteBuffer.allocateDirect(offByOneLimit);
        for (int row = 0; row < chromaH; row++) {
            for (int col = 0; col < chromaW; col++) {
                final int idx = row * rowStride + col * 2;
                vDirect.put(idx, (byte) ((row * 3 + col) & 0xFF));
                uDirect.put(idx, (byte) ((row * 5 + col + 17) & 0xFF));
            }
        }
        vDirect.position(0).limit(offByOneLimit);
        uDirect.position(0).limit(offByOneLimit);

        final byte[] nv21 = CapturePipelineHelper.extractNv21FromPlanes(
            yDirect, width,
            uDirect, rowStride, 2,
            vDirect, rowStride, 2,
            width, height
        );

        assertEquals((width * height * 3) / 2, nv21.length);
        // Verify Y plane first and last pixels
        assertEquals((byte) 0, nv21[0]);
        assertEquals((byte) (((width * height - 1) * 7) & 0xFF), nv21[width * height - 1]);
        // Verify UV plane first pixel (0, 0) and exact last pixel (chromaW - 1, chromaH - 1)
        final int uvBase = width * height;
        assertEquals((byte) 0, nv21[uvBase]);
        assertEquals((byte) 17, nv21[uvBase + 1]);

        final int lastPairOffset = uvBase + ((chromaH - 1) * chromaW + (chromaW - 1)) * 2;
        final byte expectedLastV = (byte) (((chromaH - 1) * 3 + (chromaW - 1)) & 0xFF);
        final byte expectedLastU = (byte) (((chromaH - 1) * 5 + (chromaW - 1) + 17) & 0xFF);
        assertEquals(expectedLastV, nv21[lastPairOffset]);
        assertEquals(expectedLastU, nv21[lastPairOffset + 1]);

        // Case B: Adjacent shared NV21 heap backing array with off-by-1 limit (fast-path)
        final byte[] sharedUv = new byte[rowStride * chromaH];
        for (int row = 0; row < chromaH; row++) {
            for (int col = 0; col < chromaW; col++) {
                final int vIdx = row * rowStride + col * 2;
                sharedUv[vIdx] = (byte) ((row + col + 11) & 0xFF);
                sharedUv[vIdx + 1] = (byte) ((row * 2 + col + 29) & 0xFF);
            }
        }
        final ByteBuffer vHeap = ByteBuffer.wrap(sharedUv, 0, offByOneLimit).slice();
        final ByteBuffer uHeap = ByteBuffer.wrap(sharedUv, 1, offByOneLimit).slice();
        final byte[] nv21Fast = CapturePipelineHelper.extractNv21FromPlanes(
            yDirect, width,
            uHeap, rowStride, 2,
            vHeap, rowStride, 2,
            width, height
        );
        assertEquals((width * height * 3) / 2, nv21Fast.length);
        assertEquals((byte) (((chromaH - 1) + (chromaW - 1) + 11) & 0xFF), nv21Fast[lastPairOffset]);
        assertEquals((byte) (((chromaH - 1) * 2 + (chromaW - 1) + 29) & 0xFF), nv21Fast[lastPairOffset + 1]);
    }

    @Test
    public void testBurstAtomicityDoesNotCorruptBestBlurOnExtractionFailure() {
        final CapturePipelineHelper.BurstCaptureState state = new CapturePipelineHelper.BurstCaptureState();
        state.resetAll(1000L);
        state.beginBurstIfNeeded(1000L);

        // 1. Extraction failure when no candidate exists yet must leave bestBlur at -1.0
        final boolean firstAttempt = state.tryAcceptCandidate(24.0, 1010L, () -> {
            throw new IllegalStateException("Simulated MediaTek buffer lock failure");
        });
        assertFalse(firstAttempt);
        assertEquals(-1.0, state.getBestBlur(), 1e-6);
        assertNull(state.getBestCandidate());
        assertFalse(state.isBurstFinished(1020L, 0.05f, 0.75f));

        // 2. Accept a valid candidate with blurScore = 6.0
        final boolean acceptedValid = state.tryAcceptCandidate(6.0, 1040L, () -> makeCandidate(6.0, false));
        assertTrue(acceptedValid);
        assertEquals(6.0, state.getBestBlur(), 1e-6);
        assertNotNull(state.getBestCandidate());

        // 3. Inject extraction failure on a sharper candidate (blurScore = 25.0 > early commit 17.6)
        final boolean failedSharper = state.tryAcceptCandidate(25.0, 1080L, () -> {
            throw new RuntimeException("Simulated intrinsics / YUV plane error");
        });
        assertFalse(failedSharper);
        // bestBlur MUST remain 6.0 and burst MUST NOT terminate prematurely
        assertEquals(6.0, state.getBestBlur(), 1e-6);
        assertNotNull(state.getBestCandidate());
        assertFalse(state.isBurstFinished(1090L, 0.05f, 0.75f));

        // 4. At burst timeout (220 ms), the intact 6.0 candidate commits cleanly
        assertTrue(state.isBurstFinished(1220L, 0.05f, 0.75f));
        final CapturePipelineHelper.BurstCandidate winner = state.consumeCommittedCandidate();
        assertNotNull(winner);
        assertEquals(6.0, winner.blurScore, 1e-6);
    }

    @Test
    public void testLowContrastFirstKeyframeCommitsOnBurstTimeout() {
        final CapturePipelineHelper.BurstCaptureState state = new CapturePipelineHelper.BurstCaptureState();
        state.resetAll(5000L);
        state.beginBurstIfNeeded(5000L);

        // Low-contrast surface (e.g. dark matte suitcase): blurScore = 1.5 (< 4.0)
        assertTrue(state.tryAcceptCandidate(1.5, 5050L, () -> makeCandidate(1.5, false)));
        assertFalse("Must wait for sharper frame until BURST_WINDOW_MS", state.isBurstFinished(5100L, 0.1f, 0.75f));

        // Slightly sharper low-contrast frame (2.2) replaces 1.5
        assertTrue(state.tryAcceptCandidate(2.2, 5150L, () -> makeCandidate(2.2, false)));
        assertFalse(state.isBurstFinished(5200L, 0.1f, 0.75f));

        // At 220 ms timeout, KF #1 MUST commit instead of deadlocking at 0 KF
        assertTrue(state.isBurstFinished(5220L, 0.1f, 0.75f));
        final CapturePipelineHelper.BurstCandidate kf1 = state.consumeCommittedCandidate();
        assertNotNull("KF #1 must commit on burst timeout even when blurScore < 4.0", kf1);
        assertEquals(2.2, kf1.blurScore, 1e-6);

        // Priority check: a sharp frame (>= 8.0) beats any low-contrast frame within the 220 ms window
        state.beginBurstIfNeeded(6000L);
        assertTrue(state.tryAcceptCandidate(1.5, 6030L, () -> makeCandidate(1.5, false)));
        assertTrue(state.tryAcceptCandidate(9.4, 6110L, () -> makeCandidate(9.4, false)));
        assertFalse("1.5 must not overwrite 9.4", state.tryAcceptCandidate(1.5, 6150L, () -> makeCandidate(1.5, false)));
        assertTrue(state.isBurstFinished(6220L, 0.1f, 0.75f));
        final CapturePipelineHelper.BurstCandidate kf2 = state.consumeCommittedCandidate();
        assertNotNull(kf2);
        assertEquals(9.4, kf2.blurScore, 1e-6);
    }

    @Test
    public void testAcquireCameraImagePersistentFailureTriggersGlFallbackAndDiag() {
        final CapturePipelineHelper.BurstCaptureState state = new CapturePipelineHelper.BurstCaptureState();
        state.resetAll(10_000L);
        state.beginBurstIfNeeded(10_000L);

        // 4 consecutive NotYetAvailableException failures -> still below threshold (5)
        for (int i = 1; i <= 4; i++) {
            state.recordAcquireFailure(CapturePipelineHelper.DIAG_NYA, 10_000L + i * 33L);
            assertEquals(i, state.getConsecutiveAcquireFailures());
            assertEquals(CapturePipelineHelper.DIAG_NYA, state.getLastDiagCode());
            assertFalse(state.isGlFallbackActive());
            assertFalse(state.shouldRequestGlFallback());
        }
        // Dark Cockpit rule: IMG · NYA hidden while <= 1000 ms elapsed
        assertFalse(state.shouldShowDiagCode(10_500L));
        assertTrue(state.shouldShowDiagCode(11_001L));

        // 5th..7th consecutive failure -> triggers GL Readback fallback
        for (int i = 5; i <= 7; i++) {
            state.recordAcquireFailure(CapturePipelineHelper.DIAG_NYA, 10_000L + i * 33L);
            assertTrue(state.isGlFallbackActive());
            assertTrue(state.shouldRequestGlFallback());
        }

        // GL Readback delivers candidate -> diag becomes IMG · GLF and is immediately visible
        assertTrue(state.commitExtractedCandidate(makeCandidate(12.5, true), 10_360L));
        assertEquals(CapturePipelineHelper.DIAG_GLF, state.getLastDiagCode());
        assertTrue("IMG · GLF must be shown immediately in Dark Cockpit", state.shouldShowDiagCode(10_360L));
        assertFalse("No need to re-request GL fallback once burst has candidate", state.shouldRequestGlFallback());

        assertTrue(state.isBurstFinished(10_360L, 0.1f, 0.75f));
        final CapturePipelineHelper.BurstCandidate winner = state.consumeCommittedCandidate();
        assertNotNull(winner);
        assertTrue(winner.fromGlFallback);

        // Recovery when acquireCameraImage() starts working again
        state.recordAcquireSuccess();
        assertFalse(state.isGlFallbackActive());
        assertEquals(0, state.getConsecutiveAcquireFailures());
        assertNull(state.getLastDiagCode());
    }

    @Test
    public void testLivePointCloudOverlayPopulatesAtZeroKeyframes() {
        // Construct synthetic ARCore PointCloud FloatBuffer (x, y, z, conf):
        // - 3 low-conf points (< 0.1f) -> rejected
        // - 5 mid-conf points (0.15f..0.45f) -> accepted for immediate GL_POINTS visual feedback!
        // - 2 high-conf points (>= 0.5f) -> accepted
        // - 1 NaN point -> rejected
        final FloatBuffer buf = FloatBuffer.allocate(11 * 4);
        buf.put(new float[] { 0.1f, 0.2f, -1.0f, 0.02f });
        buf.put(new float[] { 0.2f, 0.2f, -1.0f, 0.05f });
        buf.put(new float[] { 0.3f, 0.2f, -1.0f, 0.09f });
        buf.put(new float[] { 1.0f, 0.5f, -2.0f, 0.10f });
        buf.put(new float[] { 1.1f, 0.5f, -2.0f, 0.18f });
        buf.put(new float[] { 1.2f, 0.5f, -2.0f, 0.25f });
        buf.put(new float[] { 1.3f, 0.5f, -2.0f, 0.35f });
        buf.put(new float[] { 1.4f, 0.5f, -2.0f, 0.45f });
        buf.put(new float[] { 2.0f, 1.0f, -3.0f, 0.75f });
        buf.put(new float[] { 2.1f, 1.0f, -3.0f, 0.95f });
        buf.put(new float[] { Float.NaN, 1.0f, -3.0f, 0.99f });
        buf.flip();

        final float[] verts = CapturePipelineHelper.extractVisualPointCloudVertices(
            buf,
            0.1f,
            Live3DOverlayRenderer.MAX_LIVE_POINTS
        );
        assertEquals(7 * 3, verts.length);
        assertEquals(1.0f, verts[0], 1e-6f);
        assertEquals(0.5f, verts[1], 1e-6f);
        assertEquals(-2.0f, verts[2], 1e-6f);

        // Verify Live3DOverlayRenderer accepts live points immediately at 0 KF (no LiveOverlaySnapshot required)
        final Live3DOverlayRenderer overlay = new Live3DOverlayRenderer();
        overlay.updateLivePointCloud(verts);
        assertEquals(7, overlay.getLivePointCount());

        // Verify strict 2048-point GPU cap
        final FloatBuffer bigBuf = FloatBuffer.allocate(2400 * 4);
        for (int i = 0; i < 2400; i++) {
            bigBuf.put(i * 0.01f);
            bigBuf.put(0.2f);
            bigBuf.put(-2.5f);
            bigBuf.put(0.25f);
        }
        bigBuf.flip();
        final float[] cappedVerts = CapturePipelineHelper.extractVisualPointCloudVertices(
            bigBuf,
            0.1f,
            Live3DOverlayRenderer.MAX_LIVE_POINTS
        );
        assertEquals(2048 * 3, cappedVerts.length);
        overlay.updateLivePointCloud(cappedVerts);
        assertEquals(2048, overlay.getLivePointCount());
    }

    @Test
    public void testFormatAndExtractionFailuresEscalateToGlFallback() {
        final CapturePipelineHelper.BurstCaptureState state = new CapturePipelineHelper.BurstCaptureState();
        state.resetAll(20_000L);
        state.beginBurstIfNeeded(20_000L);

        // 2 format errors + 3 extractor failures -> 5 consecutive failures -> activates GL fallback
        state.recordAcquireFailure(CapturePipelineHelper.DIAG_FMT, 20_033L);
        state.recordAcquireFailure(CapturePipelineHelper.DIAG_FMT, 20_066L);
        assertFalse(state.tryAcceptCandidate(18.0, 20_099L, () -> {
            throw new IllegalStateException("extractor crash");
        }));
        assertFalse(state.tryAcceptCandidate(18.0, 20_132L, () -> null));
        assertFalse(state.isGlFallbackActive());

        state.recordAcquireFailure(CapturePipelineHelper.DIAG_ERR, 20_165L);
        assertTrue(state.isGlFallbackActive());
        assertTrue(state.shouldRequestGlFallback());
        assertEquals(CapturePipelineHelper.DIAG_ERR, state.getLastDiagCode());
    }

    @Test
    public void testGlFallbackGraceWindowPreventsBurstDropAtTimeout() {
        final CapturePipelineHelper.BurstCaptureState state = new CapturePipelineHelper.BurstCaptureState();
        state.resetAll(30_000L);
        state.beginBurstIfNeeded(30_000L);

        for (int i = 1; i <= 5; i++) {
            state.recordAcquireFailure(CapturePipelineHelper.DIAG_NYA, 30_000L + i * 33L);
        }
        assertTrue(state.shouldRequestGlFallback());
        state.markGlFallbackRequested(30_190L);

        // At 220 ms burst window (30_220L), GL fallback frame was only requested 30 ms ago -> MUST NOT drop burst
        assertFalse(
            "Burst must wait for requested GL fallback frame instead of clearing at 220 ms",
            state.isBurstFinished(30_220L, 0.1f, 0.75f)
        );
        // Same at 30_450L (260 ms < 280 ms grace)
        assertFalse(state.isBurstFinished(30_450L, 0.1f, 0.75f));

        // When GL fallback arrives at 30_240L -> burst finishes and commits KF #1
        assertTrue(state.commitExtractedCandidate(makeCandidate(14.0, true), 30_240L));
        assertTrue(state.isBurstFinished(30_240L, 0.1f, 0.75f));
        assertNotNull(state.consumeCommittedCandidate());
    }

    @Test
    public void testLivePointCloudAccumulatorPersistsAcrossEmptyFrames() {
        final CapturePipelineHelper.LivePointCloudAccumulator acc =
            new CapturePipelineHelper.LivePointCloudAccumulator(6);

        final FloatBuffer f1 = FloatBuffer.allocate(3 * 4);
        f1.put(new float[] { 1.0f, 0.2f, -1.0f, 0.3f });
        f1.put(new float[] { 1.1f, 0.3f, -1.0f, 0.05f }); // below conf 0.1 -> ignored
        f1.put(new float[] { 1.2f, 0.4f, -1.0f, 0.6f });
        f1.flip();
        assertEquals(2, acc.appendFromPointCloud(f1, 0.1f, 180));
        assertEquals(2, acc.size());

        // Subsequent empty frame MUST NOT clear accumulated world-space points
        final FloatBuffer empty = FloatBuffer.allocate(0);
        assertEquals(0, acc.appendFromPointCloud(empty, 0.1f, 180));
        assertEquals(2, acc.size());
        final float[] snap = acc.snapshot();
        assertNotNull(snap);
        assertEquals(2 * 3, snap.length);

        // Ring buffer caps at maxPoints=6
        final FloatBuffer f2 = FloatBuffer.allocate(6 * 4);
        for (int i = 0; i < 6; i++) {
            f2.put(new float[] { 2.0f + i, 0.5f, -2.0f, 0.4f });
        }
        f2.flip();
        acc.appendFromPointCloud(f2, 0.1f, 180);
        assertEquals(6, acc.size());
        assertEquals(6 * 3, acc.snapshot().length);
    }

    @Test
    public void testRgbToNv21VerticalFlipAndColorConversion() {
        final int w = 4;
        final int h = 4;
        final byte[] rgba = new byte[w * h * 4];
        final int[] rgbaInt = new int[w * h];

        // OpenGL row 0 (bottom) = pure red (255, 0, 0), OpenGL row 3 (top) = pure white (255, 255, 255),
        // OpenGL rows 1 & 2 = pure black (0, 0, 0)
        for (int glY = 0; glY < h; glY++) {
            for (int x = 0; x < w; x++) {
                final int r;
                final int g;
                final int b;
                if (glY == 0) {
                    r = 255; g = 0; b = 0;
                } else if (glY == 3) {
                    r = 255; g = 255; b = 255;
                } else {
                    r = 0; g = 0; b = 0;
                }
                final int byteOff = (glY * w + x) * 4;
                rgba[byteOff] = (byte) r;
                rgba[byteOff + 1] = (byte) g;
                rgba[byteOff + 2] = (byte) b;
                rgba[byteOff + 3] = (byte) 255;
                rgbaInt[glY * w + x] = (255 << 24) | (b << 16) | (g << 8) | r;
            }
        }

        final byte[] nv21FromBytes = CapturePipelineHelper.rgbToNv21(rgba, w, h);
        final byte[] nv21FromInts = CapturePipelineHelper.rgbToNv21(rgbaInt, w, h);
        assertEquals((w * h * 3) / 2, nv21FromBytes.length);
        assertEquals(nv21FromBytes.length, nv21FromInts.length);
        for (int i = 0; i < nv21FromBytes.length; i++) {
            assertEquals("byte[] and int[] rgbToNv21 must match at index " + i, nv21FromBytes[i], nv21FromInts[i]);
        }

        // After vertical flip:
        // - Top row (y=0) comes from OpenGL row 3 (white -> Y ~ 235)
        // - Middle rows (y=1,2) come from black (Y ~ 16)
        // - Bottom row (y=3) comes from OpenGL row 0 (red -> Y ~ 81)
        assertTrue("Top row should be white after flip", (nv21FromBytes[0] & 0xFF) >= 230);
        assertTrue("Middle row should be black after flip", (nv21FromBytes[w] & 0xFF) <= 20);
        final int bottomY = nv21FromBytes[3 * w] & 0xFF;
        assertTrue("Bottom row should be red luma (~81), got " + bottomY, bottomY >= 70 && bottomY <= 95);

        // Chroma row 0 (y=0, white) must be neutral (V=128, U=128)
        final int uvBase = w * h;
        assertEquals(128, nv21FromBytes[uvBase] & 0xFF);
        assertEquals(128, nv21FromBytes[uvBase + 1] & 0xFF);
    }

    @Test
    public void testDownscaleLumaFromNv21AndLaplacianAndSafeIntrinsics() {
        final int w = 640;
        final int h = 480;
        final byte[] nv21Flat = new byte[(w * h * 3) / 2];
        for (int i = 0; i < w * h; i++) {
            nv21Flat[i] = (byte) 120;
        }
        assertEquals(0.0, CapturePipelineHelper.computeLaplacianVarianceFromY(nv21Flat, w, h), 1e-6);

        // 2x2 box downscale of constant 120 -> 320x240 all 120
        final byte[] smallFlat = CapturePipelineHelper.downscaleLumaFromNv21(nv21Flat, w, h, 320, 240);
        assertEquals(320 * 240, smallFlat.length);
        assertEquals(120, smallFlat[0] & 0xFF);
        assertEquals(120, smallFlat[smallFlat.length - 1] & 0xFF);

        // 2x2 block pattern: top-left=40, top-right=80, bottom-left=120, bottom-right=160 -> box avg = 100
        final byte[] nv21Blocks = new byte[(w * h * 3) / 2];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                final int val;
                if ((y & 1) == 0 && (x & 1) == 0) val = 40;
                else if ((y & 1) == 0) val = 80;
                else if ((x & 1) == 0) val = 120;
                else val = 160;
                nv21Blocks[y * w + x] = (byte) val;
            }
        }
        final byte[] smallBlocks = CapturePipelineHelper.downscaleLumaFromNv21(nv21Blocks, w, h, 320, 240);
        assertEquals(100, smallBlocks[0] & 0xFF);
        assertEquals(100, smallBlocks[100 * 320 + 160] & 0xFF);

        // High-contrast 3x3 checkerboard (period 6, non-aliased with step=2/stride=4) produces high Laplacian variance
        final byte[] nv21Sharp = new byte[(w * h * 3) / 2];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                nv21Sharp[y * w + x] = (byte) ((((x / 3) + (y / 3)) & 1) == 0 ? 220 : 20);
            }
        }
        final double sharpVar = CapturePipelineHelper.computeLaplacianVarianceFromY(nv21Sharp, w, h);
        assertTrue("Expected high Laplacian variance on sharp checkerboard, got " + sharpVar, sharpVar > 1000.0);

        // Safe intrinsics fallback when primary intrDims <= 0
        final float[] texScaled = CapturePipelineHelper.resolveSafeIntrinsics(
            new float[] { 0f, 0f }, new float[] { 0f, 0f }, new int[] { 0, 0 },
            new float[] { 1000f, 1000f }, new float[] { 640f, 480f }, new int[] { 1280, 960 },
            640, 480
        );
        assertEquals(500.0f, texScaled[0], 1e-3f);
        assertEquals(500.0f, texScaled[1], 1e-3f);
        assertEquals(320.0f, texScaled[2], 1e-3f);
        assertEquals(240.0f, texScaled[3], 1e-3f);

        final float[] synthetic = CapturePipelineHelper.resolveSafeIntrinsics(
            null, null, new int[] { 0, 0 },
            null, null, new int[] { -1, 0 },
            640, 480
        );
        assertEquals(0.85f * 640.0f, synthetic[0], 1e-3f);
        assertEquals(0.85f * 640.0f, synthetic[1], 1e-3f);
        assertEquals(320.0f, synthetic[2], 1e-3f);
        assertEquals(240.0f, synthetic[3], 1e-3f);
    }

    @Test
    public void testAdaptiveKeyframeStepWithFloat2AutoCenterNeverThrowsOob() {
        // Primary regression guard: autoCenterXZ is float[2] {cx, cz}; must NEVER index [2]
        final float expectedMid = 0.14f * (float) Math.hypot(1.0 - 0.0, 4.0 - 0.0);
        assertEquals(
            expectedMid,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(
                new float[] { 1.0f, 1.4f, 4.0f },
                new float[] { 0.0f, 0.0f },
                0.40f,
                1.30f
            ),
            1e-4f
        );

        // Null and short array edge cases -> return minStepM without throwing
        assertEquals(
            0.40f,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(null, new float[] { 0.0f, 0.0f }, 0.40f, 1.30f),
            1e-6f
        );
        assertEquals(
            0.40f,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(new float[] { 1.0f, 1.4f, 4.0f }, null, 0.40f, 1.30f),
            1e-6f
        );
        assertEquals(
            0.40f,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(new float[] { 1.0f, 4.0f }, new float[] { 0.0f, 0.0f }, 0.40f, 1.30f),
            1e-6f
        );
        assertEquals(
            0.40f,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(new float[] { 1.0f, 1.4f, 4.0f }, new float[] { 0.0f }, 0.40f, 1.30f),
            1e-6f
        );

        // Non-finite inputs -> return minStepM
        assertEquals(
            0.40f,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(new float[] { Float.NaN, 1.4f, 4.0f }, new float[] { 0.0f, 0.0f }, 0.40f, 1.30f),
            1e-6f
        );
        assertEquals(
            0.40f,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(new float[] { 1.0f, 1.4f, 4.0f }, new float[] { 0.0f, Float.POSITIVE_INFINITY }, 0.40f, 1.30f),
            1e-6f
        );

        // Large radius -> clamped to maxStepM (1.30f)
        assertEquals(
            1.30f,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(
                new float[] { 20.0f, 1.4f, 0.0f },
                new float[] { 0.0f, 0.0f },
                0.40f,
                1.30f
            ),
            1e-6f
        );

        // Small radius (< 1.5 m, 0.14 * 1.5 = 0.21) -> clamped to minStepM (0.40f)
        assertEquals(
            0.40f,
            CapturePipelineHelper.computeAdaptiveKeyframeStepM(
                new float[] { 0.5f, 1.4f, 0.5f },
                new float[] { 0.0f, 0.0f },
                0.40f,
                1.30f
            ),
            1e-6f
        );
    }

    @Test
    public void testGyroDeadlockBypassRespects450msSinceLastCapture() {
        final CapturePipelineHelper.BurstCaptureState state = new CapturePipelineHelper.BurstCaptureState();
        final long startMs = 40_000L;
        state.resetAll(startMs);
        state.beginBurstIfNeeded(startMs);

        // Before 450 ms -> gyro gate remains enforced
        assertFalse(state.shouldBypassGyroForDeadlock(startMs + 200L, 450L));

        // Simulate BURST_WINDOW_MS (220 ms) timeout resetting burstStartMs with no accepted candidate
        state.clearBurst();
        state.beginBurstIfNeeded(startMs + 220L);
        assertFalse(state.shouldBypassGyroForDeadlock(startMs + 449L, 450L));

        // At startMs + 450 ms, bypass MUST engage despite burstStartMs reset at +220 ms
        assertTrue(state.shouldBypassGyroForDeadlock(startMs + 450L, 450L));

        // Once a candidate is accepted at +460 ms, bypass returns false immediately
        final long acceptedAtMs = startMs + 460L;
        assertTrue(state.commitExtractedCandidate(makeCandidate(11.0, false), acceptedAtMs));
        assertFalse(state.shouldBypassGyroForDeadlock(acceptedAtMs + 600L, 450L));

        // Consume committed candidate and start next burst; timer resets to acceptedAtMs
        assertNotNull(state.consumeCommittedCandidate());
        state.beginBurstIfNeeded(acceptedAtMs + 40L);
        assertFalse(state.shouldBypassGyroForDeadlock(acceptedAtMs + 240L, 450L));

        // Another 220 ms burst reset without candidate still measures elapsed time from acceptedAtMs
        state.clearBurst();
        state.beginBurstIfNeeded(acceptedAtMs + 260L);
        assertFalse(state.shouldBypassGyroForDeadlock(acceptedAtMs + 449L, 450L));
        assertTrue(state.shouldBypassGyroForDeadlock(acceptedAtMs + 450L, 450L));
    }
}
