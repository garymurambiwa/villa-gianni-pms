import React from 'react';
import { useToast } from '@/components/ui/use-toast';
import JournalPostingModal from '@/components/modules/JournalPostingModal';
import '@/styles/accounting-module.css';

// Accounting DOM Module implemented with IIFE for namespace isolation
const accountingModule = (() => {
  type Deps = {
    container: HTMLElement;
    onOpenJournal: () => void;
    toast: (opts: { title?: string; description?: string }) => void;
  };

  const handler = (e: Event) => {
    const target = e.target as HTMLElement;
    // Walk up to the button with data-action
    const btn = target?.closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const url = new URL(window.location.href);
    try {
      switch (action) {
        case 'cityledger': {
          window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'cityledger' } } as any));
          break;
        }
        case 'ap': {
          window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'ap' } } as any));
          break;
        }
        case 'journal': {
          // Open Daily Journal modal
          deps?.onOpenJournal();
          break;
        }
        case 'night-audit': {
          // Navigate to Reports focused on Night Audit
          url.searchParams.set('module', 'reports');
          url.searchParams.set('report', 'night-audit');
          window.history.pushState({}, '', url.toString());
          window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'reports' } } as any));
          break;
        }
        case 'reconciliation': {
          // Navigate to Transaction Clearing Admin
          window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'tx-clearing' } } as any));
          break;
        }
        case 'gl': {
          // Navigate to Reports focused on GL Accounting
          url.searchParams.set('module', 'reports');
          url.searchParams.set('report', 'gl');
          window.history.pushState({}, '', url.toString());
          window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'reports' } } as any));
          break;
        }
        case 'tax-config': {
          window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'accounting-tax' } } as any));
          break;
        }
        case 'inventory-recon': {
          window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'inventory-recon' } } as any));
          break;
        }
        case 'vendors': {
          window.dispatchEvent(new CustomEvent('navigateToModule', { detail: { module: 'vendor-management' } } as any));
          break;
        }
        default: {
          deps?.toast({ title: 'Unknown action', description: String(action || '') });
        }
      }
    } catch (err) {
      deps?.toast({ title: 'Accounting action failed', description: (err as Error)?.message || 'Unknown error' });
    }
  };

  let deps: Deps | null = null;
  const init = (d: Deps) => {
    deps = d;
    deps.container.addEventListener('click', handler);
  };
  const teardown = () => {
    if (deps?.container) deps.container.removeEventListener('click', handler);
    deps = null;
  };
  return { init, teardown };
})();

const AccountingDom: React.FC = () => {
  const { toast } = useToast();
  const [journalOpen, setJournalOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    accountingModule.init({
      container,
      onOpenJournal: () => setJournalOpen(true),
      toast: ({ title, description }) => toast({ title, description }),
    });
    return () => accountingModule.teardown();
  }, [toast]);

  return (
    <section className="accounting-module p-6">
      <header className="mb-4">
        <h2 className="text-2xl font-bold text-accounting">Accounting</h2>
        <p className="text-sm text-gray-600">Consolidated accounting operations</p>
      </header>
      <div ref={containerRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Original buttons, converted to semantic <button> */}
        <button type="button" data-action="cityledger" className="acct-btn" aria-label="City Ledger"><span className="mr-2">💼</span>City Ledger</button>
        <button type="button" data-action="ap" className="acct-btn" aria-label="AP & Expenses"><span className="mr-2">🧾</span>AP &amp; Expenses</button>
        <button type="button" data-action="journal" className="acct-btn" aria-label="Daily Journal"><span className="mr-2">📓</span>Daily Journal</button>

        {/* New functional buttons */}
        <button type="button" data-action="vendors" className="acct-btn" aria-label="Vendors"><span className="mr-2">🏢</span>Vendors</button>
        <button type="button" data-action="night-audit" className="acct-btn" aria-label="Night Audit"><span className="mr-2">🌙</span>Night Audit</button>
        <button type="button" data-action="reconciliation" className="acct-btn" aria-label="Reconciliation"><span className="mr-2">🤝</span>Reconciliation</button>
        <button type="button" data-action="gl" className="acct-btn" aria-label="GL Accounting"><span className="mr-2">📘</span>Accounting Utility (GL)</button>
        <button type="button" data-action="tax-config" className="acct-btn" aria-label="Tax Configuration"><span className="mr-2">🧮</span>Tax Configuration</button>
        <button type="button" data-action="inventory-recon" className="acct-btn" aria-label="Inventory Reconciliation"><span className="mr-2">📦</span>Inventory Reconciliation</button>
      </div>

      {/* Daily Journal modal identical operation */}
      <JournalPostingModal open={journalOpen} onOpenChange={setJournalOpen} />
    </section>
  );
};

export default AccountingDom;
