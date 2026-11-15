import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import App from '../App.tsx'
import { fakeApi, type Routes } from './fakeApi.ts'

function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname + location.search}</p>
}

/** The whole app at a route, backed by a fake API (see fakeApi). */
export function renderApp(route: string, routes: Routes = {}) {
  const api = fakeApi(routes)
  const view = render(
    <MemoryRouter initialEntries={[route]}>
      <App />
      <Address />
    </MemoryRouter>,
  )
  return { ...view, ...api }
}
