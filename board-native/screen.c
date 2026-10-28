// The thread that draws the game's frame into the window, through OpenGL ES
// 2. The frame is drawn off the game's thread because waiting for the display
// to free a buffer was a large and uneven part of every second on the Board,
// taken from the thread that runs the game (PLAYER-NOTES.md,
// player/board-speed-06glgb). It began as a copy into the window's buffer
// (jni.c before 28 October 2026), which the compositor scaled twice to the
// display; it is drawn with GL now for two things a copy cannot do cheaply:
//
//   zoom      a part of the frame drawn over the whole display. The frame is
//             a texture and the part is a rectangle of it, sampled "sharp
//             bilinear": each game pixel is first scaled up by the largest
//             whole number that fits and only the seam between two is
//             blended, so a pixel stays square at 2.6 times as it does at 2.
//   undither  grimoire's undither filter (js/delv-graphics.js, `UD`), as the
//             browser player runs it (www/index.html, makeUndither, and its
//             comment for the reasoning): the same four passes, the same
//             settings, the same shaders. WebGL 1's shading language is
//             OpenGL ES 2's, so the shaders are the page's text with two
//             changes: the last pass draws into a texture rather than the
//             screen, so it does not turn the frame over, and the blit that
//             follows it does.
//
// The game thread hands over a frame (screen_offer) only when it differs from
// the last, and the zoom and the filter's switch come from the activity's
// thread; this thread wakes for any of them. A window comes and goes with the
// activity's SurfaceView (screen_set_window); the EGL surface is made again
// for each.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <pthread.h>
#include <android/log.h>
#include <android/native_window.h>
#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>

#define TAG "Deerlizard"
#define LOG(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;   // everything below to the next blank line
static pthread_cond_t wake = PTHREAD_COND_INITIALIZER;
static uint8_t *frame, *indices;
static uint32_t frame_w, frame_h;
static int has_indices;
static int dirty;
static ANativeWindow *window;          // the activity's, with a reference of its own
static int window_changed;
static float zoom = 1, crop_u = 0, crop_v = 0;
static int undither_on;

static int started;

static uint32_t clock_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (uint32_t)(t.tv_sec * 1000u + t.tv_nsec / 1000000u);
}

// --- the shaders ------------------------------------------------------------

static const char VS[] =
    "attribute vec2 a_position; varying vec2 v_texCoord;\n"
    "void main() { v_texCoord = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }\n";

#define INSIDE "bool inside(vec2 uv) { return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0; }\n"
#define LIGHT \
    "float lin1(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }\n" \
    "vec3 toLight(vec3 c) { return vec3(lin1(c.r), lin1(c.g), lin1(c.b)); }\n" \
    "float enc1(float v) { v = clamp(v, 0.0, 1.0); return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }\n" \
    "vec3 toStored(vec3 l) { return vec3(enc1(l.r), enc1(l.g), enc1(l.b)); }\n"

static const char FS_MEAN[] =
    "precision highp float;\n"
    "varying vec2 v_texCoord; uniform sampler2D u_src; uniform vec2 u_texSize;\n"
    INSIDE
    "void main() {\n"
    "  vec2 px = 1.0 / u_texSize; vec3 sum = vec3(0.0); float cnt = 0.0;\n"
    "  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {\n"
    "    vec2 uv = v_texCoord + vec2(float(dx), float(dy)) * px;\n"
    "    if (!inside(uv)) continue;\n"
    "    sum += texture2D(u_src, uv).rgb; cnt += 1.0;\n"
    "  }\n"
    "  gl_FragColor = vec4(sum / cnt, 1.0);\n"
    "}\n";

static const char FS_DETECT[] =
    "precision highp float;\n"
    "varying vec2 v_texCoord;\n"
    "uniform sampler2D u_src; uniform sampler2D u_mean; uniform sampler2D u_idx;\n"
    "uniform vec2 u_texSize; uniform float u_sens; uniform float u_strength; uniform float u_useIdx;\n"
    "uniform float u_light;\n"
    INSIDE LIGHT
    "vec3 srcAt(vec2 uv) { return texture2D(u_src, uv).rgb * 255.0; }\n"
    "vec3 resAt(vec2 uv) { return (texture2D(u_src, uv).rgb - texture2D(u_mean, uv).rgb) * 255.0; }\n"
    "void main() {\n"
    "  vec2 px = 1.0 / u_texSize;\n"
    "  vec3 c = srcAt(v_texCoord);\n"
    "  vec3 r0 = resAt(v_texCoord);\n"
    "  float m = length(r0);\n"
    "  float d = 0.0;\n"
    "  if (m >= 0.5) {\n"
    "    float best = -2.0;\n"
    "    for (int a = 0; a < 2; a++) {\n"
    "      vec2 ax = a == 0 ? vec2(1.0, 0.0) : vec2(0.0, 1.0);\n"
    "      float sum = 0.0, cnt = 0.0;\n"
    "      for (int k = 1; k <= 3; k++) for (int sg = 0; sg < 2; sg++) {\n"
    "        vec2 uv = v_texCoord + ax * float(k) * (sg == 0 ? -1.0 : 1.0) * px;\n"
    "        if (!inside(uv)) continue;\n"
    "        cnt += 1.0;\n"
    "        vec3 rj = resAt(uv); float mj = length(rj);\n"
    "        if (mj < 0.5) continue;\n"
    "        sum += dot(r0, rj) / (m * mj);\n"
    "      }\n"
    "      if (cnt > 0.0) best = max(best, sum / cnt);\n"
    "    }\n"
    "    float coh = best < -1.0 ? 1.0 : best;\n"
    "    d = clamp((u_sens - coh) * 8.0, 0.0, 1.0) * smoothstep(1.5, 5.0, m);\n"
    "  }\n"
    "  bool uniformArea = true;\n"
    "  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {\n"
    "    if (dx == 0 && dy == 0) continue;\n"
    "    vec2 uv = v_texCoord + vec2(float(dx), float(dy)) * px;\n"
    "    if (inside(uv) && srcAt(uv) != c) uniformArea = false;\n"
    "  }\n"
    "  if (uniformArea) d = 0.0;\n"
    "  if (u_useIdx > 0.5) {\n"
    "    float idx = floor(texture2D(u_idx, v_texCoord).r * 255.0 + 0.5);\n"
    "    if (idx >= 224.0 && idx < 252.0) d = 0.0;\n"
    "  }\n"
    "  vec3 cv = u_light > 0.5 ? toLight(c / 255.0) : c / 255.0;\n"
    "  vec3 n4 = vec3(0.0); float n4cnt = 0.0;\n"
    "  for (int e = 0; e < 4; e++) {\n"
    "    vec2 off = e == 0 ? vec2(px.x, 0.0) : e == 1 ? vec2(-px.x, 0.0) : e == 2 ? vec2(0.0, px.y) : vec2(0.0, -px.y);\n"
    "    vec2 uv = v_texCoord + off;\n"
    "    if (!inside(uv)) continue;\n"
    "    vec3 nv = texture2D(u_src, uv).rgb;\n"
    "    n4 += u_light > 0.5 ? toLight(nv) : nv; n4cnt += 1.0;\n"
    "  }\n"
    "  vec3 filt = n4cnt > 0.0 ? 0.5 * cv + 0.5 * (n4 / n4cnt) : cv;\n"
    "  gl_FragColor = vec4(cv + d * u_strength * (filt - cv), d);\n"
    "}\n";

static const char FS_DETAIL[] =
    "precision highp float;\n"
    "varying vec2 v_texCoord; uniform sampler2D u_res;\n"
    "uniform vec2 u_texSize; uniform float u_strength; uniform float u_detail;\n"
    INSIDE
    "void main() {\n"
    "  vec2 uv = v_texCoord;\n"
    "  vec2 px = 1.0 / u_texSize;\n"
    "  vec4 self = texture2D(u_res, uv);\n"
    "  vec3 sum = vec3(0.0); float cnt = 0.0;\n"
    "  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {\n"
    "    vec2 t = uv + vec2(float(dx), float(dy)) * px;\n"
    "    if (!inside(t)) continue;\n"
    "    sum += texture2D(u_res, t).rgb; cnt += 1.0;\n"
    "  }\n"
    "  float w = self.a * u_strength * u_detail;\n"
    "  gl_FragColor = vec4(self.rgb + w * (self.rgb - sum / cnt), self.a);\n"
    "}\n";

// The page's FS_SUPER, drawing into a texture the right way up.
static const char FS_SUPER[] =
    "precision highp float;\n"
    "varying vec2 v_texCoord; uniform sampler2D u_det; uniform sampler2D u_idx;\n"
    "uniform vec2 u_texSize; uniform float u_strength; uniform float u_edge; uniform float u_useIdx;\n"
    "uniform float u_light;\n"
    INSIDE LIGHT
    "float lockedAt(vec2 uv) {\n"
    "  if (u_useIdx < 0.5) return 0.0;\n"
    "  float idx = floor(texture2D(u_idx, uv).r * 255.0 + 0.5);\n"
    "  return (idx >= 224.0 && idx < 252.0) ? 1.0 : 0.0;\n"
    "}\n"
    "void main() {\n"
    "  vec2 uv = v_texCoord;\n"
    "  vec2 px = 1.0 / u_texSize;\n"
    "  vec4 self = texture2D(u_det, uv);\n"
    "  vec3 cv = self.rgb;\n"
    "  vec3 cs = u_light > 0.5 ? toStored(cv) : cv;\n"
    "  float baseLock = lockedAt(uv);\n"
    "  float invSr = 1.0 / (2.0 * u_edge * u_edge);\n"
    "  vec3 acc0 = vec3(0.0), acc1 = vec3(0.0), acc2 = vec3(0.0), acc3 = vec3(0.0);\n"
    "  float ws0 = 0.0, ws1 = 0.0, ws2 = 0.0, ws3 = 0.0;\n"
    "  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {\n"
    "    vec2 t = uv + vec2(float(dx), float(dy)) * px;\n"
    "    if (!inside(t)) continue;\n"
    "    if (lockedAt(t) != baseLock) continue;\n"
    "    vec3 nv = texture2D(u_det, t).rgb;\n"
    "    vec3 ns = u_light > 0.5 ? toStored(nv) : nv;\n"
    "    vec3 dc = (ns - cs) * 255.0;\n"
    "    float rw = exp(-dot(dc, dc) * invSr);\n"
    "    vec2 b = vec2(float(dx), float(dy));\n"
    "    vec2 s0 = b - vec2(-0.25, -0.25), s1 = b - vec2(0.25, -0.25), s2 = b - vec2(-0.25, 0.25), s3 = b - vec2(0.25, 0.25);\n"
    "    float w0 = exp(-dot(s0, s0) * 2.0) * rw, w1 = exp(-dot(s1, s1) * 2.0) * rw;\n"
    "    float w2 = exp(-dot(s2, s2) * 2.0) * rw, w3 = exp(-dot(s3, s3) * 2.0) * rw;\n"
    "    acc0 += nv * w0; ws0 += w0; acc1 += nv * w1; ws1 += w1;\n"
    "    acc2 += nv * w2; ws2 += w2; acc3 += nv * w3; ws3 += w3;\n"
    "  }\n"
    "  vec3 up = 0.25 * ((ws0 > 0.0 ? acc0 / ws0 : cv) + (ws1 > 0.0 ? acc1 / ws1 : cv)\n"
    "                  + (ws2 > 0.0 ? acc2 / ws2 : cv) + (ws3 > 0.0 ? acc3 / ws3 : cv));\n"
    "  float w = min(1.0, self.a * u_strength);\n"
    "  vec3 outv = up + (1.0 - w) * (cv - up);\n"
    "  gl_FragColor = vec4(u_light > 0.5 ? toStored(outv) : outv, 1.0);\n"
    "}\n";

// The frame, or the part u_crop names (left, top, width, height, in the
// frame's fractions), over the whole window, top row at the top. u_prescale
// is the whole number of window pixels each game pixel takes before the seam
// is blended; at 1 this is plain bilinear and at an exact multiple it is
// nearest.
static const char FS_BLIT[] =
    "precision highp float;\n"
    "varying vec2 v_texCoord; uniform sampler2D u_tex; uniform vec2 u_texSize;\n"
    "uniform vec4 u_crop; uniform vec2 u_prescale;\n"
    "void main() {\n"
    "  vec2 uv = vec2(u_crop.x + v_texCoord.x * u_crop.z, u_crop.y + (1.0 - v_texCoord.y) * u_crop.w);\n"
    "  vec2 texel = uv * u_texSize, base = floor(texel), cd = fract(texel) - 0.5;\n"
    "  vec2 range = 0.5 - 0.5 / u_prescale;\n"
    "  vec2 f = (cd - clamp(cd, -range, range)) * u_prescale + 0.5;\n"
    "  gl_FragColor = vec4(texture2D(u_tex, (base + f) / u_texSize).rgb, 1.0);\n"
    "}\n";

// grimoire's settings, as the page has them (UNDITHER).
static const float SENS = 0.67f, STRENGTH = 0.67f, DETAIL = 0.5f, EDGE = 64;

// --- GL ---------------------------------------------------------------------

static EGLDisplay dpy = EGL_NO_DISPLAY;
static EGLConfig cfg;
static EGLContext ctx = EGL_NO_CONTEXT;
static EGLSurface surf = EGL_NO_SURFACE;
static ANativeWindow *drawn;   // the window surf was made for, with a reference of its own
static int gl_ready, gl_failed;
static GLuint prog_mean, prog_detect, prog_detail, prog_super, prog_blit, quad;
static GLuint tex_src, tex_idx, tex_mean, tex_res, tex_det, tex_out;
static GLuint fbo_mean, fbo_res, fbo_det, fbo_out;
static uint32_t tex_w, tex_h;
static GLenum fbo_type = GL_UNSIGNED_BYTE;

static GLuint compile(GLenum type, const char *src) {
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, NULL);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[1024] = "";
        glGetShaderInfoLog(s, sizeof log, NULL, log);
        LOG("screen: a shader did not compile: %s", log);
        return 0;
    }
    return s;
}

static GLuint link(const char *fs) {
    GLuint v = compile(GL_VERTEX_SHADER, VS), f = compile(GL_FRAGMENT_SHADER, fs);
    if (!v || !f) return 0;
    GLuint p = glCreateProgram();
    glAttachShader(p, v); glAttachShader(p, f);
    glBindAttribLocation(p, 0, "a_position");
    glLinkProgram(p);
    GLint ok = 0;
    glGetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) { LOG("screen: a program did not link"); return 0; }
    return p;
}

static GLuint texture(GLint filter) {
    GLuint t;
    glGenTextures(1, &t);
    glBindTexture(GL_TEXTURE_2D, t);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    return t;
}

static int gl_start(void) {
    dpy = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (dpy == EGL_NO_DISPLAY || !eglInitialize(dpy, NULL, NULL)) return 0;
    const EGLint want[] = { EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT, EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
                            EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_NONE };
    EGLint n = 0;
    if (!eglChooseConfig(dpy, want, &cfg, 1, &n) || n < 1) return 0;
    const EGLint version[] = { EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE };
    ctx = eglCreateContext(dpy, cfg, EGL_NO_CONTEXT, version);
    return ctx != EGL_NO_CONTEXT;
}

// The programs and the quad, once a surface is current.
static int gl_build(void) {
    prog_mean = link(FS_MEAN); prog_detect = link(FS_DETECT); prog_detail = link(FS_DETAIL);
    prog_super = link(FS_SUPER); prog_blit = link(FS_BLIT);
    if (!prog_blit) return 0;
    static const float corners[] = { -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1 };
    glGenBuffers(1, &quad);
    glBindBuffer(GL_ARRAY_BUFFER, quad);
    glBufferData(GL_ARRAY_BUFFER, sizeof corners, corners, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    // The frame and the filter's result are sampled between pixels by the
    // blit; the filter's own passes read exact pixels and want nothing blended.
    tex_src = texture(GL_LINEAR); tex_out = texture(GL_LINEAR); tex_idx = texture(GL_NEAREST);
    tex_mean = texture(GL_NEAREST); tex_res = texture(GL_NEAREST); tex_det = texture(GL_NEAREST);
    glGenFramebuffers(1, &fbo_mean); glGenFramebuffers(1, &fbo_res);
    glGenFramebuffers(1, &fbo_det); glGenFramebuffers(1, &fbo_out);
    // Half floats for the residuals where they can be drawn into, as the page.
    const char *ext = (const char *)glGetString(GL_EXTENSIONS);
    if (ext && strstr(ext, "GL_OES_texture_half_float")) fbo_type = GL_HALF_FLOAT_OES;
    return 1;
}

static void uniform1(GLuint p, const char *name, float v) { glUniform1f(glGetUniformLocation(p, name), v); }

static void attach(GLuint t, GLuint f, GLenum type) {
    glBindTexture(GL_TEXTURE_2D, t);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)tex_w, (GLsizei)tex_h, 0, GL_RGBA, type, NULL);
    glBindFramebuffer(GL_FRAMEBUFFER, f);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, t, 0);
}

static void gl_resize(uint32_t w, uint32_t h) {
    tex_w = w; tex_h = h;
    glBindTexture(GL_TEXTURE_2D, tex_src);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, (GLsizei)w, (GLsizei)h, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
    attach(tex_mean, fbo_mean, fbo_type);
    // Some drivers offer half floats and do not draw into them: the only way
    // to know is to try (the page's resize).
    if (fbo_type != GL_UNSIGNED_BYTE && glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
        LOG("screen: half floats cannot be drawn into here; the filter uses eight bits");
        fbo_type = GL_UNSIGNED_BYTE;
        attach(tex_mean, fbo_mean, fbo_type);
    }
    attach(tex_res, fbo_res, fbo_type);
    attach(tex_det, fbo_det, fbo_type);
    attach(tex_out, fbo_out, GL_UNSIGNED_BYTE);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    GLuint progs[] = { prog_mean, prog_detect, prog_detail, prog_super, prog_blit };
    for (int i = 0; i < 5; i++) {
        if (!progs[i]) continue;
        glUseProgram(progs[i]);
        glUniform2f(glGetUniformLocation(progs[i], "u_texSize"), (float)w, (float)h);
    }
    if (prog_detect) { glUseProgram(prog_detect); uniform1(prog_detect, "u_sens", SENS); uniform1(prog_detect, "u_strength", STRENGTH); uniform1(prog_detect, "u_light", 1); }
    if (prog_detail) { glUseProgram(prog_detail); uniform1(prog_detail, "u_strength", STRENGTH); uniform1(prog_detail, "u_detail", DETAIL); }
    if (prog_super) { glUseProgram(prog_super); uniform1(prog_super, "u_strength", STRENGTH); uniform1(prog_super, "u_edge", EDGE); uniform1(prog_super, "u_light", 1); }
}

static void pass(GLuint prog, GLuint fbo, int n, const char **names, const GLuint *texs) {
    glUseProgram(prog);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    for (int i = 0; i < n; i++) {
        glActiveTexture(GL_TEXTURE0 + i);
        glBindTexture(GL_TEXTURE_2D, texs[i]);
        glUniform1i(glGetUniformLocation(prog, names[i]), i);
    }
    glDrawArrays(GL_TRIANGLES, 0, 6);
}

// The window the activity has now, made current; 0 if there is none to draw into.
static int take_window(void) {
    pthread_mutex_lock(&lock);
    int changed = window_changed;
    ANativeWindow *now = window;
    if (changed && now) ANativeWindow_acquire(now);
    window_changed = 0;
    pthread_mutex_unlock(&lock);
    if (changed) {
        if (surf != EGL_NO_SURFACE) {
            eglMakeCurrent(dpy, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
            eglDestroySurface(dpy, surf);
            surf = EGL_NO_SURFACE;
        }
        if (drawn) ANativeWindow_release(drawn);
        drawn = now;
        if (drawn) {
            EGLint format;
            eglGetConfigAttrib(dpy, cfg, EGL_NATIVE_VISUAL_ID, &format);
            ANativeWindow_setBuffersGeometry(drawn, 0, 0, format);   // the window's own size
            surf = eglCreateWindowSurface(dpy, cfg, drawn, NULL);
            if (surf == EGL_NO_SURFACE || !eglMakeCurrent(dpy, surf, surf, ctx)) {
                LOG("screen: no EGL surface for the window (0x%x)", eglGetError());
                surf = EGL_NO_SURFACE;
            } else {
                eglSwapInterval(dpy, 1);
                if (!gl_ready && !gl_failed) {
                    gl_ready = gl_build();
                    gl_failed = !gl_ready;
                    LOG("screen: GL %s; %s", glGetString(GL_RENDERER), gl_ready ? "ready" : "the programs did not build");
                }
                tex_w = tex_h = 0;
            }
        }
    }
    return surf != EGL_NO_SURFACE && gl_ready;
}

static void *presenter(void *unused) {
    if (!gl_start()) { LOG("screen: EGL did not start (0x%x)", eglGetError()); return NULL; }
    uint32_t window_start = clock_ms(), posted = 0, filtered = 0, draw_ms = 0;
    for (;;) {
        pthread_mutex_lock(&lock);
        while (!dirty && !window_changed) pthread_cond_wait(&wake, &lock);
        pthread_mutex_unlock(&lock);
        if (!take_window()) {
            pthread_mutex_lock(&lock); dirty = 0; pthread_mutex_unlock(&lock);
            continue;
        }
        uint32_t t0 = clock_ms();
        pthread_mutex_lock(&lock);
        dirty = 0;
        uint32_t w = frame_w, h = frame_h;
        float z = zoom, u = crop_u, v = crop_v;
        int filter = undither_on && prog_super;
        int idx = filter && has_indices;
        if (frame) {
            if (w != tex_w || h != tex_h) gl_resize(w, h);
            glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
            glBindTexture(GL_TEXTURE_2D, tex_src);
            glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, (GLsizei)w, (GLsizei)h, GL_RGBA, GL_UNSIGNED_BYTE, frame);
            if (idx) {
                glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
                glBindTexture(GL_TEXTURE_2D, tex_idx);
                glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, (GLsizei)w, (GLsizei)h, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, indices);
            }
        }
        pthread_mutex_unlock(&lock);
        if (!tex_w) continue;
        GLuint shown = tex_src;
        if (filter) {
            glViewport(0, 0, (GLsizei)tex_w, (GLsizei)tex_h);
            glUseProgram(prog_detect); uniform1(prog_detect, "u_useIdx", idx);
            glUseProgram(prog_super); uniform1(prog_super, "u_useIdx", idx);
            const char *n1[] = { "u_src" }, *n2[] = { "u_src", "u_mean", "u_idx" }, *n3[] = { "u_res" }, *n4[] = { "u_det", "u_idx" };
            GLuint t1[] = { tex_src }, t2[] = { tex_src, tex_mean, tex_idx }, t3[] = { tex_res }, t4[] = { tex_det, tex_idx };
            pass(prog_mean, fbo_mean, 1, n1, t1);
            pass(prog_detect, fbo_res, 3, n2, t2);
            pass(prog_detail, fbo_det, 1, n3, t3);
            pass(prog_super, fbo_out, 2, n4, t4);
            shown = tex_out;
            filtered++;
        }
        EGLint sw = 0, sh = 0;
        eglQuerySurface(dpy, surf, EGL_WIDTH, &sw);
        eglQuerySurface(dpy, surf, EGL_HEIGHT, &sh);
        glViewport(0, 0, sw, sh);
        glUseProgram(prog_blit);
        float cw = 1 / z, ch = 1 / z;
        glUniform4f(glGetUniformLocation(prog_blit, "u_crop"), u, v, cw, ch);
        float px = sw / (tex_w * cw), py = sh / (tex_h * ch);
        glUniform2f(glGetUniformLocation(prog_blit, "u_prescale"), px < 1 ? 1 : (float)(int)px, py < 1 ? 1 : (float)(int)py);
        const char *nb[] = { "u_tex" };
        pass(prog_blit, 0, 1, nb, &shown);
        eglSwapBuffers(dpy, surf);
        posted++;
        draw_ms += clock_ms() - t0;
        uint32_t now = clock_ms();
        if (now - window_start >= 1000) {
            LOG("present: %u posted, %u undithered, %u ms drawing and swapping", posted, filtered, draw_ms);
            window_start = now; posted = filtered = draw_ms = 0;
        }
    }
    return NULL;
}

static void start_locked(void) {
    if (started) return;
    pthread_t t;
    if (pthread_create(&t, NULL, presenter, NULL) == 0) { pthread_detach(t); started = 1; }
}

// --- the calls --------------------------------------------------------------

void screen_set_window(ANativeWindow *w) {
    pthread_mutex_lock(&lock);
    if (window) ANativeWindow_release(window);
    window = w;
    window_changed = 1;
    dirty = frame != NULL;   // a new window has nothing on it
    start_locked();
    pthread_cond_signal(&wake);
    pthread_mutex_unlock(&lock);
}

// The game thread's frame, and the palette index of each pixel when idx is
// not NULL; handed over only when it differs from the one before.
void screen_offer(const uint8_t *px, const uint8_t *idx, uint32_t w, uint32_t h) {
    size_t size = (size_t)w * h * 4;
    pthread_mutex_lock(&lock);
    if (!frame || frame_w != w || frame_h != h) {
        free(frame); free(indices);
        frame = malloc(size); indices = malloc(size / 4);
        if (!frame || !indices) { free(frame); free(indices); frame = indices = NULL; pthread_mutex_unlock(&lock); return; }
        frame_w = w; frame_h = h;
        memset(frame, 0, size);
        dirty = 1;   // the first frame is drawn even when it is black
    }
    if (memcmp(frame, px, size) != 0) { memcpy(frame, px, size); dirty = 1; }
    if (idx && (!has_indices || memcmp(indices, idx, size / 4) != 0)) { memcpy(indices, idx, size / 4); dirty = 1; }
    has_indices = idx != NULL;
    start_locked();
    if (dirty) pthread_cond_signal(&wake);
    pthread_mutex_unlock(&lock);
}

// The part of the frame shown: z times as large, its top left corner at
// (u, v) in fractions of the frame.
void screen_set_view(float z, float u, float v) {
    pthread_mutex_lock(&lock);
    if (z != zoom || u != crop_u || v != crop_v) {
        zoom = z < 1 ? 1 : z; crop_u = u; crop_v = v;
        dirty = frame != NULL;
        pthread_cond_signal(&wake);
    }
    pthread_mutex_unlock(&lock);
}

void screen_set_undither(int on) {
    pthread_mutex_lock(&lock);
    if (on != undither_on) {
        undither_on = on;
        dirty = frame != NULL;
        pthread_cond_signal(&wake);
    }
    pthread_mutex_unlock(&lock);
}

int screen_undither(void) {
    pthread_mutex_lock(&lock);
    int on = undither_on;
    pthread_mutex_unlock(&lock);
    return on;
}
