package io.github.ratlizard.deerlizard;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.SystemClock;
import android.util.Log;
import android.view.Surface;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * The thread that runs the game: boots the module, then paces it to the wall
 * clock as the page's play loop does (www/index.html, frame()), drawing each
 * frame into the surface and the sound into an AudioTrack. Input and the
 * surface come from other threads through queues and fields read here.
 */
final class Emulator extends Thread {
    static final String TAG = MainActivity.TAG;
    static final double VBL_HZ = 60.15;
    static final int RATE = 22050, MAX_STEPS = 2_000_000, SLICE = 150_000;
    static final long MAC_EPOCH_OFFSET = 2082844800L;

    final Context context;
    final int width, height;
    final ConcurrentLinkedQueue<Runnable> input = new ConcurrentLinkedQueue<>();
    volatile Surface surface;
    volatile boolean surfaceChanged;
    volatile String status = "booting";
    volatile boolean stopping;
    final Saves saves;

    Emulator(Context context, int width, int height) {
        this.context = context;
        this.width = width;
        this.height = height;
        this.saves = new Saves(context);
        setName("emulator");
    }

    void setSurface(Surface s) { surface = s; surfaceChanged = true; }

    /** Runs on this thread before the next frame. */
    void post(Runnable r) { input.add(r); }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(in.available(), 1 << 16));
        byte[] buf = new byte[1 << 16];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    void boot() throws IOException {
        long t0 = SystemClock.uptimeMillis();
        byte[] archive = readAll(context.getAssets().open("game.sit"));
        int epoch = (int) (System.currentTimeMillis() / 1000 + MAC_EPOCH_OFFSET);
        if (Native.load(archive, epoch, width, height, true) != 0) throw new IOException("load: " + Native.error());
        archive = null;
        int restored = saves.restore();
        int seeded = saves.seed(Native.gameFolder());
        int tunes = 0;
        String[] names = context.getAssets().list("tunes");
        if (names != null) for (String name : names) {
            if (!name.endsWith(".wav")) continue;
            int checksum = (int) Long.parseLong(name.substring(0, name.length() - 4), 16);
            if (Native.tuneInstall(checksum, readAll(context.getAssets().open("tunes/" + name))) != 0) tunes++;
        }
        Native.start();
        Log.i(TAG, "booted in " + (SystemClock.uptimeMillis() - t0) + " ms, screen " + Native.width() + "x" + Native.height()
            + ", " + Native.instructionsPerTick() + " instructions/tick, " + restored + " save file(s) restored, "
            + seeded + " seeded, " + tunes + " tune(s)");
    }

    @Override
    public void run() {
        try {
            boot();
        } catch (Throwable t) {
            status = "boot failed: " + t;
            Log.e(TAG, status, t);
            return;
        }
        AudioTrack track = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_8BIT)
                .setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(RATE / 2).setTransferMode(AudioTrack.MODE_STREAM).build();
        track.play();
        byte[] audio = new byte[RATE * 4];
        play(track, audio);
        track.release();
    }

    // The page's catch-up slice: starts small and grows while calls are
    // quick, so an expensive stretch is met in a small slice.
    int catchSlice = 20_000;
    int runCatchup(long now, long budgetMs) {
        int s = 0;
        while (SystemClock.uptimeMillis() - now < budgetMs) {
            int at = Native.tick();
            long c0 = SystemClock.uptimeMillis();
            int r = Native.runCatchup(catchSlice, Native.tick() + 120);
            long took = SystemClock.uptimeMillis() - c0;
            noteSlow(took, r, at, "catching up");
            if (took > 300) catchSlice = 5_000;
            else if (took < 8 && catchSlice < SLICE) catchSlice = Math.min(SLICE, catchSlice * 3 / 2);
            if (r == 0 || !Native.running()) break;
            s += r;
        }
        return s;
    }

    int slowSaid;
    void noteSlow(long ms, int steps, int tick, String where) {
        if (ms > 100 && slowSaid < 200) {
            slowSaid++;
            Log.i(TAG, "slow: " + steps + " instructions took " + ms + " ms at tick " + tick + " (" + where + ")");
        }
    }

    void play(AudioTrack track, byte[] audio) {
        final int iptDefault = Native.instructionsPerTick();
        int ipt = iptDefault;
        long t0 = SystemClock.uptimeMillis(), lastT = t0, winT = t0, blackSince = 0, lastScan = t0;
        int startTick = Native.tick(), lit = 1000, catchingUp = 0;
        long insWindow = 0, frames = 0, guestMsWindow = 0, drawMsWindow = 0;
        double audioRemainder = 0;
        while (!stopping) {
            for (Runnable r; (r = input.poll()) != null; ) r.run();
            if (surfaceChanged) { surfaceChanged = false; Native.setSurface(surface); }
            long now = SystemClock.uptimeMillis();
            int deadline = startTick + (int) Math.floor((now - t0) / 1000.0 * VBL_HZ);
            boolean drawn;
            if (lit > 20) blackSince = 0;
            else if (blackSince == 0) { blackSince = now; catchSlice = 20_000; }
            if (blackSince != 0 && now - blackSince < 8000) {
                // A black screen is the game loading: run unpaced (the page's reasoning, frame()).
                long g0 = SystemClock.uptimeMillis();
                insWindow += runCatchup(now, 42);
                guestMsWindow += SystemClock.uptimeMillis() - g0;
                startTick = Native.tick(); t0 = SystemClock.uptimeMillis(); lastT = t0;
                drawn = true;
            } else if (Native.tick() < deadline - 20) {
                long g0 = SystemClock.uptimeMillis();
                insWindow += runCatchup(now, 42);
                guestMsWindow += SystemClock.uptimeMillis() - g0;
                catchingUp++;
                startTick = Native.tick(); t0 = SystemClock.uptimeMillis(); lastT = t0;
                drawn = catchingUp % 3 == 1;
            } else {
                if (catchingUp > 0) { Log.i(TAG, "caught up after " + catchingUp + " frames"); catchingUp = 0; }
                long dt = Math.min(now - lastT, 100); lastT = now;
                double want = Math.max(0, dt / 1000.0 * RATE + audioRemainder);
                int samples = (int) Math.floor(want); audioRemainder = want - samples;
                int steps = 0;
                long budget = Native.tick() < deadline - 2 ? 26 : 13;
                long g0 = SystemClock.uptimeMillis();
                while (Native.tick() < deadline && steps < MAX_STEPS && SystemClock.uptimeMillis() - now < budget) {
                    int at = Native.tick();
                    long c0 = SystemClock.uptimeMillis();
                    int r = Native.run(Math.min(SLICE, MAX_STEPS - steps), deadline, 0);
                    noteSlow(SystemClock.uptimeMillis() - c0, r, at, "play");
                    steps += r;
                    if (!Native.running()) { status = "guest halted: " + Native.haltReason(); Log.e(TAG, status); stopping = true; break; }
                }
                guestMsWindow += SystemClock.uptimeMillis() - g0;
                Native.mixAudio(samples);
                insWindow += steps;
                drawn = true;
            }
            int n = Native.audioDrain(audio);
            if (n > 0) track.write(audio, 0, n, AudioTrack.WRITE_NON_BLOCKING);
            if (drawn) {
                long d0 = SystemClock.uptimeMillis();
                lit = Native.present();
                drawMsWindow += SystemClock.uptimeMillis() - d0;
                frames++;
            }
            if (now - winT >= 1000) {
                double secs = (now - winT) / 1000.0, rate = insWindow / secs;
                int behind = Native.tick() - deadline;
                if (behind < -2) {
                    ipt = (int) Math.max(100_000, Math.min(iptDefault, Math.round(rate * 0.9 / VBL_HZ)));
                    Native.setInstructionsPerTick(ipt);
                } else if (ipt < iptDefault) {
                    ipt = Math.min(iptDefault, Math.round(ipt * 1.05f)); Native.setInstructionsPerTick(ipt);
                }
                status = String.format("%.1f M/s, %d ticks, %dk/tick, %d frames, guest %d ms, drawing %d ms%s",
                    rate / 1e6, behind, ipt / 1000, frames, guestMsWindow, drawMsWindow,
                    blackSince != 0 ? ", black" : catchingUp > 0 ? ", catching up" : "");
                Log.i(TAG, "stat: " + status);
                insWindow = 0; frames = 0; guestMsWindow = 0; drawMsWindow = 0; winT = now;
            }
            if (now - lastScan >= 2000) { lastScan = now; saves.scan(); }
            long spare = 16 - (SystemClock.uptimeMillis() - now);
            if (spare > 0) SystemClock.sleep(spare);
        }
        saves.scan();
        Log.i(TAG, "stopped");
    }
}
