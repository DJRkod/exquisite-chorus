import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from './App.tsx'

it('renders the app name', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Exquisite Chorus' })).toBeInTheDocument()
})
