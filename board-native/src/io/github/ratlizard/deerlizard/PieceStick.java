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
 * Two of the Chop Chop pieces as Cythera's controls, each a joystick: the
 * spice mill walks and passes a turn, and the little chef carries out a
 * command on the square next to the hero. Glyph 0 is a finger and 1 up a
 * piece (the Godot SDK's README: "glyph_id 0 == finger; 1+ == a piece"), so
 * the Chop Chop pieces are the Unity SDK's simulator icon numbers plus one:
 * spoon 1, sponge 2, spice mill 3, knife 4, little chef 5. Read on the Board
 * on 25 October 2026: with the icon numbers taken as they stand, the sponge
 * was the joystick, the mill attacked, the knife talked and the chef did
 * nothing. The spoon, sponge and knife do nothing.
 *
 * Both joysticks work alike (Stick). Where a piece is set down is its
 * centre, and Rings draws a ring of eight segments around it, far enough out
 * to be seen past the piece's base. Pushed until the piece's edge reaches
 * the ring (enter), the piece points in the direction of the octant its
 * centre is in; moved into another octant it points that way instead;
 * brought back inside leave, or lifted, it points nowhere. Turned in place
 * inside the small circle at the centre (TURN_ZONE), it counts the turn.
 *
 *   The mill holds down the keypad key of its direction (8 up, 9 up and
 *   right, 6 right, and on round to 7); the game walks on while the key is
 *   held (cythera_keys.md: a GetKeys loop). Turned, it presses keypad 5 once
 *   for each TURN degrees, which passes a turn; Rings fills an arc as the
 *   turn builds and flashes the ring when it passes. Until 28 October 2026
 *   it walked from 40 pixels out, well inside the ring, and the maintainer
 *   found it too ready to walk.
 *
 *   The chef is turned to choose one of COMMANDS: set down it reads None,
 *   and each STEP degrees clockwise is the next, round in a circle. Pushed
 *   into a direction, it presses the command's letter and then that
 *   direction's keypad key, once, each time it enters a direction: the
 *   letter arms the command and the key carries it out on the square that
 *   way (cythera_keys.md, "How the letter and the arrow relate"), and the
 *   game goes back to its usual mode after each one, so each push is armed
 *   afresh. At None a push does nothing. While it reads a command a
 *   finger's tap on the game is also that command's letter and then the
 *   press (MainActivity), which carries the command out on what is tapped
 *   (TDroppableWindow::MouseRoutine); at None, or with the chef lifted, a
 *   tap is a plain click.
 *
 * The detector's orientation is degrees anticlockwise from vertical
 * (e-z-g-disassembly, notes/carmen-time.md); only the change since set-down
 * is used.
 *
 * A finger is the game's mouse, unchanged (MainActivity). On the map, in
 * MOVE mode, the game reads a press by its gesture (MouseRoutine, 68K
 * CODE5+006484): a quick click Looks, and Searches as well when the square is
 * within reach; a double click does what suits what is there (walks to an
 * empty square, talks to a person or attacks a hostile one, uses an item,
 * Looks otherwise); a press held still for twice the double-click time opens
 * the Commands menu; a press on the hero that moves walks the hero towards
 * the finger while it is held; a press on a reachable item that moves
 * slides, drops or throws it. An armed command or a script asking for a
 * target takes the click first, and off the map a click is a click.
 */
final class PieceStick implements RawDataGlyphDetector.ContactEventWriter {
    static final String TAG = MainActivity.TAG;
    static final String MODEL = "chop_chop_v1.3.0.tflite";
    static final int MILL = 3, CHEF = 5;
    /** Display pixels from the centre inside which turning a piece counts: the small circle drawn there. */
    static final float TURN_ZONE = Rings.INNER;
    /** A piece's base, in display pixels from its centre, when the detector's box gives nothing sensible. */
    static final float BASE = 110;
    /** The push before a piece points, in display pixels, whatever its base: at least, and at most. */
    static final float PUSH_MIN = 60, PUSH_MAX = 170;
    /** Display pixels back from enter at which a piece stops pointing. */
    static final float RETURN = 24;
    /** Degrees past an octant's edge before the direction changes. */
    static final double SLACK = 8;
    /** Degrees the mill is turned in place for each keypad 5. */
    static final double TURN = 60;
    /** Degrees the chef is turned for each step of the dial, and past a step's edge before it changes. */
    static final double STEP = 60, CHEF_SLACK = 8;
    /** Ms a contact must stay one glyph before it acts. */
    static final long STEADY = 250;
    /** A touch that starts within NEAR display pixels of where a piece was seen in the last RECENT ms is a piece's, not a finger's. */
    static final float NEAR = 160;
    static final long RECENT = 400;
    /** Ms a contact must have been a piece before it marks one. */
    static final long REAL = 80;

    /** The Mac key code and character of each octant's keypad key, clockwise from up. */
    static final int[][] KEYS = {
        { 0x5B, '8' }, { 0x5C, '9' }, { 0x58, '6' }, { 0x55, '3' },
        { 0x54, '2' }, { 0x53, '1' }, { 0x56, '4' }, { 0x59, '7' } };
    static final int[] KEYPAD_5 = { 0x57, '5' };
    /** The chef's dial, clockwise from where it is set down: a name, and the Mac key code and character of its letter (cythera_keys.md, "Command modes"). */
    static final String[] COMMANDS = { "None", "Look", "Talk", "Attack", "Use", "Take" };
    static final int[][] LETTERS = { null, { 0x25, 'l' }, { 0x11, 't' }, { 0x00, 'a' }, { 0x20, 'u' }, { 0x05, 'g' } };

    /** One piece as a joystick: where it was set down, where it is, which way it points. */
    static final class Stick {
        int contact = -1;            // the contact, or -1 while the piece is not down
        float cx, cy, x, y;          // its centre, and where it is now
        float enter, leave;          // display pixels from the centre to point, and to stop
        double facing, turned;       // its last orientation, and the turn counted
        int octant = -1;             // the direction it points, or -1

        boolean down() { return contact >= 0; }

        /** Set down at C: its base is half the larger side of the detector's box, if that is sensible. */
        void setDown(BoardContactEvent c) {
            contact = c.contactId; cx = x = c.positionX; cy = y = c.positionY;
            facing = c.orientation; turned = 0; octant = -1;
            float box = Math.max(c.boundingBoxExtentsX, c.boundingBoxExtentsY);
            float base = box > 160 ? box / 2 : box;   // the box's whole side or half of it; which is not documented
            if (base < 40 || base > 200) base = BASE;
            enter = Math.max(PUSH_MIN, Math.min(PUSH_MAX, Rings.RADIUS - Rings.WIDTH / 2 - base));
            leave = enter - RETURN;
            Events.note(String.format("[piece] glyph %d down at %.0f,%.0f, box %.0f x %.0f, base %.0f, points from %.0f out",
                c.glyphId, cx, cy, c.boundingBoxExtentsX, c.boundingBoxExtentsY, base, enter));
        }

        /** Moved to C: the octant it points in now, or -1; the turn since the last call is added to turned while it is at the centre. */
        int moved(BoardContactEvent c) {
            x = c.positionX; y = c.positionY;
            float dx = x - cx, dy = y - cy;
            double r = Math.hypot(dx, dy);
            double step = turn(facing, c.orientation);
            facing = c.orientation;
            if (r < (octant < 0 ? enter : leave)) {
                // A turn counts only at the centre: pushing a piece out to
                // the ring turns it a little too.
                if (r < TURN_ZONE) turned += step;
                return octant = -1;
            }
            double deg = (Math.toDegrees(Math.atan2(dx, -dy)) + 360) % 360;  // clockwise from up; the screen's Y runs down
            int o = (int) Math.round(deg / 45) % 8;
            if (octant >= 0 && o != octant && Math.abs(turn(octant * 45, deg)) < 22.5 + SLACK) o = octant;
            return octant = o;
        }
    }

    static volatile PieceStick current;

    final MainActivity activity;
    final java.util.Map<Integer, long[]> since = new java.util.HashMap<>();   // contact: glyph, first time
    final java.util.Map<Integer, long[]> born = new java.util.HashMap<>();    // the same, for marking
    final float[][] marks = new float[16][];                                  // x, y, time of recent piece contacts
    int markAt;
    final java.util.BitSet seen = new java.util.BitSet();
    final Stick mill = new Stick(), chef = new Stick();
    int held = -1;                // the mill's keypad key held down, as an octant, or -1
    long passedAt;                // when the mill last passed a turn, for Rings
    volatile int command;         // the chef's reading, an index into COMMANDS
    long actedAt;                 // when the chef last carried out a command, for Rings

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

    /** The letter a finger's tap is to press first, or null for a plain click. */
    static int[] letter() {
        PieceStick p = current;
        return p == null || !p.chef.down() ? null : LETTERS[p.command];
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

    /** Degrees from A to B, in -180 to 180. */
    static double turn(double a, double b) { return ((b - a) % 360 + 540) % 360 - 180; }

    void press(int[] key) {
        Emulator emu = activity.emulator;
        emu.post(() -> Native.keyDown(key[0], key[1]));
        SystemClock.sleep(60);
        emu.post(() -> Native.keyUp(key[0], key[1]));
    }

    @Override
    public void onContactEvents(List<BoardContactEvent> contacts, long a, long b) {
        BoardContactEvent m = null, d = null;
        for (BoardContactEvent c : contacts) {
            if (c.phaseId == BoardContactEvent.BC_PHASE_BEGAN || gone(c))
                Events.note(String.format("[contact] %d %s: type %d glyph %d at %.0f,%.0f facing %.0f",
                    c.contactId, gone(c) ? "off" : "on", c.typeId, c.glyphId, c.positionX, c.positionY, c.orientation));
            if (c.typeId != BoardContactEvent.BC_TYPE_GLYPH || c.glyphId <= 0) { born.remove(c.contactId); continue; }   // 0 is a finger
            // A fingertip is read as a piece now and then, for 30 to 45 ms
            // (the knife and the spoon on 28 October 2026). Marked at once,
            // each of those flickers threw away every tap near it for RECENT
            // ms, and taps in a row kept throwing each other away. So a
            // contact marks a piece only once it has been one for REAL ms.
            if (gone(c)) born.remove(c.contactId);
            else {
                long now = System.currentTimeMillis();
                long[] first = born.get(c.contactId);
                if (first == null || first[0] != c.glyphId) born.put(c.contactId, first = new long[] { c.glyphId, now });
                if (now - first[1] >= REAL) mark(c.positionX, c.positionY);
            }
            boolean held = c.contactId == mill.contact || c.contactId == chef.contact;
            if (gone(c)) { since.remove(c.contactId); if (!held) continue; }
            // A contact acts only once it has been the same glyph for STEADY ms: a landing piece
            // flickered between glyphs in the SheepShaver app's runs (22 October 2026).
            else if (!held && !steady(c)) continue;
            if (!seen.get(c.glyphId)) {
                seen.set(c.glyphId);
                Events.note("[piece] first seen: glyph " + c.glyphId + (c.glyphId == MILL ? " (the joystick)"
                    : c.glyphId == CHEF ? " (the command joystick)" : " (ignored)"));
            }
            if (c.glyphId == MILL && m == null && (!mill.down() || c.contactId == mill.contact)) m = c;
            if (c.glyphId == CHEF && d == null && (!chef.down() || c.contactId == chef.contact)) d = c;
        }
        if (m == null && d == null) return;
        try {
            if (m != null) millMoved(m);
            if (d != null) chefMoved(d);
        } finally { activity.rings.postInvalidate(); }
    }

    synchronized void millMoved(BoardContactEvent c) {
        if (!mill.down()) { if (!gone(c)) mill.setDown(c); return; }
        if (gone(c)) { release(); mill.contact = -1; return; }
        int o = mill.moved(c);
        if (Math.abs(mill.turned) >= TURN) {
            mill.turned -= Math.signum(mill.turned) * TURN;
            passedAt = SystemClock.uptimeMillis();
            Events.note("[piece] mill turned: keypad 5");
            new Thread(() -> press(KEYPAD_5), "piece-turn").start();
        }
        if (o == held) return;
        release();
        if (o < 0) return;
        held = o;
        final int[] key = KEYS[o];
        activity.emulator.post(() -> Native.keyDown(key[0], key[1]));
    }

    void release() {
        if (held < 0) return;
        final int[] key = KEYS[held];
        activity.emulator.post(() -> Native.keyUp(key[0], key[1]));
        held = -1;
    }

    synchronized void chefMoved(BoardContactEvent c) {
        if (!chef.down()) {
            if (gone(c)) return;
            chef.setDown(c); command = 0;
            return;
        }
        if (gone(c)) { chef.contact = -1; command = 0; Events.note("[piece] chef lifted: plain clicks"); return; }
        int was = chef.octant;
        int o = chef.moved(c);
        // The dial: clockwise is the orientation falling, and only the turn
        // made at the centre counts, so pushing does not change the command.
        double cw = -chef.turned;
        int n = COMMANDS.length;
        int pick = ((int) Math.round(cw / STEP) % n + n) % n;
        if (pick != command && Math.abs(turn(command * STEP, cw)) >= STEP / 2 + CHEF_SLACK) {
            command = pick;
            Events.note("[piece] chef turned: " + COMMANDS[pick]);
        }
        if (o < 0 || o == was) return;
        final int[] letter = LETTERS[command], key = KEYS[o];
        if (letter == null) return;
        actedAt = SystemClock.uptimeMillis();
        Events.note("[piece] chef pushed: " + (char) letter[1] + " and keypad " + (char) key[1]);
        new Thread(() -> { press(letter); SystemClock.sleep(120); press(key); }, "piece-command").start();
    }
}
