package io.github.ratlizard.deerlizard;

import android.app.Activity;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

/**
 * Cythera on the Board, natively: the game's screen fills the display, a
 * finger is the mouse (down, drag and up as the button), and the Board's menu
 * button quits after the changed files are written.
 */
public class MainActivity extends Activity {
    static final String TAG = "Deerlizard";

    // The Board's install check wants Board's native library loaded.
    static {
        try { System.loadLibrary("board"); } catch (Throwable t) { Log.w(TAG, "libboard did not load: " + t); }
    }

    Emulator emulator;
    SurfaceView view;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        DisplayMetrics m = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(m);
        // The game's screen is 480 high, the least it runs at, and as wide as
        // the display's shape: 853 on the Board's 1920x1080. The compositor
        // scales it up, so a map square is big enough to set a piece on;
        // at the display's full size a square was smaller than a piece.
        int dw = Math.max(m.widthPixels, m.heightPixels), dh = Math.min(m.widthPixels, m.heightPixels);
        int h = 480;
        int w = Math.max(640, Math.round(dw * 480f / dh)) & ~1;
        emulator = new Emulator(this, w, h);
        view = new SurfaceView(this);
        setContentView(view);
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

    /** View pixels to the game's (v, h). */
    int[] game(float x, float y) {
        return new int[] {
            Math.round(y * emulator.height / Math.max(1, view.getHeight())),
            Math.round(x * emulator.width / Math.max(1, view.getWidth())),
        };
    }

    boolean pieceTouch;   // the touch now down is not a finger's

    boolean touch(View v, MotionEvent e) {
        if (e.getPointerId(e.getActionIndex()) != 0) return true;
        // The Board reported touches of its own at the top-left pixels every
        // few seconds to the web app; they are not a player's. A piece set
        // down touches the screen too (PieceStick).
        if (e.getActionMasked() == MotionEvent.ACTION_DOWN) {
            pieceTouch = (e.getX() < 8 && e.getY() < 12) || PieceStick.nearPiece(e.getX(), e.getY());
            Events.note(String.format("[touch] down at %.0f,%.0f, size %.2f, major %.0f%s", e.getX(), e.getY(),
                e.getSize(), e.getTouchMajor(), pieceTouch ? ", dropped as a piece's" : ""));
        }
        if (pieceTouch) return true;
        final int[] p = game(e.getX(), e.getY());
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                emulator.post(() -> { Native.mouseMove(p[0], p[1]); Native.mouseDown(p[0], p[1]); });
                break;
            case MotionEvent.ACTION_MOVE:
                emulator.post(() -> Native.mouseMove(p[0], p[1]));
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                emulator.post(() -> { Native.mouseMove(p[0], p[1]); Native.mouseUp(p[0], p[1]); });
                break;
        }
        return true;
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
