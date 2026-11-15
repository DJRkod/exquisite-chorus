import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { envelope } from './test/fakeApi.ts'
import { renderApp } from './test/renderApp.tsx'

it('renders the app name in the signed-in header', async () => {
  renderApp('/', {
    'GET /api/auth/me': envelope(200, 'OK', { id: 'u1', email: 'a@example.com', displayName: 'Ada' }),
  })
  expect(await screen.findByText('Exquisite Chorus')).toBeInTheDocument()
})
