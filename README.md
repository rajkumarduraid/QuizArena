# Quiz Arena

A live, buzzer-style team quiz that runs entirely in the browser. Players join
with a six-character code and a name — no accounts, no sign-up. Every answer is
timed to the millisecond, so each reveal names **who buzzed in first and exactly
how long they took**.

**▶ Play: https://rajkumarduraid.github.io/QuizArena/**

The whole thing is one self-contained `index.html`. No build step, no server, no
dependencies to install.

---

## Running a game

1. **Host** opens the link and picks **Host a game**.
2. Write your questions — or press **Load sample quiz** to see the shape of one.
   Questions are saved in your browser, so you can build a quiz days ahead.
3. Set up teams and scoring under **Teams** and **Rules & access**.
4. **Open the room.** You get a six-character code, a join link, and a QR code.
5. **Players** open the same link, tap **Join a game**, and enter the code and a
   name. Nothing starts until the host presses **Start**.

Host controls during play: reveal, skip, next, end early — plus <kbd>Space</kbd>
to advance and <kbd>R</kbd> to reveal, handy when the laptop is on a lectern.
Each round reveals automatically when the clock runs out or everyone has
answered.

### The projector view

`https://rajkumarduraid.github.io/QuizArena/#/dash/CODE` opens a read-only live
dashboard — team race, fastest responders, answer breakdown, leaderboard. The
host can pop it into a second window from the lobby.

---

## What it shows you

| | |
|---|---|
| **⚡ Fastest correct answer** | Named on every reveal with the exact time, e.g. `1.84s` |
| **Speed podium** | The five quickest correct answers, ranked |
| **Answer distribution** | How the room split across the options |
| **Leaderboard** | Live scores with per-round deltas and streaks |
| **Team race** | Totals *and* per-player averages, so an uneven split can't hide |
| **Final results** | Podium, full table with average and fastest times, CSV/JSON export |

Scoring is configurable: how much speed is worth, a bonus for the fastest
correct answer, a streak bonus, and an optional penalty for wrong answers.

---

## How devices connect

Two modes, chosen under **Rules & access**:

- **Any device** (default) — phones and laptops join from anywhere. Two routes,
  picked automatically: if the page is served by the bundled relay server it
  uses that; otherwise it connects browsers peer-to-peer over WebRTC.
- **This device only** — other tabs and windows on the same computer. Always
  works, including offline and straight from a downloaded file.

### If your network blocks peer-to-peer

Most workplaces and schools do. You will see this in the lobby:

> ⚠️ **Could not reach the service that links devices together**

and players typing a valid code will be told no room answered. **Run the
bundled server instead.** It carries the game over ordinary web requests, which
firewalls allow, and the page switches to it automatically — nothing to
configure.

Download `index.html` and one of the server files into the same folder, then:

```bash
node server.js          # if you have Node
python3 server.py       # if you have Python 3
```

It prints the address to share:

```
  ⚡ Quiz Arena is running

  On this computer:   http://localhost:8080

  Share ONE of these with your players:
      http://192.168.1.42:8080
```

Everyone opens that address — host included. Players need to be on the same
network as the computer running it. Leave the window open for the whole quiz;
nothing is written to disk and the rooms disappear when you stop it.

Both servers behave identically and need no installed packages. Add a port
number to change it: `node server.js 3000`.

### Sharing the file instead of the link

Putting `index.html` in OneDrive, Google Drive, Teams or an email attachment
gives every person their own separate copy on their own machine. Separate
copies cannot see each other, and the join link would just be a path on the
host's hard drive. Share the **web address**, not the file. The app detects
this case and says so rather than offering a link that cannot work.

### Which connection am I on?

Open a room and read the pill at the top-left of the lobby:

| Pill | Meaning |
|---|---|
| 🌐 **Open to any device** | Working — over the relay if you started a server, otherwise peer-to-peer. |
| 💻 **This device only** | Set that way under *Rules & access*. Only other tabs here can join. |
| ⚠️ **Could not reach the connection service** | Peer-to-peer is blocked. Start the server as above. |

---

## Hosting it yourself

`index.html` is a complete static site — any host will serve it. For GitHub
Pages: **Settings → Pages → Deploy from a branch → `main` / `(root)`**. The
repository must be public unless you are on a paid GitHub plan.

Static hosting gives you peer-to-peer play. If your network blocks that, use
`server.js` / `server.py` instead, as described above — it serves the page *and*
relays the game.

---

## Privacy

Quizzes and results are held in your own browser's `localStorage`. There is no
account, no database and no analytics.

- **Peer-to-peer**: game data travels directly between browsers. Only the
  initial handshake touches an outside service, and it carries no quiz content.
- **Relay server**: everything stays on the machine you run it on, in memory
  only. Nothing is written to disk, and rooms vanish when you stop it.

## Files

| | |
|---|---|
| `index.html` | The entire app. Open it, host it, or serve it — nothing else required. |
| `server.js` | Optional relay for networks that block peer-to-peer. Node 14+. |
| `server.py` | The same relay for Python 3.7+. Use whichever runtime you have. |

## Credits

Bundled inline so the page has no external dependencies:

- [PeerJS](https://peerjs.com) 1.5.4 — MIT
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 by
  Kazuhiko Arase — MIT
