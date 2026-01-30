type AnyData = any

const hasNative = () => typeof window !== 'undefined' && (window as any).native && (window as any).native.persistence

const lsRead = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

const lsWrite = (key: string, value: AnyData) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

export async function loadCollection<T = AnyData>(name: string, fallback: T): Promise<T> {
  try {
    if (hasNative()) {
      return await (window as any).native.persistence.load(name, fallback)
    }
    // Fallback to localStorage in web/dev
    return lsRead<T>(`corepms_${name}`, fallback)
  } catch {
    return fallback
  }
}

export async function saveCollection(name: string, value: AnyData): Promise<{ ok: boolean; error?: string }> {
  try {
    if (hasNative()) {
      const res = await (window as any).native.persistence.save(name, value)
      return res && typeof res.ok === 'boolean' ? res : { ok: true }
    }
    // Fallback to localStorage in web/dev
    lsWrite(`corepms_${name}`, value)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) }
  }
}

// Convenience helpers for common PMS collections
export const PMS_COLLECTIONS = {
  reservations: 'reservations',
  guests: 'guests',
  folioCharges: 'folioCharges',
  cityLedger: 'cityLedger',
}

