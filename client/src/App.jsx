import { useEffect, useState } from 'react';
import { auth, db, firestore } from './firebase';
import { isSignInWithEmailLink, signInWithEmailLink, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { ref, onValue, set, push, onDisconnect, remove, update } from 'firebase/database';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import SetupProfile from './components/SetupProfile';

function App() {
  const [user, setUser] = useState(null);
  const [gameState, setGameState] = useState('LOBBY'); // LOBBY, MATCHING, PLAYING, GAME_OVER
  const [matchData, setMatchData] = useState(null);
  const [currentMatchId, setCurrentMatchId] = useState(null);

  const [profile, setProfile] = useState(null);
  // null = not started, 'onboarding' = show onboarding, 'ready' = authenticated
  const [authState, setAuthState] = useState('checking');

  const checkAndSetProfile = async (authUser) => {
    const docRef = doc(firestore, 'users', authUser.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      setProfile(docSnap.data());
      setAuthState('ready');
    } else {
      // Email-linked user who has no profile yet — show guest name setup
      setUser(authUser);
      setAuthState('onboarding');
    }
  };

  useEffect(() => {
    let isProcessing = false;

    const handleAuth = async () => {
      if (isProcessing) return;
      isProcessing = true;
      
      // Handle magic link redirect when user clicks link from email
      if (isSignInWithEmailLink(auth, window.location.href)) {
        // Capture URL params NOW — before anything clears the URL
        const urlParams = new URLSearchParams(window.location.search);
        const email = urlParams.get('email') || window.localStorage.getItem('emailForSignIn');
        const pendingUsername = urlParams.get('username');

        // Wait for Firebase to re-hydrate its persisted auth state from localStorage.
        // auth.currentUser is null synchronously on page load — we must await this.
        const initialUser = await new Promise(resolve => {
          const unsub = auth.onAuthStateChanged(u => { unsub(); resolve(u); });
        });

        // If the user is already fully signed in (non-anonymous) and has a profile,
        // the email link was already used — just restore the session and go to lobby.
        if (initialUser && !initialUser.isAnonymous) {
          const profileSnap = await getDoc(doc(firestore, 'users', initialUser.uid));
          if (profileSnap.exists()) {
            window.history.replaceState(null, '', window.location.pathname);
            window.localStorage.removeItem('emailForSignIn');
            setUser(initialUser);
            setProfile(profileSnap.data());
            setAuthState('ready');
            return;
          }
        }

        if (!email) {
          setAuthState('onboarding');
          return;
        }

        try {
          const currentHref = window.location.href;

          // Sign out any anonymous user and wait for the auth state to fully clear
          // before calling signInWithEmailLink. signOut() resolves before Firebase's
          // internal state machine finishes — if we call signInWithEmailLink while
          // auth.currentUser is still in memory, Firebase auto-links and throws
          // email-already-in-use (burning the OTP so any retry gets a 400).
          if (initialUser?.isAnonymous) {
            await signOut(auth);
            await new Promise(resolve => {
              if (!auth.currentUser) { resolve(); return; }
              const unsub = auth.onAuthStateChanged(u => { if (!u) { unsub(); resolve(); } });
            });
          }

          const { user: finalUser } = await signInWithEmailLink(auth, email, currentHref);

          // Clear localStorage and URL
          window.localStorage.removeItem('emailForSignIn');
          window.history.replaceState(null, '', window.location.pathname);
          setUser(finalUser);

          // Check for an existing full profile under this uid (returning user / Sign In flow)
          const existingSnap = await getDoc(doc(firestore, 'users', finalUser.uid));
          if (existingSnap.exists() && existingSnap.data().username) {
            const profileData = { ...existingSnap.data(), email: finalUser.email };
            await setDoc(doc(firestore, 'users', finalUser.uid), { email: finalUser.email }, { merge: true });
            setProfile(profileData);
            setAuthState('ready');
            return;
          }

          // Restore profile via claimed_usernames → original uid → users/{uid}
          // Covers first-time Link Account (uid changed after signOut) and cross-device
          if (pendingUsername) {
            const cleanName = pendingUsername.toLowerCase().replace(/[^a-z0-9]/g, '');
            const claimSnap = await getDoc(doc(firestore, 'claimed_usernames', cleanName));
            if (claimSnap.exists()) {
              const originalUid = claimSnap.data().uid;
              const profileSnap = await getDoc(doc(firestore, 'users', originalUid));
              if (profileSnap.exists()) {
                const profileData = { ...profileSnap.data(), email: finalUser.email };
                await setDoc(doc(firestore, 'users', finalUser.uid), profileData);
                await setDoc(doc(firestore, 'claimed_usernames', cleanName), { uid: finalUser.uid }, { merge: true });
                if (originalUid !== finalUser.uid) {
                  await deleteDoc(doc(firestore, 'users', originalUid));
                }
                setProfile(profileData);
                setAuthState('ready');
                return;
              }
            }
          }

          setAuthState('onboarding');

        } catch (error) {
          console.error('Email link auth error:', error.code, error.message);
          setAuthState('onboarding');
        }
      } else {
        // Standard flow: Check if user is already logged in via persisted session
        const unsubscribe = auth.onAuthStateChanged((authUser) => {
          if (authUser) {
            setUser(authUser);
            checkAndSetProfile(authUser);
          } else {
            // No session — show onboarding
            setAuthState('onboarding');
          }
          unsubscribe();
        });
      }
    };

    handleAuth();
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
      } else if (data.state === 'PICKING_LETTERS' || data.state === 'GUESSING' || data.state === 'ENDED_ROUND') {
        setGameState('PLAYING');
      } else {
        // WAITING, ROOM_READY, SETUP_LENGTH all stay in LOBBY view so the Modal can show over correctly
        setGameState('LOBBY');
      }
    });

    return () => unsubscribe();
  }, [currentMatchId]);

  if (authState === 'checking') {
    return <div className="glass-card"><h1>L3TT3R</h1><div className="subtitle">Connecting...</div></div>;
  }

  if (authState === 'onboarding') {
    return (
      <SetupProfile
        onAuthComplete={(authUser, profileData) => {
          setUser(authUser);
          setProfile(profileData);
          setAuthState('ready');
        }}
      />
    );
  }

  return (
    <>
      <div className="glass-card">
        {/* H1 shown for connecting, matching, and in-game states only */}
        {gameState !== 'LOBBY' && <h1>L3TT3R</h1>}

        {gameState === 'LOBBY' && (
          <Lobby user={user} profile={profile} setMatchId={setCurrentMatchId} />
        )}

        {gameState === 'PLAYING' && matchData && (
          <GameBoard user={user} profile={profile} matchId={currentMatchId} matchData={matchData} />
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
            state: 'ROOM_SETUP',
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
