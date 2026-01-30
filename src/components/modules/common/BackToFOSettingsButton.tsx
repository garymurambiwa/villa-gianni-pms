import React from 'react';
import { Button } from '@/components/ui/button';

/**
 * Accessible, consistent "Back to FO Settings" button.
 * - Uses semantic <button> via design system Button
 * - Updates URL and dispatches navigateToModule for routing
 * - Includes hover/focus styles and ARIA label
 */
const BackToFOSettingsButton: React.FC<{ className?: string }> = ({ className }) => {
  const goBack = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('module', 'fo-setting');
      url.searchParams.set('noRedirectToast', '1');
      window.history.pushState({}, '', url.toString());
    } catch {}
    const event = new CustomEvent('navigateToModule', { detail: { module: 'fo-setting' } });
    window.dispatchEvent(event);
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={goBack}
      aria-label="Back to FO Settings"
      title="Back to FO Settings"
      className={['inline-flex items-center gap-2 px-3 py-1 text-sm', 'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600', className || ''].join(' ')}
    >
      <span aria-hidden="true">←</span>
      <span className="font-medium">Back to FO Settings</span>
    </Button>
  );
};

export default BackToFOSettingsButton;

