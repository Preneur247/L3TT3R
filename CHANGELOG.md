# Changelog

## [0.1.8] - 2026-04-23
- Smoothed how windows resize so modal and card heights grow and shrink naturally with content changes.
- Improved modal consistency by adding clearer divider lines above action buttons across utility flows.
- Refined Game Room setup visuals: slider states, player count badge, and spacing now match the rest of the settings UI.

## [0.1.7] - 2026-04-23
- **Persistent Game Room**: Matchmaking and Game Room states are now unified into a single persistent modal, eliminating the "flash" effect during transitions.
- **Improved Loading States**: Added explicit loading spinners and placeholders for player slots to ensure the UI feels stable while fetching data.
- **Fluid Layout**: Implemented CSS transitions for smooth height adjustments when entering or leaving matchmaking.

## [0.1.6] - 2026-04-23
- **Smoother Gameplay**: Fixed several bugs that caused the screen to flash or menus to freeze when entering and leaving rooms quickly.
- **Connection Handling**: The game now gracefully returns you to the main lobby if your opponent loses their internet connection during a match.
- **Timer Fix**: Fixed a visual bug where the game timer would briefly show the leftover time from the previous round before resetting.

## [0.1.5] - 2026-04-18
- **App Icon Reliability**: Finalised a stable app icon setup that works across all mobile devices, including Safari on iPhone.
- **PWA Enhancements**: Improved the web manifest for better home screen installation.
- **Improved Versioning**: Updated internal tools to follow strict semantic versioning (Major.Minor.Patch).

## [0.1.4] - 2026-04-18
### Added
- **Unified Versioning**: Centralised all version tracking into a single file for better reliability.
- **Mobile Icon Fixes**: Added high-resolution icon support and fixed display bugs on iOS and Android devices.
- **PWA Support**: Added a web manifest so the game feels more like a native app when saved to your home screen.
- **Easy Deploy**: Added a new "one-click" command to build and push updates to the web instantly.

## [0.1.3] - 2026-04-17
### Fixed
- **Stability update**: Fixed statistics word bank count and most used/longest word calculations. Fixed button placement in game end screen.

## [0.1.2] - 2026-04-17
### Improved
- **Word Bank Speed**: Optimised how your words are saved to ensure the game stays fast and stable, no matter how many thousands of words you find.
- **Mobile Buttons**: Buttons now "self-adjust" their size to fit perfectly on any phone screen, preventing text from cutting off or wrapping.
- **Better Onboarding**: Clarified the account setup process with smoother prompts and "Skip for Now" options.
- **Stat Tracking**: Your personal records (Best Streak, Longest Word, etc.) now update instantly and accurately.

### Fixed
- **Connection Issues**: Fixed rare errors that occurred at the end of matches.
- **Mobile Layout**: Fixed alignment bugs for badges and scoreboard on small mobile devices.
- **Name Security**: Added better filtering for usernames to keep the database tidy.

## [0.1.1] - 2026-04-16
### Added
- Word Bank: Track and browse every unique word you have formed across all modes.
- Grouped word display with frequency tracking.

### Fixed
- Real-time profile synchronization: Stats and Word Bank now update instantly after matches.
- Matchmaking "zombies": Public rooms now correctly re-list if a guest disconnects early.
- Performance: Removed redundant legacy code and optimized Firebase listeners.

## [0.1.0] - 2026-04-16
### Added
- Integrated user accounts and statistics tracking.
- Added support for persistent user profiles and guest account linking.
- New game modes and lobby configuration options for word length and win targets.
- Enhanced UI consistency and glassmorphism styling across the app.

## [0.0.2] - 2026-04-13
### Security
- Hardened database security rules to prevent unauthorized data access and modifications.
- Improved environment configuration management for enhanced security.

## [0.0.1] - 2026-04-13
### Added
- Initial project setup for L3TT3R.
- React frontend with Vite, Vanilla CSS, and Glassmorphism design.
- Firebase Realtime Database integration.
- Multiplayer matchmaking, game states, and loop logic implemented.
- English-to-Chinese translation for guessed words.
