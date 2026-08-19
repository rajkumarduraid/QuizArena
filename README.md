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

- **Any device** — phones and laptops connect peer-to-peer over WebRTC. This is
  the default and needs the page opened from an `https://` address (the Pages
  link above).
- **This device only** — other tabs and windows on the same computer. Always
  works, including offline and straight from a downloaded file.

### Two things that will not work

**Sharing the file instead of the link.** Putting `index.html` in OneDrive,
Google Drive, Teams or an email attachment gives every person their own separate
copy on their own machine. Separate copies cannot see each other, and the join
link would just be a path on the host's hard drive. Share the **web address**,
not the file. The app detects this case and says so rather than offering a link
that cannot work.

**Networks that block peer-to-peer.** Many corporate and school networks do.
When that happens, players type a valid code and are told no room answered.

To tell which you are hitting, open a room and read the pill at the top-left of
the lobby:

| Pill | Meaning |
|---|---|
| 🌐 **Open to any device** | Working. Phones and laptops can join. |
| ⚠️ **Could not reach the connection service** | Your network is blocking it. Try a phone hotspot to confirm. |

---

## Hosting it yourself

Any static host works. For GitHub Pages: **Settings → Pages → Deploy from a
branch → `main` / `(root)`**. The repository must be public unless you are on a
paid GitHub plan.

To run it locally instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## Privacy

Everything stays in the browser. Quizzes and results are held in your own
`localStorage`; nothing is uploaded, and there is no backend. When players are
on different devices, the game data travels directly between browsers — only the
initial handshake touches an outside service, and it carries no quiz content.

## Credits

Bundled inline so the page has no external dependencies:

- [PeerJS](https://peerjs.com) 1.5.4 — MIT
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 by
  Kazuhiko Arase — MIT
