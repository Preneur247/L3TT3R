import { useEffect, useState } from 'react';
import { auth, db, firestore } from './firebase';
import { isSignInWithEmailLink, signInWithEmailLink, EmailAuthProvider, linkWithCredential } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
    const handleAuth = async () => {
      // Handle magic link redirect when user clicks link from email
      if (isSignInWithEmailLink(auth, window.location.href)) {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
          email = window.prompt('Please provide your email for confirmation');
        }

        if (email) {
          try {
            await auth.authStateReady();
            const pendingLinkUid = window.localStorage.getItem('pendingLinkUid');

            // Step 1: get a finalUser — prefer linking to the anonymous account so the
            // UID stays the same; fall back to a plain email sign-in if that isn't possible.
            let finalUser;
            if (auth.currentUser && auth.currentUser.isAnonymous) {
              try {
                const credential = EmailAuthProvider.credentialWithLink(email, window.location.href);
                const usercred = await linkWithCredential(auth.currentUser, credential);
                finalUser = usercred.user;
              } catch (linkErr) {
                // Linking failed (e.g. email already used by another account).
                // Fall back to a plain email sign-in — the UID will differ.
                console.warn('linkWithCredential failed, falling back to signInWithEmailLink:', linkErr.code);
                const result = await signInWithEmailLink(auth, email, window.location.href);
                finalUser = result.user;
              }
            } else {
              // No anonymous session (different device / browser / session cleared).
              const result = await signInWithEmailLink(auth, email, window.location.href);
              finalUser = result.user;
            }

            window.localStorage.removeItem('emailForSignIn');
            window.localStorage.removeItem('pendingLinkUid');
            window.history.replaceState(null, '', window.location.pathname);
            setUser(finalUser);

            // Step 2: find the profile.
            // If the UID didn't change (linkWithCredential path) it's at finalUser.uid.
            // If the UID changed (signInWithEmailLink path) it's still at pendingLinkUid —
            // copy it over so the new UID has a profile.
            const profileSnap = await getDoc(doc(firestore, 'users', finalUser.uid));
            if (profileSnap.exists()) {
              setProfile(profileSnap.data());
              setAuthState('ready');
            } else if (pendingLinkUid && pendingLinkUid !== finalUser.uid) {
              const anonSnap = await getDoc(doc(firestore, 'users', pendingLinkUid));
              if (anonSnap.exists()) {
                const profileData = anonSnap.data();
                await setDoc(doc(firestore, 'users', finalUser.uid), profileData);
                setProfile(profileData);
                setAuthState('ready');
              } else {
                setAuthState('onboarding');
              }
            } else {
              setAuthState('onboarding');
            }

          } catch (error) {
            console.error('Email link auth error:', error.code, error.message);
            setAuthState('onboarding');
          }
        } else {
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
