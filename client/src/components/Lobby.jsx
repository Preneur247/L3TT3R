import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ref, get, set, update, onDisconnect, onValue, runTransaction, remove } from 'firebase/database';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, firestore } from '../firebase';
import LinkAccount from './LinkAccount';

const APP_VERSION = '0.1.1';

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const MODES = [
  { id: 'solo', label: 'Solo', icon: '👤' },
  { id: 'versus', label: 'Versus', icon: '⚔️' },
  { id: 'party', label: 'Party', icon: '👥' },
];

const RULES = {
  solo: 'Coming Soon',
  versus: 'VISUAL',
  party: 'Coming Soon',
};

const StatBlock = ({ label, value, color, glowColor, isWord = false }) => {
  const getDynamicFontSize = (text) => {
    if (!text || !isWord) return '2.5rem';
    const len = text.toString().length;
    if (len > 15) return '1.3rem';
    if (len > 12) return '1.6rem';
    if (len > 9) return '1.9rem';
    return '2.5rem';
  };

  return (
    <div style={{ 
      background: 'rgba(255,255,255,0.03)', 
      borderRadius: '20px', 
      padding: '1.25rem 1.5rem', 
      border: '1px solid var(--glass-border)',
      textAlign: 'center',
      marginBottom: '1rem',
      minHeight: '125px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem', fontWeight: 700, letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ 
        fontSize: getDynamicFontSize(value), 
        fontWeight: 900, 
        color: color || 'var(--glow-color)', 
        whiteSpace: isWord ? 'nowrap' : 'normal',
        overflow: isWord ? 'hidden' : 'visible',
        textTransform: 'uppercase',
        textShadow: `0 0 20px ${glowColor || 'rgba(56, 189, 248, 0.3)'}`,
        transition: 'font-size 0.2s ease'
      }}>
        {value}
      </div>
    </div>
  );
};

export default function Lobby({ user, profile, setMatchId, initialMatchId, onRoomInitialized }) {
  const [mode, setMode] = useState('versus');
  const [letterMode, setLetterMode] = useState('players'); // 'system' | 'players'
  const [status, setStatus] = useState('idle');           // idle | searching | error
  const [pendingMatchId, setPendingMatchId] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [roomPlayers, setRoomPlayers] = useState([]);
  const [matchData, setMatchData] = useState(null); // Local mirror for room setup sync
  const [roomSettings, setRoomSettings] = useState({ minWordLength: 3, winTarget: 5 });
  const roomListenerRef = useRef(null);
  const roomMatchIdRef = useRef(null);   // mirrors pendingMatchId for cancelRoom cleanup
  const roomCodeRef = useRef(null);      // mirrors roomCode for cancelRoom cleanup
  const matchDataRef = useRef(null);     // mirrors matchData to detect prev state in listener
  const [roomTab, setRoomTab] = useState('room');
  const [statsView, setStatsView] = useState('current');
  const [statTab, setStatTab] = useState('total');
  const [copiedCode, setCopiedCode] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showWordBank, setShowWordBank] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [tutorialMode, setTutorialMode] = useState('versus');
  const [pairStats, setPairStats] = useState(null);
  const pairStatsUnsubRef = useRef(null);
  const [wordBank, setWordBank] = useState(null);
  const [wordBankLoading, setWordBankLoading] = useState(false);

  // ── Fetch cross-session pair stats when both players are in the room ─────
  useEffect(() => {
    const p1 = matchData?.player1Id;
    const p2 = matchData?.player2Id;
    if (!p1 || !p2) { setPairStats(null); return; }

    if (pairStatsUnsubRef.current) pairStatsUnsubRef.current();
    const sortedUids = [p1, p2].sort();
    const pairKey = sortedUids.join('_');
    pairStatsUnsubRef.current = onSnapshot(
      doc(firestore, 'user_versus_matches', pairKey),
      snap => setPairStats(snap.exists() ? { ...snap.data(), sortedUids } : null),
      () => setPairStats(null)
    );
    return () => { if (pairStatsUnsubRef.current) pairStatsUnsubRef.current(); };
  }, [matchData?.player1Id, matchData?.player2Id]);

  // ── Restore room after Back to Room from game over ───────────────────────
  useEffect(() => {
    if (!initialMatchId) return;
    setPendingMatchId(initialMatchId);
    roomMatchIdRef.current = initialMatchId;
    get(ref(db, `matches/${initialMatchId}`)).then(snap => {
      const data = snap.val();
      if (data?.roomCode) {
        setRoomCode(data.roomCode);
        roomCodeRef.current = data.roomCode;
      }
    });
    initializeRoomListener(initialMatchId);
    onRoomInitialized?.();
  }, [initialMatchId]);

  // ── Settings Sync ───────────────────────────────────────────────────────
  useEffect(() => {
    // Sync language selection if wordTranslationLang is provided in profile
  }, [profile?.settings?.wordTranslationLang]);

  // Fetch Word Bank on-demand
  useEffect(() => {
    if (showWordBank && !wordBank && user?.uid) {
      const fetchWords = async () => {
        setWordBankLoading(true);
        try {
          const snap = await getDoc(doc(firestore, 'user_words', user.uid));
          if (snap.exists()) {
            setWordBank(snap.data().words || {});
          } else {
            setWordBank({});
          }
        } catch (err) {
          console.error('Failed to fetch word bank:', err);
        } finally {
          setWordBankLoading(false);
        }
      };
      fetchWords();
    }
  }, [showWordBank, wordBank, user?.uid]);

  const updateUserSetting = async (key, value) => {
    if (!user) return;
    try {
      await setDoc(doc(firestore, 'users', user.uid), {
        settings: { [key]: value }
      }, { merge: true });
    } catch (err) {
      console.error('Failed to update setting:', err);
    }
  };

  // ── Utility Room Functions ───────────────────────────────────────────────
  const initializeRoomListener = (mId) => {
    if (roomListenerRef.current) roomListenerRef.current();
    const matchRef = ref(db, `matches/${mId}`);

    const unsub = onValue(matchRef, async (snap) => {
      const data = snap.val();

      if (!data) {
        // Only treat null as a deletion if we've already had data for this room.
        // This prevents the modal from "flashing" or closing immediately on the
        // very first snapshot if the cloud write hasn't propagated yet.
        if (roomMatchIdRef.current === mId && matchDataRef.current) {
          unsub();
          roomListenerRef.current = null;
          setShowRoomModal(false);
          setMatchData(null);
          setPendingMatchId(null);
          setRoomPlayers([]);
        }
        return;
      }

      setMatchData(data);
      matchDataRef.current = data;
      setRoomSettings({
        minWordLength: data.minWordLength || 3,
        winTarget: data.winTarget || 5
      });
      if (data.letterMode) setLetterMode(data.letterMode);

      if (data.matchState === 'ROOM_SETUP' || (data.matchState === 'WAITING' && data.player1Id === user.uid)) {
        setShowRoomModal(true);
        setPendingMatchId(mId);

        // Ensure public match is listed in the search pool if it reverted to WAITING (guest dropped)
        if (data.matchState === 'WAITING' && data.isPublic && data.player1Id === user.uid) {
          const publicRef = ref(db, `lobby/waiting_matches/${data.mode || 'versus'}/${mId}`);
          set(publicRef, true).catch(() => {});
          onDisconnect(publicRef).remove();
        }
      }

      // Transition to game — hand off matchId + data so App.jsx renders immediately
      if (data.matchState === 'PICKING_LETTERS') {
        unsub();
        roomListenerRef.current = null;
        setMatchId(mId, data);
        return;
      }

      // Handle players list
      const players = [];
      // P1 (always exists if match exists)
      let p1Username = 'Host';
      try {
        const p1Snap = await getDoc(doc(firestore, 'users', data.player1Id));
        if (p1Snap.exists()) p1Username = p1Snap.data().username;
      } catch { }
      players.push({ uid: data.player1Id, username: p1Username, isHost: true });

      if (data.player2Id) {
        let p2Username = 'Player 2';
        try {
          const p2Snap = await getDoc(doc(firestore, 'users', data.player2Id));
          if (p2Snap.exists()) p2Username = p2Snap.data().username;
        } catch { }
        players.push({ uid: data.player2Id, username: p2Username, isHost: false });
      }
      setRoomPlayers(players);
    });

    roomListenerRef.current = unsub;
  };

  const updateRoomSetting = async (key, val) => {
    if (!pendingMatchId || user.uid !== matchData?.player1Id) return;
    try {
      await update(ref(db, `matches/${pendingMatchId}`), { [key]: val });
      if (key === 'isPublic') {
        const publicRef = ref(db, `lobby/waiting_matches/${mode}/${pendingMatchId}`);
        if (val) {
          // Verify we aren't already full before listing publicly
          if (!matchData.player2Id) {
            await set(publicRef, true);
            onDisconnect(publicRef).remove();
          }
        } else {
          await remove(publicRef);
          await onDisconnect(publicRef).cancel();
        }
      }
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
    const isHost = matchData?.player1Id === user.uid;

    roomMatchIdRef.current = null;
    roomCodeRef.current = null;
    try {
      if (mId) {
        const matchRef = ref(db, `matches/${mId}`);
        const codeRef = ref(db, `room_codes/${mCode}`);
        const publicRef = ref(db, `lobby/waiting_matches/${mode}/${mId}`);
        
        // Clean up onDisconnect first
        await onDisconnect(matchRef).cancel().catch(() => {});
        if (mCode) await onDisconnect(codeRef).cancel().catch(() => {});
        await onDisconnect(publicRef).cancel().catch(() => {});

        if (isHost) {
          await remove(matchRef);
          if (mCode) await remove(codeRef).catch(() => {});
          await remove(publicRef).catch(() => {});
        } else {
          // Guest leaving: clear self and reset room to WAITING
          await update(matchRef, {
            player2Id: null,
            matchState: 'WAITING'
          });
          // If it's a public room, re-list it
          if (matchData?.isPublic) {
            await set(publicRef, true);
          }
        }
      }
    } catch (err) {
      console.error('Cancel room error:', err);
    }
    setPendingMatchId(null);
    setRoomCode(null);
    setMatchData(null);
    matchDataRef.current = null;
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
      const startUpdates = {
        matchState: 'PICKING_LETTERS',
        player1Score: 0,
        player2Score: 0,
        player1Role: 'START',
        player2Role: 'END',
        currentRound: 1,
        minWordLength: roomSettings.minWordLength,
        winTarget: roomSettings.winTarget,
        letterMode: letterMode
      };
      await update(ref(db, `matches/${mId}`), startUpdates);
      
      // Clean up room index, public pool, and onDisconnect listeners now that game started
      if (mCode) {
        onDisconnect(ref(db, `room_codes/${mCode}`)).cancel().catch(() => {});
        await remove(ref(db, `room_codes/${mCode}`)).catch(() => {});
      }
      const publicRef = ref(db, `lobby/waiting_matches/${mode}/${mId}`);
      onDisconnect(publicRef).cancel().catch(() => {});
      await remove(publicRef).catch(() => {});

      setMatchId(mId, { ...matchData, ...startUpdates });
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

      // Pre-fetch the match data to pop the local cache and prevent
      // transaction aborts due to initial null state.
      await get(matchRef);

      const result = await runTransaction(matchRef, (current) => {
        // If the transaction starts with null, return null to tell Firebase
        // to continue the transaction until it has the server data.
        if (current === null) return current;

        if (current.matchState === 'WAITING' && !current.player2Id) {
          current.player2Id = user.uid;
          current.matchState = 'ROOM_SETUP';
          current.player1Score = 0;
          current.player2Score = 0;
          current.player1GamesWon = 0;
          current.player2GamesWon = 0;
          return current;
        }
        return; // Abort transaction if conditions not met
      });

      if (!result.committed) {
        setJoinError('This room is no longer available.');
        return;
      }

      const matchInfo = result.snapshot.val();
      if (!matchInfo) {
        setJoinError('Could not retrieve room details. Please try again.');
        return;
      }

      // If it was public, remove it from registry
      if (matchInfo.isPublic) {
        await remove(ref(db, `lobby/waiting_matches/${matchInfo.mode || 'versus'}/${matchId}`)).catch(() => { });
      }

      setShowJoinModal(false);
      setJoinCodeInput('');
      setPendingMatchId(matchId);
      roomMatchIdRef.current = matchId;
      
      // Guest onDisconnect: clear self and reset state if connection lost
      onDisconnect(matchRef).update({
        player2Id: null,
        matchState: 'WAITING'
      });
      
      initializeRoomListener(matchId);
      setShowRoomModal(true);
    } catch (err) {
      console.error('Join room error:', err);
      setJoinError('Connection failed. Please try again.');
    } finally {
      setJoining(false);
    }
  };

  const findMatch = async () => {
    setStatus('searching');
    try {
      // 1. First, look for an existing public room
      const publicWaitingRef = ref(db, `lobby/waiting_matches/${mode}`);
      const snap = await get(publicWaitingRef);

      if (snap.exists()) {
        const waitingRooms = snap.val();
        const matchIds = Object.keys(waitingRooms);

        // Try to join rooms until one works
        for (const mId of matchIds) {
          const matchRef = ref(db, `matches/${mId}`);

          // Pre-fetch to avoid transaction aborts on initial null
          await get(matchRef);

          const result = await runTransaction(matchRef, (current) => {
            if (current === null) return current;
            if (current.matchState === 'WAITING' && !current.player2Id) {
              current.player2Id = user.uid;
              current.matchState = 'ROOM_SETUP';
              current.player1Score = 0;
              current.player2Score = 0;
              current.player1GamesWon = 0;
              current.player2GamesWon = 0;
              return current;
            }
            return;
          });

          if (result.committed) {
            // Successfully joined an existing room!
            await remove(ref(db, `lobby/waiting_matches/${mode}/${mId}`)).catch(() => { });
            setPendingMatchId(mId);
            roomMatchIdRef.current = mId;
            
            // Guest onDisconnect: clear self and reset state if connection lost
            onDisconnect(matchRef).update({
              player2Id: null,
              matchState: 'WAITING'
            });
            
            initializeRoomListener(mId);
            setRoomTab('room');
            setShowRoomModal(true);
            setStatus('idle');
            return;
          }
        }
      }

      // 2. If no joinable public room found, create a new PUBLIC room and wait
      await createRoom(true);
      setStatus('idle');
    } catch (err) {
      console.error('Find match error:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  };


  // ── Versus: create private room ───────────────────────────────────────────
  const createRoom = async (isPublic = false) => {
    const code = generateRoomCode();
    const matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // Set refs synchronously before any await so cancelRoom always has them
    roomMatchIdRef.current = matchId;
    roomCodeRef.current = code;
    setRoomCode(code);
    setRoomPlayers([{ uid: user.uid, username: profile?.username || 'You', isHost: true }]);
    setRoomTab('room');

    const initialData = {
      matchId: matchId,
      player1Id: user.uid,
      matchState: 'WAITING',
      isPublic: isPublic,
      mode: mode,
      player1GamesWon: 0,
      player2GamesWon: 0,
      roomCode: code,
      minWordLength: roomSettings.minWordLength,
      winTarget: roomSettings.winTarget,
      letterMode: letterMode
    };

    setMatchData(initialData);
    matchDataRef.current = initialData;
    setShowRoomModal(true);
    try {
      const matchRef = ref(db, `matches/${matchId}`);
      const codeRef = ref(db, `room_codes/${code}`);
      const publicRef = ref(db, `lobby/waiting_matches/${mode}/${matchId}`);

      await set(matchRef, initialData);
      await set(codeRef, matchId);

      if (isPublic) {
        await set(publicRef, true);
        onDisconnect(publicRef).remove();
      }

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



  // ── Action panel per mode ─────────────────────────────────────────────────
  const renderActionPanel = () => {
    if (mode === 'solo') {
      return (
        <div className="action-panel">
          <button className="primary action-panel-btn-main" disabled>
            <div className="btn-stack">
              <span>Go Solo</span>
              <span className="btn-sub-text">Coming Soon</span>
            </div>
          </button>
          <div className="action-panel-row">
            <button className="action-panel-btn-sub" disabled>
              <div className="btn-stack">
                <span>Leaderboard</span>
                <span className="btn-sub-text">Coming Soon</span>
              </div>
            </button>
            <button className="action-panel-btn-sub" disabled>
              <div className="btn-stack">
                <span>Challenges</span>
                <span className="btn-sub-text">Coming Soon</span>
              </div>
            </button>
          </div>
        </div>
      );
    }

    if (mode === 'party') {
      return (
        <div className="action-panel">
          <button className="primary action-panel-btn-main" disabled>
            <div className="btn-stack">
              <span>Go Party</span>
              <span className="btn-sub-text">Coming Soon</span>
            </div>
          </button>
          <div className="action-panel-row">
            <button className="action-panel-btn-sub" disabled>
              <div className="btn-stack">
                <span>Create Room</span>
                <span className="btn-sub-text">Coming Soon</span>
              </div>
            </button>
            <button className="action-panel-btn-sub" disabled>
              <div className="btn-stack">
                <span>Join by Code</span>
                <span className="btn-sub-text">Coming Soon</span>
              </div>
            </button>
          </div>
        </div>
      );
    }

    // Versus (default)
    const anyModalOpen = showRoomModal || showJoinModal;
    return (
      <div className="action-panel">
        {status === 'error' && (
          <div className="error-message" style={{ marginBottom: '1rem' }}>
            Connection failed. Please try again.
          </div>
        )}
        <button
          className="primary action-panel-btn-main"
          onClick={() => findMatch()}
          disabled={anyModalOpen || status === 'searching'}
        >
          {status === 'searching' ? (
            <div className="btn-stack" style={{ flexDirection: 'row', gap: '0.75rem' }}>
              <span className="spinner" style={{ width: '1.25rem', height: '1.25rem', borderWidth: '2px' }} />
              Searching...
            </div>
          ) : 'Quick Match'}
        </button>
        <div className="action-panel-row">
          <button className="action-panel-btn-sub" onClick={() => createRoom(false)} disabled={anyModalOpen}>
            Create Room
          </button>
          <button className="action-panel-btn-sub" onClick={() => setShowJoinModal(true)} disabled={anyModalOpen}>
            Join by Code
          </button>
        </div>
      </div>
    );
  };


  return (
    <>
      <style>{`
        .custom-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 22px;
          height: 22px;
          background: #fff;
          border: 3px solid var(--glow-color);
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(0,0,0,0.5);
          position: relative;
          z-index: 10;
        }
        .custom-range::-moz-range-thumb {
          width: 22px;
          height: 22px;
          background: #fff;
          border: 3px solid var(--glow-color);
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(0,0,0,0.5);
          position: relative;
          z-index: 10;
        }
      `}</style>
      {showStats && createPortal(
        <div className="popup-overlay" onClick={() => setShowStats(false)}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '2rem', marginTop: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              Your Stats
            </h2>

            <div className="modal-body">
              <div className="mode-tabs" style={{ marginBottom: '1.5rem' }}>
                {[
                  { id: 'total', label: 'Total', icon: '🌍' },
                  { id: 'solo', label: 'Solo', icon: '👤' },
                  { id: 'versus', label: 'Versus', icon: '⚔️' },
                  { id: 'party', label: 'Party', icon: '👥' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    className={`mode-tab ${statTab === tab.id ? 'tab-active' : ''}`}
                    onClick={() => setStatTab(tab.id)}
                    style={{ fontSize: '0.82rem', padding: '0.6rem 0.2rem' }}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              {(() => {
                const activeStats = profile?.stats?.[statTab] || { wordsFormed: 0, gamesPlayed: 0, gamesWon: 0, currentStreak: 0, bestStreak: 0 };
                const winRate = activeStats.gamesPlayed ? Math.round(((activeStats.gamesWon || 0) / activeStats.gamesPlayed) * 100) : 0;
                const hasStreak = statTab !== 'total';

                // Use cached records for Total tab
                const mostUsedWord = statTab === 'total' ? (profile?.stats?.total?.mostUsedWord || '---') : 'N/A';
                const longestWord = statTab === 'total' ? (profile?.stats?.total?.longestWord || '---') : 'N/A';

                return (
                  <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '2rem', textAlign: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>
                          {activeStats.gamesPlayed || 0}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '0.3rem' }}>
                          {activeStats.gamesPlayed === 1 ? 'Game' : 'Games'}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.1 }}>
                          {winRate}<span style={{ fontSize: '1.2rem', opacity: 0.6 }}>%</span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '0.3rem' }}>Win Rate</div>
                      </div>
                    </div>

                    <StatBlock 
                      label="Words Formed" 
                      value={activeStats.wordsFormed || 0} 
                      color="var(--glow-success)" 
                      glowColor="rgba(16, 185, 129, 0.3)" 
                    />

                    {hasStreak && (
                      <>
                        <StatBlock label="Current Streak" value={activeStats.currentStreak || 0} />
                        <StatBlock 
                          label="Best Streak" 
                          value={activeStats.bestStreak || 0} 
                          color="#f43f5e" 
                          glowColor="rgba(244, 63, 94, 0.3)" 
                        />
                      </>
                    )}

                    {!hasStreak && (
                      <>
                        <StatBlock label="Most Used Word" value={mostUsedWord} isWord={true} />
                        <StatBlock 
                          label="Longest Word" 
                          value={longestWord} 
                          isWord={true} 
                          color="#f43f5e" 
                          glowColor="rgba(244, 63, 94, 0.3)" 
                        />
                      </>
                    )}
                  </div>
                );
              })()}
            </div>

            <div style={{ textAlign: 'center', marginTop: '1.5rem', flexShrink: 0 }}>
              <button className="primary" onClick={() => setShowStats(false)}>Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showWordBank && createPortal(
        <div className="popup-overlay" onClick={() => setShowWordBank(false)}>
          <div className="rules-modal" style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '1.5rem', marginTop: 0, flexShrink: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ alignSelf: 'center' }}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                Word Bank
                <span style={{ fontSize: '0.85rem', opacity: 0.5, fontWeight: 400 }}>({profile?.stats?.total?.uniqueWords || 0})</span>
              </span>
            </h2>

            <div className="modal-body">
              {(() => {
                if (wordBankLoading) {
                  return <div style={{ textAlign: 'center', padding: '2rem' }}><span className="spinner" /> Loading word bank...</div>;
                }

                const words = wordBank || {};
                const wordList = Object.keys(words).sort();
                
                if (wordList.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '3rem 1rem', opacity: 0.5 }}>
                      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📚</div>
                      <p>Your word bank is empty. Play some games to start collecting words!</p>
                    </div>
                  );
                }

                const groups = wordList.reduce((acc, word) => {
                  const first = word[0].toUpperCase();
                  if (!acc[first]) acc[first] = [];
                  acc[first].push({ word, count: words[word] });
                  return acc;
                }, {});

                return Object.keys(groups).sort().map(letter => (
                  <div key={letter} style={{ marginBottom: '1.5rem' }}>
                    <div style={{ 
                      fontSize: '0.9rem', 
                      color: 'var(--glow-color)', 
                      fontWeight: 800, 
                      marginBottom: '0.75rem', 
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      paddingBottom: '0.25rem',
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '0.5rem'
                    }}>
                      {letter}
                      <span style={{ fontSize: '0.7rem', opacity: 0.5, fontWeight: 400 }}>({groups[letter].length})</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {groups[letter].map(item => (
                        <div 
                          key={item.word} 
                          title={`Formed ${item.count} time${item.count > 1 ? 's' : ''}`}
                          style={{
                            padding: '0.4rem 0.8rem',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '8px',
                            fontSize: '0.9rem',
                            color: 'var(--text-main)',
                            letterSpacing: '0.05em',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.4rem'
                          }}
                        >
                          {item.word}
                          <span style={{ fontSize: '0.7rem', color: 'var(--glow-success)', opacity: 0.8, marginTop: '0.15rem' }}>×{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>

            <div style={{ textAlign: 'center', marginTop: '1.5rem', flexShrink: 0 }}>
              <button className="primary" onClick={() => setShowWordBank(false)}>Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showSettings && createPortal(
        <div className="popup-overlay" onClick={() => setShowSettings(false)}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '2rem', marginTop: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </h2>
            <div className="modal-body">
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
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                        Account linked with <span style={{ fontWeight: 400, opacity: 0.85 }}>{profile?.email || user.email}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="settings-group">
                <label className="settings-label">App Interface</label>
                <select className="glass-select" value="en" disabled>
                  <option value="en">English</option>
                </select>
              </div>

              <div className="settings-group">
                <label className="settings-label">Word Translation</label>
                <select className="glass-select" value="zh-TW" disabled>
                  <option value="zh-TW">繁體中文</option>
                </select>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '1.5rem', flexShrink: 0 }}>
              <button className="primary" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showRules && createPortal(
        <div className="popup-overlay" onClick={() => setShowRules(false)}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '2rem', marginTop: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              How to Play
            </h2>
            <div className="modal-body">
              <div className="mode-tabs" style={{ marginBottom: '1.5rem' }}>
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
              {tutorialMode === 'versus' ? (
                <div className="tutorial-visual" style={{ padding: '0.5rem 0' }}>
                  <div style={{ marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <div style={{ width: '42px', height: '42px', border: '2px solid var(--glow-color)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.25rem', color: 'var(--glow-color)', background: 'rgba(56, 189, 248, 0.05)' }}>S</div>
                      <div style={{ width: '42px', height: '42px', border: '2px dashed rgba(255,255,255,0.15)', borderRadius: '10px' }}></div>
                      <div style={{ width: '42px', height: '42px', border: '2px dashed rgba(255,255,255,0.15)', borderRadius: '10px' }}></div>
                      <div style={{ width: '42px', height: '42px', border: '2px dashed rgba(255,255,255,0.15)', borderRadius: '10px' }}></div>
                      <div style={{ width: '42px', height: '42px', border: '2px solid var(--glow-color)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.25rem', color: 'var(--glow-color)', background: 'rgba(56, 189, 248, 0.05)' }}>T</div>
                    </div>
                    <p style={{ textAlign: 'center', fontSize: '1rem', color: 'var(--text-main)', fontWeight: 700, marginBottom: '0.25rem' }}>1. Start & End Letters</p>
                    <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>Form a word that begins and ends with the letters shown on screen.</p>
                  </div>

                  <div style={{ marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <div style={{ width: '42px', height: '42px', background: 'rgba(255,255,255,0.08)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.25rem' }}>S</div>
                      <div style={{ width: '42px', height: '42px', background: 'var(--glow-color)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.25rem', color: '#000', boxShadow: '0 0 15px var(--glow-color)' }}>M</div>
                      <div style={{ width: '42px', height: '42px', background: 'var(--glow-color)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.25rem', color: '#000', boxShadow: '0 0 15px var(--glow-color)' }}>A</div>
                      <div style={{ width: '42px', height: '42px', background: 'var(--glow-color)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.25rem', color: '#000', boxShadow: '0 0 15px var(--glow-color)' }}>R</div>
                      <div style={{ width: '42px', height: '42px', background: 'rgba(255,255,255,0.08)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.25rem' }}>T</div>
                    </div>
                    <p style={{ textAlign: 'center', fontSize: '1rem', color: 'var(--text-main)', fontWeight: 700, marginBottom: '0.25rem' }}>2. Meet the Length</p>
                    <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>Ensure your word meets the minimum length requirement for the round.</p>
                  </div>

                  <div style={{ background: 'rgba(56, 189, 248, 0.08)', padding: '1.25rem', borderRadius: '16px', border: '1px solid rgba(56, 189, 248, 0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🏆</div>
                    <p style={{ fontSize: '1rem', color: 'var(--glow-color)', fontWeight: 800, marginBottom: '0.25rem' }}>3. Race to Submit</p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>Be the first to submit a valid word! Reach the target score to win the match.</p>
                  </div>
                </div>
              ) : (
                <div style={{
                  textAlign: 'center',
                  fontSize: '2.5rem',
                  fontWeight: 800,
                  margin: '4rem 0',
                  color: 'var(--text-muted)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  opacity: 0.5
                }}>
                  {RULES[tutorialMode]}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'center' }}>
              <button className="primary" onClick={() => setShowRules(false)}>Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Link Account Modal */}
      {showLinkModal && <LinkAccount onClose={() => setShowLinkModal(false)} username={profile?.username} />}


      {showRoomModal && createPortal(
        <div className="popup-overlay">
          {!matchData ? (
            <div className="rules-modal" style={{ textAlign: 'center', padding: '3rem' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                <span className="spinner" style={{ width: '2.5rem', height: '2.5rem' }} />
              </div>
              <h2 style={{ color: 'var(--glow-color)', marginBottom: '0.5rem' }}>Entering Room...</h2>
              <p style={{ color: 'var(--text-muted)' }}>Fetching match details</p>
              <button className="secondary" style={{ marginTop: '2rem', width: '100%' }} onClick={cancelRoom}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="rules-modal" onClick={e => e.stopPropagation()}>
              <h2 style={{ color: 'var(--glow-color)', marginBottom: '1.25rem', marginTop: 0, fontSize: '1.75rem', textAlign: 'center', flexShrink: 0 }}>
                Game Room
              </h2>

              <div className="tags-row" style={{ marginBottom: '1.25rem', flexShrink: 0 }}>
                <span className="badge-tag badge-versus">Versus Mode</span>
                <span className={`badge-tag ${matchData.isPublic ? 'badge-public' : 'badge-private'}`}>
                  {matchData.isPublic ? 'Public' : 'Private'}
                </span>
              </div>

              {/* Tab bar */}
              <div className="game-tabs" style={{ marginBottom: '1.25rem', flexShrink: 0 }}>
                <button
                  className={`game-tab${roomTab === 'room' ? ' game-tab-active' : ''}`}
                  onClick={() => setRoomTab('room')}
                >Room</button>
                <button
                  className={`game-tab${roomTab === 'invite' ? ' game-tab-active' : ''}`}
                  onClick={() => setRoomTab('invite')}
                >Invite</button>
                <button
                  className={`game-tab${roomTab === 'setup' ? ' game-tab-active' : ''}`}
                  onClick={() => setRoomTab('setup')}
                >Setup</button>
              </div>

              <div className="modal-body">
                {/* Room tab */}
                {roomTab === 'room' && (() => {
                  const gamesWonByUid = {
                    [matchData.player1Id]: matchData.player1GamesWon || 0,
                    ...(matchData.player2Id ? { [matchData.player2Id]: matchData.player2GamesWon || 0 } : {}),
                  };
                  const totalGamesWon = Object.values(gamesWonByUid).reduce((s, v) => s + v, 0);
                  return (
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

                      {/* Stats card — tap anywhere to switch session ↔ all-time */}
                      {roomPlayers.length === 2 && (() => {
                        const currentGame = {
                          p1: matchData.player1Score || 0,
                          p2: matchData.player2Score || 0,
                          w1: matchData.player1GamesWon || 0,
                          w2: matchData.player2GamesWon || 0
                        };
                        const allTime = pairStats ? (() => {
                          const p1IsFirst = pairStats.player1Id === matchData.player1Id;
                          return {
                            p1: p1IsFirst ? (pairStats.player1GamesWon || 0) : (pairStats.player2GamesWon || 0),
                            p2: p1IsFirst ? (pairStats.player2GamesWon || 0) : (pairStats.player1GamesWon || 0),
                          };
                        })() : null;

                        const isCurrent = statsView === 'current';
                        const label = isCurrent ? 'MATCH' : 'ALL-TIME';
                        const active = isCurrent ? currentGame : allTime;
                        if (!active) return null;

                        const hint = pairStats ? (isCurrent ? 'Tap for all-time' : 'Tap for match') : null;

                        const isP2 = roomPlayers[1]?.uid === user.uid;
                        const name1 = isP2 ? roomPlayers[1].username : roomPlayers[0].username;
                        const name2 = isP2 ? roomPlayers[0].username : roomPlayers[1].username;
                        const score1 = isP2 ? active.p2 : active.p1;
                        const score2 = isP2 ? active.p1 : active.p2;
                        const win1 = isP2 ? active.w2 : active.w1;
                        const win2 = isP2 ? active.w1 : active.w2;

                        return (
                          <div
                            className={`room-series${pairStats ? ' room-series-tappable' : ''}`}
                            onClick={pairStats ? () => setStatsView(v => v === 'current' ? 'alltime' : 'current') : undefined}
                            style={{ textAlign: 'center' }}
                          >
                            <div className="room-series-label" style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>
                              <span>{label}</span>
                            </div>

                            <div className="room-series-versus" style={{ marginBottom: hint ? '0.5rem' : 0 }}>
                              <span className="room-series-name">{name1}</span>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <span className="room-series-score">
                                  {isCurrent ? win1 : score1}
                                  <span className="room-series-sep">–</span>
                                  {isCurrent ? win2 : score2}
                                </span>
                              </div>
                              <span className="room-series-name right">{name2}</span>
                            </div>

                            {hint && (
                              <div className="room-series-hint" style={{ opacity: 0.4 }}>
                                {hint}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* Invite tab */}
                {roomTab === 'invite' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="settings-group" style={{ marginBottom: 0 }}>
                      <label className="settings-label">Room Visibility</label>
                      <div className="game-tabs" style={{ marginBottom: 0 }}>
                        <button
                          className={`game-tab${matchData.isPublic ? '' : ' game-tab-active'}`}
                          onClick={() => updateRoomSetting('isPublic', false)}
                          disabled={user.uid !== matchData.player1Id}
                        >Private</button>
                        <button
                          className={`game-tab${matchData.isPublic ? ' game-tab-active' : ''}`}
                          onClick={() => updateRoomSetting('isPublic', true)}
                          disabled={user.uid !== matchData.player1Id}
                        >Public</button>
                      </div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem', textAlign: 'center' }}>
                        {matchData.isPublic
                          ? 'Anyone can join.'
                          : 'Only people with the room code can join.'}
                      </p>
                    </div>

                    <div className="settings-group" style={{ marginBottom: 0 }}>
                      <label className="settings-label">Room Code</label>
                      <div
                        className="room-code-section copyable"
                        onClick={copyRoomCode}
                        style={{ padding: '0.75rem', marginBottom: 0 }}
                      >
                        <div className="code" style={{ fontSize: '1.75rem' }}>{matchData.roomCode}</div>
                        <div className={`room-code-hint${copiedCode ? ' copied' : ''}`}>
                          {copiedCode ? '✓ Copied!' : 'Tap to copy'}
                        </div>
                      </div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem', textAlign: 'center' }}>
                        Share this code with a friend to invite them to your room.
                      </p>
                    </div>
                  </div>
                )}

                {/* Setup tab */}
                {roomTab === 'setup' && (
                  <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                    <div className="settings-group" style={{ marginBottom: 0 }}>
                      <label className="settings-label">Letter Selection</label>
                      <div className="game-tabs" style={{ marginBottom: 0 }}>
                        <button
                          className={`game-tab${matchData.letterMode === 'system' ? ' game-tab-active' : ''}`}
                          onClick={() => updateRoomSetting('letterMode', 'system')}
                          disabled={user.uid !== matchData.player1Id}
                        >System</button>
                        <button
                          className={`game-tab${matchData.letterMode === 'players' ? ' game-tab-active' : ''}`}
                          onClick={() => updateRoomSetting('letterMode', 'players')}
                          disabled={user.uid !== matchData.player1Id}
                        >Players</button>
                      </div>
                    </div>

                    <div className="settings-group" style={{ marginBottom: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <label className="settings-label" style={{ marginBottom: 0 }}>Min Length</label>
                        <div style={{
                          background: 'var(--glow-color)',
                          color: '#000',
                          fontWeight: 800,
                          fontSize: '1.1rem',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '8px',
                          minWidth: '40px',
                          textAlign: 'center'
                        }}>
                          {matchData.minWordLength || 3}
                        </div>
                      </div>
                      <div style={{ position: 'relative', padding: '0.25rem 0' }}>
                        <input
                          type="range"
                          className="custom-range"
                          min="3"
                          max="10"
                          value={matchData.minWordLength || 3}
                          onChange={(e) => updateRoomSetting('minWordLength', parseInt(e.target.value))}
                          disabled={user.uid !== matchData.player1Id}
                          style={{
                            width: '100%',
                            height: '16px',
                            background: `linear-gradient(to right, var(--glow-color) ${((matchData.minWordLength || 3) - 3) / 7 * 100}%, rgba(255,255,255,0.15) ${((matchData.minWordLength || 3) - 3) / 7 * 100}%)`,
                            borderRadius: '8px',
                            accentColor: 'transparent',
                            cursor: user.uid !== matchData.player1Id ? 'not-allowed' : 'pointer',
                            appearance: 'none',
                            WebkitAppearance: 'none'
                          }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>3</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>10</span>
                        </div>
                      </div>
                    </div>

                    <div className="settings-group" style={{ marginBottom: 0 }}>
                      <label className="settings-label">Target Points</label>
                      <div className="game-tabs" style={{ marginBottom: 0 }}>
                        {[1, 3, 5, 10, 20].map(n => (
                          <button
                            key={n}
                            className={`game-tab${(matchData.winTarget || 5) === n ? ' game-tab-active' : ''}`}
                            onClick={() => updateRoomSetting('winTarget', n)}
                            disabled={user.uid !== matchData.player1Id}
                          >{n}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

              </div>
              <div className="modal-footer">
                <button className="secondary btn-responsive" onClick={cancelRoom}>
                  Leave Room
                </button>
                {user.uid === matchData.player1Id ? (
                  <button
                    className="primary btn-responsive"
                    onClick={startGame}
                    disabled={roomPlayers.length < 2}
                  >
                    Start Game
                  </button>
                ) : (
                  <div className="btn-responsive" style={{ 
                    background: 'rgba(56, 189, 248, 0.05)', 
                    border: '1px solid rgba(56, 189, 248, 0.15)', 
                    borderRadius: '12px', 
                    color: 'var(--text-muted)', 
                    fontWeight: 600, 
                    padding: '0.75rem 0.5rem', 
                    textAlign: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '44px'
                  }}>
                    Waiting for host...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}


      {showJoinModal && createPortal(
        <div className="popup-overlay" onClick={() => { setShowJoinModal(false); setJoinCodeInput(''); setJoinError(null); }}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ color: 'var(--glow-color)', marginBottom: '1.5rem', marginTop: 0 }}>
              Join by Code
            </h2>
            <div className="modal-body">
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
            </div>
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
        </div>,
        document.body
      )}

      {showLinkModal && createPortal(
        <LinkAccount
          username={profile?.username || 'Guest'}
          onClose={() => setShowLinkModal(false)}
        />,
        document.body
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
        <div className="glass-separator" style={{ margin: '0.5rem 0 1rem 0' }} />

        {/* Utility Dock (Tutorial & Settings) */}
        <div className="util-opt3-pill">
          <button className="util-opt3-btn" onClick={() => { setTutorialMode(mode); setShowRules(true); }} title="Tutorial">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </button>
          <button className="util-opt3-btn" onClick={() => setShowStats(true)} title="Stats">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          </button>
          <button className="util-opt3-btn" title="Word Bank" onClick={() => setShowWordBank(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
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
