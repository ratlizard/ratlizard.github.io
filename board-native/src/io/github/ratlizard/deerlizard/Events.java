package io.github.ratlizard.deerlizard;

import android.util.Log;

/**
 * The piece and touch lines, logged and kept: the last LIMIT of them, for
 * Remote's `events`. The Board's own log buffer holds only the last few
 * seconds, since the Board SDK writes a BOARD_LATENCY line every frame, so
 * a player's session is gone from it by the time anyone reads it.
 */
final class Events {
    static final int LIMIT = 200;
    static final String[] lines = new String[LIMIT];
    static int next;

    static synchronized void note(String line) {
        Log.i(MainActivity.TAG, line);
        lines[next++ % LIMIT] = String.format("%tT %s", System.currentTimeMillis(), line);
    }

    /** The kept lines, oldest first, joined by " | " so they fit Remote's one-line answer. */
    static synchronized String all() {
        StringBuilder b = new StringBuilder();
        for (int i = Math.max(0, next - LIMIT); i < next; i++) b.append(lines[i % LIMIT]).append(" | ");
        return b.toString();
    }
}
