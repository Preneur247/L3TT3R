import { useState } from 'react';
import { ref, get, set, update, onDisconnect, runTransaction, remove } from 'firebase/database';
import { db } from '../firebase';

export default function Lobby({ user, setMatchId }) {
  const [status, setStatus] = useState('idle'); // idle, searching, error
  const [pendingMatchId, setPendingMatchId] = useState(null);

  const findMatch = async () => {
    setStatus('searching');
    try {
      const lobbyRef = ref(db, 'lobby/waiting');
      const newMatchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      let transactionResult = { action: null, matchId: null };

      // Atomically claim a waiting slot or register as the new waiter
      const txResult = await runTransaction(lobbyRef, (currentVal) => {
        if (currentVal) {
          transactionResult = { action: 'join', matchId: currentVal };
          return null; // Claim and clear lobby
        }
        transactionResult = { action: 'create', matchId: newMatchId };
        return newMatchId; // Register as waiting
      });

      if (!txResult.committed) {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 3000);
        return;
      }

      if (transactionResult.action === 'join') {
        // Validate that the match still exists and is still waiting
        const matchRef = ref(db, `matches/${transactionResult.matchId}`);
        const snap = await get(matchRef);
        if (!snap.exists() || snap.val().state !== 'WAITING') {
          // Stale match — retry from scratch
          setStatus('idle');
          return;
        }
        await update(matchRef, {
          player2: user.uid,
          state: 'SETUP_LENGTH',
          player1Score: 0,
          player2Score: 0,
          player1GameWins: 0,
          player2GameWins: 0,
        });
        setMatchId(transactionResult.matchId);
      } else {
        // Create new match as host
        const matchRef = ref(db, `matches/${newMatchId}`);
        await set(matchRef, {
          id: newMatchId,
          player1: user.uid,
          state: 'WAITING',
          player1GameWins: 0,
          player2GameWins: 0,
        });
        // Cleanup if host disconnects while waiting
        onDisconnect(lobbyRef).set(null);
        onDisconnect(matchRef).remove();
        setPendingMatchId(newMatchId);
        setMatchId(newMatchId);
      }
    } catch (err) {
      console.error('Find match error:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const cancelSearch = async () => {
    try {
      if (pendingMatchId) {
        await remove(ref(db, `matches/${pendingMatchId}`));
        await remove(ref(db, 'lobby/waiting'));
      }
      setPendingMatchId(null);
      setMatchId(null);
      setStatus('idle');
    } catch (err) {
      console.error('Cancel search error:', err);
      setStatus('idle');
    }
  };

  return (
    <div>
      <p className="subtitle">Race to be first to reach the target score!</p>
      {status === 'error' && <div className="error-message">Connection failed. Please try again.</div>}
      <div className="controls">
        <button
          className="primary"
          onClick={findMatch}
          disabled={status === 'searching'}
        >
          {status === 'searching' ? <><span className="spinner" /> Searching...</> : 'Find Match'}
        </button>
        {status === 'searching' && (
          <button onClick={cancelSearch}>Cancel</button>
        )}
      </div>
    </div>
  );
}
