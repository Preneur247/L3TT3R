import { useState, useRef } from 'react';
import { ref, get, set, update, onDisconnect, onValue, runTransaction, remove } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { db, firestore } from '../firebase';
import LinkAccount from './LinkAccount';

const APP_VERSION = '0.0.2';

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const MODES = [
  { id: 'solo',    label: 'Solo',    icon: '👤' },
  { id: 'versus',  label: 'Versus',  icon: '⚔️' },
  { id: 'party',   label: 'Party',   icon: '👥' },
];

const RULES = {
  solo: [
    'Practice mode to improve your speed and vocabulary.',
    'Form a valid English word that starts and ends with the given letters.',
    'Play at your own pace without a timer.',
    'The winning word is translated to Chinese after each round. 🎉',
  ],
  versus: [
    'Form a valid English word that starts and ends with the given letters.',
    'The word must meet the minimum length set before the match.',
    'First to submit a correct word wins the round.',
    'Both players passing triggers a draw for that round.',
    'Timer runs out at 99s — also a draw.',
    'First to reach the point target wins the game!',
    'The winning word is translated to Chinese after each round. 🎉',
  ],
  party: [
    'Play with multiple friends in a single room.',
    'Host customized matches with private share codes.',
    'Form a valid English word that starts and ends with the given letters.',
    'First to submit a correct word wins the round.',
    'First to reach the point target wins the game!',
    'The winning word is translated to Chinese after each round. 🎉',
  ],
};

export default function Lobby({ user, profile, setMatchId }) {
  const [mode, setMode] = useState('versus');
  const [letterMode, setLetterMode] = useState('players'); // 'system' | 'players'
  const [status, setStatus] = useState('idle');           // idle | searching | error
  const [pendingMatchId, setPendingMatchId] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [roomPlayers, setRoomPlayers] = useState([]);
  const [matchData, setMatchData] = useState(null); // Local mirror for room setup sync
  const [roomSettings, setRoomSettings] = useState({ minWordLength: 3, winTarget: 5 });
  const roomListenerRef = useRef(null);
  const roomMatchIdRef = useRef(null);   // mirrors pendingMatchId for cancelRoom cleanup
  const roomCodeRef = useRef(null);      // mirrors roomCode for cancelRoom cleanup
  const searchListenerRef = useRef(null);
  const waitingListenerRef = useRef(null);
  const [roomTab, setRoomTab] = useState('room');
  const [copiedCode, setCopiedCode] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [tutorialMode, setTutorialMode] = useState('versus');
  const [language, setLanguage] = useState('en');         // 'en' | 'zh-TW'

  // ── Utility Room Functions ───────────────────────────────────────────────
  const initializeRoomListener = (mId) => {
    if (roomListenerRef.current) roomListenerRef.current();
    const matchRef = ref(db, `matches/${mId}`);

    const unsub = onValue(matchRef, async (snap) => {
      const data = snap.val();
      if (!data) {
        // Room was deleted by host
        unsub();
        roomListenerRef.current = null;
        setShowRoomModal(false);
        setMatchData(null);
        setPendingMatchId(null);
        setRoomPlayers([]);
        return;
      }

      setMatchData(data);
      setRoomSettings({
        minWordLength: data.minWordLength || 3,
        winTarget: data.winTarget || 5
      });
      if (data.letterMode) setLetterMode(data.letterMode);

      // Handle transition from Search to Room when player found
      if (data.state === 'ROOM_SETUP') {
        setShowSearchModal(false);
        setShowRoomModal(true);
      }

      // Transition to game if host started it
      if (data.state === 'PICKING_LETTERS') {
        unsub();
        roomListenerRef.current = null;
        setShowRoomModal(false);
        setRoomPlayers([]);
        setMatchId(mId);
        return;
      }

      // Handle players list
      const players = [];
      // P1 (always exists if match exists)
      let p1Username = 'Host';
      try {
        const p1Snap = await getDoc(doc(firestore, 'users', data.player1));
        if (p1Snap.exists()) p1Username = p1Snap.data().username;
      } catch {}
      players.push({ uid: data.player1, username: p1Username, isHost: true });

      if (data.player2) {
        let p2Username = 'Player 2';
        try {
          const p2Snap = await getDoc(doc(firestore, 'users', data.player2));
          if (p2Snap.exists()) p2Username = p2Snap.data().username;
        } catch {}
        players.push({ uid: data.player2, username: p2Username, isHost: false });
      }
      setRoomPlayers(players);
    });

    roomListenerRef.current = unsub;
  };

  const updateRoomSetting = async (key, val) => {
    if (!pendingMatchId || user.uid !== matchData?.player1) return;
    try {
      await update(ref(db, `matches/${pendingMatchId}`), { [key]: val });
    } catch (err) {
      console.error('Update setting error:', err);
    }
  };

  const copyRoomCode = () => {
    if (!matchData?.roomCode) return;
    navigator.clipboard.writeText(matchData.roomCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const cancelRoom = async () => {
    if (roomListenerRef.current) {
      roomListenerRef.current();
      roomListenerRef.current = null;
    }
    setShowRoomModal(false);
    setRoomPlayers([]);
    const mId = roomMatchIdRef.current || pendingMatchId;
    const mCode = roomCodeRef.current || roomCode;
    roomMatchIdRef.current = null;
    roomCodeRef.current = null;
    try {
      if (mId) {
        const matchRef = ref(db, `matches/${mId}`);
        const codeRef = ref(db, `room_codes/${mCode}`);
        await onDisconnect(matchRef).cancel();
        if (mCode) await onDisconnect(codeRef).cancel();
        await remove(matchRef);
        if (mCode) await remove(codeRef);
      }
    } catch (err) {
      console.error('Cancel room error:', err);
    }
    setPendingMatchId(null);
    setRoomCode(null);
    setMatchData(null);
  };

  const startGame = async () => {
    if (roomListenerRef.current) {
      roomListenerRef.current();
      roomListenerRef.current = null;
    }
    const mId = roomMatchIdRef.current || pendingMatchId;
    const mCode = roomCodeRef.current || roomCode;
    roomMatchIdRef.current = null;
    roomCodeRef.current = null;
    try {
      await update(ref(db, `matches/${mId}`), {
        state: 'PICKING_LETTERS',
        player1Score: 0,
        player2Score: 0,
        player1Role: 'START',
        player2Role: 'END',
        currentRound: 1,
        minWordLength: roomSettings.minWordLength,
        winTarget: roomSettings.winTarget,
        letterMode: letterMode
      });
      // Clean up room code index now that the game has started
      if (mCode) await remove(ref(db, `room_codes/${mCode}`)).catch(() => {});
      setShowRoomModal(false);
      setRoomPlayers([]);
      setMatchId(mId);
    } catch (err) {
      console.error('Start game error:', err);
    }
  };

  const joinByCode = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    setJoinError(null);
    try {
      const codeSnap = await get(ref(db, `room_codes/${code}`));
      if (!codeSnap.exists()) {
        setJoinError('Room not found. Check the code and try again.');
        return;
      }
      const matchId = codeSnap.val();
      const matchRef = ref(db, `matches/${matchId}`);
      const matchSnap = await get(matchRef);
      if (!matchSnap.exists() || matchSnap.val().state !== 'WAITING') {
        setJoinError('This room is no longer available.');
        return;
      }
      // Join as P2 — wait for host to start (ROOM_SETUP)
      await update(matchRef, { player2: user.uid, state: 'ROOM_SETUP', player1Score: 0, player2Score: 0, player1GameWins: 0, player2GameWins: 0 });
      setShowJoinModal(false);
      setJoinCodeInput('');
      setPendingMatchId(matchId);
      initializeRoomListener(matchId);
      setShowRoomModal(true);
    } catch (err) {
      console.error('Join room error:', err);
      setJoinError('Connection failed. Please try again.');
    } finally {
      setJoining(false);
    }
  };

  // ── Versus: find or create public match ──────────────────────────────────
  const findMatch = async () => {
    setShowSearchModal(true);
    try {
      const lobbyRef = ref(db, 'lobby/public_waiting/versus');
      const newMatchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      let transactionResult = { action: null, matchId: null };

      const txResult = await runTransaction(lobbyRef, (currentVal) => {
        if (currentVal) {
          transactionResult = { action: 'join', matchId: currentVal };
          return null;
        }
        transactionResult = { action: 'create', matchId: newMatchId };
        return newMatchId;
      });

      if (!txResult.committed) {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 3000);
        return;
      }

      if (transactionResult.action === 'join') {
        // Slot found — join immediately and hand off
        const matchRef = ref(db, `matches/${transactionResult.matchId}`);
        const snap = await get(matchRef);
        if (!snap.exists() || snap.val().state !== 'WAITING') {
          setShowSearchModal(false);
          return;
        }
        await update(matchRef, {
          player2: user.uid,
          state: 'ROOM_SETUP',
          player1Score: 0,
          player2Score: 0,
          player1GameWins: 0,
          player2GameWins: 0,
        });
        setShowSearchModal(false);
        setPendingMatchId(transactionResult.matchId);
        initializeRoomListener(transactionResult.matchId);
        setRoomTab('room');
        setShowRoomModal(true);
      } else {
        // Created slot — wait for P2 (modal already open)
        const matchRef = ref(db, `matches/${newMatchId}`);
        await set(matchRef, {
          id: newMatchId,
          player1: user.uid,
          state: 'WAITING',
          isPublic: true,
          player1GameWins: 0,
          player2GameWins: 0,
          minWordLength: roomSettings.minWordLength,
          winTarget: roomSettings.winTarget,
          letterMode: letterMode
        });
        onDisconnect(lobbyRef).set(null);
        onDisconnect(matchRef).remove();
        setPendingMatchId(newMatchId);
        initializeRoomListener(newMatchId);
      }
    } catch (err) {
      console.error('Find match error:', err);
      setShowSearchModal(false);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const cancelSearch = async () => {
    if (searchListenerRef.current) {
      searchListenerRef.current();
      searchListenerRef.current = null;
    }
    setShowSearchModal(false);
    try {
      if (pendingMatchId) {
        await remove(ref(db, `matches/${pendingMatchId}`));
        await remove(ref(db, 'lobby/public_waiting/versus'));
      }
    } catch (err) {
      console.error('Cancel search error:', err);
    }
    setPendingMatchId(null);
  };

  // ── Versus: create private room ───────────────────────────────────────────
  const createRoom = async () => {
    const code = generateRoomCode();
    const matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // Set refs synchronously before any await so cancelRoom always has them
    roomMatchIdRef.current = matchId;
    roomCodeRef.current = code;
    setRoomCode(code);
    setRoomPlayers([{ uid: user.uid, username: profile?.username || 'You', isHost: true }]);
    setRoomTab('room');
    
    const initialData = {
      id: matchId,
      player1: user.uid,
      state: 'WAITING',
      isPublic: false,
      player1GameWins: 0,
      player2GameWins: 0,
      roomCode: code,
      minWordLength: roomSettings.minWordLength,
      winTarget: roomSettings.winTarget,
      letterMode: letterMode
    };
    
    setMatchData(initialData);
    setShowRoomModal(true);
    try {
      const matchRef = ref(db, `matches/${matchId}`);
      const codeRef = ref(db, `room_codes/${code}`);
      await set(matchRef, initialData);
      await set(codeRef, matchId);
      onDisconnect(matchRef).remove();
      onDisconnect(codeRef).remove();
      setPendingMatchId(matchId);
      initializeRoomListener(matchId);
    } catch (err) {
      console.error('Create room error:', err);
      setShowRoomModal(false);
      setRoomPlayers([]);
      setRoomCode(null);
      roomMatchIdRef.current = null;
      roomCodeRef.current = null;
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const toggleLanguage = () => setLanguage(l => l === 'en' ? 'zh-TW' : 'en');


  // ── Action panel per mode ─────────────────────────────────────────────────
  const renderActionPanel = () => {
    if (mode === 'solo') {
      return (
        <div className="action-panel">
          <button className="primary" style={{ width: '100%', marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} disabled>
            <span>Start Practice</span>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.65)', fontWeight: 'normal', marginTop: '0.2rem' }}>Coming Soon</span>
          </button>
          <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
            <button style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.75rem 0.5rem' }} disabled>
              <span>Leaderboard</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'normal', marginTop: '0.2rem' }}>Coming Soon</span>
            </button>
            <button style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.75rem 0.5rem' }} disabled>
              <span>Best Streak</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'normal', marginTop: '0.2rem' }}>Coming Soon</span>
            </button>
          </div>
        </div>
      );
    }

    if (mode === 'party') {
      return (
        <div className="action-panel">
          <button className="primary" style={{ width: '100%', marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} disabled>
            <span>Quick Match</span>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.65)', fontWeight: 'normal', marginTop: '0.2rem' }}>Coming Soon</span>
          </button>
          <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
            <button style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.75rem 0.5rem' }} disabled>
              <span>Create Room</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'normal', marginTop: '0.2rem' }}>Coming Soon</span>
            </button>
            <button style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.75rem 0.5rem' }} disabled>
              <span>Join by Code</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 'normal', marginTop: '0.2rem' }}>Coming Soon</span>
            </button>
          </div>
        </div>
      );
    }

    // Versus (default)
    const anyModalOpen = showSearchModal || showRoomModal || showJoinModal;
    return (
      <div className="action-panel">
        {status === 'error' && (
          <div className="error-message" style={{ marginBottom: '1rem' }}>
            Connection failed. Please try again.
          </div>
        )}
        <button
          className="primary"
          style={{ width: '100%', marginBottom: '0.75rem', padding: '1rem' }}
          onClick={findMatch}
          disabled={anyModalOpen}
        >
          Quick Match
        </button>
        <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
          <button style={{ flex: 1, padding: '0.75rem 0.5rem' }} onClick={createRoom} disabled={anyModalOpen}>
            Create Room
          </button>
          <button style={{ flex: 1, padding: '0.75rem 0.5rem' }} onClick={() => setShowJoinModal(true)} disabled={anyModalOpen}>
            Join by Code
          </button>
        </div>
      </div>
    );
  };


  return (
    <>
      {/* Stats Modal */}
      {showStats && (
        <div className="popup-overlay" onClick={() => setShowStats(false)}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '2rem', marginTop: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              Your Stats
            </h2>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginBottom: '2rem', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>14</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Played</div>
              </div>
              <div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>82</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Win %</div>
              </div>
              <div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>5</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Streak</div>
              </div>
            </div>

            <div className="settings-group" style={{ textAlign: 'center' }}>
              <label className="settings-label" style={{ textAlign: 'center' }}>Words Formed</label>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--glow-success)' }}>234</div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
              <button className="primary" onClick={() => setShowStats(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="popup-overlay" onClick={() => setShowSettings(false)}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '2rem', marginTop: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </h2>

            <div className="settings-group">
              <label className="settings-label">Account</label>
              <div style={{
                padding: '1rem',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--glass-border)',
                borderRadius: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>💎</span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '1rem', letterSpacing: '0.04em' }}>
                      {profile?.username || 'Guest'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: user.isAnonymous ? 'var(--text-muted)' : 'var(--glow-success)' }}>
                      {user.isAnonymous ? 'Guest Account' : 'Verified Account'}
                    </span>
                  </div>
                </div>

                {user.isAnonymous ? (
                  <div style={{
                    padding: '0.75rem',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                      Your stats are only saved on this device. Link an email to backup your progress.
                    </div>
                    <button className="secondary" onClick={() => { setShowSettings(false); setShowLinkModal(true); }} style={{ width: '100%', fontSize: '0.85rem', padding: '0.5rem' }}>
                      ✉️ Link Email
                    </button>
                  </div>
                ) : (
                  <div style={{
                    padding: '0.75rem',
                    background: 'rgba(16, 185, 129, 0.08)',
                    borderRadius: '12px',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: 'var(--glow-success)'
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Account secured & backed up</span>
                  </div>
                )}
              </div>
            </div>

            <div className="settings-group">
              <label className="settings-label">App Interface</label>
              <select className="glass-select" value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="en">English (en)</option>
                <option value="zh-TW">繁體中文 (zh-TW)</option>
              </select>
            </div>

            <div className="settings-group">
              <label className="settings-label">Word Translation</label>
              <select className="glass-select" value="zh-TW" disabled>
                <option value="zh-TW">繁體中文 (zh-TW)</option>
              </select>
            </div>

            <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
              <button className="primary" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      {showRules && (
        <div className="popup-overlay" onClick={() => setShowRules(false)}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '2rem', marginTop: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              How to Play
            </h2>
            <div className="mode-tabs">
              {MODES.map(m => (
                <button
                  key={m.id}
                  className={`mode-tab ${tutorialMode === m.id ? 'tab-active' : ''}`}
                  onClick={() => setTutorialMode(m.id)}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
            <ul>
              {RULES[tutorialMode].map((rule, i) => <li key={i}>{rule}</li>)}
            </ul>
            <div style={{ textAlign: 'center' }}>
              <button className="primary" onClick={() => setShowRules(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Link Account Modal */}
      {showLinkModal && <LinkAccount onClose={() => setShowLinkModal(false)} />}

      {/* Quick Match Search Modal */}
      {showSearchModal && (
        <div className="popup-overlay">
          <div className="rules-modal" style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
              <span className="spinner" style={{ width: '2rem', height: '2rem', borderWidth: '3px' }} />
            </div>
            <h2 style={{ color: 'var(--glow-color)', marginTop: 0, marginBottom: '0.5rem' }}>Finding a Match</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '1.75rem' }}>
              Searching for an opponent...
            </p>
            <button style={{ width: '100%' }} onClick={cancelSearch}>Cancel</button>
          </div>
        </div>
      )}

      {showRoomModal && matchData && (
        <div className="popup-overlay">
          <div className="rules-modal" onClick={e => e.stopPropagation()} style={{ maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ overflowY: 'auto', flex: 1 }}>
            <h2 style={{ color: 'var(--glow-color)', marginBottom: '1.25rem', marginTop: 0, fontSize: '1.75rem', textAlign: 'center' }}>
              Game Room
            </h2>

            <div className="tags-row" style={{ marginBottom: '1.25rem' }}>
              <span className="badge-tag badge-versus">Versus Mode</span>
              <span className={`badge-tag ${matchData.isPublic ? 'badge-public' : 'badge-private'}`}>
                {matchData.isPublic ? 'Public' : 'Private'}
              </span>
            </div>

            {/* Tab bar */}
            <div className="game-tabs" style={{ marginBottom: '1.25rem' }}>
              <button
                className={`game-tab${roomTab === 'room' ? ' game-tab-active' : ''}`}
                onClick={() => setRoomTab('room')}
              >Room</button>
              <button
                className={`game-tab${roomTab === 'setup' ? ' game-tab-active' : ''}`}
                onClick={() => setRoomTab('setup')}
              >Setup</button>
            </div>

            {/* Room tab */}
            {roomTab === 'room' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                {/* Players with count */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="settings-label" style={{ marginBottom: 0 }}>Players</label>
                  <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--glow-color)' }}>{roomPlayers.length}/2</span>
                </div>
                <div className="room-player-slot filled">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  <span className="room-player-name">{roomPlayers[0]?.username || 'Host'}</span>
                  <span className="room-player-badge">Host</span>
                </div>
                <div className={`room-player-slot ${roomPlayers[1] ? 'filled' : 'waiting'}`}>
                  {roomPlayers[1] ? (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                      <span className="room-player-name">{roomPlayers[1].username}</span>
                    </>
                  ) : (
                    <>
                      <span className="spinner" style={{ width: '1.2rem', height: '1.2rem', opacity: 0.5, flexShrink: 0 }} />
                      <span className="room-player-name" style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 500 }}>Waiting...</span>
                    </>
                  )}
                </div>

                {/* Room Code — below players */}
                {!matchData.isPublic && matchData.roomCode && (
                  <div
                    className="room-code-section copyable"
                    onClick={copyRoomCode}
                    style={{ marginTop: '0.25rem' }}
                  >
                    <div className="label">Room Code</div>
                    <div className="code">{matchData.roomCode}</div>
                    <div className={`room-code-hint${copiedCode ? ' copied' : ''}`}>
                      {copiedCode ? '✓ Copied!' : 'Tap to copy'}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Setup tab */}
            {roomTab === 'setup' && (
              <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div className="settings-group" style={{ marginBottom: 0 }}>
                  <label className="settings-label">Letter Selection</label>
                  <div className="segmented-control" style={{ width: '100%' }}>
                    <button
                      className={`segment ${matchData.letterMode === 'system' ? 'segment-active' : ''}`}
                      onClick={() => updateRoomSetting('letterMode', 'system')}
                      disabled={user.uid !== matchData.player1}
                      style={{ flex: 1 }}
                    >System</button>
                    <button
                      className={`segment ${matchData.letterMode === 'players' ? 'segment-active' : ''}`}
                      onClick={() => updateRoomSetting('letterMode', 'players')}
                      disabled={user.uid !== matchData.player1}
                      style={{ flex: 1 }}
                    >Players</button>
                  </div>
                </div>

                <div className="settings-group" style={{ marginBottom: 0 }}>
                  <label className="settings-label">Min Length: <span style={{ color: 'var(--glow-color)', float: 'right' }}>{matchData.minWordLength || 3}</span></label>
                  <input
                    type="range"
                    min="3"
                    max="10"
                    value={matchData.minWordLength || 3}
                    onChange={(e) => updateRoomSetting('minWordLength', parseInt(e.target.value))}
                    disabled={user.uid !== matchData.player1}
                    style={{ width: '100%', height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px', accentColor: 'var(--glow-color)' }}
                  />
                </div>

                <div className="settings-group" style={{ marginBottom: 0 }}>
                  <label className="settings-label">Target Points</label>
                  <div className="segmented-control" style={{ width: '100%' }}>
                    {[5, 10, 20].map(n => (
                      <button
                        key={n}
                        className={`segment ${matchData.winTarget === n ? 'segment-active' : ''}`}
                        onClick={() => updateRoomSetting('winTarget', n)}
                        disabled={user.uid !== matchData.player1}
                        style={{ flex: 1 }}
                      >{n}</button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            </div>{/* end scrollable */}
            <div style={{ display: 'flex', gap: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)', flexShrink: 0 }}>
              <button className="secondary" style={{ flex: 1, padding: '1rem' }} onClick={cancelRoom}>
                Leave Room
              </button>
              {user.uid === matchData.player1 ? (
                <button
                  className="primary"
                  style={{ flex: 1.5, padding: '1rem' }}
                  onClick={startGame}
                  disabled={roomPlayers.length < 2}
                >
                  Start Game
                </button>
              ) : (
                <div style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.15)', borderRadius: '12px', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.85rem', padding: '0.5rem', textAlign: 'center' }}>
                  Waiting for host to begin...
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Join by Code Modal */}
      {showJoinModal && (
        <div className="popup-overlay" onClick={() => { setShowJoinModal(false); setJoinCodeInput(''); setJoinError(null); }}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ color: 'var(--glow-color)', marginBottom: '1.5rem', marginTop: 0 }}>
              Join by Code
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '1rem' }}>
              Enter the 6-character room code from your friend.
            </p>
            <input
              type="text"
              placeholder="AB3K7Q"
              maxLength={6}
              value={joinCodeInput}
              onChange={e => { setJoinCodeInput(e.target.value.toUpperCase()); setJoinError(null); }}
              autoFocus
              style={{ letterSpacing: '0.2em', fontWeight: 800 }}
            />
            {joinError && (
              <div className="error-message" style={{ marginBottom: '0.75rem' }}>{joinError}</div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button style={{ flex: 1 }} onClick={() => { setShowJoinModal(false); setJoinCodeInput(''); setJoinError(null); }}>Cancel</button>
              <button
                className="primary"
                style={{ flex: 1 }}
                onClick={joinByCode}
                disabled={joining || joinCodeInput.trim().length === 0}
              >
                {joining ? <><span className="spinner" /> Joining...</> : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="lobby-container">
        {/* Title */}
        <h1>L3TT3R</h1>

        {/* Mode Tabs */}
        <div className="mode-tabs">
          {MODES.map(m => (
            <button
              key={m.id}
              className={`mode-tab ${mode === m.id ? 'tab-active' : ''}`}
              onClick={() => {
                setMode(m.id);
                setStatus('idle');
                if (m.id === 'party') setLetterMode('system');
                else if (m.id === 'versus') setLetterMode('players');
              }}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>

        {/* Dynamic action content */}
        {renderActionPanel()}

        {/* Separator */}
        <div style={{
          width: '100%',
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
          margin: '0.5rem 0 1rem 0'
        }} />

        {/* Utility Dock (Tutorial & Settings) */}
        <div className="util-opt3-pill">
          <button className="util-opt3-btn" onClick={() => { setTutorialMode(mode); setShowRules(true); }} title="Tutorial">
             <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </button>
          <button className="util-opt3-btn" onClick={() => setShowStats(true)} title="Stats">
             <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          </button>
          <button className="util-opt3-btn" onClick={() => setShowSettings(true)} title="Settings">
             <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </div>
      </div>

      {/* Version — sits below the card, outside lobby-container */}
      <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
        <span className="version-text" style={{ position: 'static', opacity: 0.3, fontSize: '0.75rem' }}>
          v{APP_VERSION}
        </span>
      </div>
    </>
  );
}
