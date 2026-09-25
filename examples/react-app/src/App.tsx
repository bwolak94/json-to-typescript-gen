import { useEffect, useState } from 'react'

interface User {
  id: number
  name: string
  role: string
}

const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:4001'

export default function App() {
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_URL}/users`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<User[]>
      })
      .then((data) => {
        setUsers(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      })
  }, [])

  if (loading) return <p data-testid="loading">Loading...</p>
  if (error) return <p data-testid="error">{error}</p>
  if (users.length === 0) return <p data-testid="empty">No users found.</p>

  return (
    <ul data-testid="user-list">
      {users.map((u) => (
        <li key={u.id} data-testid="user">
          <strong>{u.name}</strong> — {u.role}
        </li>
      ))}
    </ul>
  )
}
