package io.github.ratlizard.deerlizard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

/**
 * A ring drawn on top of the game around where the spice mill was set down,
 * so the player can see the centre the joystick measures from: eight
 * segments for the eight directions, the one held filled, and a line from the
 * centre to where the mill is now. The mill itself covers its centre, so the
 * ring is drawn wider than the piece. Nothing is drawn while no mill is down.
 * It takes no touches; MainActivity's view below it does.
 */
final class MillRing extends View {
    static final float RADIUS = 150, WIDTH = 28;
    final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG), held = new Paint(Paint.ANTI_ALIAS_FLAG), line = new Paint(Paint.ANTI_ALIAS_FLAG);
    final RectF box = new RectF();

    MillRing(Context c) {
        super(c);
        ring.setStyle(Paint.Style.STROKE); ring.setStrokeWidth(WIDTH); ring.setColor(0x60FFFFFF);
        held.setStyle(Paint.Style.STROKE); held.setStrokeWidth(WIDTH); held.setColor(0xD0F0C040);
        line.setStyle(Paint.Style.STROKE); line.setStrokeWidth(6); line.setColor(0xD0F0C040);
        setClickable(false);
        setFocusable(false);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        PieceStick p = PieceStick.current;
        if (p == null) return;
        float cx, cy, x, y;
        int octant;
        synchronized (p) {
            if (p.stick < 0) return;
            cx = p.cx; cy = p.cy; x = p.nowX; y = p.nowY; octant = p.octant;
        }
        box.set(cx - RADIUS, cy - RADIUS, cx + RADIUS, cy + RADIUS);
        // Clockwise from up, as PieceStick numbers the octants; Android's
        // angles start at 3 o'clock, so up is -90.
        for (int o = 0; o < 8; o++)
            canvas.drawArc(box, -90 + o * 45 - 19, 38, false, o == octant ? held : ring);
        canvas.drawCircle(cx, cy, PieceStick.ENTER, ring);
        if (Math.hypot(x - cx, y - cy) > 4) canvas.drawLine(cx, cy, x, y, line);
    }
}
