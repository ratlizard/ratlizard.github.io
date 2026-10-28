package io.github.ratlizard.deerlizard;

import android.view.Surface;

/**
 * The module's calls (cythera-web/src/lib.rs, through jni.c). The module's
 * state is thread-local, so every call that reaches it must come from one
 * thread: only Emulator's thread makes them. setView and setUndither reach
 * only screen.c's drawing thread, and come from the activity's.
 */
final class Native {
    static {
        System.loadLibrary("deerlizard");
    }

    static native int load(byte[] archive, int macEpochSecs, int width, int height, boolean powerpc);
    static native String error();
    static native int start();
    static native int importFile(String path, int type, int creator, int flags, int created, int modified, byte[] data, byte[] rsrc);
    static native int saveScan();
    static native String savePath(int i);
    /** Type, creator, Finder flags, created, modified. */
    static native int[] saveInfo(int i);
    static native byte[] saveData(int i);
    static native byte[] saveRsrc(int i);
    static native void saveAck();
    static native String gameFolder();
    static native int width();
    static native int height();
    static native int run(int maxSteps, int deadlineTick, int audioSamples);
    static native void mixAudio(int samples);
    static native int runCatchup(int maxSteps, int tickCap);
    static native boolean running();
    static native int tick();
    static native void setInstructionsPerTick(int n);
    static native int instructionsPerTick();
    static native void mouseMove(int v, int h);
    static native void mouseDown(int v, int h);
    static native void mouseUp(int v, int h);
    static native void keyDown(int macKey, int charCode);
    static native void keyUp(int macKey, int charCode);
    static native String haltReason();
    static native int tuneInstall(int checksum, byte[] bytes);
    static native int audioDrain(byte[] out);
    static native void setSurface(Surface surface);
    /** The part of the screen shown: zoom times as large, its top left corner at (u, v) in fractions of the screen. Any thread. */
    static native void setView(float zoom, float u, float v);
    /** grimoire's undither filter on the screen, or off. Any thread. */
    static native void setUndither(boolean on);
    /** Whether the filter reads each pixel's palette index to leave the animated colours alone (on by default). Any thread. */
    static native void setUnditherIndices(boolean on);
    /** Draws the screen into the surface; returns the lit part of the screen in thousandths. */
    static native int present();
}
