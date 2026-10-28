package io.github.ratlizard.deerlizard;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Cythera on the Board, natively: the game's screen fills the display, a
 * finger is the mouse (down, drag and up as the button), two fingers zoom,
 * and the Board's menu button quits after the changed files are written.
 */
public class MainActivity extends Activity {
    static final String TAG = "Deerlizard";
    /** The game's screen height, in game pixels. */
    static final int HEIGHT = 720;

    // The Board's install check wants Board's native library loaded.
    static {
        try { System.loadLibrary("board"); } catch (Throwable t) { Log.w(TAG, "libboard did not load: " + t); }
    }

    Emulator emulator;
    SurfaceView view;
    Rings rings;   // drawn over the game while the spice mill or the chef is down
    SharedPreferences settings;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        DisplayMetrics m = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(m);
        // The game's screen is HEIGHT high and as wide as the display's
        // shape: 1280x720 on the Board's 1920x1080, scaled up 1.5 times (the
        // maintainer, 28 October 2026). Tried before it: 960x540, scaled
        // twice, from 25 October; 1920x1080 one to one, where a map square
        // was smaller than a piece; 480 high, where the windows left too
        // little room. A pinch zooms in.
        int dw = Math.max(m.widthPixels, m.heightPixels), dh = Math.min(m.widthPixels, m.heightPixels);
        int h = Math.min(HEIGHT, dh) & ~1;
        int w = Math.max(640, Math.round(dw * (float) h / dh)) & ~1;
        emulator = new Emulator(this, w, h);
        settings = getSharedPreferences("deerlizard", MODE_PRIVATE);
        Native.setUndither(undither());
        view = new SurfaceView(this);
        rings = new Rings(this);
        android.widget.FrameLayout frame = new android.widget.FrameLayout(this);
        frame.addView(view);
        frame.addView(rings);
        setContentView(frame);
        hideSystemBars();
        view.getHolder().addCallback(new SurfaceHolder.Callback() {
            @Override public void surfaceCreated(SurfaceHolder holder) { emulator.setSurface(holder.getSurface()); }
            @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { emulator.setSurface(holder.getSurface()); }
            @Override public void surfaceDestroyed(SurfaceHolder holder) { emulator.setSurface(null); }
        });
        view.setOnTouchListener(this::touch);
        BoardMenu.start(this);
        PieceStick.start(this);
        Remote.startIfConfigured(this);
        emulator.start();
        Log.i(TAG, "display " + m.widthPixels + "x" + m.heightPixels + ", game " + w + "x" + h);
    }

    boolean undither() { return settings.getBoolean("undither", false); }

    /** The undither filter on or off, and remembered for the next launch. */
    void setUndither(boolean on) {
        settings.edit().putBoolean("undither", on).apply();
        Native.setUndither(on);
        Events.note("[menu] undither " + (on ? "on" : "off"));
    }

    // --- the view: how far zoomed, and where ---------------------------------

    static final float MAX_ZOOM = 4;
    float zoom = 1, left, top;   // the part shown: zoom times as large, its top left corner in game pixels

    /** View pixels to the game's (v, h), through the zoom. */
    int[] game(float x, float y) {
        float vw = Math.max(1, view.getWidth()), vh = Math.max(1, view.getHeight());
        return new int[] {
            Math.round(top + y / vh * emulator.height / zoom),
            Math.round(left + x / vw * emulator.width / zoom),
        };
    }

    void showView() { Native.setView(zoom, left / emulator.width, top / emulator.height); }

    // --- touches -----------------------------------------------------------

    /*
     * A finger is the mouse. A press reaches the game PINCH_WAIT ms after the
     * finger lands, or as soon as it moves or lifts, whichever is first: a
     * second finger landing within that time makes the two a pinch, and the
     * game sees no press at all. A pinch on the browser player that pressed
     * the game first was a click on whatever lay under the first finger, which
     * is the fault the page's pinch_probe counts. A second finger landing
     * after the press has reached the game is ignored, as is any third.
     * Two pieces set down together also land as two touches, and were taken
     * for a pinch (the maintainer, 28 October 2026), so two touches only
     * begin to zoom once they have drawn PINCH_MOVE pixels apart or
     * together, and are dropped as pieces' if either turns out to be near a
     * piece before that.
     *
     * While the chef's dial reads a command (PieceStick), the press is the
     * command's letter and then the press, so the game carries the press out
     * as that command. Every mouse and key event goes through `inputs`, one
     * thread, in order, which is where the letter's waits are taken.
     *
     * The Board reported touches of its own at the top-left pixels every few
     * seconds to the web app; they are not a player's. A piece set down
     * touches the screen too (PieceStick.nearPiece). Neither is a finger.
     */
    static final long PINCH_WAIT = 90, HOLD = 80, LETTER = 60, ARMED = 120;
    static final float SLOP = 14, PINCH_MOVE = 30;
    boolean zooming;                // the two touches have begun to zoom
    final ExecutorService inputs = Executors.newSingleThreadExecutor();
    final Handler ui = new Handler(Looper.getMainLooper());
    final Set<Integer> ignored = new HashSet<>();   // pointers that are pieces, the Board's own, or extra fingers
    int mouse = -1;                 // the pointer that is the mouse, or -1
    boolean waiting, pressed;       // its press is yet to reach the game; has reached it
    float downX, downY;
    long pressedAt;                 // on the inputs thread: when the press reached the game
    int pinchA = -1, pinchB = -1;   // the two pointers of a pinch
    float pinchFrom, pinchZoom, pinchGameX, pinchGameY;
    final Runnable pressNow = this::press;

    boolean touch(View v, MotionEvent e) {
        int action = e.getActionMasked(), i = e.getActionIndex(), id = e.getPointerId(i);
        switch (action) {
            case MotionEvent.ACTION_DOWN:
            case MotionEvent.ACTION_POINTER_DOWN: {
                float x = e.getX(i), y = e.getY(i);
                boolean piece = (x < 8 && y < 12) || PieceStick.nearPiece(x, y);
                Events.note(String.format("[touch] %d down at %.0f,%.0f, size %.2f, major %.0f%s", id, x, y,
                    e.getSize(i), e.getTouchMajor(i), piece ? ", dropped as a piece's" : ""));
                if (piece || pinchA >= 0) { ignored.add(id); break; }
                if (mouse < 0) {
                    mouse = id; waiting = true; pressed = false; downX = x; downY = y;
                    ui.postDelayed(pressNow, PINCH_WAIT);
                } else if (waiting) {
                    ui.removeCallbacks(pressNow);
                    waiting = false;
                    startPinch(e, mouse, id);
                    mouse = -1;
                } else ignored.add(id);
                break;
            }
            case MotionEvent.ACTION_MOVE:
                if (pinchA >= 0) { pinch(e); break; }
                if (mouse < 0) break;
                int at = e.findPointerIndex(mouse);
                if (at < 0) break;
                float x = e.getX(at), y = e.getY(at);
                if (waiting && Math.hypot(x - downX, y - downY) > SLOP) { ui.removeCallbacks(pressNow); press(); }
                if (pressed) {
                    final int[] p = game(x, y);
                    inputs.execute(() -> emulator.post(() -> Native.mouseMove(p[0], p[1])));
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_POINTER_UP:
                if (ignored.remove(id)) break;
                if (id == pinchA || id == pinchB) {
                    // The finger left down is not the mouse.
                    int other = id == pinchA ? pinchB : pinchA;
                    if (action == MotionEvent.ACTION_POINTER_UP) ignored.add(other);
                    pinchA = pinchB = -1;
                    Events.note(String.format("[touch] zoom %.2f at %.0f,%.0f", zoom, left, top));
                    break;
                }
                if (id == mouse) {
                    if (waiting) { ui.removeCallbacks(pressNow); press(); }
                    release(e.getX(i), e.getY(i));
                }
                break;
            case MotionEvent.ACTION_CANCEL:
                ui.removeCallbacks(pressNow);
                if (mouse >= 0 && pressed) release(downX, downY);
                mouse = -1; waiting = false; pinchA = pinchB = -1;
                ignored.clear();
                break;
        }
        if (action == MotionEvent.ACTION_UP) ignored.clear();
        return true;
    }

    /** The mouse finger's press, preceded by the dial's command letter if it reads one. */
    void press() {
        if (!waiting) return;
        waiting = false;
        // A piece marks itself only once the detector has seen it for
        // PieceStick.REAL ms, which is before PINCH_WAIT is up: a piece set
        // down is caught here even when its touch came first.
        if (PieceStick.nearPiece(downX, downY)) {
            Events.note(String.format("[touch] %d at %.0f,%.0f is a piece's after all", mouse, downX, downY));
            ignored.add(mouse);
            mouse = -1;
            return;
        }
        pressed = true;
        final int[] p = game(downX, downY);
        final int[] key = PieceStick.letter();
        if (key != null) Events.note("[touch] " + (char) key[1] + " and a press");
        inputs.execute(() -> {
            if (key != null) {
                emulator.post(() -> Native.keyDown(key[0], key[1]));
                SystemClock.sleep(LETTER);
                emulator.post(() -> Native.keyUp(key[0], key[1]));
                SystemClock.sleep(ARMED);
            }
            emulator.post(() -> { Native.mouseMove(p[0], p[1]); Native.mouseDown(p[0], p[1]); });
            pressedAt = SystemClock.uptimeMillis();
        });
    }

    /** The mouse finger lifted; held at least HOLD ms, so a quick tap is not lost between two of the game's ticks. */
    void release(float x, float y) {
        mouse = -1;
        if (!pressed) return;
        pressed = false;
        final int[] p = game(x, y);
        inputs.execute(() -> {
            long wait = pressedAt + HOLD - SystemClock.uptimeMillis();
            if (wait > 0) SystemClock.sleep(wait);
            emulator.post(() -> { Native.mouseMove(p[0], p[1]); Native.mouseUp(p[0], p[1]); });
        });
    }

    void startPinch(MotionEvent e, int a, int b) {
        pinchA = a; pinchB = b; zooming = false;
        int ia = e.findPointerIndex(a), ib = e.findPointerIndex(b);
        float mx = (e.getX(ia) + e.getX(ib)) / 2, my = (e.getY(ia) + e.getY(ib)) / 2;
        pinchFrom = Math.max(1, (float) Math.hypot(e.getX(ia) - e.getX(ib), e.getY(ia) - e.getY(ib)));
        pinchZoom = zoom;
        // The game pixel under the fingers' midpoint stays under it.
        pinchGameX = left + mx / Math.max(1, view.getWidth()) * emulator.width / zoom;
        pinchGameY = top + my / Math.max(1, view.getHeight()) * emulator.height / zoom;
    }

    void pinch(MotionEvent e) {
        int ia = e.findPointerIndex(pinchA), ib = e.findPointerIndex(pinchB);
        if (ia < 0 || ib < 0) return;
        float mx = (e.getX(ia) + e.getX(ib)) / 2, my = (e.getY(ia) + e.getY(ib)) / 2;
        float d = (float) Math.hypot(e.getX(ia) - e.getX(ib), e.getY(ia) - e.getY(ib));
        if (!zooming) {
            if (PieceStick.nearPiece(e.getX(ia), e.getY(ia)) || PieceStick.nearPiece(e.getX(ib), e.getY(ib))) {
                Events.note("[touch] two touches are pieces', not a pinch");
                ignored.add(pinchA); ignored.add(pinchB);
                pinchA = pinchB = -1;
                return;
            }
            if (Math.abs(d - pinchFrom) < PINCH_MOVE) return;
            zooming = true;
        }
        float z = Math.max(1, Math.min(MAX_ZOOM, pinchZoom * d / pinchFrom));
        if (z < 1.04f) z = 1;
        float w = emulator.width / z, h = emulator.height / z;
        zoom = z;
        left = Math.max(0, Math.min(emulator.width - w, pinchGameX - mx / Math.max(1, view.getWidth()) * w));
        top = Math.max(0, Math.min(emulator.height - h, pinchGameY - my / Math.max(1, view.getHeight()) * h));
        showView();
    }

    /** Writes the changed files and ends the app. */
    void quit() {
        new Thread(() -> {
            emulator.stopping = true;
            try { emulator.join(5000); } catch (InterruptedException ignored) { }
            BoardMenu.end();
        }, "quit").start();
    }

    void hideSystemBars() {
        getWindow().setDecorFitsSystemWindows(false);
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) {
            c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) { hideSystemBars(); BoardMenu.show(); }
    }

    @Override
    public void onBackPressed() { quit(); }
}
