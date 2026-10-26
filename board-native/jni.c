// The module's C interface (cythera-web/src/lib.rs) for the Java activity:
// one JNI function for each call the activity makes, the frame handed to a
// thread that posts it to the window, and cw_log to the Android log. The
// module's state is thread-local, so every call comes from the activity's
// emulator thread.
#include <jni.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <pthread.h>
#include <android/log.h>
#include <android/native_window.h>
#include <android/native_window_jni.h>

#define TAG "Deerlizard"

extern void cw_init(void);
extern void cw_prefer_powerpc(int32_t on);
extern uint8_t *cw_alloc(size_t len);
extern const uint8_t *cw_error_ptr(void);
extern size_t cw_error_len(void);
extern int32_t cw_load(uint8_t *ptr, size_t len, uint32_t mac_epoch_secs, uint32_t width, uint32_t height);
extern int32_t cw_start(void);
extern int32_t cw_import(uint8_t *path, size_t path_len, uint32_t type, uint32_t creator, uint32_t flags,
                         uint32_t created, uint32_t modified, uint8_t *data, size_t data_len, uint8_t *rsrc, size_t rsrc_len);
extern uint32_t cw_save_scan(void);
extern const uint8_t *cw_save_path_ptr(uint32_t i);
extern size_t cw_save_path_len(uint32_t i);
extern uint32_t cw_save_type(uint32_t i);
extern uint32_t cw_save_creator(uint32_t i);
extern uint32_t cw_save_flags(uint32_t i);
extern uint32_t cw_save_created(uint32_t i);
extern uint32_t cw_save_modified(uint32_t i);
extern const uint8_t *cw_save_data_ptr(uint32_t i);
extern size_t cw_save_data_len(uint32_t i);
extern const uint8_t *cw_save_rsrc_ptr(uint32_t i);
extern size_t cw_save_rsrc_len(uint32_t i);
extern void cw_save_ack(void);
extern int32_t cw_vfs_find(const uint8_t *name, size_t len);
extern const uint8_t *cw_found_ptr(void);
extern size_t cw_found_len(void);
extern uint32_t cw_width(void);
extern uint32_t cw_height(void);
extern uint32_t cw_run(uint32_t max_steps, uint32_t deadline_tick, uint32_t audio_samples);
extern void cw_mix_audio(uint32_t samples);
extern uint32_t cw_run_catchup(uint32_t max_steps, uint32_t tick_cap);
extern int32_t cw_running(void);
extern uint32_t cw_tick(void);
extern void cw_set_instructions_per_tick(uint32_t n);
extern uint32_t cw_instructions_per_tick(void);
extern const uint8_t *cw_render(void);
extern void cw_mouse_move(int32_t v, int32_t h);
extern void cw_mouse_down(int32_t v, int32_t h);
extern void cw_mouse_up(int32_t v, int32_t h);
extern void cw_key_down(uint32_t key, uint32_t ch);
extern void cw_key_up(uint32_t key, uint32_t ch);
extern const uint8_t *cw_audio_drain(void);
extern size_t cw_audio_len(void);
extern int32_t cw_tune_install(uint32_t checksum, const uint8_t *ptr, size_t len);
extern const uint8_t *cw_halt_reason(void);
extern size_t cw_halt_reason_len(void);

void cw_log(const uint8_t *ptr, size_t len) {
    __android_log_print(ANDROID_LOG_INFO, TAG, "%.*s", (int)len, (const char *)ptr);
}

#define FN(ret, name) JNIEXPORT ret JNICALL Java_io_github_ratlizard_deerlizard_Native_##name

static jstring utf8(JNIEnv *env, const uint8_t *p, size_t len) {
    char buf[1024];
    if (len >= sizeof buf) len = sizeof buf - 1;
    memcpy(buf, p, len); buf[len] = 0;
    return (*env)->NewStringUTF(env, buf);
}

static jbyteArray bytes(JNIEnv *env, const uint8_t *p, size_t len) {
    jbyteArray a = (*env)->NewByteArray(env, (jsize)len);
    if (len) (*env)->SetByteArrayRegion(env, a, 0, (jsize)len, (const jbyte *)p);
    return a;
}

// A copy of a Java array in a buffer the module owns afterwards.
static uint8_t *owned(JNIEnv *env, jbyteArray a, size_t *len) {
    *len = a ? (size_t)(*env)->GetArrayLength(env, a) : 0;
    if (!a) return NULL;
    uint8_t *p = cw_alloc(*len);
    (*env)->GetByteArrayRegion(env, a, 0, (jsize)*len, (jbyte *)p);
    return p;
}

FN(jint, load)(JNIEnv *env, jclass c, jbyteArray archive, jint epoch, jint w, jint h, jboolean ppc) {
    cw_init();
    if (ppc) cw_prefer_powerpc(1);
    size_t len;
    uint8_t *p = owned(env, archive, &len);
    return cw_load(p, len, (uint32_t)epoch, (uint32_t)w, (uint32_t)h);
}
FN(jstring, error)(JNIEnv *env, jclass c) { return utf8(env, cw_error_ptr(), cw_error_len()); }
FN(jint, start)(JNIEnv *env, jclass c) { return cw_start(); }

FN(jint, importFile)(JNIEnv *env, jclass c, jstring path, jint type, jint creator, jint flags, jint created,
                     jint modified, jbyteArray data, jbyteArray rsrc) {
    const char *s = (*env)->GetStringUTFChars(env, path, NULL);
    size_t plen = strlen(s), dlen, rlen;
    uint8_t *pp = cw_alloc(plen);
    memcpy(pp, s, plen);
    (*env)->ReleaseStringUTFChars(env, path, s);
    uint8_t *d = owned(env, data, &dlen), *r = owned(env, rsrc, &rlen);
    return cw_import(pp, plen, type, creator, flags, created, modified, d, dlen, r, rlen);
}

FN(jint, saveScan)(JNIEnv *env, jclass c) { return (jint)cw_save_scan(); }
FN(jstring, savePath)(JNIEnv *env, jclass c, jint i) { return utf8(env, cw_save_path_ptr(i), cw_save_path_len(i)); }
// type, creator, Finder flags, created, modified
FN(jintArray, saveInfo)(JNIEnv *env, jclass c, jint i) {
    jint v[5] = {(jint)cw_save_type(i), (jint)cw_save_creator(i), (jint)cw_save_flags(i),
                 (jint)cw_save_created(i), (jint)cw_save_modified(i)};
    jintArray a = (*env)->NewIntArray(env, 5);
    (*env)->SetIntArrayRegion(env, a, 0, 5, v);
    return a;
}
FN(jbyteArray, saveData)(JNIEnv *env, jclass c, jint i) { return bytes(env, cw_save_data_ptr(i), cw_save_data_len(i)); }
FN(jbyteArray, saveRsrc)(JNIEnv *env, jclass c, jint i) { return bytes(env, cw_save_rsrc_ptr(i), cw_save_rsrc_len(i)); }
FN(void, saveAck)(JNIEnv *env, jclass c) { cw_save_ack(); }

// The folder holding Cythera Data, with its trailing slash; empty if not found.
FN(jstring, gameFolder)(JNIEnv *env, jclass c) {
    static const char name[] = "Cythera Data";
    if (!cw_vfs_find((const uint8_t *)name, sizeof name - 1)) return (*env)->NewStringUTF(env, "");
    const uint8_t *p = cw_found_ptr();
    size_t len = cw_found_len();
    while (len && p[len - 1] != '/') len--;
    return utf8(env, p, len);
}

FN(jint, width)(JNIEnv *env, jclass c) { return (jint)cw_width(); }
FN(jint, height)(JNIEnv *env, jclass c) { return (jint)cw_height(); }
FN(jint, run)(JNIEnv *env, jclass c, jint max, jint deadline, jint samples) { return (jint)cw_run(max, deadline, samples); }
FN(void, mixAudio)(JNIEnv *env, jclass c, jint samples) { cw_mix_audio(samples); }
FN(jint, runCatchup)(JNIEnv *env, jclass c, jint max, jint cap) { return (jint)cw_run_catchup(max, cap); }
FN(jboolean, running)(JNIEnv *env, jclass c) { return cw_running() != 0; }
FN(jint, tick)(JNIEnv *env, jclass c) { return (jint)cw_tick(); }
FN(void, setInstructionsPerTick)(JNIEnv *env, jclass c, jint n) { cw_set_instructions_per_tick(n); }
FN(jint, instructionsPerTick)(JNIEnv *env, jclass c) { return (jint)cw_instructions_per_tick(); }
FN(void, mouseMove)(JNIEnv *env, jclass c, jint v, jint h) { cw_mouse_move(v, h); }
FN(void, mouseDown)(JNIEnv *env, jclass c, jint v, jint h) { cw_mouse_down(v, h); }
FN(void, mouseUp)(JNIEnv *env, jclass c, jint v, jint h) { cw_mouse_up(v, h); }
FN(void, keyDown)(JNIEnv *env, jclass c, jint key, jint ch) { cw_key_down(key, ch); }
FN(void, keyUp)(JNIEnv *env, jclass c, jint key, jint ch) { cw_key_up(key, ch); }
FN(jstring, haltReason)(JNIEnv *env, jclass c) {
    size_t len = cw_halt_reason_len();
    return len ? utf8(env, cw_halt_reason(), len) : (*env)->NewStringUTF(env, "");
}

FN(jint, tuneInstall)(JNIEnv *env, jclass c, jint checksum, jbyteArray a) {
    jsize len = (*env)->GetArrayLength(env, a);
    jbyte *p = (*env)->GetByteArrayElements(env, a, NULL);
    jint kind = cw_tune_install((uint32_t)checksum, (const uint8_t *)p, (size_t)len);
    (*env)->ReleaseByteArrayElements(env, a, p, JNI_ABORT);
    return kind;
}

// The mixed audio since the last call, unsigned 8-bit mono at 22,050 Hz,
// copied into `out`; returns how many bytes (at most out's length).
FN(jint, audioDrain)(JNIEnv *env, jclass c, jbyteArray out) {
    const uint8_t *p = cw_audio_drain();
    size_t len = cw_audio_len(), cap = (size_t)(*env)->GetArrayLength(env, out);
    if (len > cap) len = cap;
    if (len) (*env)->SetByteArrayRegion(env, out, 0, (jsize)len, (const jbyte *)p);
    return (jint)len;
}

// The window is posted from a thread of its own. Locking a window buffer
// waits for the display to free one, and on the Board that wait was a large and
// uneven part of every second, taken from the thread that runs the game. The
// emulator thread renders the screen and keeps the newest frame for the
// presenter to post; a frame that matches the last one kept is not handed over.
static ANativeWindow *window;
static pthread_mutex_t window_lock = PTHREAD_MUTEX_INITIALIZER;   // window, and its buffer while posting
static pthread_mutex_t frame_lock = PTHREAD_MUTEX_INITIALIZER;    // frame, frame_size, frame_w, frame_h, dirty
static pthread_cond_t frame_ready = PTHREAD_COND_INITIALIZER;
static uint8_t *frame;
static size_t frame_size;
static uint32_t frame_w, frame_h;
static int dirty;
static int presenter_started;

static uint32_t clock_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (uint32_t)(t.tv_sec * 1000u + t.tv_nsec / 1000000u);
}

static void *presenter(void *unused) {
    uint32_t window_start = clock_ms(), posted = 0, wait_ms = 0, copy_ms = 0;
    for (;;) {
        pthread_mutex_lock(&frame_lock);
        while (!dirty) pthread_cond_wait(&frame_ready, &frame_lock);
        pthread_mutex_unlock(&frame_lock);
        pthread_mutex_lock(&window_lock);
        ANativeWindow_Buffer buf;
        uint32_t t0 = clock_ms();
        if (window && ANativeWindow_lock(window, &buf, NULL) == 0) {
            uint32_t t1 = clock_ms();
            pthread_mutex_lock(&frame_lock);
            dirty = 0;
            // The module's state belongs to the emulator thread, so the size
            // is the one present() stored with the frame.
            uint32_t w = frame_w, h = frame_h;
            if (frame && frame_size == (size_t)w * h * 4) {
                uint32_t rows = h < (uint32_t)buf.height ? h : (uint32_t)buf.height;
                uint32_t cols = w < (uint32_t)buf.width ? w : (uint32_t)buf.width;
                for (uint32_t y = 0; y < rows; y++)
                    memcpy((uint8_t *)buf.bits + (size_t)y * buf.stride * 4, frame + (size_t)y * w * 4, (size_t)cols * 4);
            }
            pthread_mutex_unlock(&frame_lock);
            ANativeWindow_unlockAndPost(window);
            posted++; wait_ms += t1 - t0; copy_ms += clock_ms() - t1;
        } else {
            pthread_mutex_lock(&frame_lock);
            dirty = 0;
            pthread_mutex_unlock(&frame_lock);
        }
        pthread_mutex_unlock(&window_lock);
        uint32_t now = clock_ms();
        if (now - window_start >= 1000) {
            __android_log_print(ANDROID_LOG_INFO, TAG, "present: %u posted, waited %u ms for the display, copied and posted %u ms",
                                posted, wait_ms, copy_ms);
            window_start = now; posted = wait_ms = copy_ms = 0;
        }
    }
    return NULL;
}

FN(void, setSurface)(JNIEnv *env, jclass c, jobject surface) {
    pthread_mutex_lock(&window_lock);
    if (window) ANativeWindow_release(window);
    window = surface ? ANativeWindow_fromSurface(env, surface) : NULL;
    if (window) ANativeWindow_setBuffersGeometry(window, (int32_t)cw_width(), (int32_t)cw_height(), WINDOW_FORMAT_RGBA_8888);
    pthread_mutex_unlock(&window_lock);
    // A new surface has nothing on it, so the frame is posted again.
    pthread_mutex_lock(&frame_lock);
    if (frame) { dirty = 1; pthread_cond_signal(&frame_ready); }
    pthread_mutex_unlock(&frame_lock);
}

// Renders the screen and hands the presenter the frame when it differs from
// the one before. Returns how much of the screen is lit, in thousandths,
// sampled as the page samples it: a black screen is Cythera loading.
FN(jint, present)(JNIEnv *env, jclass c) {
    uint32_t w = cw_width(), h = cw_height();
    const uint8_t *px = cw_render();
    if (!px) return 1000;
    uint32_t lit = 0, seen = 0;
    for (uint32_t i = 0; i < w * h; i += 197, seen++)
        if (px[i * 4] | px[i * 4 + 1] | px[i * 4 + 2]) lit++;
    size_t size = (size_t)w * h * 4;
    pthread_mutex_lock(&frame_lock);
    if (!frame || frame_size != size) {
        free(frame);
        frame = malloc(size);
        frame_size = frame ? size : 0;
        frame_w = w; frame_h = h;
        if (frame) memset(frame, 0, size);
        dirty = 1;   // the first frame is posted even when it is black
    }
    if (frame && memcmp(frame, px, size) != 0) {
        memcpy(frame, px, size);
        dirty = 1;
    }
    if (dirty && !presenter_started) {
        pthread_t t;
        if (pthread_create(&t, NULL, presenter, NULL) == 0) { pthread_detach(t); presenter_started = 1; }
    }
    if (dirty) pthread_cond_signal(&frame_ready);
    pthread_mutex_unlock(&frame_lock);
    return (jint)(seen ? lit * 1000 / seen : 1000);
}
