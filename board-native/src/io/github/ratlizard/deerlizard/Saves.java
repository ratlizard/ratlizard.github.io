package io.github.ratlizard.deerlizard;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * The game's changed files, one file each in the app's saves/ folder, as the
 * page keeps them in IndexedDB: restored between load and start, scanned
 * every two seconds and on the way out. Each holds the game path, type,
 * creator, Finder flags, dates and both forks. Called on Emulator's thread.
 */
final class Saves {
    static final String TAG = MainActivity.TAG;
    final Context context;
    final File dir;

    Saves(Context context) {
        this.context = context;
        dir = new File(context.getFilesDir(), "saves");
        dir.mkdirs();
    }

    static String fileName(String path) {
        StringBuilder b = new StringBuilder();
        for (byte c : path.getBytes(java.nio.charset.StandardCharsets.UTF_8)) b.append(String.format("%02x", c & 0xff));
        return b.length() > 200 ? Integer.toHexString(path.hashCode()) + ".sav" : b + ".sav";
    }

    int restore() {
        int n = 0;
        byte[] prefs = null;
        int[] prefsInfo = null;
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) {
            if (!f.getName().endsWith(".sav")) continue;
            try (DataInputStream in = new DataInputStream(new FileInputStream(f))) {
                String path = in.readUTF();
                int type = in.readInt(), creator = in.readInt(), flags = in.readInt(), created = in.readInt(), modified = in.readInt();
                byte[] data = new byte[in.readInt()]; in.readFully(data);
                byte[] rsrc = new byte[in.readInt()]; in.readFully(rsrc);
                n++;
                if (path.equals(Prefs.PATH)) { prefs = rsrc; prefsInfo = new int[] { type, creator, flags, created, modified }; continue; }
                Native.importFile(path, type, creator, flags, created, modified, data, rsrc);
            } catch (IOException e) {
                Log.w(TAG, "save " + f.getName() + " not restored: " + e);
            }
        }
        Prefs.apply(context, prefs, prefsInfo);
        return n;
    }

    /**
     * The characters in the APK's seed/ folder (a kit save folder each:
     * metadata.json, data.fork, resource.fork), put in the game's folder the
     * first time the app starts.
     */
    int seed(String folder) {
        File done = new File(dir, "seeded");
        if (done.exists() || folder.isEmpty()) return 0;
        int n = 0;
        try {
            String[] names = context.getAssets().list("seed");
            if (names != null) for (String name : names) {
                String at = "seed/" + name + "/";
                JSONObject md = new JSONObject(new String(Emulator.readAll(context.getAssets().open(at + "metadata.json")), "UTF-8"));
                int[] info = { (int) md.getLong("file_type"), (int) md.getLong("creator"),
                    md.getInt("finder_flags"), (int) md.getLong("created_date"), (int) md.getLong("modified_date") };
                byte[] data = Emulator.readAll(context.getAssets().open(at + "data.fork"));
                byte[] rsrc = Emulator.readAll(context.getAssets().open(at + "resource.fork"));
                Native.importFile(folder + name, info[0], info[1], info[2], info[3], info[4], data, rsrc);
                // The module counts an imported file as stored, and the scan
                // writes only what the game changes: kept here, the character
                // is restored at the next launch, when it is not seeded again.
                if (!write(folder + name, info, data, rsrc)) return n;
                n++;
            }
            done.createNewFile();
        } catch (Exception e) {
            Log.w(TAG, "seed: " + e);
        }
        return n;
    }

    void scan() {
        int count = Native.saveScan();
        for (int i = 0; i < count; i++) {
            String path = Native.savePath(i);
            int[] info = Native.saveInfo(i);
            if (!write(path, info, Native.saveData(i), Native.saveRsrc(i))) return;
        }
        if (count > 0) Native.saveAck();
    }

    /** One file into saves/: path, type, creator, Finder flags, dates, then both forks. */
    boolean write(String path, int[] info, byte[] data, byte[] rsrc) {
        File tmp = new File(dir, "writing"), out = new File(dir, fileName(path));
        try (DataOutputStream o = new DataOutputStream(new FileOutputStream(tmp))) {
            o.writeUTF(path);
            for (int v : info) o.writeInt(v);
            o.writeInt(data.length); o.write(data);
            o.writeInt(rsrc.length); o.write(rsrc);
        } catch (IOException e) {
            Log.w(TAG, "save " + path + " not written: " + e);
            return false;
        }
        if (!tmp.renameTo(out)) { Log.w(TAG, "save " + path + " not renamed"); return false; }
        Log.i(TAG, "saved " + path + " (" + data.length + " + " + rsrc.length + " bytes)");
        return true;
    }
}
