package io.github.ratlizard.deerlizard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.View;

/**
 * What PieceStick's two pieces are doing, drawn on top of the game in
 * display pixels.
 *
 * Around the spice mill: a ring of eight segments for the eight directions,
 * the one held filled, a small circle at the centre and a line from the
 * centre to where the mill is now. The mill walks once the line reaches the
 * ring. Turning it inside the small circle fills an arc round that circle as
 * the turn builds; when a turn passes, the whole ring flashes for FLASH ms.
 * The mill covers its centre, so the ring is drawn wider than the piece.
 *
 * Around the little chef: a ring of six segments, one for each of
 * PieceStick.COMMANDS clockwise from the top, each named outside it, with
 * the one the dial reads filled.
 *
 * Nothing is drawn for a piece that is not down. The view takes no touches;
 * MainActivity's view below it does.
 */
final class Rings extends View {
    static final float RADIUS = 150, WIDTH = 28, INNER = 40;
    static final long FLASH = 450;
    final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG), held = new Paint(Paint.ANTI_ALIAS_FLAG),
        line = new Paint(Paint.ANTI_ALIAS_FLAG), flash = new Paint(Paint.ANTI_ALIAS_FLAG),
        label = new Paint(Paint.ANTI_ALIAS_FLAG), chosen = new Paint(Paint.ANTI_ALIAS_FLAG);
    final RectF box = new RectF(), inner = new RectF();

    Rings(Context c) {
        super(c);
        ring.setStyle(Paint.Style.STROKE); ring.setStrokeWidth(WIDTH); ring.setColor(0x60FFFFFF);
        held.setStyle(Paint.Style.STROKE); held.setStrokeWidth(WIDTH); held.setColor(0xD0F0C040);
        line.setStyle(Paint.Style.STROKE); line.setStrokeWidth(6); line.setColor(0xD0F0C040);
        flash.setStyle(Paint.Style.FILL);
        for (Paint p : new Paint[] { label, chosen }) {
            p.setTextSize(30); p.setTextAlign(Paint.Align.CENTER); p.setShadowLayer(4, 0, 0, 0xFF000000);
        }
        label.setColor(0xD0FFFFFF);
        chosen.setColor(0xFFF0C040); chosen.setFakeBoldText(true);
        setClickable(false);
        setFocusable(false);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        PieceStick p = PieceStick.current;
        if (p == null) return;
        boolean mill, chef;
        float cx, cy, x, y, chefX, chefY;
        int octant, command;
        double turned;
        long passedAt;
        synchronized (p) {
            mill = p.stick >= 0; chef = p.chef >= 0;
            cx = p.cx; cy = p.cy; x = p.nowX; y = p.nowY; octant = p.octant; turned = p.turned; passedAt = p.passedAt;
            chefX = p.chefX; chefY = p.chefY; command = p.command;
        }
        if (mill) {
            long since = SystemClock.uptimeMillis() - passedAt;
            boolean flashing = passedAt != 0 && since < FLASH;
            box.set(cx - RADIUS, cy - RADIUS, cx + RADIUS, cy + RADIUS);
            if (flashing) {
                int alpha = (int) (0x70 * (1 - since / (float) FLASH));
                flash.setColor(alpha << 24 | 0xF0C040);
                canvas.drawCircle(cx, cy, RADIUS - WIDTH / 2, flash);
            }
            // Clockwise from up, as PieceStick numbers the octants; Android's
            // angles start at 3 o'clock, so up is -90.
            for (int o = 0; o < 8; o++)
                canvas.drawArc(box, -90 + o * 45 - 19, 38, false, o == octant || flashing ? held : ring);
            canvas.drawCircle(cx, cy, INNER, ring);
            // The turn so far, round the small circle. The orientation runs
            // anticlockwise and Android's angles clockwise.
            if (Math.abs(turned) > 2) {
                inner.set(cx - INNER, cy - INNER, cx + INNER, cy + INNER);
                canvas.drawArc(inner, -90, (float) (-turned / PieceStick.TURN * 360), false, held);
            }
            if (Math.hypot(x - cx, y - cy) > 4) canvas.drawLine(cx, cy, x, y, line);
            if (flashing) postInvalidateOnAnimation();
        }
        if (chef) {
            box.set(chefX - RADIUS, chefY - RADIUS, chefX + RADIUS, chefY + RADIUS);
            int n = PieceStick.COMMANDS.length;
            float sweep = 360f / n;
            for (int i = 0; i < n; i++) {
                canvas.drawArc(box, -90 + i * sweep - sweep / 2 + 3, sweep - 6, false, i == command ? held : ring);
                double a = Math.toRadians(-90 + i * sweep);
                float r = RADIUS + WIDTH / 2 + 30;
                Paint t = i == command ? chosen : label;
                canvas.drawText(PieceStick.COMMANDS[i], chefX + (float) Math.cos(a) * r,
                    chefY + (float) Math.sin(a) * r - (t.ascent() + t.descent()) / 2, t);
            }
        }
    }
}
