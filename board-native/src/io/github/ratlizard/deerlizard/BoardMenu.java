package io.github.ratlizard.deerlizard;

import android.os.SystemClock;
import android.util.Log;

import co.harrishill.board.core.BoardNativePlugin;
import co.harrishill.board.core.GodotBoardContext;
import co.harrishill.board.pausescreen.PauseResultCallbackImpl;
import co.harrishill.board.session.SessionManagerBridge;

/**
 * The Board's system menu button and pause screen, through the Board SDK's
 * Java classes in board.aar, as the SheepShaver Board apps use them
 * (e-z-g-disassembly, tools/sheepshaver-board/). Raw touches are not
 * swallowed, so the activity still receives them. Quit and Save & Quit both
 * write the changed files and end the app; a game is saved in the game.
 * One button of the app's turns grimoire's undither filter on and off
 * (screen.c), and the choice is kept for the next launch.
 */
final class BoardMenu {
    static final String TAG = MainActivity.TAG;
    static MainActivity activity;

    static void start(MainActivity a) {
        activity = a;
        try {
            BoardNativePlugin.setSwallowSystemTouches(false);
            GodotBoardContext context = new GodotBoardContext();
            context.setActivity(a);
            BoardNativePlugin.setBoardContext(context);
            BoardNativePlugin.setAppId(a.getPackageName());
            BoardNativePlugin.initialize();
            PauseResultCallbackImpl.setListener(BoardMenu::onResult);
        } catch (Throwable t) {
            Log.w(TAG, "[menu] Board SDK did not start: " + t);
            return;
        }
        new Thread(() -> {
            for (int i = 0; i < 300 && !BoardNativePlugin.areServicesReady(); i++) {
                if (BoardNativePlugin.haveServicesFailed()) {
                    Log.w(TAG, "[menu] Board services failed: " + BoardNativePlugin.getServicesFailedReason());
                    return;
                }
                SystemClock.sleep(100);
            }
            setContext();
            BoardNativePlugin.showSystemMenuButton();
            Log.i(TAG, "[menu] Board menu button set up");
        }, "board-menu").start();
    }

    /**
     * The pause screen's one button of the app's, Undither, which turns the
     * filter on and off. The arrays are the buttons' ids, texts and icons, set
     * once, as the SheepShaver apps' Keyboard and Cheats buttons are
     * (e-z-g-disassembly, tools/sheepshaver-board/BoardMenu.java). The first
     * build named the button "Undither: On" or "Undither: Off" and set the
     * context again from the press's callback to rename it; the first press
     * reached the app and none after it did (28 October 2026).
     */
    static void setContext() {
        String[] none = new String[0];
        BoardNativePlugin.setPauseContext(activity.getPackageName(), "Cythera", false,
            new String[] { "undither" }, new String[] { "Undither" }, new String[] { "" }, none, none, new int[0]);
    }

    static void show() {
        try { if (BoardNativePlugin.areServicesReady()) BoardNativePlugin.showSystemMenuButton(); } catch (Throwable ignored) { }
    }

    static void onResult() {
        String action = PauseResultCallbackImpl.getActionType();
        Log.i(TAG, "[menu] pause screen: " + action);
        if ("CUSTOM_ACTION".equals(action) && "undither".equals(PauseResultCallbackImpl.getCustomButtonId()) && activity != null) {
            activity.setUndither(!activity.undither());
            return;
        }
        if (action != null && action.startsWith("EXIT_GAME") && activity != null) activity.quit();
    }

    static volatile boolean ending;
    static void end() {
        if (ending) return;
        ending = true;
        try { SessionManagerBridge.terminateApplication(); } catch (Throwable t) { Log.w(TAG, "[menu] terminateApplication: " + t); }
        // terminateApplication leaves the process running, and a later
        // launch then came up in it (the SheepShaver apps).
        SystemClock.sleep(300);
        android.os.Process.killProcess(android.os.Process.myPid());
    }
}
