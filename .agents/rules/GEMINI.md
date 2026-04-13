---
trigger: manual
---

# L3TT3R Agent Guidelines

## 1. Project Overview
L3TT3R is a real-time multiplayer web app (PWA-style game) where 2 players race to form a word starting and ending with specific letters. 
The app runs on a serverless architecture using React, Vite, and Firebase Realtime Database. 

## 2. Core Principles
- **No Custom Backend:** Rely entirely on Firebase Realtime DB and client-side logic to handle matchmaking and game state. Do NOT introduce external Node.js/Express servers or WebSockets.
- **Immediate Feedback:** Realtime sync through Firebase `onValueListeners` should dictate app state to maintain ultra-low latency parsing.
- **Glassmorphism & Dark Mode:** The visual identity relies on smooth vanilla CSS animations, a dark color palette, and glowing accents. Avoid arbitrary resets of the design system. Keep mobile responsiveness a priority (especially the iOS Safari keyboard and viewport edge cases).

## 3. Tech Stack
- Frontend: Vite + React
- Styling: Vanilla CSS (Dark mode, glassmorphism)
- Backend / Database: Firebase Realtime Database (Serverless)
- Authentication: Firebase Anonymous Auth

## 4. Workflows
- Refer to `spec.md` for specific rules, flows, and data structures.
- Modify existing `jsx` files in `client/src/components` logically and cleanly. Keep components small.