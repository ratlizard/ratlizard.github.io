package io.github.ratlizard.deerlizard;

import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

import co.harrishill.board.touch.detection.RawDataGlyphDetector;
import co.harrishill.board.touch.tracking.BoardContactEvent;
import co.harrishill.board.touch.tracking.TrackerParameters;

/**
 * A Board piece as the mouse: one of the Arcade set's spaceships (the first
 * one put down; any of the four, glyphs 4 to 7), its nose the pointer.
 * Putting the ship on the screen moves the pointer there and presses the
 * button, sliding it drags, lifting it releases. The SheepShaver Board apps'
 * PieceMouse (e-z-g-disassembly, tools/sheepshaver-board/), which Sam tried
 * on the Board, with the game's mouse in place of SDL's.
 *
 * Contacts come from the Board SDK's glyph detector with the Arcade model
 * (the asset arcade_v1.3.7.tflite); BoardNativePlugin.initialize(), in
 * BoardMenu, has started the detector. Positions are display pixels.
 */
final class PieceMouse implements RawDataGlyphDetector.ContactEventWriter {
    static final String TAG = MainActivity.TAG;
    static final String MODEL = "arcade_v1.3.7.tflite";
    /** Pointer distance ahead of the piece's centre, in display pixels, as Carmen 0.17. */
    static final float NOSE = 50;
    static volatile PieceMouse current;

    final MainActivity activity;
    int ship = -1;                // the contact being the mouse, or -1
    float x, y;
    final java.util.BitSet seen = new java.util.BitSet();

    PieceMouse(MainActivity a) { activity = a; }

    /** Loads the model and starts listening; false if the SDK would not. */
    static boolean start(MainActivity a) {
        try {
            File model = new File(new File(a.getFilesDir(), "board_models"), MODEL);
            if (!model.exists()) {
                model.getParentFile().mkdirs();
                try (InputStream in = a.getAssets().open(MODEL); OutputStream o = new FileOutputStream(model)) {
                    byte[] buf = new byte[1 << 16];
                    for (int n; (n = in.read(buf)) > 0; ) o.write(buf, 0, n);
                }
            }
            if (!RawDataGlyphDetector.loadModelFromFile(model.getPath())) { Log.w(TAG, "[piece] the Arcade model did not load"); return false; }
            // The SDK's defaults (board_input.gd): smoothing, persistence, fast tracking.
            if (!RawDataGlyphDetector.activate(new TrackerParameters(0.035f, 0.004f, 4, true))) { Log.w(TAG, "[piece] the detector did not activate"); return false; }
            current = new PieceMouse(a);
            RawDataGlyphDetector.addContactEventWriter(current);
            Log.i(TAG, "[piece] an Arcade ship is the mouse");
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "[piece] " + t);
            return false;
        }
    }

    /** Whether a ship is down: then finger touches are not passed on as well. */
    static boolean active() { PieceMouse p = current; return p != null && p.ship >= 0; }

    @Override
    public void onContactEvents(List<BoardContactEvent> contacts, long a, long b) {
        BoardContactEvent mine = null;
        for (BoardContactEvent c : contacts) {
            if (c.typeId == BoardContactEvent.BC_TYPE_GLYPH && c.glyphId >= 0 && !seen.get(c.glyphId)) {
                seen.set(c.glyphId);
                Log.i(TAG, "[piece] first seen: glyph " + c.glyphId + (c.glyphId >= 4 && c.glyphId <= 7 ? " (a ship)" : " (not a ship: ignored)"));
            }
            if (c.typeId != BoardContactEvent.BC_TYPE_GLYPH || c.glyphId < 4 || c.glyphId > 7) continue;
            if (ship < 0 && (c.phaseId == BoardContactEvent.BC_PHASE_BEGAN || c.phaseId == BoardContactEvent.BC_PHASE_MOVED
                    || c.phaseId == BoardContactEvent.BC_PHASE_STATIONARY)) { mine = c; break; }
            if (c.contactId == ship) { mine = c; break; }
        }
        if (mine == null) return;
        boolean gone = mine.phaseId == BoardContactEvent.BC_PHASE_ENDED || mine.phaseId == BoardContactEvent.BC_PHASE_CANCELED;
        if (!gone) nose(mine);
        final int[] p = activity.game(x, y);
        Emulator emu = activity.emulator;
        if (ship < 0 && !gone) {
            ship = mine.contactId;
            emu.post(() -> { Native.mouseMove(p[0], p[1]); Native.mouseDown(p[0], p[1]); });
        } else if (ship >= 0 && gone) {
            emu.post(() -> { Native.mouseMove(p[0], p[1]); Native.mouseUp(p[0], p[1]); });
            ship = -1;
        } else if (ship >= 0) {
            emu.post(() -> Native.mouseMove(p[0], p[1]));
        }
    }

    /**
     * The pointer: ahead of the centre where the ship faces. The detector's
     * orientation is degrees anticlockwise from vertical; on the Board the
     * screen angle (Y down) the ship faces is 270 less it (the SheepShaver
     * apps, 21 October 2026).
     */
    void nose(BoardContactEvent c) {
        double r = Math.toRadians(270 - c.orientation);
        x = c.positionX + (float) Math.cos(r) * NOSE;
        y = c.positionY + (float) Math.sin(r) * NOSE;
    }
}
