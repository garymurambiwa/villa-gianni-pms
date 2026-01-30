import React, { useEffect } from 'react';
import { Login } from '@/components/Login';
import AuthPortal from '@/components/modules/AuthPortal';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useAuth } from '@/context/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { getDefaultModuleForRole } from '@/lib/roleLanding';

const LoginPage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      // If the account requires password change, redirect to the change page immediately
      if (user.passwordChangeRequired) {
        navigate('/password-change');
        return;
      }
      const params = new URLSearchParams(location.search);
      const redirect = params.get('redirect');
      const lastModule = (() => {
        try {
          return localStorage.getItem('corepms_active_module') || '';
        } catch {
          return '';
        }
      })();
      const roleDefault = getDefaultModuleForRole(user.role);
      if (redirect) {
        // Navigate to requested module after successful login
        navigate(`/?module=${encodeURIComponent(redirect)}`);
      } else if (lastModule) {
        // Fallback to last active module if available
        navigate(`/?module=${encodeURIComponent(lastModule)}`);
      } else if (roleDefault) {
        // Role-based default landing module
        navigate(`/?module=${encodeURIComponent(roleDefault)}`);
      } else {
        // Default to home/dashboard
        navigate('/');
      }
    }
  }, [user, location.search, navigate]);
  return (
    <div className="p-6">
      <Login />
      <div className="mt-6">
        <ErrorBoundary fallbackTitle="Auth Error" fallbackMessage="Authentication portal failed.">
          <AuthPortal />
        </ErrorBoundary>
      </div>
    </div>
  );
};

export default LoginPage;
