import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { envelope, sentBody } from '../test/fakeApi.ts'
import { renderApp } from '../test/renderApp.tsx'

const ADA = { id: 'u1', email: 'ada@example.com', displayName: 'Ada Lovelace' }
const SIGNED_IN_AS_ADA = { 'GET /api/auth/me': envelope(200, 'OK', ADA) }

const address = () => screen.getByTestId('address')

describe('auth flows', () => {
  it('signs up with valid input and lands on the app home with the name shown', async () => {
    const { fetch } = renderApp('/signup', {
      'POST /api/auth/signup': envelope(201, 'Account created', ADA),
    })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Display name'), 'Ada Lovelace')
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Recordings' })).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(address()).toHaveTextContent(/^\/$/)
    expect(sentBody(fetch, 'POST /api/auth/signup')).toEqual({
      displayName: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'hunter22!',
    })
  })

  it('shows the server message on a failed sign-up', async () => {
    renderApp('/signup', {
      'POST /api/auth/signup': envelope(409, 'An account with that email already exists'),
    })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Display name'), 'Ada')
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('An account with that email already exists')
  })

  it('shows the server message on wrong credentials and keeps the entered email', async () => {
    renderApp('/signin', {
      'POST /api/auth/login': envelope(401, 'Invalid email or password'),
    })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
    expect(address()).toHaveTextContent('/signin')
  })

  it('sends unknown routes to home, which is protected', async () => {
    renderApp('/somewhere', SIGNED_IN_AS_ADA)

    expect(await screen.findByRole('heading', { name: 'Recordings' })).toBeInTheDocument()
    expect(address()).toHaveTextContent(/^\/$/)
  })

  it('redirects a signed-out visit to sign-in, then returns to the original route', async () => {
    renderApp('/?tab=mine', {
      'POST /api/auth/login': envelope(200, 'Signed in', ADA),
    })
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email'), 'ada@example.com')
    expect(address()).toHaveTextContent(/^\/signin$/)
    await user.type(screen.getByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Recordings' })).toBeInTheDocument()
    expect(address()).toHaveTextContent(/^\/\?tab=mine$/)
  })

  it('keeps the original route across a detour to sign-up', async () => {
    renderApp('/?tab=mine', {
      'POST /api/auth/signup': envelope(201, 'Account created', ADA),
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: /create an account/i }))
    await user.type(await screen.findByLabelText('Display name'), 'Ada Lovelace')
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter22!')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Recordings' })).toBeInTheDocument()
    expect(address()).toHaveTextContent(/^\/\?tab=mine$/)
  })

  it('shows the home page directly when the session is already signed in', async () => {
    renderApp('/', SIGNED_IN_AS_ADA)

    expect(await screen.findByRole('heading', { name: 'Recordings' })).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
  })

  it('sends a signed-in visit to /signin on to home', async () => {
    renderApp('/signin', SIGNED_IN_AS_ADA)

    expect(await screen.findByRole('heading', { name: 'Recordings' })).toBeInTheDocument()
    expect(address()).toHaveTextContent(/^\/$/)
  })

  it('signs out, clearing the user and returning to sign-in', async () => {
    const { fetch } = renderApp('/', {
      ...SIGNED_IN_AS_ADA,
      'POST /api/auth/logout': { status: 204 },
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    expect(address()).toHaveTextContent('/signin')
    expect(fetch.mock.calls.some(([url, init]) => url === '/api/auth/logout' && init?.method === 'POST')).toBe(true)
  })

  it('waits for health before asking who is signed in', async () => {
    const { fetch } = renderApp('/')

    await screen.findByRole('heading', { name: 'Sign in' })
    const urls = fetch.mock.calls.map(([url]) => String(url))
    expect(urls.indexOf('/api/health')).toBe(0)
    expect(urls.indexOf('/api/auth/me')).toBeGreaterThan(0)
  })

  it('links sign-in and sign-up pages to each other', async () => {
    renderApp('/signin')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('link', { name: /create an account/i }))
    expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /sign in/i }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    await waitFor(() => expect(address()).toHaveTextContent('/signin'))
  })
})
