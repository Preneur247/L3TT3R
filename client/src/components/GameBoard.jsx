import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ref, update, onValue, get } from 'firebase/database';
import { doc, getDoc, setDoc, increment } from 'firebase/firestore';
import { db, firestore } from '../firebase';

function getTimerClass(seconds) {
  if (seconds > 30) return 'safe';
  if (seconds > 10) return 'warning';
  return 'danger';
}

const getTranslation = async (word) => {
  try {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${word}`);
    const data = await res.json();
    return data[0][0][0];
  } catch (e) {
    return "翻譯不可用";
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

  const isP1 = user.uid === matchData.player1;
  const myRole = isP1 ? matchData.player1Role : matchData.player2Role;
  const myLetter = isP1 ? matchData.player1Letter : matchData.player2Letter;
  const oppLetter = isP1 ? matchData.player2Letter : matchData.player1Letter;

  const myScore = isP1 ? matchData.player1Score : matchData.player2Score;
  const oppScore = isP1 ? matchData.player2Score : matchData.player1Score;
  const myGameWins = isP1 ? (matchData.player1GameWins || 0) : (matchData.player2GameWins || 0);
  const oppGameWins = isP1 ? (matchData.player2GameWins || 0) : (matchData.player1GameWins || 0);
  const gameWinsTracked = matchData.player1GameWins !== undefined || matchData.player2GameWins !== undefined;
  const winTarget = matchData.winTarget || 5;

  // Fetch opponent username
  useEffect(() => {
    const oppUid = isP1 ? matchData.player2 : matchData.player1;
    if (!oppUid) return;
    getDoc(doc(firestore, 'users', oppUid)).then(snap => {
      if (snap.exists()) setOppUsername(snap.data().username || 'Opp');
    }).catch(() => {});
  }, [matchData.player1, matchData.player2]);

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

  // Reset local state on next round
  useEffect(() => {
    if (matchData.state === 'PICKING_LETTERS' || matchData.state === 'SETUP_LENGTH') {
      setWord('');
      setLetter('');
      setErrorMsg('');
    }
  }, [matchData.state, matchData.currentRound]);

  useEffect(() => {
    if (matchData.state === 'GUESSING' && matchData.roundStartTime) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - matchData.roundStartTime) / 1000);
        const remaining = Math.max(0, 99 - elapsed);
        setTimeLeft(remaining);

        if (remaining === 0 && isP1) {
          handleTimeout();
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [matchData.state, matchData.roundStartTime]);

  // System Auto-Generation logic
  useEffect(() => {
    if (matchData.state === 'PICKING_LETTERS' && matchData.letterMode === 'system' && isP1) {
      const generateSystemLetters = async () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const start = chars[Math.floor(Math.random() * chars.length)];
        const end = chars[Math.floor(Math.random() * chars.length)];
        
        const matchRef = ref(db, `matches/${matchId}`);
        await update(matchRef, {
          state: 'GUESSING',
          startLetter: start,
          endLetter: end,
          roundStartTime: Date.now(),
          player1Letter: null,
          player2Letter: null
        });
      };
      
      // Small delay for smooth transition feel
      const timer = setTimeout(generateSystemLetters, 800);
      return () => clearTimeout(timer);
    }
  }, [matchData.state, matchData.letterMode, isP1, matchId]);

  const handleTimeout = async () => {
    const matchRef = ref(db, `matches/${matchId}`);
    await update(matchRef, {
      state: 'ENDED_ROUND',
      lastRoundResult: { reason: 'timeout', winnerId: null }
    });
  };

  const submitPick = async () => {
    // Focus the holding input immediately (still inside the click handler /
    // user-gesture) so iOS keeps the keyboard open while we wait for Firebase.
    holdingRef.current?.focus();
    if (letter.length === 1 && /^[A-Z]$/.test(letter)) {
      const matchRef = ref(db, `matches/${matchId}`);
      const updates = {};
      if (isP1) updates.player1Letter = letter;
      else updates.player2Letter = letter;

      await update(matchRef, updates);

      // Check if both locked
      const snapshot = await get(matchRef);
      const data = snapshot.val();
      if (data.player1Letter && data.player2Letter) {
        await update(matchRef, {
          state: 'GUESSING',
          startLetter: data.player1Role === 'START' ? data.player1Letter : data.player2Letter,
          endLetter: data.player1Role === 'END' ? data.player1Letter : data.player2Letter,
          roundStartTime: Date.now()
        });
      }
      setLetter('');
    }
  };

  const submitWord = async (e) => {
    e.preventDefault();
    const cleanWord = word.trim().toUpperCase();

    if (dictLoading) {
      setErrorMsg('Dictionary is still loading...');
      return;
    }
    if (cleanWord.length < (matchData.minWordLength || 3)) {
      setErrorMsg(`Minimum length is ${matchData.minWordLength || 3}`);
      return;
    }
    if (cleanWord[0] !== matchData.startLetter || cleanWord[cleanWord.length - 1] !== matchData.endLetter) {
      setErrorMsg(`Must start with ${matchData.startLetter} and end with ${matchData.endLetter}`);
      return;
    }
    if (!dictionary.has(cleanWord)) {
      setErrorMsg("Not a valid word");
      return;
    }

    // WINNER FOUND
    // 1. UPDATE DB IMMEDIATELY (Instant Win Dialog < 100ms)
    const matchRef = ref(db, `matches/${matchId}`);
    const newScores = isP1
      ? { player1Score: (matchData.player1Score || 0) + 1, player2Score: (matchData.player2Score || 0) }
      : { player1Score: (matchData.player1Score || 0), player2Score: (matchData.player2Score || 0) + 1 };

    const isGameOver = (newScores.player1Score >= winTarget || newScores.player2Score >= winTarget);
    const gameWinUpdates = isGameOver ? {
      player1GameWins: (matchData.player1GameWins || 0) + (isP1 ? 1 : 0),
      player2GameWins: (matchData.player2GameWins || 0) + (!isP1 ? 1 : 0),
    } : {};

    // When a game ends, append an entry to gameHistory keyed by game number
    const gameNumber = (matchData.player1GameWins || 0) + (matchData.player2GameWins || 0) + 1;
    const historyEntry = isGameOver ? {
      [`gameHistory/${gameNumber}`]: {
        p1Score: newScores.player1Score,
        p2Score: newScores.player2Score,
        winnerId: user.uid,
      }
    } : {};

    // Build Firestore pair stats update (must be awaited alongside Realtime DB
    // so the data is committed before the user lands back in the room)
    const pairStatsWrite = (isGameOver && matchData.player2) ? (() => {
      const sortedUids = [matchData.player1, matchData.player2].sort();
      const pairKey = sortedUids.join('_');
      const p1IsFirst = sortedUids[0] === matchData.player1;
      return setDoc(doc(firestore, 'playerPairStats', pairKey), {
        p1Uid: sortedUids[0],
        p2Uid: sortedUids[1],
        p1TotalScore: increment(p1IsFirst ? newScores.player1Score : newScores.player2Score),
        p2TotalScore: increment(p1IsFirst ? newScores.player2Score : newScores.player1Score),
        gamesPlayed: increment(1),
      }, { merge: true }).catch(err => console.error('pairStats write failed:', err));
    })() : Promise.resolve();

    await Promise.all([
      update(matchRef, {
        ...newScores,
        ...gameWinUpdates,
        ...historyEntry,
        state: isGameOver ? 'GAME_OVER' : 'ENDED_ROUND',
        winner: isGameOver ? user.uid : null,
        lastRoundResult: {
          winnerId: user.uid,
          word: cleanWord,
          translation: null,
          reason: 'correct'
        }
      }),
      pairStatsWrite,
    ]);

    // 2. FETCH TRANSLATION ASYNC
    const translation = await getTranslation(cleanWord);

    // 3. UPDATE DB WITH TRANSLATION (Popping in shortly after)
    await update(matchRef, {
      'lastRoundResult/translation': translation
    });
  };

  const handlePass = async () => {
    const matchRef = ref(db, `matches/${matchId}`);
    const updates = {};
    if (isP1) updates.player1Pass = true;
    else updates.player2Pass = true;

    await update(matchRef, updates);

    // Check if both passed
    const snapshot = await get(matchRef);
    const data = snapshot.val();
    if (data.player1Pass && data.player2Pass) {
      await update(matchRef, {
        state: 'ENDED_ROUND',
        lastRoundResult: { reason: 'pass', winnerId: null }
      });
    }
  };

  const nextRound = async () => {
    // Focus holding input immediately (user-gesture) to reopen keyboard before
    // Firebase/React re-render triggers the next round's real input.
    holdingRef.current?.focus();
    const matchRef = ref(db, `matches/${matchId}`);
    await update(matchRef, {
      state: 'PICKING_LETTERS',
      player1Letter: null,
      player2Letter: null,
      player1Pass: null,
      player2Pass: null,
      player1Role: matchData.player1Role === 'START' ? 'END' : 'START',
      player2Role: matchData.player2Role === 'START' ? 'END' : 'START',
      currentRound: (matchData.currentRound || 1) + 1,
      lastRoundResult: null
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

    if (matchData.state === 'GUESSING') {
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

  if (matchData.state === 'GAME_OVER') {
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
      <div className="scoreboard">
        <div className="score-item">
          <span className="label">{profile?.username || 'You'}</span>
          <span className={`pass-badge${matchData.state === 'GUESSING' && (isP1 ? matchData.player1Pass : matchData.player2Pass) ? '' : ' pass-badge--hidden'}`}>PASSED</span>
          <span className="value">{myScore}</span>
        </div>
        <div className="score-item">
          <span className="label">{oppUsername}</span>
          <span className={`pass-badge${matchData.state === 'GUESSING' && (!isP1 ? matchData.player1Pass : matchData.player2Pass) ? '' : ' pass-badge--hidden'}`}>PASSED</span>
          <span className="value">{oppScore}</span>
        </div>
      </div>

      <div className="game-info-bar">
        <span className="info-chip">{'\u2605'} {winTarget}</span>
        <span className="info-chip">{'\u2265'} {matchData.minWordLength || 3}</span>
        {gameWinsTracked && <span className="info-chip">{myGameWins} : {oppGameWins}</span>}
      </div>

      <div className="letters-display">
        <div className={startBox.className}>{startBox.content}</div>
        <div className={endBox.className}>{endBox.content}</div>
      </div>

      <div className="game-action-area">
        {dictLoading && <div className="dict-loading"><span className="spinner" /> Loading dictionary...</div>}

        {matchData.state === 'PICKING_LETTERS' && (
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
                  <button className="primary" type="submit">Lock</button>
                </form>
              </>
            )}
          </div>
        )}

        {matchData.state === 'GUESSING' && (
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
              <div className="controls">
                <button className="primary" type="submit">Submit</button>
                <button className={isP1 && matchData.player1Pass || !isP1 && matchData.player2Pass ? 'selected' : ''} type="button" onClick={handlePass}>Pass</button>
              </div>
            </form>
          </>
        )}

        {errorMsg && <div className="error-message">{errorMsg}</div>}
      </div>
      </div>

      {matchData.state === 'ENDED_ROUND' && matchData.lastRoundResult && createPortal(
        <div className="popup-overlay">
          <div className={`translation-popup ${matchData.lastRoundResult.winnerId === user.uid ? '' : (matchData.lastRoundResult.winnerId ? 'loss' : '')}`}>
            <div className={`popup-title ${matchData.lastRoundResult.winnerId === user.uid ? 'win' : (matchData.lastRoundResult.winnerId ? 'loss' : '')}`}>
              {matchData.lastRoundResult.reason === 'correct'
                ? (matchData.lastRoundResult.winnerId === user.uid ? 'You Won!' : 'Opponent Won!')
                : `Draw (${matchData.lastRoundResult.reason})`}
            </div>

            {matchData.lastRoundResult.word && (
              <div className="word-block">
                <div className="word">
                  {matchData.lastRoundResult.word}
                </div>
                <div className="chinese">
                  {matchData.lastRoundResult.translation
                    ? matchData.lastRoundResult.translation
                    : <span className="translation-loading"><span className="spinner" /> Translating...</span>
                  }
                </div>
              </div>
            )}

            <div className="popup-actions">
              <button className="primary" onClick={nextRound}>Continue &rarr;</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
