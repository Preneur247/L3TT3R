import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ref, update, onValue, get } from 'firebase/database';
import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { db, firestore } from '../firebase';
import SetupProfile from './SetupProfile';
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
    }
  }, [matchData.matchState, matchData.currentRound]);

  useEffect(() => {
    if (matchData.matchState === 'GUESSING' && matchData.roundStartTime) {
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
  }, [matchData.matchState, matchData.roundStartTime]);

  // System Auto-Generation logic
  useEffect(() => {
    if (matchData.matchState === 'PICKING_LETTERS' && matchData.letterMode === 'system' && isP1) {
      const generateSystemLetters = async () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const start = chars[Math.floor(Math.random() * chars.length)];
        const end = chars[Math.floor(Math.random() * chars.length)];
        
        const matchRef = ref(db, `matches/${matchId}`);
        await update(matchRef, {
          matchState: 'GUESSING',
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
  }, [matchData.matchState, matchData.letterMode, isP1, matchId]);

  const handleTimeout = async () => {
    const matchRef = ref(db, `matches/${matchId}`);
    await update(matchRef, {
      matchState: 'ENDED_ROUND',
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
          matchState: 'GUESSING',
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
    const gameWonUpdates = isGameOver ? {
      player1GamesWon: (matchData.player1GamesWon || 0) + (isP1 ? 1 : 0),
      player2GamesWon: (matchData.player2GamesWon || 0) + (!isP1 ? 1 : 0),
    } : {};

    // When a game ends, append an entry to game_history keyed by game number
    const gameNumber = (matchData.player1GamesWon || 0) + (matchData.player2GamesWon || 0) + 1;
    const historyEntry = isGameOver ? {
      [`game_history/${gameNumber}`]: {
        player1Score: newScores.player1Score,
        player2Score: newScores.player2Score,
        winnerId: user.uid,
      }
    } : {};

    // Build player stats update for current user
    const playerStatsWrite = (async () => {
      try {
        const statsRef = doc(firestore, 'users', user.uid);
        const wordsDocRef = doc(firestore, 'user_words', user.uid);
        const mode = matchData.mode || 'versus';
        const safeWord = cleanWord.toUpperCase().replace(/\./g, '_');

        // 1. Parallel write to update counts
        await Promise.all([
          updateDoc(statsRef, {
            'stats.total.wordsFormed': increment(1),
            [`stats.${mode}.wordsFormed`]: increment(1)
          }),
          setDoc(wordsDocRef, {
            words: {
              [safeWord]: increment(1)
            }
          }, { merge: true })
        ]);

        // 2. Fetch the updated bank to sync record holders in the profile
        const wordsSnap = await getDoc(wordsDocRef);
        if (wordsSnap.exists()) {
          const words = wordsSnap.data().words || {};
          const wordEntries = Object.entries(words);
          if (wordEntries.length > 0) {
            const mostUsed = wordEntries.reduce((a, b) => b[1] > a[1] ? b : a);
            const longest = wordEntries.reduce((a, b) => b[0].length > a[0].length ? b : a);
            
            await updateDoc(statsRef, {
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


    await Promise.all([
      update(matchRef, {
        ...newScores,
        ...gameWonUpdates,
        ...historyEntry,
        matchState: isGameOver ? 'GAME_OVER' : 'ENDED_ROUND',
        winnerId: isGameOver ? user.uid : null,
        lastRoundResult: {
          winnerId: user.uid,
          word: cleanWord,
          translation: null,
          reason: 'correct'
        }
      }),
      playerStatsWrite,
    ]);

    // 2. FETCH TRANSLATION ASYNC
    const targetLang = profile?.settings?.wordTranslationLang || 'zh-TW';
    const translation = await getTranslation(cleanWord, targetLang);

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
        matchState: 'ENDED_ROUND',
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
      matchState: 'PICKING_LETTERS',
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
