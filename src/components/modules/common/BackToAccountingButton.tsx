import React from 'react';

/**
 * BackToAccountingButton
 * A consistent, accessible back button that navigates to the Accounting module.
 * - Top-left positioning via `.acct-back-btn`
 * - Uses `.acct-btn` styling for consistency with other navigation elements
 * - Updates URL (`module=accounting`) and dispatches global navigation event
 */
const BackToAccountingButton: React.FC<{ label?: string; className?: string }> = ({ label = 'Back to Accounting', className = '' }) => {
  const navigate = React.useCallback(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('module', 'accounting');
      url.searchParams.set('noRedirectToast', '1');
      window.history.pushState({}, '', url.toString());
    } catch {}
    const event = new CustomEvent('navigateToModule', { detail: { module: 'accounting' } });
    window.dispatchEvent(event);
  }, []);

  const onKeyDown: React.KeyboardEventHandler<HTMLButtonElement> = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate();
    }
  };

  return (
    <div className={`acct-back-btn ${className}`.trim()}>
      <button
        type="button"
        className="acct-btn"
        aria-label="Back to Accounting"
        title={label}
        onClick={navigate}
        onKeyDown={onKeyDown}
      >
        ← {label}
      </button>
    </div>
  );
};

export default BackToAccountingButton;

