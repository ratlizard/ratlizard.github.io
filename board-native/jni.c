// The module's C interface (cythera-web/src/lib.rs) for the Java activity:
// one JNI function for each call the activity makes, the frame handed to
// screen.c's thread, which draws it into the window, and cw_log to the
// Android log. The module's state is thread-local, so every call that reaches
// the module comes from the activity's emulator thread.
#include <jni.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
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
extern const uint8_t *cw_render_indices(void);
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

// The page's lazy files are Carmen's (www/index.html, CARMEN); Cythera's
// archive is whole, so no file is ever asked for. The module links against
// the import all the same, and without it the library does not load.
int32_t cw_host_lazy_fetch(uint32_t key, uint8_t *ptr, size_t len) { return 0; }

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

FN(void, setEnv)(JNIEnv *env, jclass c, jstring name, jstring value) {
    const char *n = (*env)->GetStringUTFChars(env, name, NULL), *v = (*env)->GetStringUTFChars(env, value, NULL);
    setenv(n, v, 1);
    (*env)->ReleaseStringUTFChars(env, name, n);
    (*env)->ReleaseStringUTFChars(env, value, v);
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

// screen.c draws the frame on a thread of its own.
extern void screen_set_window(ANativeWindow *w);
extern void screen_offer(const uint8_t *px, const uint8_t *idx, uint32_t w, uint32_t h);
extern void screen_set_view(float zoom, float u, float v);
extern void screen_set_undither(int on);
extern int screen_undither(void);

// Whether present() reads the palette indices for the filter.
static volatile int use_indices = 1;

FN(void, setSurface)(JNIEnv *env, jclass c, jobject surface) {
    screen_set_window(surface ? ANativeWindow_fromSurface(env, surface) : NULL);
}

// Renders the screen and hands it to screen.c, with each pixel's palette
// index while the undither filter is on. Returns how much of the screen is
// lit, in thousandths, sampled as the page samples it: a black screen is
// Cythera loading.
FN(jint, present)(JNIEnv *env, jclass c) {
    uint32_t w = cw_width(), h = cw_height();
    // The indices first, as the page takes them: reading them can grow the
    // module's memory.
    const uint8_t *idx = screen_undither() && use_indices ? cw_render_indices() : NULL;
    const uint8_t *px = cw_render();
    if (!px) return 1000;
    uint32_t lit = 0, seen = 0;
    for (uint32_t i = 0; i < w * h; i += 197, seen++)
        if (px[i * 4] | px[i * 4 + 1] | px[i * 4 + 2]) lit++;
    screen_offer(px, idx, w, h);
    return (jint)(seen ? lit * 1000 / seen : 1000);
}

// Neither touches the module's state, so either may come from any thread.
FN(void, setView)(JNIEnv *env, jclass c, jfloat zoom, jfloat u, jfloat v) { screen_set_view(zoom, u, v); }
FN(void, setUndither)(JNIEnv *env, jclass c, jboolean on) { screen_set_undither(on ? 1 : 0); }
FN(void, setUnditherIndices)(JNIEnv *env, jclass c, jboolean on) { use_indices = on ? 1 : 0; }
