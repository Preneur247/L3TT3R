---
trigger: always_on
---

# App Specification: L3TT3R

## 1. Overview
L3TT3R is a competitive, time-based, word-forming game played between 2 players per match. Players compete to be the first to type a valid English word that fits a specific set of constraints (starting letter, ending letter, minimum length). 

## 2. Tech Stack & Architecture
- **Frontend Framework:** Vite + React.
- **Styling:** Vanilla CSS (Glassmorphism, Dark mode, glowing highlights).
- **Backend/Database:** Firebase Realtime Database (Serverless architecture, fully handles matchmaking and sync).
- **Authentication:** Firebase Anonymous Auth.
- **Third-party Services:** 
  - **Dictionary:** Fetched on client via raw GitHub user content (`words_alpha.txt`).
  - **Translation:** `mymemory.translated.net` API for English-to-Chinese word definitions.

## 3. Screen Design & User Flow

### Screen 1: Lobby
- **State:** Idle / Searching
- **UI Elements:** 
  - Glass card container with Title (L3TT3R).
  - Subtitle: "Race to be first to reach the target score!".
  - "Find Match" Button.
- **Flow:** User clicks "Find Match" -> Changes to "Searching...". Looks for an open slot in Firebase (`lobby/waiting`). If none exists, creates one and waits.

### Screen 2: Matchmaking / Waiting
- **UI Elements:** Pulsing subtitle "Waiting for opponent to connect...".
- **Flow:** Host waits here until Player 2 joins the created match ID. Re-routes to Setup once joined.

### Screen 3: Match Setup
- **Role Specific UI:** 
  - **Host (P1):** Inputs to set "Minimum word length" (3-10) and "Points to win" (5, 10, 20). "Start" button.
  - **Guest (P2):** Read-only view indicating "Host is configuring match settings...".
- **Flow:** Host clicks Start to transition into the gameplay loop.

### Screen 4: Gameplay - Picking Letters Phase
- **UI Elements:**
  - Scoreboard at the top (You vs Opp).
  - Game Info Bar (Win target, Min length, Overall Game Win/Loss record).
  - Two large Letter Boxes (Starting Letter and Ending Letter). Shows '?' if empty, '🔒' if locked.
  - Text Prompt: "Pick the [starting/ending] letter" or "Waiting for opponent...".
  - Input form to type exactly 1 letter (A-Z) and a "Lock" button.
- **Flow:** Both players type a single letter and click Lock. Once both lock, letters are revealed and Guessing Phase begins.

### Screen 5: Gameplay - Guessing Phase
- **UI Elements:**
  - The Start and End letter boxes are revealed and prominently displayed.
  - A 99-second countdown timer (changes color: safe > 30s, warning > 10s, danger < 10s).
  - Text input to type the guessed word.
  - "Submit" and "Pass" buttons.
- **Rules:** 
  - Word is checked against client-side loaded dictionary.
  - Matches Start Letter, End Letter, and Minimum Length.
- **Flow:** 
  - Player guesses infinitely until right. 
  - Timeout at 0s triggers a draw. 
  - Both players picking "Pass" triggers a draw. 
  - Once someone guesses correctly, round ends immediately.

### Screen 6: Round Verification & Translation Popup
- **UI Elements:**
  - Overlay Popup showing "You Won!", "Opponent Won!", or "Draw".
  - Displays the winning English word.
  - Shows an async loading spinner followed by the Chinese translation.
  - "Continue" button.
- **Flow:** Player clicks "Continue", roles swap (Starter becomes Ender), and loops back to **Screen 4 (Picking Letters)**.

### Screen 7: Game Over Screen
- **Condition:** A player reaches the required Win Target score.
- **UI Elements:**
  - "VICTORY" or "DEFEAT" Popup.
  - Shows the final word and translation from the match point.
  - Displays overall "Games" stats (Lifetime wins).
  - "Play Again" (Resets scores, sends to Match Setup) or "Leave" (Return to Lobby).

## 4. Firebase Data Models (RTDB)

### Global Paths
- **`lobby/waiting`:** String holding the matchId of a currently waiting player. Claimed via transaction to ensure atomic matchmaking.

### Match Object (`matches/{matchId}`)
- `id`: String (Match ID).
- `state`: String enum. Represents the current phase of the match: `'WAITING' | 'SETUP_LENGTH' | 'PICKING_LETTERS' | 'GUESSING' | 'ENDED_ROUND' | 'GAME_OVER'`.
- `player1`, `player2`: Strings (UIDs).
- `player1Score`, `player2Score`: Integers (Round wins in the current game).
- `player1GameWins`, `player2GameWins`: Integers (Lifetime game wins across multiple matches between these two players).
- `winTarget`: Integer (Score required to win the game).
- `minWordLength`: Integer (Minimum length for valid words).
- `player1Role`, `player2Role`: `'START' | 'END'`. Determines which letter the player provides.
- `player1Letter`, `player2Letter`: String (1 char). The letter chosen during `PICKING_LETTERS`.
- `startLetter`, `endLetter`: String (1 char). The finalized letters for the `GUESSING` phase.
- `player1Pass`, `player2Pass`: Boolean. True if the player voted to pass the round.
- `currentRound`: Integer. Tracks the round number.
- `roundStartTime`: Timestamp (ms). Used for the 99s countdown.
- `lastRoundResult`: Object.
  - `winnerId`: String UID (or null for draw).
  - `word`: String (The winning word).
  - `translation`: String (Chinese translation of the word, updated asynchronously).
  - `reason`: `'correct' | 'timeout' | 'pass'`.
- `winner`: String UID (The winner of the overall game).

## 5. Match State Flow & Transformations

The game loop is strictly driven by the `state` property in the `matches/{matchId}` node. Clients listen to these changes via `onValue` and react accordingly.

1. **`WAITING`**
   - **How it works:** Host created the match and is waiting.
   - **Transformation:** When Player 2 searches for a match, they claim `lobby/waiting`, then update the match object by setting `player2` UID, initializing scores to 0, and changing state to `SETUP_LENGTH`.

2. **`SETUP_LENGTH`**
   - **How it works:** Player 1 configures the game (`winTarget`, `minWordLength`).
   - **Transformation:** Player 1 clicks "Start". They update the match state to `PICKING_LETTERS`, assign `player1Role` to 'START', `player2Role` to 'END', and set `currentRound` to 1.

3. **`PICKING_LETTERS`**
   - **How it works:** Both players input exactly one letter corresponding to their role (START or END). 
   - **Transformation:** When a player locks their letter, they update either `player1Letter` or `player2Letter`. The client who locks second detects that both `player1Letter` and `player2Letter` are present, and updates the state to `GUESSING`, copies the letters to `startLetter` and `endLetter`, and sets `roundStartTime` to `Date.now()`.

4. **`GUESSING`**
   - **How it works:** Players frantically type valid words matching the constraints. A local 99-second countdown runs based on `roundStartTime`.
   - **Transformations:**
     - **Correct Guess:** A player submits a valid word. They immediately increment their score, update `lastRoundResult` (with `reason: 'correct'`, `word`, and `winnerId`), and change state to `ENDED_ROUND`. If their new score reaches `winTarget`, the state becomes `GAME_OVER` and `winner` is set. Asynchronously, the translation is fetched and added to `lastRoundResult/translation`.
     - **Mutual Pass:** Both players click "Pass". Once both `player1Pass` and `player2Pass` are true, state updates to `ENDED_ROUND` with `lastRoundResult.reason = 'pass'`.
     - **Timeout:** Timer hits 0s. Player 1 triggers the update to `ENDED_ROUND` with `lastRoundResult.reason = 'timeout'`.

5. **`ENDED_ROUND`**
   - **How it works:** The round is over, showing the results and translation.
   - **Transformation:** Player clicks "Continue". This triggers an update to reset `player1Letter`, `player2Letter`, `player1Pass`, and `player2Pass`, increments `currentRound`, swaps the roles (`START` becomes `END`), clears `lastRoundResult`, and changes state back to `PICKING_LETTERS`.

6. **`GAME_OVER`**
   - **How it works:** A player reached the `winTarget`. Overall `GameWins` are incremented.
   - **Transformations:**
     - **Play Again:** Resets match state back to `SETUP_LENGTH`, clearing round data and scores, but leaving `GameWins` intact.
     - **Leave:** Both players disconnect. The client removes the match or returns to the App `LOBBY` state.
