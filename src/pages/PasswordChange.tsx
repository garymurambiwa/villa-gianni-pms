import React from 'react'
import { useAuth } from '@/context/AuthContext'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'

const PasswordChangePage: React.FC = () => {
  const { user, changePassword } = useAuth()
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [msg, setMsg] = React.useState('')
  const navigate = useNavigate()

  const onSubmit = async () => {
    setMsg('')
    const res = await changePassword(current, next)
    if (res.ok) {
      setMsg('Password updated successfully. Redirecting…')
      setTimeout(() => navigate('/'), 800)
    } else {
      setMsg(res.error || 'Failed to update password')
    }
  }

  return (
    <div className="p-6 flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-6 rounded shadow max-w-sm w-full">
        <h2 className="text-lg font-semibold mb-2">Change Password</h2>
        {!user && (
          <p className="text-sm text-blue-700 bg-blue-50 p-2 rounded mb-3">Not logged in</p>
        )}
        {user && (
          <p className="text-sm text-green-700 bg-green-50 p-2 rounded mb-3">Logged in as {user.username}</p>
        )}
        {user?.passwordChangeRequired && (
          <p className="text-sm text-red-700 bg-red-50 p-2 rounded mb-3">Password change required before accessing the system.</p>
        )}
        {msg && <div className="text-sm p-2 mb-3 rounded bg-blue-50 text-blue-700">{msg}</div>}
        <div className="space-y-3">
          <div>
            <label htmlFor="current" className="text-sm">Current Password</label>
            <Input id="current" type="password" value={current} onChange={(e)=> setCurrent(e.target.value)} disabled={!user} />
          </div>
          <div>
            <label htmlFor="next" className="text-sm">New Password</label>
            <Input id="next" type="password" value={next} onChange={(e)=> setNext(e.target.value)} disabled={!user} />
            <div className="text-xs text-gray-500">Min 8 chars, include upper, lower, number, symbol.</div>
          </div>
          <Button onClick={onSubmit} disabled={!next || !user}>Update Password</Button>
        </div>
      </div>
    </div>
  )
}

export default PasswordChangePage
