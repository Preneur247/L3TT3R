import { useState } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import { signInAnonymously, sendSignInLinkToEmail, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { auth, firestore } from '../firebase';

const APP_VERSION = '0.0.2';

const inputStyle = {
  width: '100%',
  padding: '0.9rem 1rem',
  fontSize: '1.1rem',
  textAlign: 'center',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '14px',
  color: 'var(--text-main)',
  outline: 'none',
  boxSizing: 'border-box',
  letterSpacing: '0.03em',
  transition: 'border-color 0.2s',
  textTransform: 'uppercase',
};

// Atomically signs in and claims the username. Throws if the name is taken.
async function claimAndRegister(cleanName) {
  await setPersistence(auth, browserLocalPersistence);
  const { user } = await signInAnonymously(auth);
  const username = cleanName.toUpperCase();

  const claimRef = doc(firestore, 'claimed_usernames', cleanName);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(claimRef);
    if (snap.exists()) {
      throw new Error('That username is already taken. Try a different one.');
    }
    tx.set(claimRef, { uid: user.uid });
    tx.set(doc(firestore, 'users', user.uid), {
      username,
      stats: { wins: 0, gamesPlayed: 0 },
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
  const [language, setLanguage] = useState('en');

  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const nameValid = cleanName.length >= 3 && cleanName.length <= 12;

  const go = (s) => { setError(null); setStep(s); };

  const defaultProfile = (username) => ({
    username,
    stats: { wins: 0, gamesPlayed: 0 },
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
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 'min-content' }}>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>

          <div style={{ textAlign: 'center' }}>
            <h1 style={{ margin: 0, marginBottom: '0.3rem' }}>L3TT3R</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Two letters. One winner.</div>
          </div>

          {/* ── Welcome ─────────────────────────────────────────────────── */}
          {step === 'welcome' && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="primary" style={{ width: '100%' }} onClick={() => go('name')}>
                Play
              </button>
              <button style={{ width: '100%' }} onClick={() => go('login')}>
                Sign In
              </button>
            </div>
          )}

          {/* ── Login: email input ──────────────────────────────────────── */}
          {step === 'login' && (
            <form onSubmit={handleLoginSend} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <button type="button" onClick={() => go('welcome')} className="back-nav-btn">‹</button>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>Sign in</span>
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => { setError(null); setEmail(e.target.value); }}
                placeholder="email@example.com"
                autoFocus
                style={{ ...inputStyle, fontSize: '1rem', textTransform: 'none' }}
              />
              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                We'll send a one-tap sign-in link to your email.
              </div>
              {error && <div className="error-message" style={{ textAlign: 'center', fontSize: '0.85rem' }}>{error}</div>}
              <button type="submit" className="primary" style={{ width: '100%' }} disabled={loading || !email}>
                {loading ? <span className="spinner" /> : 'Send Sign-in Link'}
              </button>
            </form>
          )}

          {/* ── Play: enter name ────────────────────────────────────────── */}
          {step === 'name' && (
            <form onSubmit={handleContinue} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <button type="button" onClick={() => go('welcome')} className="back-nav-btn">‹</button>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>Choose a username</span>
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => { setError(null); setName(e.target.value); }}
                placeholder=""
                maxLength={12}
                autoFocus
                style={inputStyle}
              />
              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Letters and numbers only, 3–12 characters
              </div>
              {error && <div className="error-message" style={{ textAlign: 'center', fontSize: '0.85rem' }}>{error}</div>}
              <button type="submit" className="primary" style={{ width: '100%' }} disabled={!nameValid || loading}>
                {loading ? <span className="spinner" /> : 'Continue'}
              </button>
            </form>
          )}

          {/* ── Play: backup prompt ─────────────────────────────────────── */}
          {step === 'prompt' && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem', alignItems: 'stretch' }}>
              <div style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '18px',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.75rem',
                textAlign: 'center',
                width: '100%',
                boxSizing: 'border-box'
              }}>
                <div style={{ fontSize: '2.5rem' }}>🔒</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                  Back up your account
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, textAlign: 'justify' }}>
                  Your account is saved on this browser only. If you clear your cache or switch devices, you'll lose all your account data.
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, textAlign: 'justify' }}>
                  Link an email to secure your account and restore it from any device.
                </div>
              </div>
              {error && <div className="error-message" style={{ textAlign: 'center', fontSize: '0.85rem' }}>{error}</div>}
              <div style={{ display: 'flex', gap: '0.75rem', width: '100%', boxSizing: 'border-box' }}>
                <button style={{ flex: 1, whiteSpace: 'nowrap', boxSizing: 'border-box', padding: '0.75rem 0' }} onClick={handleSkip} disabled={loading}>
                  Skip for now
                </button>
                <button className="primary" style={{ flex: 1, whiteSpace: 'nowrap', boxSizing: 'border-box', padding: '0.75rem 0' }} onClick={() => go('link')} disabled={loading}>
                  Link Account
                </button>
              </div>
            </div>
          )}

          {/* ── Play: enter email to link ───────────────────────────────── */}
          {step === 'link' && (
            <form onSubmit={handleSendLink} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <button type="button" onClick={() => go('prompt')} className="back-nav-btn">‹</button>
                <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>Link your email</span>
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => { setError(null); setEmail(e.target.value); }}
                placeholder="email@example.com"
                autoFocus
                style={{ ...inputStyle, fontSize: '1rem', textTransform: 'none' }}
              />
              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                We'll send a one-tap magic link — no password needed.
              </div>
              {error && <div className="error-message" style={{ textAlign: 'center', fontSize: '0.85rem' }}>{error}</div>}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" style={{ flex: 1 }} onClick={() => go('prompt')} disabled={loading}>Back</button>
                <button type="submit" className="primary" style={{ flex: 2 }} disabled={loading || !email}>
                  {loading ? <span className="spinner" /> : 'Send Link'}
                </button>
              </div>
            </form>
          )}

          {/* ── Sent: check your email ──────────────────────────────────── */}
          {step === 'sent' && (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '18px',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.75rem',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '2.5rem' }}>✉️</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                  Check your email
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, textAlign: 'center' }}>
                  A sign-in link was sent to<br />
                  <strong style={{ color: 'var(--text-main)' }}>{email}</strong>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, textAlign: 'justify' }}>
                  {sentMode === 'login'
                    ? 'Click the link in the email to sign in to your account.'
                    : 'Click the link in your inbox to link your account. Check your spam folder if needed.'}
                </div>
              </div>
              {/* Only the Play Link flow has an escape hatch */}
              {sentMode === 'link' && pendingAuth && (
                <button
                  onClick={() => {
                    window.localStorage.removeItem('pendingLinkUid');
                    onAuthComplete(pendingAuth.user, pendingAuth.profileData);
                  }}
                  style={{ width: '100%' }}
                >
                  Enter without linking
                </button>
              )}
            </div>
          )}

          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '1rem' }}>
            <div className="util-opt3-pill" style={{ position: 'relative', bottom: 'auto', left: 'auto', transform: 'none' }}>
              <button className="util-opt3-btn" onClick={() => setShowSettings(true)} title="Settings">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <span className="version-text" style={{ position: 'static', opacity: 0.3, fontSize: '0.75rem' }}>v{APP_VERSION}</span>
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
            <div className="settings-group">
              <label className="settings-label">App Interface</label>
              <select className="glass-select" value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="zh-TW">繁體中文</option>
              </select>
            </div>
            <div className="settings-group">
              <label className="settings-label">Word Translation</label>
              <select className="glass-select" value="zh-TW" disabled>
                <option value="zh-TW">繁體中文</option>
              </select>
            </div>
            <div style={{ textAlign: 'center', marginTop: '2.5rem' }}>
              <button className="primary" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
