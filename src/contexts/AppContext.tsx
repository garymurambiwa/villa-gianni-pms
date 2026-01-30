import React, { ReactNode } from 'react';
import { AuthProvider } from '@/context/AuthContext';
import { DataProvider } from '../context/DataContext';
import { ShiftProvider } from './ShiftContext';

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  return (
    <AuthProvider>
      <DataProvider>
        <ShiftProvider>
          {children}
        </ShiftProvider>
      </DataProvider>
    </AuthProvider>
  );
};
