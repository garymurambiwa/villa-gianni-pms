import { useState, useEffect } from 'react';
import { getDynamicPackageOptions } from '@/lib/dynamicPackageUtils';
import { PackageOption } from '@/lib/packageUtils';

/**
 * Custom hook to fetch and manage dynamic breakfast package options
 * This replaces the hardcoded packageOptions with live data from the Breakfast module
 */
export function useDynamicPackageOptions() {
  const [packageOptions, setPackageOptions] = useState<PackageOption[]>([
    { code: 'RO', label: 'Room Only', surcharge: 0 },
    { code: 'BB', label: 'Bed & Breakfast', surcharge: 15 },
    { code: 'DBB', label: 'Dinner, Bed & Breakfast', surcharge: 45 }
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPackageOptions = async () => {
      try {
        setLoading(true);
        setError(null);
        const options = await getDynamicPackageOptions();
        setPackageOptions(options);
      } catch (err) {
        console.error('Failed to load dynamic package options:', err);
        setError('Failed to load meal plan options. Showing default options.');
        // Keep the fallback options
      } finally {
        setLoading(false);
      }
    };

    loadPackageOptions();
  }, []);

  return {
    packageOptions,
    loading,
    error
  };
}