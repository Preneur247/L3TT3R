import { useState } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { signInAnonymously, sendSignInLinkToEmail, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { auth, firestore } from '../firebase';

// Using global __APP_VERSION__ from vite.config.js


// Atomically signs in and claims the username. Throws if the name is taken.
async function claimAndRegister(cleanName) {
  await setPersistence(auth, browserLocalPersistence);
  const { user } = await signInAnonymously(auth);
  const username = cleanName.trim();

  const claimRef = doc(firestore, 'claimed_usernames', cleanName);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(claimRef);
    if (snap.exists()) {
      throw new Error('That username is already taken. Try a different one.');
    }
    tx.set(claimRef, { uid: user.uid });
    tx.set(doc(firestore, 'users', user.uid), {
      username,
      stats: {
        total: { gamesPlayed: 0, gamesWon: 0, wordsFormed: 0 },
        party: { bestStreak: 0, currentStreak: 0, gamesPlayed: 0, gamesWon: 0, wordsFormed: 0 },
        solo: { bestStreak: 0, currentStreak: 0, gamesPlayed: 0, gamesWon: 0, wordsFormed: 0 },
        versus: { bestStreak: 0, currentStreak: 0, gamesPlayed: 0, gamesWon: 0, wordsFormed: 0 }
      },
      settings: { appInterfaceLang: 'en', wordTranslationLang: 'zh-TW' },
      createdAt: Date.now(),
    });
  });

  return { user, username };
}



export default function SetupProfile({ onAuthComplete }) {
  // steps: 'welcome' | 'login' | 'name' | 'prompt' | 'link' | 'sent'
  const [step, setStep] = useState('welcome');
  // sentMode: 'login' (returning user) | 'link' (new user linking account)
  const [sentMode, setSentMode] = useState(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [claimedAuth, setClaimedAuth] = useState(null); // { user, username } set after Continue
  const [pendingAuth, setPendingAuth] = useState(null); // { user, profileData }

  const [showSettings, setShowSettings] = useState(false);


  const cleanName = name.trim().replace(/[^a-zA-Z0-9]/g, '');
  const nameValid = cleanName.length >= 3 && cleanName.length <= 12;

  const go = (s) => { setError(null); setStep(s); };

  const defaultProfile = (username) => ({
    username,
    stats: {
      gamesWon: 0,
      gamesPlayed: 0,
      wordsFormed: 0,
      currentStreak: 0,
      bestStreak: 0
    },
    words: {},
    settings: { appInterfaceLang: 'en', wordTranslationLang: 'zh-TW' },
  });

  // ── Play path helpers ──────────────────────────────────────────────────────

  // Signs in + atomically claims the name; advances to backup prompt on success.
  const handleContinue = async (e) => {
    e?.preventDefault();
    if (!nameValid) { setError('Name must be 3–12 letters or numbers.'); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await claimAndRegister(cleanName);
      setClaimedAuth(result);
      go('prompt');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Could not register username. Please try again.');
    }
    setLoading(false);
  };

  const handleSkip = () => {
    onAuthComplete(claimedAuth.user, defaultProfile(claimedAuth.username));
  };

  // Send link for Play Link Account flow
  const handleSendLink = async (e) => {
    e?.preventDefault();
    if (!email || !email.includes('@')) { setError('Please enter a valid email.'); return; }
    setLoading(true);
    setError(null);
    try {
      window.localStorage.setItem('emailForSignIn', email);

      // Embed email + username in the magic link URL so Device B can restore the account
      const continueUrl = `${window.location.origin}?email=${encodeURIComponent(email)}&username=${encodeURIComponent(claimedAuth.username)}`;

      await sendSignInLinkToEmail(auth, email, {
        url: continueUrl,
        handleCodeInApp: true,
      });
      setPendingAuth({ user: claimedAuth.user, profileData: defaultProfile(claimedAuth.username) });
      setSentMode('link');
      setStep('sent');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to send. Try again.');
    }
    setLoading(false);
  };

  // ── Login path helper ──────────────────────────────────────────────────────

  // Send link for Login flow — no anonymous sign-in, no name claim
  const handleLoginSend = async (e) => {
    e?.preventDefault();
    if (!email || !email.includes('@')) { setError('Please enter a valid email.'); return; }
    setLoading(true);
    setError(null);
    try {
      window.localStorage.setItem('emailForSignIn', email);
      await sendSignInLinkToEmail(auth, email, {
        url: `${window.location.origin}?email=${encodeURIComponent(email)}`,
        handleCodeInApp: true,
      });
      setSentMode('login');
      setStep('sent');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to send. Try again.');
    }
    setLoading(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="glass-card">
        <div className="card-stack">

          <div style={{ textAlign: 'center' }}>
            <h1 style={{ margin: 0, marginBottom: '0.3rem' }}>L3TT3R</h1>
            <div className="version-text">Two letters. One winner.</div>
          </div>

          {/* ── Welcome ─────────────────────────────────────────────────── */}
          {step === 'welcome' && (
            <div className="card-stack" style={{ gap: '0.75rem' }}>
              <button className="primary full-width" onClick={() => go('name')}>
                Play
              </button>
              <button className="full-width" onClick={() => go('login')}>
                Sign In
              </button>
            </div>
          )}

          {/* ── Login: email input ──────────────────────────────────────── */}
          {step === 'login' && (
            <form onSubmit={handleLoginSend} className="card-stack" style={{ gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <button type="button" onClick={() => go('welcome')} className="back-nav-btn">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>Sign in</span>
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => { setError(null); setEmail(e.target.value); }}
                placeholder="email@example.com"
                autoFocus
                className="glass-input no-transform"
              />
              <div className="info-text" style={{ textAlign: 'center' }}>
                We'll email you a one-tap link.
              </div>
              {error && <div className="error-message">{error}</div>}
              <button type="submit" className="primary full-width" disabled={loading || !email}>
                {loading ? <span className="spinner" /> : 'Send Sign-in Link'}
              </button>
            </form>
          )}

          {/* ── Play: enter name ────────────────────────────────────────── */}
          {step === 'name' && (
            <form onSubmit={handleContinue} className="card-stack" style={{ gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <button type="button" onClick={() => go('welcome')} className="back-nav-btn">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>Choose a username</span>
              </div>
              <input
                type="text"
                className="glass-input"
                value={name}
                onChange={(e) => {
                  setError(null);
                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  setName(val);
                }}
                placeholder=""
                maxLength={12}
                autoFocus
              />
              <div className="info-text" style={{ textAlign: 'center' }}>
                Letters and numbers only, 3–12 characters
              </div>
              {error && <div className="error-message">{error}</div>}
              <button type="submit" className="primary full-width" disabled={!nameValid || loading}>
                {loading ? <span className="spinner" /> : 'Continue'}
              </button>
            </form>
          )}

          {/* ── Play: backup prompt ─────────────────────────────────────── */}
          {step === 'prompt' && (
            <div className="card-stack">
              <div className="prompt-card">
                <div className="icon-large">🔒</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                  Back up your account
                </div>
                <div className="info-text" style={{ textAlign: 'justify' }}>
                  Your account is saved on this browser only. If you clear your cache or switch devices, you'll lose all your account data.
                </div>
                <div className="info-text" style={{ textAlign: 'justify' }}>
                  Link an email to secure your account and restore it from any device.
                </div>
              </div>
              {error && <div className="error-message">{error}</div>}
              <div className="modal-footer" style={{ border: 'none', padding: 0 }}>
                <button type="button" className="btn-responsive" onClick={handleSkip} disabled={loading}>
                  Skip for Now
                </button>
                <button type="button" className="primary btn-responsive" onClick={() => go('link')} disabled={loading}>
                  Link Account
                </button>
              </div>
            </div>
          )}

          {/* ── Play: enter email to link ───────────────────────────────── */}
          {step === 'link' && (
            <form onSubmit={handleSendLink} className="card-stack" style={{ gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <button type="button" onClick={() => go('prompt')} className="back-nav-btn">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>Link your email</span>
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => { setError(null); setEmail(e.target.value); }}
                placeholder="email@example.com"
                autoFocus
                className="glass-input no-transform"
              />
              <div className="info-text" style={{ textAlign: 'center' }}>
                We'll email you a one-tap link.
              </div>
              {error && <div className="error-message">{error}</div>}
              <div className="modal-footer" style={{ border: 'none', padding: 0 }}>
                <button type="button" className="btn-responsive" onClick={() => go('prompt')} disabled={loading}>Back</button>
                <button type="submit" className="primary btn-responsive" style={{ flex: 1.5 }} disabled={loading || !email}>
                  {loading ? <span className="spinner" /> : 'Send Link'}
                </button>
              </div>
            </form>
          )}

          {/* ── Sent: check your email ──────────────────────────────────── */}
          {step === 'sent' && (
            <div className="card-stack">
              <div className="prompt-card">
                <div className="icon-large">✉️</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                  Check your email
                </div>
                <div className="info-text" style={{ textAlign: 'center' }}>
                  A sign-in link was sent to<br />
                  <strong style={{ color: 'var(--text-main)' }}>{email}</strong>
                </div>
                <div className="info-text" style={{ textAlign: 'justify' }}>
                  {sentMode === 'login'
                    ? 'Click the link in the email to sign in to your account.'
                    : 'Click the link in your inbox to link your account. Check your spam folder if needed.'}
                </div>
              </div>
              {/* Only the Play Link flow has an escape hatch */}
              {sentMode === 'link' && pendingAuth && (
                <button
                  type="button"
                  onClick={() => {
                    window.localStorage.removeItem('pendingLinkUid');
                    onAuthComplete(pendingAuth.user, pendingAuth.profileData);
                  }}
                  className="btn-responsive full-width"
                >
                  Enter without linking
                </button>
              )}
            </div>
          )}

          {/* Match Lobby spacing exactly (2.0rem from button content to line) */}
          <div className="glass-separator" style={{ margin: '0.5rem 0 1rem 0' }} />

          <div className="card-stack" style={{ gap: '0.75rem', alignItems: 'center', marginTop: '-0.5rem' }}>
            <div className="util-opt3-pill" style={{ margin: 0 }}>
              <button className="util-opt3-btn" onClick={() => setShowSettings(true)} title="Settings">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <span className="version-text" style={{ position: 'static', opacity: 0.3, fontSize: '0.75rem' }}>
                v{__APP_VERSION__}
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="popup-overlay" onClick={() => setShowSettings(false)}>
          <div className="rules-modal" onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '2rem', marginTop: 0 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </h2>
            <div className="modal-body">
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
        </div>
      )}
    </>
  );
}
