package io.github.ratlizard.deerlizard;

import android.content.Context;
import android.util.Log;

/**
 * Cythera's movement setting, set before the game starts. It is byte 0 of
 * 'Pref' 130 ('UI Prefs') in System Folder/Preferences/Cythera Preferences
 * (the workbench's cheats.md, "The UI Prefs record"): bit 7 animates a move
 * between squares and bit 1 makes it four steps ("Smoother Movement"). With
 * no file the game picks the 68040's defaults, 0x18, one jump a square,
 * which on the Board made walking hard to follow with the mill. The other
 * bits are kept: bits 2-5, the frame-rate cap, stay at the game's 10 frames
 * a second (the maintainer, 25 October 2026), and bits 0 and 6 are the
 * player's.
 */
final class Prefs {
    static final String PATH = "System Folder/Preferences/Cythera Preferences";
    static final int SMOOTHER = 0x82;

    /** Sets byte 0 of 'Pref' 130 in a resource fork; false if the fork has none. */
    static boolean patch(byte[] rsrc) {
        try {
            int dataAt = u32(rsrc, 0), mapAt = u32(rsrc, 4);
            int types = mapAt + u16(rsrc, mapAt + 24);
            int count = u16(rsrc, types) + 1;
            for (int t = 0; t < count; t++) {
                int e = types + 2 + t * 8;
                if (u32(rsrc, e) != 0x50726566) continue;   // 'Pref'
                int refs = types + u16(rsrc, e + 6), n = u16(rsrc, e + 4) + 1;
                for (int r = 0; r < n; r++) {
                    int ref = refs + r * 12;
                    if (u16(rsrc, ref) != 130) continue;
                    int at = dataAt + (u32(rsrc, ref + 4) & 0xFFFFFF) + 4;
                    int was = rsrc[at] & 0xFF;
                    rsrc[at] = (byte) (was | SMOOTHER);
                    Log.i(MainActivity.TAG, String.format("UI Prefs byte 0: %02x to %02x", was, rsrc[at] & 0xFF));
                    return true;
                }
            }
        } catch (ArrayIndexOutOfBoundsException e) { Log.w(MainActivity.TAG, "Cythera Preferences: " + e); }
        return false;
    }

    /**
     * Before the game starts: the stored preferences file with the settings
     * set, or, with none stored, the asset prefs/resource.fork (a file the
     * game wrote, from the workbench's drive-scripts fixtures).
     */
    static void apply(Context context, byte[] stored, int[] info) {
        try {
            byte[] rsrc = stored != null ? stored : Emulator.readAll(context.getAssets().open("prefs/resource.fork"));
            if (info == null) info = new int[] { 0x70726566, 0x3F3F3F3F, 0, 0, 0 };   // 'pref', '????'
            if (patch(rsrc)) Native.importFile(PATH, info[0], info[1], info[2], info[3], info[4], new byte[0], rsrc);
        } catch (Exception e) { Log.w(MainActivity.TAG, "Cythera Preferences: " + e); }
    }

    static int u16(byte[] b, int i) { return ((b[i] & 0xFF) << 8) | (b[i + 1] & 0xFF); }
    static int u32(byte[] b, int i) { return (u16(b, i) << 16) | u16(b, i + 2); }
}
