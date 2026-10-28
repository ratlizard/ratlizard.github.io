package io.github.ratlizard.deerlizard;

import android.os.SystemClock;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.ServerSocket;
import java.net.Socket;

/**
 * In a test build (the asset `remote`, holding a port), takes the game's
 * input from a computer on the network, one command a line, in the game's
 * screen pixels (x, y):
 *   click X Y        move, press, hold 250 ms, release
 *   move X Y / down X Y / up X Y
 *   key CODE CHAR    a Mac key code and character code, pressed for 120 ms
 *   stat             the last second's figures
 *   events           the last piece and touch lines (Events)
 *   undither on|off  the undither filter, as the pause screen's button
 *   indices on|off   whether the filter leaves the animated colours alone
 *   zoom Z U V       Z times as large, the top left corner at (U, V) in
 *                    fractions of the screen, as a pinch leaves it
 * Each line is answered "ok", the figures, or "? LINE".
 */
final class Remote extends Thread {
    final MainActivity activity;
    final int port;

    Remote(MainActivity activity, int port) { this.activity = activity; this.port = port; setDaemon(true); setName("remote"); }

    static void startIfConfigured(MainActivity a) {
        try {
            String text = new String(Emulator.readAll(a.getAssets().open("remote")), "UTF-8").trim();
            new Remote(a, Integer.parseInt(text)).start();
        } catch (Exception none) { }
    }

    @Override
    public void run() {
        try (ServerSocket server = new ServerSocket(port)) {
            Log.i(MainActivity.TAG, "[remote] listening on port " + port);
            for (;;) {
                try (Socket s = server.accept()) {
                    BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), "UTF-8"));
                    PrintWriter out = new PrintWriter(s.getOutputStream(), true);
                    for (String line; (line = in.readLine()) != null; ) out.println(command(line.trim()));
                } catch (Exception e) { Log.w(MainActivity.TAG, "[remote] " + e); }
            }
        } catch (Exception e) { Log.e(MainActivity.TAG, "[remote] no server: " + e); }
    }

    String command(String line) {
        Emulator emu = activity.emulator;
        String[] w = line.split("\\s+");
        Log.i(MainActivity.TAG, "[remote] " + line);
        try {
            switch (w[0]) {
                case "stat": return emu.status;
                case "events": return Events.all();
                case "undither": activity.runOnUiThread(() -> activity.setUndither(w[1].equals("on"))); return "ok";
                case "indices": Native.setUnditherIndices(w[1].equals("on")); return "ok";
                case "zoom": {
                    final float z = Float.parseFloat(w[1]), u = Float.parseFloat(w[2]), v = Float.parseFloat(w[3]);
                    activity.runOnUiThread(() -> {
                        activity.zoom = z; activity.left = u * emu.width; activity.top = v * emu.height;
                        activity.showView();
                    });
                    return "ok";
                }
                case "key": {
                    final int code = Integer.decode(w[1]), ch = Integer.decode(w[2]);
                    emu.post(() -> Native.keyDown(code, ch));
                    SystemClock.sleep(120);
                    emu.post(() -> Native.keyUp(code, ch));
                    return "ok";
                }
            }
            final int x = Integer.parseInt(w[1]), y = Integer.parseInt(w[2]);
            switch (w[0]) {
                case "click":
                    emu.post(() -> { Native.mouseMove(y, x); Native.mouseDown(y, x); });
                    SystemClock.sleep(250);
                    emu.post(() -> Native.mouseUp(y, x));
                    return "ok";
                case "move": emu.post(() -> Native.mouseMove(y, x)); return "ok";
                case "down": emu.post(() -> { Native.mouseMove(y, x); Native.mouseDown(y, x); }); return "ok";
                case "up": emu.post(() -> Native.mouseUp(y, x)); return "ok";
            }
        } catch (Exception e) { return "? " + line + " (" + e + ")"; }
        return "? " + line;
    }
}
