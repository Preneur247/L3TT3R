import { useState } from 'react';
import { sendSignInLinkToEmail } from 'firebase/auth';
import { auth } from '../firebase';

export default function LinkAccount({ onClose, username }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      window.localStorage.setItem('emailForSignIn', email);

      const continueUrl = `${window.location.origin}?email=${encodeURIComponent(email)}&username=${encodeURIComponent(username)}`;

      await sendSignInLinkToEmail(auth, email, {
        url: continueUrl,
        handleCodeInApp: true,
      });
      setSent(true);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to send link.');
    }
    setLoading(false);
  };

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div className="rules-modal" onClick={e => e.stopPropagation()}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--glow-color)', marginBottom: '1rem', marginTop: 0 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          Link Email
        </h2>
        
        {sent ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ color: 'var(--glow-success)', marginBottom: '1rem' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            </div>
            <p style={{ color: 'var(--text-main)', fontSize: '1.1rem' }}>Link sent!</p>
            <p style={{ color: 'var(--text-muted)' }}>Check your inbox (and spam folder) for the login link. You can close this tab safely.</p>
            <div style={{ marginTop: '2rem' }}>
              <button className="primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.5, textAlign: 'justify' }}>
              By linking an email address, your profile and stats will be securely backed up. You can log into this account from any device.
            </p>

            <form onSubmit={handleSubmit}>
              <div className="settings-group">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setError(null); setEmail(e.target.value); }}
                  placeholder="email@example.com"
                  autoFocus
                  style={{ 
                    width: '100%', 
                    padding: '0.9rem 1rem', 
                    fontSize: '1rem', 
                    textAlign: 'center', 
                    background: 'rgba(255, 255, 255, 0.06)', 
                    border: '1px solid rgba(255, 255, 255, 0.12)', 
                    borderRadius: '14px', 
                    color: 'var(--text-main)', 
                    outline: 'none', 
                    boxSizing: 'border-box' 
                  }}
                />
              </div>

              {error && <div className="error-message" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button type="button" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="primary" style={{ flex: 1 }} disabled={loading || !email}>
                  {loading ? <span className="spinner" /> : 'Send Link'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
