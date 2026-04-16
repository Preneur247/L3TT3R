import { createPortal } from 'react-dom';

/**
 * ResultOverlay
 * A unified component for displaying round results and game over states.
 * 
 * @param {boolean} isOpen - Whether the overlay is visible
 * @param {boolean} isWinner - Whether the current user is the winner
 * @param {boolean} isDraw - Whether the round was a draw
 * @param {string} reason - The reason for the result ('correct', 'timeout', 'pass')
 * @param {string} word - The word that won the round (optional)
 * @param {string} translation - The translation of the winning word (optional)
 * @param {string} title - Custom title (e.g., 'VICTORY', 'DEFEAT', 'You Won!')
 * @param {React.ReactNode} scoreDisplay - Custom score display (e.g., "Games 5 : 2")
 * @param {Array} actions - Array of { label, onClick, isPrimary } objects
 */
export default function ResultOverlay({
  isOpen,
  isWinner,
  isDraw,
  reason,
  word,
  translation,
  title,
  scoreDisplay,
  actions = []
}) {
  if (!isOpen) return null;

  const getResultClass = () => {
    if (isDraw) return 'draw';
    return isWinner ? 'win' : 'loss';
  };

  const getPopupClass = () => {
    if (isDraw) return '';
    return isWinner ? '' : 'loss';
  };

  return createPortal(
    <div className="popup-overlay">
      <div className={`translation-popup ${getPopupClass()}`}>
        <div className={`popup-title ${getResultClass()}`}>
          {title}
        </div>

        {word && (
          <div className="word-block">
            <div className="word">{word}</div>
            <div className="chinese">
              {translation ? (
                translation
              ) : (
                <span className="translation-loading">
                  <span className="spinner" /> Translating...
                </span>
              )}
            </div>
          </div>
        )}

        {scoreDisplay && (
          <div className="popup-score">
            {scoreDisplay}
          </div>
        )}

        <div className={actions.length > 2 ? 'popup-actions-vertical' : 'popup-actions'}>
          {actions.map((action, idx) => (
            <button
              key={idx}
              className={action.isPrimary ? 'primary' : ''}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
