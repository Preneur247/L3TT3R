import { useState, useEffect, useRef } from 'react';
import { ref, runTransaction } from 'firebase/database';
import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db, firestore } from '../firebase';
import ResultOverlay from './ResultOverlay';

function getTimerClass(seconds) {
  if (seconds > 30) return 'safe';
  if (seconds > 10) return 'warning';
  return 'danger';
}

const getTranslation = async (word, targetLang = 'zh-TW') => {
  try {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${word}`);
    const data = await res.json();
    return data[0][0][0];
  } catch (e) {
    return targetLang.startsWith('zh') ? "翻譯不可用" : "Translation unavailable";
  }
};

export default function GameBoard({ user, profile, matchId, matchData }) {
  const [word, setWord] = useState('');
  const [letter, setLetter] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [timeLeft, setTimeLeft] = useState(99);
  
  const [dictionary, setDictionary] = useState(new Set());
  const [dictLoading, setDictLoading] = useState(true);
  const dictionaryLoaded = useRef(false);
  // Persistent off-screen input: focusing it during a button-click handler
  // keeps the iOS keyboard open while we wait for Firebase / React to render
  // the next real input (focus transitions input→input, keyboard never closes).
  const holdingRef = useRef(null);

  const [oppUsername, setOppUsername] = useState('Opp');

  const submittingRef = useRef(false);

  const isP1 = user.uid === matchData.player1Id;
  const myRole = isP1 ? matchData.player1Role : matchData.player2Role;
  const myLetter = isP1 ? matchData.player1Letter : matchData.player2Letter;
  const oppLetter = isP1 ? matchData.player2Letter : matchData.player1Letter;

  const myScore = isP1 ? matchData.player1Score : matchData.player2Score;
  const oppScore = isP1 ? matchData.player2Score : matchData.player1Score;
  const myGamesWon = isP1 ? (matchData.player1GamesWon || 0) : (matchData.player2GamesWon || 0);
  const oppGamesWon = isP1 ? (matchData.player2GamesWon || 0) : (matchData.player1GamesWon || 0);
  const gamesWonTracked = matchData.player1GamesWon !== undefined || matchData.player2GamesWon !== undefined;
  const winTarget = matchData.winTarget || 5;

  // Fetch opponent username
  useEffect(() => {
    const oppUid = isP1 ? matchData.player2Id : matchData.player1Id;
    if (!oppUid) return;
    getDoc(doc(firestore, 'users', oppUid)).then(snap => {
      if (snap.exists()) setOppUsername(snap.data().username || 'Opp');
    }).catch(() => {});
  }, [matchData.player1Id, matchData.player2Id]);

  // Load Dictionary
  useEffect(() => {
    if (dictionaryLoaded.current) return;
    setDictLoading(true);
    fetch('https://raw.githubusercontent.com/dwyl/english-words/refs/heads/master/words_alpha.txt')
      .then(res => res.text())
      .then(text => {
        const words = text.split('\n').map(w => w.trim().toUpperCase());
        setDictionary(new Set(words));
        dictionaryLoaded.current = true;
        setDictLoading(false);
      })
      .catch(() => {
        setDictLoading(false);
        setErrorMsg('Failed to load dictionary. Please refresh.');
      });
  }, []);

  useEffect(() => {
    if (matchData.matchState === 'PICKING_LETTERS') {
      setWord('');
      setLetter('');
      setErrorMsg('');
      setTimeLeft(99);
    }
  }, [matchData.matchState, matchData.currentRound]);

  useEffect(() => {
    if (matchData.matchState === 'GUESSING' && matchData.roundStartTime) {
      const calcRemaining = () => {
        const elapsed = Math.floor((Date.now() - matchData.roundStartTime) / 1000);
        return Math.max(0, 99 - elapsed);
      };
      
      // Set immediately to prevent 1-second delay flash
      setTimeLeft(calcRemaining());

      let timeoutTriggered = false;
      const interval = setInterval(() => {
        const remaining = calcRemaining();
        setTimeLeft(remaining);

        // Both players watch the clock — transaction in handleTimeout ensures only one wins.
        // This also covers P1 disconnect: P2 will still trigger the timeout.
        // timeoutTriggered prevents repeat calls every second once remaining hits 0.
        if (remaining === 0 && !timeoutTriggered) {
          timeoutTriggered = true;
          handleTimeout();
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [matchData.matchState, matchData.roundStartTime]);

  // System Auto-Generation logic
  useEffect(() => {
    if (matchData.matchState === 'PICKING_LETTERS' && matchData.letterMode === 'system' && isP1) {
      const generateSystemLetters = async () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const start = chars[Math.floor(Math.random() * chars.length)];
        const end = chars[Math.floor(Math.random() * chars.length)];

        const matchRef = ref(db, `matches/${matchId}`);
        await runTransaction(matchRef, (current) => {
          // Abort if state already advanced (timer fired after state changed)
          if (current === null) return current;
          if (current.matchState !== 'PICKING_LETTERS') return;
          current.matchState = 'GUESSING';
          current.startLetter = start;
          current.endLetter = end;
          current.roundStartTime = Date.now();
          current.player1Letter = null;
          current.player2Letter = null;
          return current;
        });
      };

      const timer = setTimeout(generateSystemLetters, 800);
      return () => clearTimeout(timer);
    }
  }, [matchData.matchState, matchData.letterMode, isP1, matchId]);

  const handleTimeout = async () => {
    const matchRef = ref(db, `matches/${matchId}`);
    await runTransaction(matchRef, (current) => {
      if (current === null) return current;
      if (current.matchState !== 'GUESSING') return; // already ended — abort
      current.matchState = 'ENDED_ROUND';
      current.lastRoundResult = { reason: 'timeout', winnerId: null };
      return current;
    });
  };

  const submitPick = async () => {
    // Focus the holding input immediately (still inside the click handler /
    // user-gesture) so iOS keeps the keyboard open while we wait for Firebase.
    holdingRef.current?.focus();
    if (letter.length !== 1 || !/^[A-Z]$/.test(letter)) return;

    const matchRef = ref(db, `matches/${matchId}`);
    await runTransaction(matchRef, (current) => {
      if (current === null) return current;
      if (current.matchState !== 'PICKING_LETTERS') return; // state changed — abort
      const myLetterKey = user.uid === current.player1Id ? 'player1Letter' : 'player2Letter';
      if (current[myLetterKey]) return; // already locked — idempotent guard
      current[myLetterKey] = letter;
      // Transition to GUESSING atomically once both letters are locked
      if (current.player1Letter && current.player2Letter) {
        current.matchState = 'GUESSING';
        current.startLetter = current.player1Role === 'START' ? current.player1Letter : current.player2Letter;
        current.endLetter = current.player1Role === 'END' ? current.player1Letter : current.player2Letter;
        current.roundStartTime = Date.now();
      }
      return current;
    });
    setLetter('');
  };

  const submitWord = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;

    const cleanWord = word.trim().toUpperCase();

    if (dictLoading) { setErrorMsg('Dictionary is still loading...'); return; }
    if (cleanWord.length < (matchData.minWordLength || 3)) { setErrorMsg(`Minimum length is ${matchData.minWordLength || 3}`); return; }
    if (cleanWord[0] !== matchData.startLetter || cleanWord[cleanWord.length - 1] !== matchData.endLetter) { setErrorMsg(`Must start with ${matchData.startLetter} and end with ${matchData.endLetter}`); return; }
    if (!dictionary.has(cleanWord)) { setErrorMsg('Not a valid word'); return; }

    submittingRef.current = true;
    const matchRef = ref(db, `matches/${matchId}`);

    try {
      // Atomic CAS: only one player can end the round, even under simultaneous submission.
      const result = await runTransaction(matchRef, (current) => {
        if (current === null) return current;
        if (current.matchState !== 'GUESSING') return; // already ended — abort

        const submitterIsP1 = user.uid === current.player1Id;
        const p1Score = (current.player1Score || 0) + (submitterIsP1 ? 1 : 0);
        const p2Score = (current.player2Score || 0) + (submitterIsP1 ? 0 : 1);
        const currentWinTarget = current.winTarget || 5;
        const isGameOver = p1Score >= currentWinTarget || p2Score >= currentWinTarget;

        current.player1Score = p1Score;
        current.player2Score = p2Score;
        current.lastRoundResult = { winnerId: user.uid, word: cleanWord, translation: null, reason: 'correct' };

        if (isGameOver) {
          current.matchState = 'GAME_OVER';
          current.winnerId = user.uid;
          const gameNumber = (current.player1GamesWon || 0) + (current.player2GamesWon || 0) + 1;
          if (submitterIsP1) current.player1GamesWon = (current.player1GamesWon || 0) + 1;
          else current.player2GamesWon = (current.player2GamesWon || 0) + 1;
          if (!current.game_history) current.game_history = {};
          current.game_history[gameNumber] = { player1Score: p1Score, player2Score: p2Score, winnerId: user.uid };
        } else {
          current.matchState = 'ENDED_ROUND';
          current.winnerId = null;
        }

        return current;
      });

      if (!result.committed) return; // Opponent already ended the round — silently discard

      // Stats write is fire-and-forget: game state is already committed above.
      // A stats failure doesn't affect match progression.
      (async () => {
        try {
          const statsRef = doc(firestore, 'users', user.uid);
          const wordsDocRef = doc(firestore, 'user_words', user.uid);
          const mode = matchData.mode || 'versus';

          await setDoc(wordsDocRef, { words: { [cleanWord]: increment(1) } }, { merge: true });

          const wordsSnap = await getDoc(wordsDocRef);
          if (wordsSnap.exists()) {
            const words = wordsSnap.data().words || {};
            const wordEntries = Object.entries(words);
            if (wordEntries.length > 0) {
              const mostUsed = wordEntries.reduce((a, b) => {
                const aCount = typeof a[1] === 'number' ? a[1] : 0;
                const bCount = typeof b[1] === 'number' ? b[1] : 0;
                return bCount > aCount ? b : a;
              });
              const longest = wordEntries.reduce((a, b) => b[0].length > a[0].length ? b : a);
              await updateDoc(statsRef, {
                'stats.total.wordsFormed': increment(1),
                [`stats.${mode}.wordsFormed`]: increment(1),
                'stats.total.mostUsedWord': mostUsed[0],
                'stats.total.mostUsedWordCount': mostUsed[1],
                'stats.total.longestWord': longest[0],
                'stats.total.longestWordLen': longest[0].length,
                'stats.total.uniqueWords': wordEntries.length
              });
            }
          }
        } catch (err) {
          console.error('playerStatsWrite failed:', err);
        }
      })();

      // Fetch translation and patch it in — but only if lastRoundResult still belongs
      // to this word. A slow network could return after nextRound() already cleared/replaced
      // lastRoundResult, which would corrupt the new round's result data.
      const targetLang = profile?.settings?.wordTranslationLang || 'zh-TW';
      const translation = await getTranslation(cleanWord, targetLang);
      await runTransaction(matchRef, (current) => {
        if (current === null) return current;
        if (!current.lastRoundResult || current.lastRoundResult.word !== cleanWord) return;
        current.lastRoundResult.translation = translation;
        return current;
      });

    } finally {
      submittingRef.current = false;
    }
  };

  const handlePass = async () => {
    const matchRef = ref(db, `matches/${matchId}`);
    await runTransaction(matchRef, (current) => {
      if (current === null) return current;
      if (current.matchState !== 'GUESSING') return; // already ended — abort
      const myPassKey = user.uid === current.player1Id ? 'player1Pass' : 'player2Pass';
      current[myPassKey] = true;
      // Atomically transition if both players have now passed
      if (current.player1Pass && current.player2Pass) {
        current.matchState = 'ENDED_ROUND';
        current.lastRoundResult = { reason: 'pass', winnerId: null };
      }
      return current;
    });
  };

  const nextRound = async () => {
    // Focus holding input immediately (user-gesture) to reopen keyboard before
    // Firebase/React re-render triggers the next round's real input.
    holdingRef.current?.focus();
    const matchRef = ref(db, `matches/${matchId}`);
    // Transaction ensures both players clicking "Continue" simultaneously is idempotent
    // and uses server state for role-flip (not stale React state).
    await runTransaction(matchRef, (current) => {
      if (current === null) return current;
      if (current.matchState !== 'ENDED_ROUND') return; // already transitioned — abort
      current.matchState = 'PICKING_LETTERS';
      current.player1Letter = null;
      current.player2Letter = null;
      current.player1Pass = null;
      current.player2Pass = null;
      current.player1Role = current.player1Role === 'START' ? 'END' : 'START';
      current.player2Role = current.player2Role === 'START' ? 'END' : 'START';
      current.currentRound = (current.currentRound || 1) + 1;
      current.lastRoundResult = null;
      return current;
    });
  };

  // Off-screen holding input styles
  const holdingStyle = {
    position: 'fixed',
    top: '-200px',
    left: 0,
    width: '1px',
    height: '1px',
    opacity: 0,
    pointerEvents: 'none',
  };

  // Determine letter box content for picking phase
  const renderLetterBox = (role) => {
    const isStart = role === 'START';
    const p1HasRole = matchData.player1Role === role;
    const letterForRole = p1HasRole ? matchData.player1Letter : matchData.player2Letter;

    if (matchData.matchState === 'GUESSING') {
      const revealed = isStart ? matchData.startLetter : matchData.endLetter;
      return {
        content: revealed,
        className: revealed ? 'letter-box filled' : 'letter-box'
      };
    }

    if (letterForRole) {
      return {
        content: '🔒',
        className: 'letter-box locked'
      };
    }

    return {
      content: '?',
      className: 'letter-box'
    };
  };

  const startBox = renderLetterBox('START');
  const endBox = renderLetterBox('END');

  if (matchData.matchState === 'GAME_OVER') {
    return (
      <div className="game-board" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <h2 className="pulse">Game Over!</h2>
        <p style={{ color: 'var(--text-muted)' }}>Calculating results...</p>
      </div>
    );
  }

  return (
    <div>
      {/* Persistent off-screen input — always mounted so focus can be handed
          here during button clicks, keeping the iOS keyboard open. */}
      <input ref={holdingRef} type="text" style={holdingStyle} readOnly tabIndex={-1} />

      <div className="game-board">
      <div className="scoreboard" style={{ gap: '0.5rem' }}>
        <div className="score-item" style={{ flex: 1, minWidth: 0 }}>
          <span className="label" style={{ 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap',
            display: 'block'
          }}>
            {profile?.username || 'You'}
          </span>
          <span className={`pass-badge${matchData.matchState === 'GUESSING' && (isP1 ? matchData.player1Pass : matchData.player2Pass) ? '' : ' pass-badge--hidden'}`}>PASSED</span>
          <span className="value">{myScore}</span>
        </div>
        <div className="score-item" style={{ flex: 1, minWidth: 0 }}>
          <span className="label" style={{ 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap',
            display: 'block'
          }}>
            {oppUsername}
          </span>
          <span className={`pass-badge${matchData.matchState === 'GUESSING' && (!isP1 ? matchData.player1Pass : matchData.player2Pass) ? '' : ' pass-badge--hidden'}`}>PASSED</span>
          <span className="value">{oppScore}</span>
        </div>
      </div>

      <div className="game-info-bar">
        <span className="info-chip">{'\u2605'} {winTarget}</span>
        <span className="info-chip">{'\u2265'} {matchData.minWordLength || 3}</span>
      </div>

      <div className="letters-display">
        <div className={startBox.className}>{startBox.content}</div>
        <div className={endBox.className}>{endBox.content}</div>
      </div>

      <div className="game-action-area">
        {dictLoading && <div className="dict-loading"><span className="spinner" /> Loading dictionary...</div>}

        {matchData.matchState === 'PICKING_LETTERS' && (
          <div className="pick-section">
            {matchData.letterMode === 'system' ? (
               <div style={{ textAlign: 'center' }}>
                 <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                   <span className="spinner" style={{ width: '2rem', height: '2rem' }} />
                 </div>
                 <h2 className="pulse">System is choosing letters...</h2>
               </div>
            ) : (
              <>
                <h2>
                  {!myLetter
                    ? `Pick the ${myRole === 'START' ? 'starting' : 'ending'} letter`
                    : 'Waiting for opponent...'}
                </h2>
                {myLetter && (
                  <div className="locked-confirmation">You locked: {myLetter}</div>
                )}
                {/* Keep input mounted even while waiting so keyboard stays open.
                    Hidden via opacity/height when locked; autoFocus opens keyboard. */}
                <form
                  className="pick-letter-form"
                  onSubmit={e => { e.preventDefault(); submitPick(); }}
                  style={{
                    overflow: 'hidden',
                    height: myLetter ? 0 : 'auto',
                    opacity: myLetter ? 0 : 1,
                    pointerEvents: myLetter ? 'none' : 'auto',
                  }}
                >
                  <input
                    className="pick-letter-input"
                    type="text"
                    maxLength="1"
                    value={letter}
                    onChange={e => setLetter(e.target.value.toUpperCase())}
                    style={{ textTransform: 'uppercase' }}
                    autoFocus
                  />
                  <button className="primary btn-responsive" type="submit" style={{ flex: '0 0 auto', width: 'auto', padding: '0.75rem 1.5rem' }}>Lock</button>
                </form>
              </>
            )}
          </div>
        )}

        {matchData.matchState === 'GUESSING' && (
          <>
            <div className={`timer ${getTimerClass(timeLeft)}`}>{timeLeft}</div>

            <form onSubmit={submitWord}>
              <input
                type="text"
                value={word}
                onChange={e => { setWord(e.target.value.toUpperCase()); setErrorMsg(''); }}
                placeholder="Type your word..."
                autoFocus
              />
               <div className="controls modal-footer" style={{ marginTop: '1.5rem', borderTop: 'none', padding: 0 }}>
                  <button className="primary btn-responsive" type="submit">Submit</button>
                  <button className={`btn-responsive ${isP1 && matchData.player1Pass || !isP1 && matchData.player2Pass ? 'selected' : 'secondary'}`} type="button" onClick={handlePass}>Pass</button>
                </div>
            </form>
          </>
        )}

        {errorMsg && <div className="error-message">{errorMsg}</div>}
      </div>
      </div>

      <ResultOverlay
        isOpen={matchData.matchState === 'ENDED_ROUND' && !!matchData.lastRoundResult}
        isWinner={matchData.lastRoundResult?.winnerId === user.uid}
        isDraw={!matchData.lastRoundResult?.winnerId && matchData.lastRoundResult?.reason !== 'correct'}
        reason={matchData.lastRoundResult?.reason}
        word={matchData.lastRoundResult?.word}
        translation={matchData.lastRoundResult?.translation}
        title={
          matchData.lastRoundResult?.reason === 'correct'
            ? (matchData.lastRoundResult?.winnerId === user.uid ? 'You Won!' : 'Opponent Won!')
            : matchData.lastRoundResult?.reason === 'pass' ? 'Draw (Passed)' : 'Draw (Timeout)'
        }
        actions={[
          {
            label: 'Continue \u2192',
            isPrimary: true,
            onClick: nextRound
          }
        ]}
      />
    </div>
  );
}
