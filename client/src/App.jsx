import { useEffect, useState } from 'react';
import { auth, db, initAuth } from './firebase';
import { ref, onValue, set, push, onDisconnect, remove, update } from 'firebase/database';
import Lobby from './components/Lobby';
import MatchSetup from './components/MatchSetup';
import GameBoard from './components/GameBoard';

function App() {
  const [user, setUser] = useState(null);
  const [gameState, setGameState] = useState('LOBBY'); // LOBBY, MATCHING, PLAYING, GAME_OVER
  const [matchData, setMatchData] = useState(null);
  const [currentMatchId, setCurrentMatchId] = useState(null);

  // Authenticate anonymously on mount (session-scoped per tab)
  useEffect(() => {
    initAuth().then(({ user }) => {
      setUser(user);
    });
  }, []);

  // Listen to match changes if in a match
  useEffect(() => {
    if (!currentMatchId) return;

    const matchRef = ref(db, `matches/${currentMatchId}`);
    const unsubscribe = onValue(matchRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setGameState('LOBBY');
        setMatchData(null);
        setCurrentMatchId(null);
        return;
      }

      setMatchData(data);
      
      if (data.winner) {
        setGameState('GAME_OVER');
      } else if (data.state === 'SETUP_LENGTH' || data.state === 'PICKING_LETTERS' || data.state === 'GUESSING' || data.state === 'ENDED_ROUND') {
        setGameState('PLAYING');
      } else if (data.state === 'WAITING') {
        setGameState('MATCHING');
      }
    });

    return () => unsubscribe();
  }, [currentMatchId]);

  if (!user) {
    return <div className="glass-card"><h1>L3TT3R</h1><div className="subtitle">Connecting...</div></div>;
  }

  return (
    <>
      <div className="glass-card">
        <h1>L3TT3R</h1>

        {gameState === 'LOBBY' && (
          <Lobby user={user} setMatchId={setCurrentMatchId} />
        )}

        {gameState === 'MATCHING' && (
          <div className="subtitle pulse">Waiting for opponent to connect...</div>
        )}

        {(gameState === 'PLAYING' || gameState === 'GAME_OVER') && matchData && (
          <>
            {matchData.state === 'SETUP_LENGTH' ? (
              <MatchSetup user={user} matchId={currentMatchId} matchData={matchData} />
            ) : (
              <GameBoard user={user} matchId={currentMatchId} matchData={matchData} />
            )}
          </>
        )}
      </div>

      {/* Rendered outside glass-card so position:fixed is relative to the
          viewport, not the glass-card's backdrop-filter stacking context. */}
      {gameState === 'GAME_OVER' && matchData && (() => {
        const isWinner = matchData.winner === user.uid;
        const isP1 = user.uid === matchData.player1;
        const myGameWins = isP1 ? (matchData.player1GameWins || 0) : (matchData.player2GameWins || 0);
        const oppGameWins = isP1 ? (matchData.player2GameWins || 0) : (matchData.player1GameWins || 0);
        const winTarget = matchData.winTarget || 5;
        const lastWord = matchData.lastRoundResult?.word;
        const lastTranslation = matchData.lastRoundResult?.translation;

        const handlePlayAgain = async () => {
          const matchRef = ref(db, `matches/${currentMatchId}`);
          await update(matchRef, {
            state: 'SETUP_LENGTH',
            winner: null,
            gameOverReason: null,
            player1Score: 0,
            player2Score: 0,
            player1Letter: null,
            player2Letter: null,
            player1Pass: null,
            player2Pass: null,
            player1Role: null,
            player2Role: null,
            startLetter: null,
            endLetter: null,
            roundStartTime: null,
            currentRound: null,
            lastRoundResult: null,
            minWordLength: null,
            winTarget: null,
          });
        };

        return (
          <div className="popup-overlay">
            <div className={`translation-popup ${isWinner ? '' : 'loss'}`}>
              <div className={`popup-title ${isWinner ? 'win' : 'loss'}`}>
                {isWinner ? 'VICTORY' : 'DEFEAT'}
              </div>

              {lastWord && (
                <div className="word-block">
                  <div className="word">{lastWord}</div>
                  {lastTranslation
                    ? <div className="chinese">{lastTranslation}</div>
                    : <div className="translation-loading"><span className="spinner" /> Translating...</div>
                  }
                </div>
              )}

              <div className="popup-score">
                <span className="info-chip">Games {myGameWins} : {oppGameWins}</span>
              </div>

              <div className="popup-actions">
                <button className="primary" onClick={handlePlayAgain}>Play Again</button>
                <button onClick={() => {
                  setGameState('LOBBY');
                  setMatchData(null);
                  setCurrentMatchId(null);
                }}>Leave</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}

export default App;
