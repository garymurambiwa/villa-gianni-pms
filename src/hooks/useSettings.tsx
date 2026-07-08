import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import pmsAuthDb from '@/lib/pmsAuthDb';
import { getHotelName } from '@/lib/brand';

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

const getInitialDefaults = (): AppSettings => {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    const isBaradzanwa = host.includes('baradzanwa');
    
    return {
        hotelName: getHotelName(),
        hotelTagline: isBaradzanwa ? 'Welcome to Baradzanwa' : (import.meta.env.VITE_HOTEL_TAGLINE || 'Boutique Hotel'),
        logoUrl: isBaradzanwa ? '/logob.png' : (import.meta.env.VITE_HOTEL_LOGO_URL || '/logo.png'),
        themePreset: isBaradzanwa ? 'bronze' : 'light',
        themeColors: {},
        address: isBaradzanwa ? '' : (import.meta.env.VITE_HOTEL_ADDRESS || ''),
        phone: isBaradzanwa ? '' : (import.meta.env.VITE_HOTEL_PHONE || ''),
        email: isBaradzanwa ? '' : (import.meta.env.VITE_HOTEL_EMAIL || ''),
        website: '',
        currency: 'USD',
        timezone: 'Africa/Harare',
        dateFormat: 'DD/MM/YYYY',
        receiptFooter: isBaradzanwa ? 'Thank you!' : (import.meta.env.VITE_HOTEL_RECEIPT_FOOTER || 'Thank you for staying with us!'),
        backgroundImageUrl: isBaradzanwa ? '/baradzanwabg.jpeg' : '',
    };
};

const defaultSettings = getInitialDefaults();

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
        // Set loading to true initially
        setIsLoading(true);
        try {
            const allSettings = await pmsAuthDb.getAllAppSettings();
            const newSettings: AppSettings = { ...getInitialDefaults() };

            // Apply all simple string keys (guard against literally-stored "undefined")
            for (const key of STRING_KEYS) {
                const v = allSettings[key];
                if (v && v !== 'undefined') (newSettings as any)[key] = v;
            }

            // themeColors is JSON
            if (allSettings.themeColors) {
                try { newSettings.themeColors = JSON.parse(allSettings.themeColors); } catch { }
            }

            setSettings(newSettings);
            applyTheme(newSettings);

        } catch (e) {
            console.error('Failed to fetch settings:', e);
        } finally {
            setIsLoading(false);
        }
    };

    /** Apply the full theme token set to the DOM */
    const applyTheme = (s: AppSettings) => {
        const root = document.documentElement;

        // 0. Update document title
        if (s.hotelName) {
            document.title = `${s.hotelName} Management Suite`;
        }

        // 1. Set data-theme attribute so themes.css selectors activate
        root.setAttribute('data-theme', s.themePreset || 'light');

        // 2. Override individual --hotel-* vars if a custom primary is set
        //    (allows the custom color picker in SystemSettings to override the preset)
        if (s.themeColors?.primary) {
            root.style.setProperty('--hotel-primary', s.themeColors.primary);
        }

        // 3. Apply background image override (from settings page)
        if (s.backgroundImageUrl) {
            document.body.style.backgroundImage = `url(${s.backgroundImageUrl})`;
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundAttachment = 'fixed';
        } else {
            document.body.style.backgroundImage = 'none';
            document.body.style.backgroundAttachment = '';
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
