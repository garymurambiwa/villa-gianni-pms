import { beforeEach, describe, expect, test } from 'vitest'
import React from 'react'
import { render, act } from '@testing-library/react'
import { DataProvider, useData } from '../context/DataContext'

describe('Rooms data flow (MySQL bridge mocked)', () => {
  let currentRooms: any[] = []
  let lastInsert: any = null

  beforeEach(() => {
    currentRooms = []
    lastInsert = null
    ;(global as any).window = (global as any).window || {}
    ;(window as any).native = {
      db: {
        async query(sql: string, params: any[] = []) {
          const q = String(sql).trim().toUpperCase()
          if (q.startsWith('SELECT * FROM ROOMS')) {
            return { rows: currentRooms, rowCount: currentRooms.length }
          }
          if (q.startsWith('INSERT INTO ROOMS')) {
            const [id, number, type, rate, status] = params
            lastInsert = { id, number, type, rate, status }
            currentRooms = [{ id, number, type, rate, status }]
            return { rows: [], rowCount: 0 }
          }
          if (q.startsWith('SELECT ID FROM ROOMS WHERE NUMBER')) {
            const n = params[0]
            const match = currentRooms.find(r => String(r.number) === String(n))
            return { rows: match ? [{ id: match.id }] : [], rowCount: match ? 1 : 0 }
          }
          return { rows: [], rowCount: 0 }
        },
      },
    }
  })

  test('addRoom inserts with id and VC status, then lists', async () => {
    let api: any = null
    const Harness: React.FC = () => {
      api = useData()
      return null
    }
    render(
      <DataProvider>
        <Harness />
      </DataProvider>
    )
    await act(async () => {
      const ok = await api.addRoom({ number: '104', type: 'Suite', rate: 250 })
      expect(ok).toBe(true)
    })
    expect(lastInsert).toBeTruthy()
    expect(typeof lastInsert.id).toBe('string')
    expect(lastInsert.status).toBe('VC')
    expect(api.rooms.find((r: any) => r.number === '104')).toBeTruthy()
  })
})
