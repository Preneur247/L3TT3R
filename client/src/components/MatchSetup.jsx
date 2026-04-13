import { useState } from 'react';
import { ref, update } from 'firebase/database';
import { db } from '../firebase';

export default function MatchSetup({ user, matchId, matchData }) {
  const [len, setLen] = useState(3);
  const [winTarget, setWinTarget] = useState(5);
  const isP1 = user.uid === matchData.player1;

  const handleStart = async () => {
    const matchRef = ref(db, `matches/${matchId}`);
    await update(matchRef, {
      minWordLength: parseInt(len),
      winTarget,
      state: 'PICKING_LETTERS',
      player1Role: 'START',
      player2Role: 'END',
      currentRound: 1
    });
  };

  return (
    <div className="setup-section">
      <h2>Match Settings</h2>
      {isP1 ? (
        <>
          <p className="setup-label">Minimum word length:</p>
          <div className="setup-input-row">
            <input
              type="number"
              min="3"
              max="10"
              value={len}
              onChange={e => setLen(e.target.value)}
              style={{ width: '100px' }}
            />
          </div>

          <p className="setup-label">Points to win:</p>
          <div className="setup-options">
            {[5, 10, 20].map(n => (
              <button
                key={n}
                className={winTarget === n ? 'primary' : ''}
                onClick={() => setWinTarget(n)}
              >
                {n}
              </button>
            ))}
          </div>

          <button className="primary" onClick={handleStart}>Start</button>
        </>
      ) : (
        <>
          <p className="subtitle pulse">Host is configuring match settings...</p>
          <p className="setup-label">Word length and win target are being set.</p>
        </>
      )}
    </div>
  );
}
