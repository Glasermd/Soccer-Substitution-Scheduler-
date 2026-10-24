# ⚽ Soccer-Substitution-Scheduler-
Soccer Substitution Scheduler 


A mobile-first, single-file web application designed for managing youth soccer (5v5) player rotations, sideline timing, and multi-game playing time balance. Built for quick, one-handed operation on the sideline with instant SMS/RCS schedule sharing and cloud state persistence.

---

## ✨ Key Features

* **📋 Dynamic Attendance & Roster Management:** 
  * Defaults to selecting all players on the roster.
  * One-tap attendance toggles automatically recalculate the entire game's substitution schedule based on how many players are present (e.g., shifting seamlessly between 2 subs per shift with 7 players, or 1 sub per shift with 6 players).
* **⚖️ Multi-Week Fair Play Algorithm:** 
  * Balances sitting shifts across both the current game and cumulative historical games.
  * Prevents back-to-back sitting shifts (no player sits more than 4 minutes consecutively unless forced by a full-quarter override).
* **🔄 On-the-Fly Sideline Reconfiguration:** 
  * **Edit Actuals:** If a substitution deviates from the plan (e.g., an injury, tired player, or ref wave-off), tap any shift to lock in who *actually* sat out. All remaining unlocked shifts automatically recalculate to maintain overall balance.
  * **Full 8-Min Quarter Override:** One-tap toggle for quarters where the referee does not stop play for a mid-quarter substitution.
* **⏱️ Built-In Sideline Timer & Whistle Alerts:** 
  * 8:00 quarter countdown clock with visual progress bars for 1st Half (8:00–4:00) and 2nd Half (4:00–0:00) shifts.
  * Quick `-15s`, `+15s`, and `Sync 4:00` buttons to keep your phone aligned with the referee's whistle.
  * Synthesized Web Audio referee whistle + vibration alerts at the 4:00 mid-quarter sub mark and 0:00 quarter end, displaying a clear banner of who is **Coming In** and **Going Out**.
* **💬 1-Tap SMS / RCS Schedule Export:** 
  * Formats the current rotation into clean text message bubbles (`Out 1st...`, `2nd part of 2nd...`) for quick copying and pasting into group texts.
* **☁️ Dual Persistence (Firebase + LocalStorage):** 
  * Connects to Google Firebase Firestore for real-time syncing across multiple coaches/parents' devices and week-to-week season tracking.
  * Gracefully falls back to browser `localStorage` for 100% offline sideline reliability.

---

## 🚀 Deployment (GitHub + Vercel)

Because the entire application lives inside a single `index.html` file with zero build steps Required, deploying to Vercel takes less than a minute:

1. Push `index.html` and `README.md` to a new GitHub repository.
2. Log in to [Vercel](https://vercel.com/) and click **Add New... → Project**.
3. Import your GitHub repository.
4. Leave the Framework Preset as **Other** (no build command needed) and click **Deploy**.

---

## 🔥 Connecting Firebase (Optional for Multi-Device Sync)

Out of the box, the app saves your roster, game states, and cumulative shift history locally on your phone using `localStorage`. To sync across multiple phones in real time:

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Navigate to **Build → Authentication → Sign-in method** and enable **Anonymous** sign-in.
3. Navigate to **Build → Firestore Database**, create a database, and start in **Test Mode** (or configure rules for your app path).
4. In **Project Settings → General**, register a **Web App** and copy your `firebaseConfig` object.
5. In `index.html`, pass your configuration into `__firebase_config` (or replace the config initialization block directly with your keys).
6. **Important:** Add your Vercel production URL (e.g., `your-project.vercel.app`) under **Authentication → Settings → Authorized domains** in the Firebase Console.

---

## 📱 Sideline Workflow

1. **Pre-Game Roll Call:** Open the app before kickoff and tap any absent players in the **Attendance** bar to mark them out.
2. **Share the Plan:** Scroll to the **Text Schedule** card and tap **Copy All** to text the initial rotation to the sideline.
3. **Run the Clock:** Tap **Start** when the ref blows the opening whistle. At the `4:00
4. 
