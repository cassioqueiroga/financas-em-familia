import { createContext, useContext } from 'react';
import type { HouseholdRepository } from '@/features/households/types';
import type { AuthService } from '@/services/auth';

export interface AppServices {
  auth: AuthService;
  households: HouseholdRepository;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices precisa de <ServicesProvider>');
  return services;
}
