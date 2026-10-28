package io.github.ratlizard.deerlizard;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.View;

/**
 * What PieceStick's two joysticks are doing, drawn on top of the game in
 * display pixels.
 *
 * Around each piece: a ring of eight segments for the eight directions, far
 * enough out to be seen past the piece's base (on 28 October 2026, at 150
 * pixels, the maintainer found it barely wider than the mill), with the
 * whole slice from the centre out to the ring filled in the direction the
 * piece points; a small circle at the centre, inside which turning counts;
 * and a line from the centre to where the piece is now.
 *
 * The mill fills an arc round the small circle as a turn builds; when a turn
 * passes, the whole ring flashes for FLASH ms.
 *
 * The chef has its commands around the outside of its ring, clockwise from
 * the top as PieceStick.COMMANDS has them, each drawn as one of the
 * program's cursors (CURSORS; cursors.py writes them at build time), the
 * one the dial reads on a lit square. The slice it is pushed into flashes
 * when the command is carried out. The program shows one targeting cursor
 * for every command (TDroppableWindow::CursorRoutine, the workbench's
 * doc/functions), so these are chosen from its other cursors. Without the
 * pictures, the names are written instead.
 *
 * Nothing is drawn for a piece that is not down. The view takes no touches;
 * MainActivity's view below it does.
 */
final class Rings extends View {
    static final float RADIUS = 230, WIDTH = 40, INNER = 40;
    static final long FLASH = 450;
    /** The program's cursor ('crsr') for each of PieceStick.COMMANDS. build.sh reads this line. */
    static final int[] CURSORS = {170, 141, 160, 136, 169, 139};
    /** Display pixels a cursor's 16 is drawn at. */
    static final int ICON = 64;
    final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG), held = new Paint(Paint.ANTI_ALIAS_FLAG),
        slice = new Paint(Paint.ANTI_ALIAS_FLAG), line = new Paint(Paint.ANTI_ALIAS_FLAG),
        flash = new Paint(Paint.ANTI_ALIAS_FLAG), label = new Paint(Paint.ANTI_ALIAS_FLAG),
        chosen = new Paint(Paint.ANTI_ALIAS_FLAG), plate = new Paint(Paint.ANTI_ALIAS_FLAG),
        pixels = new Paint();
    final RectF box = new RectF(), inner = new RectF(), wedge = new RectF();
    final Rect to = new Rect();
    final Bitmap[] icons = new Bitmap[PieceStick.COMMANDS.length];

    Rings(Context c) {
        super(c);
        ring.setStyle(Paint.Style.STROKE); ring.setStrokeWidth(WIDTH); ring.setColor(0x70FFFFFF);
        held.setStyle(Paint.Style.STROKE); held.setStrokeWidth(WIDTH); held.setColor(0xE0F0C040);
        slice.setStyle(Paint.Style.FILL); slice.setColor(0x60F0C040);
        line.setStyle(Paint.Style.STROKE); line.setStrokeWidth(6); line.setColor(0xD0F0C040);
        flash.setStyle(Paint.Style.FILL);
        plate.setStyle(Paint.Style.FILL);
        for (Paint p : new Paint[] { label, chosen }) {
            p.setTextSize(30); p.setTextAlign(Paint.Align.CENTER); p.setShadowLayer(4, 0, 0, 0xFF000000);
        }
        label.setColor(0xD0FFFFFF);
        chosen.setColor(0xFFF0C040); chosen.setFakeBoldText(true);
        pixels.setFilterBitmap(false);   // a cursor's pixels stay square
        for (int i = 0; i < icons.length; i++) {
            try { icons[i] = BitmapFactory.decodeStream(c.getAssets().open("cursors/" + CURSORS[i] + ".png")); }
            catch (Exception none) { }
        }
        setClickable(false);
        setFocusable(false);
    }

    /** One joystick's ring: the eight segments, the slice it points in, the centre circle and the line. */
    void drawStick(Canvas canvas, float cx, float cy, float x, float y, int octant, boolean lit, Paint fill) {
        box.set(cx - RADIUS, cy - RADIUS, cx + RADIUS, cy + RADIUS);
        // Clockwise from up, as PieceStick numbers the octants; Android's
        // angles start at 3 o'clock, so up is -90.
        if (octant >= 0) {
            float r = RADIUS + WIDTH / 2;
            wedge.set(cx - r, cy - r, cx + r, cy + r);
            canvas.drawArc(wedge, -90 + octant * 45 - 22.5f, 45, true, fill);
        }
        for (int o = 0; o < 8; o++)
            canvas.drawArc(box, -90 + o * 45 - 19, 38, false, o == octant || lit ? held : ring);
        canvas.drawCircle(cx, cy, INNER, ring);
        if (Math.hypot(x - cx, y - cy) > 4) canvas.drawLine(cx, cy, x, y, line);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        PieceStick p = PieceStick.current;
        if (p == null) return;
        PieceStick.Stick m = new PieceStick.Stick(), d = new PieceStick.Stick();
        int command;
        long passedAt, actedAt;
        synchronized (p) {
            copy(p.mill, m); copy(p.chef, d);
            command = p.command; passedAt = p.passedAt; actedAt = p.actedAt;
        }
        long now = SystemClock.uptimeMillis();
        boolean animating = false;
        if (m.down()) {
            long since = now - passedAt;
            boolean flashing = passedAt != 0 && since < FLASH;
            if (flashing) {
                flash.setColor((int) (0x70 * (1 - since / (float) FLASH)) << 24 | 0xF0C040);
                canvas.drawCircle(m.cx, m.cy, RADIUS - WIDTH / 2, flash);
                animating = true;
            }
            drawStick(canvas, m.cx, m.cy, m.x, m.y, m.octant, flashing, slice);
            // The turn so far, round the small circle. The orientation runs
            // anticlockwise and Android's angles clockwise.
            double part = m.turned % PieceStick.TURN;
            if (Math.abs(part) > 2) {
                inner.set(m.cx - INNER, m.cy - INNER, m.cx + INNER, m.cy + INNER);
                canvas.drawArc(inner, -90, (float) (-part / PieceStick.TURN * 360), false, held);
            }
        }
        if (d.down()) {
            long since = now - actedAt;
            Paint fill = slice;
            if (actedAt != 0 && since < FLASH) {
                flash.setColor((int) (0x60 + 0x60 * (1 - since / (float) FLASH)) << 24 | 0xF0C040);
                fill = flash;
                animating = true;
            }
            drawStick(canvas, d.cx, d.cy, d.x, d.y, d.octant, false, fill);
            int n = PieceStick.COMMANDS.length;
            float sweep = 360f / n, r = RADIUS + WIDTH / 2 + ICON * 0.75f;
            for (int i = 0; i < n; i++) {
                double a = Math.toRadians(-90 + i * sweep);
                float ix = d.cx + (float) Math.cos(a) * r, iy = d.cy + (float) Math.sin(a) * r;
                boolean on = i == command;
                if (icons[i] != null) {
                    int half = ICON / 2 + 8;
                    plate.setColor(on ? 0xE0F0C040 : 0x90000000);
                    canvas.drawRoundRect(ix - half, iy - half, ix + half, iy + half, 10, 10, plate);
                    to.set((int) ix - ICON / 2, (int) iy - ICON / 2, (int) ix + ICON / 2, (int) iy + ICON / 2);
                    canvas.drawBitmap(icons[i], null, to, pixels);
                } else {
                    Paint t = on ? chosen : label;
                    canvas.drawText(PieceStick.COMMANDS[i], ix, iy - (t.ascent() + t.descent()) / 2, t);
                }
            }
        }
        if (animating) postInvalidateOnAnimation();
    }

    static void copy(PieceStick.Stick from, PieceStick.Stick to) {
        to.contact = from.contact; to.cx = from.cx; to.cy = from.cy; to.x = from.x; to.y = from.y;
        to.octant = from.octant; to.turned = from.turned;
    }
}
