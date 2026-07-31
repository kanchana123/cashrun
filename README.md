# CashRun 🏃💨💰

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-iOS%20%7C%20Android%20%7C%20Web-brightgreen)](#tech-stack)

**CashRun** is a cross-platform 2D runner game built for web, iOS, and Android. Designed with asynchronous game loops, custom level progression dynamics, and multi-theme rendering, CashRun offers an engaging mobile gameplay experience available natively on app stores and directly in the browser.

---

## 🔗 Live Play & App Downloads

* 📱 **iOS App Store:** [Download on App Store](https://apps.apple.com/in/app/cashrun-wallet-vs-bills/id6755665213)
* 🤖 **Google Play Store:** [Get it on Google Play](https://play.google.com/store/apps/details?id=com.kanchannannavare.cashrun&hl=en_US)
* 🌐 **Web App Game:** [Play Online Demo](https://cashrun-wallet-vs-bills.netlify.app)
* 🏠 **Official Website:** [CashRun Landing Page](https://cashrun.netlify.app)

---

## 🛠️ Architecture & Tech Stack

The application is built using a hybrid cross-platform architecture, enabling a unified JavaScript/HTML5 core codebase to run natively on mobile operating systems via Ionic Capacitor.

* **Frontend & Game Engine:** HTML5 Canvas, JavaScript (ES6+), CSS3
* **Mobile Runtime Bridge:** Ionic Capacitor (`capacitor.config.json`)
* **iOS Native Layer:** Swift / Xcode Target (`/ios`)
* **Android Native Layer:** Java / Android Studio Target (`/android`)
* **Game Logic Modules:**
  * `levelManager.js` – Dynamic difficulty scaling and procedural level generation logic.
  * `themes.js` – State-driven environment and UI theme switching system.
  * `script.js` – Core game loop, event listeners, collision detection, and score state management.

---

## 📸 Key Features

* **Cross-Platform Compatibility:** Single game core compiled seamlessly to native iOS, Android, and web targets.
* **Modular Theme System:** Dynamic visual switching powered by modular JavaScript state management.
* **Adaptive Level Progression:** Procedural difficulty adjustment designed to maximize player retention.
* **Native Mobile Integration:** Configured with custom splash screens (`splash.png`) and native app icon assets (`app-icon.png`).

---

## 🚀 Local Development Setup

To clone and run the project locally on your machine:

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/kanchana123/cashrun.git](https://github.com/kanchana123/cashrun.git)
   cd cashrun```
2. **Install dependencies:**
   ```bash
   npm install```
   
3. **Run the Web Version:**
Open index.html directly in your browser or run a simple local web server:
   ```bash
   npx serve .```
4. **Build & Sync Native Mobile Projects:**
   ```bash
    # Sync web assets to iOS & Android native containers
    npx cap sync

    # Open native projects in respective IDEs
    npx cap open ios      # Opens Xcode
    npx cap open android  # Opens Android Studio

## 📜 License
Distributed under the GNU General Public License v3.0 (GPLv3). See LICENSE for more details.

## 👤 Author
Kanchan Nannavare

Portfolio: kanchan-nannavare.netlify.app

GitHub: @kanchana123
   
