/* Original PS1 arcade demos. MIT license: see LICENSE.
 * Built against the unmodified, MPL-2.0-licensed PSn00bSDK v0.24.
 * No Sony SDK, commercial game assets or BIOS image are included.
 */
#include <stdint.h>
#include <stdio.h>
#include <psxgpu.h>
#include <psxapi.h>
#include <psxpad.h>

static DISPENV display[2];
static DRAWENV drawing[2];
static uint32_t order[2][2];
static uint8_t packets[2][32768];
static uint8_t *next;
static int frame;
static uint8_t pad1[34], pad2[34];

/* These named globals are intentionally easy to identify for future mods. */
volatile int paddle_width = 48;
volatile int paddle_height = 40;
volatile int paddle_speed = 4;
volatile int accent_red = 255, accent_green = 125, accent_blue = 74;
static int bx, by, vx, vy, paddle, rival, score, other, lives, waiting, over;
static int bricks[5][8], remaining;

static int clamp(int n, int lo, int hi) { return n < lo ? lo : n > hi ? hi : n; }
static void rect(int x, int y, int w, int h, int r, int g, int b) {
    TILE *t = (TILE *)next;
    next += sizeof(TILE);
    setTile(t); setXY0(t, x, y); setWH(t, w, h); setRGB0(t, r, g, b);
    addPrim(&order[frame][1], t);
}
static void text(int x, int y, const char *s) {
    next = (uint8_t *)FntSort(&order[frame][0], next, x, y, s);
}
static void serve(void) {
    waiting = 1;
    bx = GAME_BRICKS ? paddle + paddle_width / 2 : 160;
    by = GAME_BRICKS ? 202 : 125;
    vx = GAME_BRICKS ? 2 : (other & 1 ? -2 : 2);
    vy = GAME_BRICKS ? -2 : 1;
}
static void reset(void) {
    paddle = GAME_BRICKS ? 136 : 100;
    rival = 100; score = other = over = 0; lives = 3;
    remaining = 40;
    for (int y = 0; y < 5; y++) for (int x = 0; x < 8; x++) bricks[y][x] = 1;
    serve();
}
static void update(uint16_t held, uint16_t pressed) {
    if (over) { if (pressed & PAD_CROSS) reset(); return; }
    if (GAME_BRICKS) {
        if (held & PAD_LEFT) paddle -= paddle_speed;
        if (held & PAD_RIGHT) paddle += paddle_speed;
        paddle = clamp(paddle, 12, 308 - paddle_width);
        if (waiting) { bx = paddle + paddle_width / 2; if (pressed & PAD_CROSS) waiting = 0; return; }
        int oldy = by;
        bx += vx; by += vy;
        if (bx < 12) { bx = 12; vx = -vx; }
        if (bx > 302) { bx = 302; vx = -vx; }
        if (by < 34) { by = 34; vy = -vy; }
        if (vy > 0 && oldy <= 203 && by >= 203 && bx + 6 >= paddle && bx <= paddle + paddle_width) {
            by = 202; vy = -2;
            vx = bx < paddle + paddle_width / 3 ? -3 : bx > paddle + paddle_width * 2 / 3 ? 3 : (vx > 0 ? 1 : -1);
        }
        for (int y = 0; y < 5; y++) for (int x = 0; x < 8; x++) {
            int px = 16 + x * 36, py = 48 + y * 16;
            if (bricks[y][x] && bx + 6 > px && bx < px + 32 && by + 6 > py && by < py + 12) {
                bricks[y][x] = 0; remaining--; score += 10;
                vy = -vy; by += vy * 2;
                if (!remaining) over = 1;
                return;
            }
        }
        if (by > 230) { if (--lives <= 0) over = 1; else serve(); }
    } else {
        if (held & PAD_UP) paddle -= paddle_speed;
        if (held & PAD_DOWN) paddle += paddle_speed;
        paddle = clamp(paddle, 36, 220 - paddle_height);
        if (waiting) { if (pressed & PAD_CROSS) waiting = 0; return; }
        rival += by > rival + 20 ? 1 : by < rival + 17 ? -1 : 0;
        rival = clamp(rival, 36, 180);
        bx += vx; by += vy;
        if (by < 36) { by = 36; vy = -vy; }
        if (by > 214) { by = 214; vy = -vy; }
        if (vx < 0 && bx <= 29 && bx >= 18 && by + 6 >= paddle && by <= paddle + paddle_height) {
            bx = 29; vx = clamp(-vx + 1, 2, 5); vy = by < paddle + paddle_height / 2 ? -2 : 2;
        }
        if (vx > 0 && bx >= 285 && bx <= 298 && by + 6 >= rival && by <= rival + 40) {
            bx = 284; vx = -vx; vy = by < rival + 20 ? -2 : 2;
        }
        if (bx < 0 || bx > 320) {
            if (bx < 0) other++; else score++;
            if (score >= 7 || other >= 7) over = 1; else serve();
        }
    }
}
static void render(int paused) {
    char line[64];
    rect(10, 32, 300, 2, 62, 67, 85);
    rect(10, 222, 300, 2, 62, 67, 85);
    if (GAME_BRICKS) {
        snprintf(line, sizeof(line), "BRICK SHIFT   %03d       LIVES %d", score, lives);
        text(16, 14, line);
        for (int y = 0; y < 5; y++) for (int x = 0; x < 8; x++) if (bricks[y][x]) {
            rect(16 + x * 36, 48 + y * 16, 32, 12, 250 - y * 25, 100 + y * 24, 80 + y * 32);
        }
        rect(paddle, 210, paddle_width, 7, accent_red, accent_green, accent_blue);
    } else {
        snprintf(line, sizeof(line), "PADDLE RALLY    YOU %d  :  %d CPU", score, other);
        text(16, 14, line);
        for (int y = 40; y < 220; y += 15) rect(159, y, 2, 7, 48, 53, 72);
        rect(21, paddle, 7, paddle_height, accent_red, accent_green, accent_blue);
        rect(292, rival, 7, 40, 141, 178, 255);
    }
    rect(bx, by, 6, 6, 255, 241, 215);
    if (paused) text(132, 150, "PAUSED");
    else if (over) {
        text(112, 150, GAME_BRICKS ? (remaining ? "GAME OVER" : "ALL CLEAR!") : (score >= 7 ? "YOU WIN!" : "CPU WINS"));
        text(80, 168, "CROSS TO PLAY AGAIN");
    } else if (waiting) text(88, 160, "CROSS TO LAUNCH");
}
int main(void) {
    ResetGraph(0); SetVideoMode(MODE_NTSC); FntLoad(960, 0);
    for (int i = 0; i < 2; i++) {
        SetDefDrawEnv(&drawing[i], 0, i * 240, 320, 240);
        SetDefDispEnv(&display[i], 0, i * 240, 320, 240);
        drawing[i].isbg = 1; setRGB0(&drawing[i], 18, 20, 34);
    }
    InitPAD(pad1, sizeof(pad1), pad2, sizeof(pad2)); StartPAD(); ChangeClearPAD(0);
    SetDispMask(1); reset();
    uint16_t previous = 0;
    int paused = 0;
    for (;;) {
        PADTYPE *pad = (PADTYPE *)pad1;
        uint16_t held = pad->stat == 0 ? (uint16_t)~pad->btn : 0;
        uint16_t pressed = held & ~previous;
        previous = held;
        if (pressed & PAD_START) paused = !paused;
        if (pressed & PAD_SELECT) { reset(); paused = 0; }
        if (!paused) update(held, pressed);
        ClearOTagR(order[frame], 2); next = packets[frame];
        render(paused);
        DrawSync(0); VSync(0);
        PutDispEnv(&display[frame ^ 1]);
        DrawOTagEnv(&order[frame][1], &drawing[frame]);
        frame ^= 1;
    }
}
