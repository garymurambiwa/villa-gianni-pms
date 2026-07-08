import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { getHotelName } from '@/lib/brand';
import { useSettings } from '@/hooks/useSettings';
// Removed local Customize button; customization moves to FO Settings.

type BrandSettings = {
  name: string;
  font: string;
  color: string;
  sizePx: number; // base size in px
  logoDataUrl?: string; // persisted data URL
};

const K_BRAND = 'corepms_brand_settings';

const readJSON = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const writeJSON = (key: string, value: any) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { } };

const DEFAULT: BrandSettings = {
  name: getHotelName(),
  font: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  color: '#60a5fa', // text-blue-400
  sizePx: 24,
};

const allowedFonts = [
  { label: 'Inter (Default)', value: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Montserrat', value: 'Montserrat, Arial, sans-serif' },
];

const isValidName = (name: string) => /^([A-Za-z0-9 \-_.]{2,32})$/.test(name);

const sanitizeSvg = async (file: File): Promise<string | null> => {
  const text = await file.text();
  const lowered = text.toLowerCase();
  if (lowered.includes('<script') || lowered.includes('onload=') || lowered.includes('javascript:')) return null;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
};

const fileToDataUrl = (file: File): Promise<string | null> => {
  return new Promise(async (resolve) => {
    const type = file.type;
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) return resolve(null);
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'].includes(type)) return resolve(null);
    if (type === 'image/svg+xml') {
      const svgData = await sanitizeSvg(file);
      return resolve(svgData);
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
};

const BrandHeader: React.FC = () => {
  const { user } = useAuth();
  const { settings: appSettings } = useSettings();
  const [settings, setSettings] = React.useState<BrandSettings>(() => readJSON<BrandSettings>(K_BRAND, DEFAULT));
  // Listen for updates from FO Settings to keep header in sync
  React.useEffect(() => {
    const onUpdated = () => {
      try { setSettings(readJSON<BrandSettings>(K_BRAND, DEFAULT)); } catch { }
    };
    window.addEventListener('brand:updated', onUpdated as any);
    return () => window.removeEventListener('brand:updated', onUpdated as any);
  }, []);

  const fontSize = `${settings.sizePx}px`;
  const responsiveSizeClass = 'text-2xl md:text-3xl';

  const defaultLogo = import.meta.env.VITE_HOTEL_LOGO_URL || `${import.meta.env.BASE_URL || '/'}logo.png`;
  const logoSrc = appSettings.logoUrl || settings.logoDataUrl || defaultLogo;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Link to="/" aria-label="Go to homepage" title="Go to homepage" className="block select-none">
          <img
            src={logoSrc}
            alt={appSettings.hotelName || settings.name || 'Hotel Logo'}
            className="w-[120px] sm:w-[150px] md:w-[180px] h-max-[50px] object-contain"
            loading="eager"
          />
        </Link>
      </div>
    </div>
  );
};

export default BrandHeader;
