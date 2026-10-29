/* Browser services for the directly compiled game. No console runtime. */
#pragma once

enum {
    PAD_SELECT = 1 << 0, PAD_START = 1 << 3,
    PAD_UP = 1 << 4, PAD_RIGHT = 1 << 5,
    PAD_DOWN = 1 << 6, PAD_LEFT = 1 << 7, PAD_CROSS = 1 << 14
};

__attribute__((import_module("arcade"), import_name("rect")))
void rect(int x, int y, int w, int h, int r, int g, int b);
__attribute__((import_module("arcade"), import_name("text")))
void text(int x, int y, const char *s);
