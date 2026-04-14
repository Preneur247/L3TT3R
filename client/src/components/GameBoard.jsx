import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ref, update, onValue, get } from 'firebase/database';
import { db } from '../firebase';

function getTimerClass(seconds) {
  if (seconds > 30) return 'safe';
  if (seconds > 10) return 'warning';
  return 'danger';
}

function getDifficultyLabel(d) {
  if (d === 0) return 'Easy';
  if (d === 1) return 'Medium';
  return 'Hard';
}

export default function GameBoard({ user, matchId, matchData }) {
  const [word, setWord] = useState('');
  const [letter, setLetter] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [timeLeft, setTimeLeft] = useState(99);
  
  // Sharding Dictionary State
  const [activeShard, setActiveShard] = useState(null); // Array of {w, t, d}
  const [dictLoading, setDictLoading] = useState(false);
  const shardCache = useRef({}); // { "a-e": [...] }
  // Persistent off-screen input: focusing it during a button-click handler
  // keeps the iOS keyboard open while we wait for Firebase / React to render
  // the next real input (focus transitions input→input, keyboard never closes).
  const holdingRef = useRef(null);

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

  // Load Shard when guessing phase starts
  useEffect(() => {
    if (matchData.state === 'GUESSING' && matchData.startLetter && matchData.endLetter) {
      const key = `${matchData.startLetter.toLowerCase()}-${matchData.endLetter.toLowerCase()}`;
      
      if (shardCache.current[key]) {
        setActiveShard(shardCache.current[key]);
        setDictLoading(false);
        return;
      }

      setDictLoading(true);
      fetch(`/dict/${key}.json`)
        .then(res => res.json())
        .then(data => {
          shardCache.current[key] = data;
          setActiveShard(data);
          setDictLoading(false);
        })
        .catch(() => {
          setDictLoading(false);
          setErrorMsg('Failed to load dictionary shard.');
        });
    } else if (matchData.state !== 'GUESSING') {
      setActiveShard(null);
    }
  }, [matchData.state, matchData.startLetter, matchData.endLetter]);

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
    if (!activeShard) {
      setErrorMsg('Dictionary is not ready...');
      return;
    }

    const wordEntry = activeShard.find(item => item.w === cleanWord);
    if (!wordEntry) {
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

    await update(matchRef, {
      ...newScores,
      ...gameWinUpdates,
      state: isGameOver ? 'GAME_OVER' : 'ENDED_ROUND',
      winner: isGameOver ? user.uid : null,
      lastRoundResult: {
        winnerId: user.uid,
        word: cleanWord,
        translation: wordEntry.t,
        difficulty: wordEntry.d,
        reason: 'correct'
      }
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

  return (
    <div>
      {/* Persistent off-screen input — always mounted so focus can be handed
          here during button clicks, keeping the iOS keyboard open. */}
      <input ref={holdingRef} type="text" style={holdingStyle} readOnly tabIndex={-1} />

      <div className="game-board">
      <div className="scoreboard">
        <div className="score-item">
          <span className="label">You</span>
          <span className="value">{myScore}</span>
        </div>
        <div className="score-item">
          <span className="label">Opp</span>
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
                  onSubmit={e => { e.preventDefault(); submitPick(); }}
                  style={{
                    overflow: 'hidden',
                    height: myLetter ? 0 : 'auto',
                    opacity: myLetter ? 0 : 1,
                    pointerEvents: myLetter ? 'none' : 'auto',
                  }}
                >
                  <input
                    type="text"
                    maxLength="1"
                    value={letter}
                    onChange={e => setLetter(e.target.value.toUpperCase())}
                    style={{ textTransform: 'uppercase' }}
                    autoFocus
                  />
                  <div className="controls">
                    <button className="primary" type="submit">Lock</button>
                  </div>
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
                <button type="button" onClick={handlePass}>Pass</button>
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
                  {matchData.lastRoundResult.difficulty !== undefined && (
                    <span className={`difficulty-tag d-${matchData.lastRoundResult.difficulty}`}>
                      {getDifficultyLabel(matchData.lastRoundResult.difficulty)}
                    </span>
                  )}
                </div>
                <div className="chinese">
                  {matchData.lastRoundResult.translation || "無翻譯可用"}
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
