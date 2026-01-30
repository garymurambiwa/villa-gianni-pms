import React from 'react'
import userMgmtService from '@/lib/userMgmtService'

const pwRe = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\da-zA-Z]).{8,}$/

const Register: React.FC = () => {
  const [username, setUsername] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')
  const [role, setRole] = React.useState('frontdesk')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState('')
  const [status, setStatus] = React.useState<'idle'|'loading'|'done'>('idle')
  const strengthOk = pwRe.test(password)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!userMgmtService.validateEmail(email)) { setError('Invalid email'); return }
    if (!strengthOk) { setError('Weak password'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setStatus('loading')
    const res = await userMgmtService.register({ username: username.trim(), email: email.trim(), password, name: name.trim(), role })
    if (!res.ok) { setError(res.error || 'Registration failed'); setStatus('idle'); return }
    setStatus('done')
    try { localStorage.setItem('corepms_last_verify_token', String(res.token||'')) } catch {}
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h2 className="text-2xl font-bold mb-4">Create Account</h2>
      {status !== 'done' && (
        <form onSubmit={submit} className="space-y-3">
          <input className="w-full px-3 py-2 border rounded" placeholder="Username" value={username} onChange={(e)=>setUsername(e.target.value)} />
          <input className="w-full px-3 py-2 border rounded" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <input className="w-full px-3 py-2 border rounded" placeholder="Full Name" value={name} onChange={(e)=>setName(e.target.value)} />
          <select className="w-full px-3 py-2 border rounded" value={role} onChange={(e)=>setRole(e.target.value)}>
            <option value="frontdesk">Front Desk</option>
            <option value="cashier">Cashier</option>
            <option value="barman">Barman</option>
            <option value="posmanager">FNB Manager</option>
            <option value="manager">FO Manager</option>
            <option value="supervisor">Supervisor</option>
            <option value="auditor">Night Auditor</option>
            <option value="housekeeping">Housekeeping</option>
            <option value="admin">Admin</option>
          </select>
          <div>
            <input className="w-full px-3 py-2 border rounded" type="password" placeholder="Password" value={password} onChange={(e)=>setPassword(e.target.value)} />
            <div className={`text-xs mt-1 ${strengthOk ? 'text-green-700' : 'text-gray-600'}`}>Min 8, 1 uppercase, 1 number, 1 special</div>
          </div>
          <input className="w-full px-3 py-2 border rounded" type="password" placeholder="Confirm Password" value={confirm} onChange={(e)=>setConfirm(e.target.value)} />
          {error && <div className="bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded">{error}</div>}
          <button type="submit" className="w-full bg-blue-600 text-white px-3 py-2 rounded">Register</button>
        </form>
      )}
      {status === 'done' && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded">
          <p className="font-semibold">Check your email to verify your account.</p>
        </div>
      )}
    </div>
  )
}

export default Register