import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from '@/app/App';
import type { AppServices } from '@/app/services';
import { ServicesProvider } from '@/app/services-context';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { fakeFinance, fakeSharing } from './fakes';

export function renderApp(partial: Pick<AppServices, 'auth' | 'households'> & Partial<AppServices>, path = '/') {
  const services: AppServices = { finance: fakeFinance(), sharing: fakeSharing(), ...partial };
  return render(
    <ServicesProvider services={services}>
      <AuthProvider service={services.auth}>
        <MemoryRouter initialEntries={[path]}>
          <App environment="development" />
        </MemoryRouter>
      </AuthProvider>
    </ServicesProvider>,
  );
}
