# PlayStation to Web

**Play, debug, and remix original PlayStation games in your browser. Vibe the game as you play.**

**[Open the arcade — play in your browser](https://steveseguin.github.io/playstation-to-web/)**

Try **Paddle Rally** and **Brick Shift**, two free, original PS1 homebrew games.
Choose a game, press **Play now**, and find its controls below the screen.
No disc or BIOS upload is needed. Each game has an **Apply mod** drawer;
the hosted demos do not have mods yet.

The arcade currently plays these homebrew games through EmulatorJS. They are
not yet compiled with `psxw`. The compiler and its live JavaScript mod tools
described below are a separate path. [Arcade source, licenses, and setup](demos/README.md).

PlayStation to Web turns supported PlayStation 1 games into programs that run
directly in a web browser. It also lets you modify a game while you're playing:
change its rules, tweak values, and try new behavior through JavaScript mods
without restarting your session.

The compiler's first game is **Harvest Moon: Back to Nature**. This is an early developer
project built around that game's decompilation (reconstructed source code).
Other games need their own source project and integration; you cannot just
drop in any PlayStation disc and expect it to work.

## What can you do with it?

- **Play in your browser**, with keyboard or gamepad controls, sound, and saved games.
- **Remix a game live.** Load or replace JavaScript mods during play, change game
  values, and alter what game functions do. A mod can change rewards, adjust
  difficulty, or try out a new mechanic.
- **Vibe the game as you play.** Write a mod yourself or use an AI coding assistant
  to help write it, load it into your running game, and keep iterating. Live
  changes use the mod tools; there is no built-in AI chat interface.
- **Look under the hood.** Inspect game state and set breakpoints in the game's
  C code using browser developer tools.

[Watch the demo and walkthrough](https://youtu.be/6qEwwaCxalc).

## How does it work?

The project compiles reconstructed game code into **WebAssembly**, a format that
lets browsers run compiled programs. It translates remaining PlayStation machine
code ahead of time and supplies the graphics, audio, input, and disc services
the game needs.

```mermaid
flowchart TD
    source["1. Start with a supported decompilation project<br/>Reconstructed game C code + SDK sources"]
    originals["Matching original game and SDK inputs<br/>Machine code + symbols + game configuration"]
    inspect["2. Map the game<br/>Identify functions, original addresses, and overlays<br/>(code sections loaded as the game runs)"]
    source --> inspect
    originals --> inspect

    inspect --> c["3a. Use reconstructed C<br/>Prepare the source for the browser compiler"]
    inspect --> lift["3b. Translate remaining machine code<br/>Convert PlayStation MIPS instructions into C"]
    inspect --> adapters["3c. Connect hardware services<br/>Use Rust adapters and the runtime"]

    c --> compile["4. Compile to WebAssembly<br/>Clang compiles both kinds of C"]
    lift --> compile
    compile --> link["5. Link the game code<br/>Preserve PlayStation addresses and function calls<br/>Resolve which overlay code is active"]
    adapters --> runtime["Compile the Rust runtime<br/>Console services, graphics, sound,<br/>disc access, input, and saves"]
    link --> merge["6. Combine into game.wasm<br/>Game code + runtime in one compiled module"]
    runtime --> merge
    merge --> bundle["7. Package the browser player<br/>Web page + JavaScript host + renderer + game.wasm"]
    bundle --> play["8. Play in your browser<br/>A background Worker runs the compiled game<br/>The browser presents graphics, audio, and controls"]

    disc["Your matching disc image<br/>Provides initial game memory and assets at play time"] --> play
    mods["Optional: live JavaScript mods<br/>Build with --moddable<br/>Change values or hook game functions"] -. "Apply or swap while playing" .-> play
    play -. "See the result and refine your mod" .-> mods

    classDef input fill:#e8eef8,stroke:#42618c,color:#172a45
    classDef build fill:#fff1dc,stroke:#a86a18,color:#553508
    classDef output fill:#e5f3e9,stroke:#39734b,color:#173d23
    classDef mod fill:#f0e7fa,stroke:#8054a6,color:#43245f
    class source,originals,disc input
    class inspect,c,lift,adapters,compile,link,runtime,merge build
    class bundle,play output
    class mods mod
```

**Decompilation happens upstream:** people reconstruct the game's source in a
separate project. `psxw` uses that work and translates the remaining machine code
before play. The resulting WebAssembly runs the compiled game in the browser.
The public arcade's EmulatorJS demos use a separate playback path.

For compiled commercial games, you supply the matching game's disc image
(`.cue` and `.bin` files) for its assets. Commercial game discs and assets are
not included in this repository or the public arcade.

## Getting started

Building a game currently requires developer tools and setup. The command-line
tool is called **`psxw`**; existing commands and configuration filenames still
use that short name.

- [Developer setup and build commands](README.slop.md)
- [Browser controls, saves, and live JavaScript mods](web/README.md)
- [How the compiler and runtime work](docs/design.md)
- [Development progress and remaining work](plans/README.md)

APIs and game support are still evolving. Expect rough edges, especially when
bringing another game into the project.
