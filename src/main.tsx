import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from '@/app/App';
import type { AppServices } from '@/app/services';
import { ServicesProvider } from '@/app/services-context';
import { loadConfig } from '@/config/env';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { createSupabaseHouseholdRepository } from '@/features/households/repository';
import { ConfigErrorPage } from '@/pages/ConfigErrorPage';
import { createSupabaseAuthService } from '@/services/auth';
import { createSupabaseClient } from '@/services/supabase';
import './index.css';

const root = createRoot(document.getElementById('root')!);
const result = loadConfig();

if (!result.ok) {
  root.render(<ConfigErrorPage issues={result.issues} />);
} else {
  const client = createSupabaseClient(result.config);
  const services: AppServices = {
    auth: createSupabaseAuthService(client),
    households: createSupabaseHouseholdRepository(client),
  };
  root.render(
    <StrictMode>
      <ServicesProvider services={services}>
        <AuthProvider service={services.auth}>
          <BrowserRouter>
            <App environment={result.config.environment} />
          </BrowserRouter>
        </AuthProvider>
      </ServicesProvider>
    </StrictMode>,
  );
}
