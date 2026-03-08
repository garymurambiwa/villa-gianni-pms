import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import pmsAuthDb from '@/lib/pmsAuthDb';

export interface AppSettings {
    hotelName: string;
    hotelTagline: string;
    logoUrl: string;
    themePreset: string;
    themeColors?: {
        primary?: string;
        background?: string;
    };
    backgroundImageUrl?: string;
    // Contact & Location
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    // Regional
    currency?: string;
    timezone?: string;
    dateFormat?: string;
    // Receipt
    receiptFooter?: string;
}

interface SettingsContextType {
    settings: AppSettings;
    updateSetting: (key: keyof AppSettings, value: any) => Promise<boolean>;
    updateSettings: (patch: Partial<AppSettings>) => Promise<boolean>;
    refreshSettings: () => Promise<void>;
    isLoading: boolean;
}

const defaultSettings: AppSettings = {
    hotelName: import.meta.env.VITE_HOTEL_NAME || 'Hotel Name',
    hotelTagline: import.meta.env.VITE_HOTEL_TAGLINE || 'Boutique Hotel',
    logoUrl: import.meta.env.VITE_HOTEL_LOGO_URL || '/logo.png',
    themePreset: 'light',
    themeColors: {},
    address: import.meta.env.VITE_HOTEL_ADDRESS || '',
    phone: import.meta.env.VITE_HOTEL_PHONE || '',
    email: import.meta.env.VITE_HOTEL_EMAIL || '',
    website: '',
    currency: 'USD',
    timezone: 'Africa/Harare',
    dateFormat: 'DD/MM/YYYY',
    receiptFooter: import.meta.env.VITE_HOTEL_RECEIPT_FOOTER || 'Thank you for staying with us!',
};

const STRING_KEYS: Array<keyof AppSettings> = [
    'hotelName', 'hotelTagline', 'logoUrl', 'themePreset', 'backgroundImageUrl',
    'address', 'phone', 'email', 'website', 'currency', 'timezone', 'dateFormat', 'receiptFooter',
];

const SettingsContext = createContext<SettingsContextType>({
    settings: defaultSettings,
    updateSetting: async () => false,
    updateSettings: async () => false,
    refreshSettings: async () => { },
    isLoading: true,
});

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
    const [settings, setSettings] = useState<AppSettings>(defaultSettings);
    const [isLoading, setIsLoading] = useState(true);

    const fetchSettings = async () => {
        setIsLoading(true);
        try {
            const allSettings = await pmsAuthDb.getAllAppSettings();
            const newSettings: AppSettings = { ...defaultSettings };

            // Apply all simple string keys
            for (const key of STRING_KEYS) {
                if (allSettings[key]) (newSettings as any)[key] = allSettings[key];
            }

            // themeColors is JSON
            if (allSettings.themeColors) {
                try { newSettings.themeColors = JSON.parse(allSettings.themeColors); } catch { }
            }

            setSettings(newSettings);

            // Inject CSS variables for theme
            if (newSettings.themeColors?.primary) {
                document.documentElement.style.setProperty('--primary', newSettings.themeColors.primary);
            } else {
                document.documentElement.style.removeProperty('--primary');
            }

            if (newSettings.backgroundImageUrl) {
                document.body.style.backgroundImage = `url(${newSettings.backgroundImageUrl})`;
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundPosition = 'center';
            } else if (newSettings.themeColors?.background) {
                document.body.style.backgroundImage = 'none';
                document.body.style.backgroundColor = newSettings.themeColors.background;
            } else {
                document.body.style.backgroundImage = 'none';
                document.body.style.backgroundColor = '';
            }

        } catch (e) {
            console.error('Failed to fetch settings:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchSettings(); }, []);

    const updateSetting = async (key: keyof AppSettings, value: any): Promise<boolean> => {
        try {
            const dbValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            const res = await pmsAuthDb.setAppSetting(key as string, dbValue);
            if (res.ok) { await fetchSettings(); return true; }
            return false;
        } catch (error) {
            console.error('Failed to update setting:', error);
            return false;
        }
    };

    const updateSettings = async (patch: Partial<AppSettings>): Promise<boolean> => {
        try {
            let allOk = true;
            for (const [key, value] of Object.entries(patch)) {
                const dbValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                const res = await pmsAuthDb.setAppSetting(key, dbValue);
                if (!res.ok) allOk = false;
            }
            await fetchSettings();
            return allOk;
        } catch (error) {
            console.error('Failed to update settings:', error);
            return false;
        }
    };

    return (
        <SettingsContext.Provider value={{ settings, updateSetting, updateSettings, refreshSettings: fetchSettings, isLoading }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => useContext(SettingsContext);
