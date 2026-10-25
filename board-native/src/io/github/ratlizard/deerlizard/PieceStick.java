package io.github.ratlizard.deerlizard;

import android.os.SystemClock;
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
 * The Chop Chop pieces as Cythera's controls, as the SheepShaver Cythera app
 * has them (e-z-g-disassembly, branch worktree-cythera-board,
 * tools/sheepshaver-board/PieceStick.java), with the game's keys in place of
 * SDL's. Glyphs are the Chop Chop model's: knife 0, spoon 1, sponge 2,
 * spice mill 3, little chef 4. The order of the Unity SDK's simulator icons
 * (spoon 0, sponge 1, mill 2, knife 3) is not the model's; that order, set
 * down on the Board on 25 October 2026, made the knife Use, the spoon Take,
 * the sponge the joystick and the mill Attack.
 *
 * The spice mill is a joystick on the numeric keypad. Where it is set down is
 * the centre. Pushed further than ENTER pixels from there, it holds down the
 * keypad key of the octant it is in (8 up, 9 up and right, 6 right, and on
 * round to 7); moved into another octant, it lets that key go and holds the
 * new one; brought back within LEAVE of the centre, or lifted, it lets go.
 * The game walks on while the key is held (cythera_keys.md: a GetKeys
 * loop). Turned in place at the centre, it presses keypad 5 once for each
 * TURN degrees, which passes a turn.
 *
 * The other pieces act where they are set down: one presses its command
 * letter and then clicks under its centre, once; lift it and set it down
 * again to do it again. Knife A (attack), spoon U (use), sponge G (take),
 * little chef T (talk). With a command armed, the game carries out the next
 * click on the map as that command (TDroppableWindow::MouseRoutine), which
 * is the click that follows the letter.
 *
 * A finger is the game's mouse, unchanged. On the map, in MOVE mode, the
 * game reads a press by its gesture (MouseRoutine, 68K CODE5+006484): a quick
 * click Looks, and Searches as well when the square is within reach; a
 * double click does what suits what is there (walks to an empty square,
 * talks to a person or attacks a hostile one, uses an item, Looks otherwise);
 * a press held still for twice the double-click time opens the Commands
 * menu; a press on the hero that moves walks the hero towards the finger
 * while it is held; a press on a reachable item that moves slides, drops or
 * throws it. An armed command or a script asking for a target takes the
 * click first, and off the map a click is a click.
 */
final class PieceStick implements RawDataGlyphDetector.ContactEventWriter {
    static final String TAG = MainActivity.TAG;
    static final String MODEL = "chop_chop_v1.3.0.tflite";
    static final int MILL = 3;
    /** Display pixels from the centre to press a direction, and to let it go (the Board is about 92 per inch). */
    static final float ENTER = 40, LEAVE = 28;
    /** Degrees past an octant's edge before the held direction changes. */
    static final double SLACK = 8;
    /** Degrees the mill is turned in place for each keypad 5. */
    static final double TURN = 60;
    /** Ms a contact must stay one glyph before it acts. */
    static final long STEADY = 250;
    /** A touch that starts within NEAR display pixels of where a piece was seen in the last RECENT ms is a piece's, not a finger's. */
    static final float NEAR = 160;
    static final long RECENT = 400;

    /** The Mac key code and character of each octant's keypad key, clockwise from up. */
    static final int[][] KEYS = {
        { 0x5B, '8' }, { 0x5C, '9' }, { 0x58, '6' }, { 0x55, '3' },
        { 0x54, '2' }, { 0x53, '1' }, { 0x56, '4' }, { 0x59, '7' } };
    static final int[] KEYPAD_5 = { 0x57, '5' };
    /** Glyph: the Mac key code and character of its command letter. */
    static final java.util.Map<Integer, int[]> ACTIONS = new java.util.HashMap<>();
    static {
        ACTIONS.put(0, new int[] { 0x00, 'a' });   // knife: attack
        ACTIONS.put(1, new int[] { 0x20, 'u' });   // spoon: use
        ACTIONS.put(2, new int[] { 0x05, 'g' });   // sponge: take
        ACTIONS.put(4, new int[] { 0x11, 't' });   // little chef: talk
    }

    static volatile PieceStick current;

    final MainActivity activity;
    final java.util.Map<Integer, long[]> since = new java.util.HashMap<>();   // contact: glyph, first time
    final float[][] marks = new float[16][];                                  // x, y, time of recent piece contacts
    int markAt;
    final java.util.BitSet seen = new java.util.BitSet();
    final java.util.Set<Integer> acted = new java.util.HashSet<>();   // contacts that have done their action
    int stick = -1;               // the contact being the joystick, or -1
    float cx, cy;                 // its centre
    double facing, turned;        // its last orientation, and the turn since the last keypad 5
    int octant = -1;              // the direction held, or -1

    PieceStick(MainActivity a) { activity = a; }

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
            if (!RawDataGlyphDetector.loadModelFromFile(model.getPath())) { Log.w(TAG, "[piece] the Chop Chop model did not load"); return false; }
            // The SDK's defaults (board_input.gd): smoothing, persistence, fast tracking.
            if (!RawDataGlyphDetector.activate(new TrackerParameters(0.035f, 0.004f, 4, true))) { Log.w(TAG, "[piece] the detector did not activate"); return false; }
            current = new PieceStick(a);
            RawDataGlyphDetector.addContactEventWriter(current);
            Log.i(TAG, "[piece] the Chop Chop pieces are the controls");
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "[piece] " + t);
            return false;
        }
    }

    boolean steady(BoardContactEvent c) {
        long now = System.currentTimeMillis();
        long[] s = since.get(c.contactId);
        if (s == null || s[0] != c.glyphId) { since.put(c.contactId, new long[] { c.glyphId, now }); return false; }
        return now - s[1] >= STEADY;
    }

    synchronized void mark(float x, float y) { marks[markAt++ % marks.length] = new float[] { x, y, System.currentTimeMillis() }; }

    /** Whether a touch at X, Y (display pixels) is a piece's rather than a finger's: a piece on the screen also touches it. */
    static boolean nearPiece(float x, float y) {
        PieceStick p = current;
        if (p == null) return false;
        synchronized (p) {
            long now = System.currentTimeMillis();
            for (float[] m : p.marks)
                if (m != null && now - (long) m[2] < RECENT && Math.hypot(m[0] - x, m[1] - y) < NEAR) return true;
        }
        return false;
    }

    static boolean gone(BoardContactEvent c) {
        return c.phaseId == BoardContactEvent.BC_PHASE_ENDED || c.phaseId == BoardContactEvent.BC_PHASE_CANCELED;
    }

    void press(int[] key) {
        Emulator emu = activity.emulator;
        emu.post(() -> Native.keyDown(key[0], key[1]));
        SystemClock.sleep(60);
        emu.post(() -> Native.keyUp(key[0], key[1]));
    }

    /** An action piece set down: its letter, then a click at its centre, on a thread of its own. */
    void act(BoardContactEvent c) {
        final int[] key = ACTIONS.get(c.glyphId);
        final int[] p = activity.game(c.positionX, c.positionY);
        Events.note(String.format("[piece] glyph %d at %.0f,%.0f: %c and a click", c.glyphId, c.positionX, c.positionY, (char) key[1]));
        new Thread(() -> {
            Emulator emu = activity.emulator;
            press(key);
            SystemClock.sleep(120);
            emu.post(() -> { Native.mouseMove(p[0], p[1]); Native.mouseDown(p[0], p[1]); });
            SystemClock.sleep(80);
            emu.post(() -> Native.mouseUp(p[0], p[1]));
        }, "piece-action").start();
    }

    @Override
    public void onContactEvents(List<BoardContactEvent> contacts, long a, long b) {
        BoardContactEvent mine = null;
        for (BoardContactEvent c : contacts) {
            if (c.phaseId == BoardContactEvent.BC_PHASE_BEGAN || gone(c))
                Events.note(String.format("[contact] %d %s: type %d glyph %d at %.0f,%.0f facing %.0f",
                    c.contactId, gone(c) ? "off" : "on", c.typeId, c.glyphId, c.positionX, c.positionY, c.orientation));
            if (c.typeId != BoardContactEvent.BC_TYPE_GLYPH || c.glyphId < 0) continue;
            if (!gone(c)) mark(c.positionX, c.positionY);
            else if (c.contactId != stick && since.remove(c.contactId) == null) continue;
            else if (!acted.contains(c.contactId) && c.contactId != stick) continue;   // never steady: nothing to undo
            // A contact acts only once it has been the same glyph for STEADY ms: a landing piece
            // flickered between glyphs in the SheepShaver app's runs (22 October 2026).
            if (!gone(c) && c.contactId != stick && !steady(c)) continue;
            if (!seen.get(c.glyphId)) {
                seen.set(c.glyphId);
                Events.note("[piece] first seen: glyph " + c.glyphId + (c.glyphId == MILL ? " (the joystick)"
                    : ACTIONS.containsKey(c.glyphId) ? " (an action)" : " (ignored)"));
            }
            if (ACTIONS.containsKey(c.glyphId)) {
                if (gone(c)) acted.remove(c.contactId);
                else if (acted.add(c.contactId)) act(c);
                continue;
            }
            if (c.glyphId != MILL) continue;
            if (mine == null && (stick < 0 || c.contactId == stick)) mine = c;
        }
        if (mine == null) return;
        if (stick < 0) {
            if (gone(mine)) return;
            stick = mine.contactId; cx = mine.positionX; cy = mine.positionY;
            facing = mine.orientation; turned = 0;
            Events.note(String.format("[piece] mill down at %.0f,%.0f", cx, cy));
            return;
        }
        if (gone(mine)) { release(); stick = -1; return; }
        float dx = mine.positionX - cx, dy = mine.positionY - cy;
        double r = Math.hypot(dx, dy);
        double step = ((mine.orientation - facing) % 360 + 540) % 360 - 180;
        facing = mine.orientation;
        if (r < (octant < 0 ? ENTER : LEAVE)) {
            release();
            turned += step;
            if (Math.abs(turned) >= TURN) {
                turned -= Math.signum(turned) * TURN;
                Events.note("[piece] mill turned: keypad 5");
                new Thread(() -> press(KEYPAD_5), "piece-turn").start();
            }
            return;
        }
        turned = 0;
        double deg = (Math.toDegrees(Math.atan2(dx, -dy)) + 360) % 360;  // clockwise from up; the screen's Y runs down
        int o = (int) Math.round(deg / 45) % 8;
        if (octant >= 0 && o != octant) {
            double off = Math.abs(((deg - octant * 45) % 360 + 540) % 360 - 180);
            if (off < 22.5 + SLACK) o = octant;
        }
        if (o == octant) return;
        release();
        octant = o;
        final int[] key = KEYS[o];
        activity.emulator.post(() -> Native.keyDown(key[0], key[1]));
    }

    void release() {
        if (octant < 0) return;
        final int[] key = KEYS[octant];
        activity.emulator.post(() -> Native.keyUp(key[0], key[1]));
        octant = -1;
    }
}
