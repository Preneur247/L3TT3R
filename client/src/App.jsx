import { useEffect, useState, useRef } from 'react';
import { auth, db, firestore } from './firebase';
import { isSignInWithEmailLink, signInWithEmailLink, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch, increment, onSnapshot } from 'firebase/firestore';
import { ref, onValue, update } from 'firebase/database';
import Lobby from './components/Lobby';
import GameBoard from './components/GameBoard';
import SetupProfile from './components/SetupProfile';
import ResultOverlay from './components/ResultOverlay';


function App() {
  const [user, setUser] = useState(null);
  const [gameState, setGameState] = useState('LOBBY'); // LOBBY, MATCHING, PLAYING, GAME_OVER
  const [matchData, setMatchData] = useState(null);
  const [currentMatchId, setCurrentMatchId] = useState(null);
  // Only set when the user intentionally clicks "Back to Room" — never from currentMatchId directly
  const [returnRoomMatchId, setReturnRoomMatchId] = useState(null);

  const [profile, setProfile] = useState(null);
  const statsRecordedRef = useRef(null);
  const profileUnsubRef = useRef(null);
  // null = not started, 'onboarding' = show onboarding, 'ready' = authenticated
  const [authState, setAuthState] = useState('checking');

  const checkAndSetProfile = (authUser) => {
    if (profileUnsubRef.current) profileUnsubRef.current();
    
    const docRef = doc(firestore, 'users', authUser.uid);
    profileUnsubRef.current = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data());
        setAuthState('ready');
      } else {
        // Email-linked user who has no profile yet — show guest name setup
        setUser(authUser);
        setAuthState('onboarding');
      }
    }, (err) => {
      console.error('Profile listener error:', err);
    });
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
            const cleanName = pendingUsername.trim().replace(/[^a-zA-Z0-9]/g, '');
            const claimSnap = await getDoc(doc(firestore, 'claimed_usernames', cleanName));
            if (claimSnap.exists()) {
              const originalUid = claimSnap.data().uid;
              const profileSnap = await getDoc(doc(firestore, 'users', originalUid));
              if (profileSnap.exists()) {
                const profileData = { ...profileSnap.data(), email: finalUser.email };
                await setDoc(doc(firestore, 'users', finalUser.uid), profileData);
                await setDoc(doc(firestore, 'claimed_usernames', cleanName), { 
                  uid: finalUser.uid
                }, { merge: true });
                if (originalUid !== finalUser.uid) {
                  // Migrate player_pair_stats from originalUid to finalUser.uid
                  const q1 = query(collection(firestore, 'player_pair_stats'), where('player1Id', '==', originalUid));
                  const q2 = query(collection(firestore, 'player_pair_stats'), where('player2Id', '==', originalUid));
                  const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
                  const statsDocs = [...s1.docs, ...s2.docs];
                  
                  if (statsDocs.length > 0) {
                    const batch = writeBatch(firestore);
                    for (const sDoc of statsDocs) {
                      const data = sDoc.data();
                      const otherUid = data.player1Id === originalUid ? data.player2Id : data.player1Id;
                      const sortedUids = [finalUser.uid, otherUid].sort();
                      const newPairKey = sortedUids.join('_');
                      
                      const oldUserScore = data.player1Id === originalUid ? data.player1TotalScore : data.player2TotalScore;
                      const otherUserScore = data.player1Id === originalUid ? data.player2TotalScore : data.player1TotalScore;
                      
                      batch.set(doc(firestore, 'player_pair_stats', newPairKey), {
                        player1Id: sortedUids[0],
                        player2Id: sortedUids[1],
                        player1TotalScore: increment(sortedUids[0] === finalUser.uid ? oldUserScore : otherUserScore),
                        player2TotalScore: increment(sortedUids[1] === finalUser.uid ? oldUserScore : otherUserScore),
                        gamesPlayed: increment(data.gamesPlayed)
                      }, { merge: true });
                      batch.delete(sDoc.ref);
                    }
                    await batch.commit().catch(err => console.error('Stats migration failed:', err));
                  }

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
    return () => {
      if (profileUnsubRef.current) profileUnsubRef.current();
    };
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

      if (data.winnerId) {
        setGameState('GAME_OVER');
      } else if (data.matchState === 'PICKING_LETTERS' || data.matchState === 'GUESSING' || data.matchState === 'ENDED_ROUND') {
        setGameState('PLAYING');
      } else if (data.matchState === 'ROOM_SETUP' || data.matchState === 'WAITING') {
        // These states should show the Lobby with the matching Modal open
        setGameState('LOBBY');
      } else {
        setGameState('LOBBY');
      }
    });

    return () => unsubscribe();
  }, [currentMatchId]);

  // Record game-over stats once per match
  useEffect(() => {
    if (gameState === 'GAME_OVER' && matchData?.winnerId && user?.uid && currentMatchId !== statsRecordedRef.current) {
      statsRecordedRef.current = currentMatchId;
      
      const isWinner = matchData.winnerId === user.uid;
      const mode = matchData.mode || 'versus';
      const statsRef = doc(firestore, 'users', user.uid);
      
      const updates = {
        'stats.overall.gamesPlayed': increment(1),
        [`stats.${mode}.gamesPlayed`]: increment(1),
        'stats.overall.gamesWon': increment(isWinner ? 1 : 0),
        [`stats.${mode}.gamesWon`]: increment(isWinner ? 1 : 0),
      };

      if (isWinner) {
        const modeStats = profile?.stats?.[mode] || { currentStreak: 0, bestStreak: 0 };
        const newStreak = (modeStats.currentStreak || 0) + 1;
        updates[`stats.${mode}.currentStreak`] = newStreak;
        if (newStreak > (modeStats.bestStreak || 0)) {
          updates[`stats.${mode}.bestStreak`] = newStreak;
        }
      } else {
        updates[`stats.${mode}.currentStreak`] = 0;
      }

      updateDoc(statsRef, updates).catch(err => console.error('App.jsx stats update failed:', err));
    }
  }, [gameState, matchData, currentMatchId, user?.uid, profile]);

  // Migrate legacy flat stats to new nested structure
  useEffect(() => {
    if (authState === 'ready' && profile && user?.uid && profile.stats) {
      const stats = profile.stats;
      const needsMigration = !stats.overall || stats.overall.wins !== undefined;

      if (needsMigration) {
        const migrate = async () => {
          const gamesPlayed = stats.gamesPlayed || stats.overall?.gamesPlayed || 0;
          const gamesWon = stats.wins || stats.overall?.wins || stats.overall?.gamesWon || 0;
          const wordsFormed = stats.wordsFormed || stats.overall?.wordsFormed || 0;
          const streak = stats.streak || stats.versus?.currentStreak || 0;
          const bestStreak = stats.versus?.bestStreak || streak;

          const newStats = {
            overall: { gamesPlayed, gamesWon, wordsFormed },
            versus: { gamesPlayed, gamesWon, wordsFormed, currentStreak: streak, bestStreak: bestStreak },
            solo: { gamesPlayed: 0, gamesWon: 0, wordsFormed: 0, currentStreak: 0, bestStreak: 0 },
            party: { gamesPlayed: 0, gamesWon: 0, wordsFormed: 0, currentStreak: 0, bestStreak: 0 }
          };

          try {
            const userRef = doc(firestore, 'users', user.uid);
            await setDoc(userRef, { stats: newStats }, { merge: true });
            setProfile(prev => ({ ...prev, stats: newStats }));
          } catch (err) {
            console.error('Migration failed:', err);
          }
        };
        migrate();
      }
    }
  }, [authState, profile, user?.uid]);

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
        {(gameState !== 'LOBBY' && gameState !== 'GAME_OVER') && <h1>L3TT3R</h1>}

        {(gameState === 'LOBBY' || gameState === 'GAME_OVER') && (
          <Lobby
            user={user}
            profile={profile}
            setMatchId={(mId, data) => {
              setCurrentMatchId(mId);
              if (data) {
                setMatchData(data);
                setGameState('PLAYING');
              }
            }}
            initialMatchId={returnRoomMatchId || (gameState === 'GAME_OVER' ? currentMatchId : null)}
            onRoomInitialized={() => setReturnRoomMatchId(null)}
          />
        )}

        {gameState === 'PLAYING' && matchData && (
          <GameBoard user={user} profile={profile} matchId={currentMatchId} matchData={matchData} />
        )}
      </div>

      {gameState === 'GAME_OVER' && matchData && (
        <ResultOverlay
          isOpen={true}
          isWinner={matchData.winnerId === user.uid}
          title={matchData.winnerId === user.uid ? 'VICTORY' : 'DEFEAT'}
          word={matchData.lastRoundResult?.word}
          translation={matchData.lastRoundResult?.translation}
          actions={[
            {
              label: 'Play Again',
              isPrimary: true,
              onClick: async () => {
                setReturnRoomMatchId(currentMatchId);
                const matchRef = ref(db, `matches/${currentMatchId}`);
                await update(matchRef, {
                  matchState: 'ROOM_SETUP',
                  winnerId: null,
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
              }
            },
            {
              label: 'Back to Room',
              onClick: async () => {
                setReturnRoomMatchId(currentMatchId);
                const matchRef = ref(db, `matches/${currentMatchId}`);
                await update(matchRef, {
                  matchState: 'ROOM_SETUP',
                  winnerId: null,
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
              }
            }
          ]}
        />
      )}
    </>
  );
}

export default App;
