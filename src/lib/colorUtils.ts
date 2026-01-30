/**
 * Color utility functions for accessibility and validation
 */

export interface ColorFormats {
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
}

/**
 * Convert hex color to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Convert RGB color to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Convert RGB color to HSL
 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/**
 * Calculate relative luminance of a color
 */
export function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors
 */
export function getContrastRatio(color1: { r: number; g: number; b: number }, color2: { r: number; g: number; b: number }): number {
  const lum1 = getLuminance(color1.r, color1.g, color1.b);
  const lum2 = getLuminance(color2.r, color2.g, color2.b);
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  
  return (brightest + 0.05) / (darkest + 0.05);
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s = s / 100;
  l = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0));
  const g = Math.round(255 * f(8));
  const b = Math.round(255 * f(4));
  return { r, g, b };
}

export function ensureContrast(backgroundHex: string, textHex: string, minRatio: number = 4.5): { hex: string; rgb: { r: number; g: number; b: number }; ratio: number } {
  const bg = hexToRgb(backgroundHex) || { r: 107, g: 114, b: 128 };
  const txt = textHex.toLowerCase() === '#000000' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
  let ratio = getContrastRatio(bg, txt);
  if (ratio >= minRatio) return { hex: backgroundHex, rgb: bg, ratio };
  const hsl = rgbToHsl(bg.r, bg.g, bg.b);
  let l = hsl.l;
  const direction = textHex.toLowerCase() === '#ffffff' ? -1 : 1;
  for (let i = 0; i < 20; i++) {
    l = Math.max(0, Math.min(100, l + direction * 3));
    const rgb = hslToRgb(hsl.h, hsl.s, l);
    ratio = getContrastRatio(rgb, txt);
    if (ratio >= minRatio) {
      return { hex: rgbToHex(rgb.r, rgb.g, rgb.b), rgb, ratio };
    }
  }
  return { hex: backgroundHex, rgb: bg, ratio };
}

/**
 * Parse color string in various formats (hex, rgb, hsl)
 */
export function parseColor(color: string): ColorFormats | null {
  if (!color || typeof color !== 'string') return null;
  
  color = color.trim();
  
  // Hex color
  if (color.startsWith('#')) {
    const rgb = hexToRgb(color);
    if (!rgb) return null;
    return {
      hex: color,
      rgb,
      hsl: rgbToHsl(rgb.r, rgb.g, rgb.b)
    };
  }
  
  // RGB color
  const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    
    if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
      return {
        hex: rgbToHex(r, g, b),
        rgb: { r, g, b },
        hsl: rgbToHsl(r, g, b)
      };
    }
  }
  
  // HSL color
  const hslMatch = color.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)/i);
  if (hslMatch) {
    const h = parseInt(hslMatch[1], 10);
    const s = parseInt(hslMatch[2], 10);
    const l = parseInt(hslMatch[3], 10);
    
    if (h >= 0 && h <= 360 && s >= 0 && s <= 100 && l >= 0 && l <= 100) {
      // Convert HSL to RGB
      const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
      const x = c * (1 - Math.abs((h / 60) % 2 - 1));
      const m = l / 100 - c / 2;
      
      let r = 0, g = 0, b = 0;
      
      if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
      else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
      else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
      else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
      else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
      else if (h >= 300 && h < 360) { r = c; g = 0; b = x; }
      
      r = Math.round((r + m) * 255);
      g = Math.round((g + m) * 255);
      b = Math.round((b + m) * 255);
      
      return {
        hex: rgbToHex(r, g, b),
        rgb: { r, g, b },
        hsl: { h, s, l }
      };
    }
  }
  
  return null;
}

/**
 * Validate color and return safe color with accessibility check
 */
export function validateColor(color: string, backgroundColor: { r: number; g: number; b: number } = { r: 255, g: 255, b: 255 }): { 
  valid: boolean; 
  color: string | null; 
  contrastRatio: number;
  accessibility: 'pass' | 'fail';
} {
  const parsed = parseColor(color);
  if (!parsed) {
    return { 
      valid: false, 
      color: null, 
      contrastRatio: 1,
      accessibility: 'fail'
    };
  }
  
  const contrastRatio = getContrastRatio(parsed.rgb, backgroundColor);
  const accessibility = contrastRatio >= 4.5 ? 'pass' : 'fail';
  
  return {
    valid: true,
    color: parsed.hex,
    contrastRatio,
    accessibility
  };
}

/**
 * Get contrasting text color (black or white) based on background
 */
export function getContrastingTextColor(backgroundColor: { r: number; g: number; b: number }): string {
  const luminance = getLuminance(backgroundColor.r, backgroundColor.g, backgroundColor.b);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

/**
 * Default menu colors with accessibility compliance
 */
export const defaultMenuColors = {
  dashboard: '#3B82F6',      // Blue
  frontoffice: '#10B981',    // Green
  reservations: '#F59E0B',   // Amber
  rooms: '#8B5CF6',          // Purple
  pos: '#EF4444',            // Red
  inventory: '#06B6D4',      // Cyan
  accounting: '#84CC16',     // Lime
  reports: '#F97316',        // Orange
  users: '#EC4899',          // Pink
  maintenance: '#6B7280',    // Gray
  'night-audit': '#1F2937',  // Dark Gray
  'pos-settings': '#DC2626', // Dark Red
  'fo-setting': '#059669',   // Dark Green
  'rate-management': '#7C3AED', // Violet
  'cityledger': '#0EA5E9',   // Sky Blue
  'ap': '#65A30D',           // Dark Lime
  'tx-clearing': '#EA580C',  // Dark Orange
  'superadmin-settings': '#BE185D', // Dark Pink
  'admin-management': '#7C2D12', // Dark Brown
  'profile-admin': '#581C87', // Dark Purple
  'profile': '#1E40AF',      // Dark Blue
  'tasks': '#0F766E',        // Dark Teal
  'versioncontrol': '#374151', // Dark Gray
  'printer-config': '#92400E', // Dark Amber
  default: '#6B7280'         // Gray
};

/**
 * Get color for a specific menu item
 */
export function getMenuColor(moduleId: string, customColors?: Record<string, string>): string {
  const colors = customColors || defaultMenuColors;
  return colors[moduleId as keyof typeof colors] || colors.default;
}
