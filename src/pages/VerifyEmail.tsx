import React from 'react'
import userMgmtService from '@/lib/userMgmtService'

const VerifyEmail: React.FC = () => {
  const [token, setToken] = React.useState(() => {
    try { return localStorage.getItem('corepms_last_verify_token') || '' } catch { return '' }
  })
  const [status, setStatus] = React.useState<'idle'|'loading'|'ok'|'err'>('idle')
  const [error, setError] = React.useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setStatus('loading')
    const res = await userMgmtService.verifyEmail(token.trim())
    if (!res.ok) { setError(res.error || 'Verification failed'); setStatus('err'); return }
    setStatus('ok')
  }
  return (
    <div className="p-6 max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-4">Verify Email</h2>
      {status !== 'ok' && (
        <form onSubmit={submit} className="space-y-3">
          <input className="w-full px-3 py-2 border rounded" placeholder="Verification token" value={token} onChange={(e)=>setToken(e.target.value)} />
          {error && <div className="bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded">{error}</div>}
          <button type="submit" className="w-full bg-green-600 text-white px-3 py-2 rounded">Verify</button>
        </form>
      )}
      {status === 'ok' && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded">Email verified</div>
      )}
    </div>
  )
}

export default VerifyEmail