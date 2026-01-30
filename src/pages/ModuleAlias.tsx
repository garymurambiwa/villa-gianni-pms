import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const ModuleAlias: React.FC<{ module: string }> = ({ module }) => {
  const navigate = useNavigate();
  useEffect(() => {
    // Redirect to the unified module-based route used by AppLayout
    navigate(`/?module=${encodeURIComponent(module)}`);
  }, [navigate, module]);
  return (
    <div className="p-6">
      <div className="max-w-md mx-auto bg-white shadow rounded-lg p-6 text-center">
        <div className="text-sm text-gray-600">Redirecting to {module}…</div>
      </div>
    </div>
  );
};

export default ModuleAlias;

