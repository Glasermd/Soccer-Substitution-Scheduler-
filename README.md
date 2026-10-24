# ⚽ Soccer Sideline Sub, Position & Stats Manager

A mobile-first, single-file web application for youth soccer coaches to manage fair bench rotations, automated field position assignments (`FWD`, `MID`, `DEF`, `GK`), live match scoring (goals and assists), sideline timing, and season-long team statistics. Built for fast, one-handed sideline operation with instant SMS/RCS schedule sharing and automatic state persistence.

---

## ✨ Key Features

### 📋 Blank-Slate Onboarding & Roster Management
* **First-Load Team Setup:** Starts with a clean onboarding prompt to set your team name, select your game format, and build your roster.
* **Jersey Numbers & Inline Editing:** Add player names alongside optional jersey numbers (`#`), edit numbers or names at any time, and toggle player attendance with a single tap during pre-game roll call.
* **Starter Order Rotation:** One-tap `🔀 Rotate Order` button shifts tie-breaker priority from week to week.

### 📐 Configurable Game Formats & Formations (4v4 to 11v11)
* **Built-In Presets:** Supports `4v4 (No GK)`, `5v5 (No GK: 2-1-2 or 3-2)`, `5v5 (With GK)`, `6v6`, `7v7 (2-3-1 or 2-2-2)`, `9v9`, and `11v11`.
* **Custom Zone Slots:** Fine-tune the exact number of active on-field slots for **Attack (`FWD`)**, **Midfield (`MID`)**, **Defense (`DEF`)**, and **Goalie (`GK`)**.
* **Flexible Timing:** Configure quarter durations (`6`, `8`, `10`, `12`, or `15` minutes) and choose between **2 shifts per quarter** (mid-quarter sub) or **1 shift per quarter** (full-quarter rotation).

### ⚖️ Fair Playtime & Position Rotation Engine
* **Multi-Game Bench Balancing:** Dynamically calculates sitting shifts based on who is present today combined with cumulative season bench history, while preventing back-to-back sitting shifts.
* **Automated Position Rotation:** Assigns on-field players across `FWD`, `MID`, `DEF`, and `GK` by prioritizing players with the lowest cumulative shifts in each zone and applying an anti-stagnation penalty so players don't get stuck in the same position for consecutive shifts.
* **Live Fairness Matrix:** Displays a real-time table of today's shifts (and cumulative season totals in parentheses) across Bench, `FWD`, `MID`, `DEF`, `GK`, and overall Play Percentage.

### 🔄 On-the-Fly Sideline Reconfiguration
* **Interactive Shift & Position Modal:** Tap any shift card (`✏️ Edit Actual`) to swap who actually sat on the bench or tap any active player's position badge to lock in a manual position change. Saving locks that shift and automatically recalculates all remaining unlocked shifts to preserve overall fairness.
* **Full-Quarter Override:** Toggle `Full Qtr (No Mid-Sub)` on any quarter header if the referee waves off the mid-quarter stoppage; the app holds the current lineup for the full quarter and rebalances the rest of the match.

### 🏆 Live Scorekeeper (Goals & Assists)
* **Team Goal Logger:** Tap `+ Goal ⚽` under your team to select **Who Scored** (or *Own Goal*) and **Who Assisted** (or *Unassisted*). Every goal is automatically stamped with the active quarter and countdown clock time.
* **Opponent Score Counter:** Quick `+1` and `-1` buttons track the opposing team's score without extra prompts.
* **Match Scoring Timeline:** Displays a live summary of goals and assists beneath the scoreboard with one-tap undo (`✕`).

### 📊 Season Stats Leaderboard & Game History Viewer
* **Team Record Dashboard:** Automatically calculates season `W-L-D` record, **Goals For**, **Goals Against**, and **Goal Differential**.
* **Player Season Leaderboard:** Tracks cumulative **Games Played (`GP`)**, **Goals (`G`)**, **Assists (`A`)**, **Points (`PTS`)**, **Bench Shifts**, and **Position Breakdown (`FWD / MID / DEF / GK`)** across all completed games.
* **Completed Match Archive:** Tapping `✅ Complete & Save Game` at the end of a match archives the date, opponent, final score, and goal/assist log into the permanent Game History list while rolling all shift and stat totals into the season baseline.

### ⏱️ Built-In Sideline Timer & Referee Whistle Alerts
* **Quarter & Shift Countdown:** Features a high-contrast clock with `-15s`, `+15s`, and `Sync Mid` buttons to stay aligned with the referee's watch.
* **Dual-Half Progress Bars:** Visually tracks both the 1st half and 2nd half of each quarter.
* **Synthesized Whistle + Vibration Alerts:** Uses the native Web Audio API to blow a referee whistle at the mid-quarter sub mark and end of the quarter, popping up an on-screen alert banner showing who is **Coming ON Field**, **Going to Bench**, and their **Assigned Field Positions**.

### 💬 1-Tap SMS / RCS Schedule Export
* **Two Formatting Modes:** Switch between **Subs Only** (`Out 1st: ...`, `2nd part of 1st: ...`) and **Subs + Positions** (`Out 1st: ... | FWD: ... • MID: ... • DEF: ...`).
* **Instant Copy:** Tap any individual message bubble to copy a single shift, or tap `📋 Copy All` to paste the full game plan into a parent or coaching group text.

---

## 🚀 Deployment (GitHub + Vercel)

Because the entire application is contained in a single `index.html` file with zero build steps or external dependencies, deploying to Vercel takes under a minute:

1. Push `index.html` and `README.md` to a GitHub repository.
2. Log in to [Vercel](https://vercel.com/) and click **Add New... → Project**.
3. Import your GitHub repository.
4. Leave the Framework Preset as **Other** (no build command or output directory required) and click **Deploy**.

---

## 📱 Game-Day Sideline Workflow

1. **Initial Setup (First Use Only):** Enter your team name, choose your formation preset, and add your players with their jersey numbers.
2. **Pre-Game Roll Call:** Tap any absent players in the **Roll Call** bar to mark them out—the bench and position schedule recalculates immediately.
3. **Share the Lineup:** Scroll to **Text Schedule** and tap **Copy All** to text the rotation to assistant coaches or parents.
4. **Kickoff & Live Tracking:**
   * Enter the opponent's name on the scoreboard and tap **▶ Start** on the quarter timer at the opening whistle.
   * Log team goals and assists as they happen using **+ Goal ⚽**.
   * If a substitution or position changes mid-game, tap that shift card to lock in the actual lineup and rebalance the remaining shifts.
5. **Post-Game Archive:** After Quarter 4, tap **✅ Complete & Save Game** at the bottom of the page to archive the match result and roll all player stats and shift counts into the **📊 Stats & Game History** tab.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, Vanilla JavaScript, Tailwind CSS (CDN)
* **Audio:** Native Web Audio API (synthesized referee whistle with zero external audio files)
* **Storage:** Browser `localStorage` (`soccer_sub_pos_stats_v3`) for automatic offline-ready persistence
* 
