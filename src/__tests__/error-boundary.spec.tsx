import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '../components/ErrorBoundary'

const Boom: React.FC = () => {
  throw new Error('boom')
}

describe('ErrorBoundary recovery UI', () => {
  it('shows recovery actions when child throws', () => {
    render(
      React.createElement(ErrorBoundary, { fallbackTitle: 'POS Settings Error', fallbackMessage: 'Module failed to render due to configuration or permission issues.' }, React.createElement(Boom))
    )
    expect(screen.queryByText('POS Settings Error')).not.toBeNull()
    expect(screen.queryByText('Reload')).not.toBeNull()
    expect(screen.queryByText('Go to Login')).not.toBeNull()
    expect(screen.queryByText('Clear Error Cache')).not.toBeNull()
    expect(screen.queryByText('Copy Details')).not.toBeNull()
    expect(screen.queryByText('Error boundary engaged')).not.toBeNull()
  })
})
