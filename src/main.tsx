
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const el = document.getElementById('root')!
el.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui,Arial;">
    <div style="text-align:center">
      <div style="margin-bottom:8px">Loading Application…</div>
      <div style="width:36px;height:36px;border-radius:50%;border:4px solid #ddd;border-top-color:#4f46e5;animation:spin 1s linear infinite;margin:0 auto"></div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </div>
  </div>
`

// Wait for the main process to signal that the database is ready
if ((window as any).native) {
  // Database initialization is handled by the main process
  // We just need to wait and then render the app
  createRoot(el).render(<App />)
  
  // Listen for app close event from main process
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'app-will-close') {
      console.log('[Renderer] App closing, performing cleanup...');
      // Perform any renderer-side cleanup here
      // This gives components time to clean up before the window closes
    }
  });
  
  // Handle beforeunload for proper cleanup
  window.addEventListener('beforeunload', (event) => {
    console.log('[Renderer] Window unloading, cleaning up resources...');
    // Prevent default behavior to allow for cleanup
    event.preventDefault();
    // Return undefined to allow the unload to proceed after cleanup
    return undefined;
  });
} else {
  // Fallback for web development
  import('@/lib/databaseInitializer').then(async ({ initializeDatabase }) => {
    try { await initializeDatabase() } catch {}
    createRoot(el).render(<App />)
  })
}
