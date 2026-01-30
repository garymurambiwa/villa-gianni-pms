import { useState, useEffect, useCallback } from 'react';
import { 
  validateColor, 
  getContrastingTextColor, 
  defaultMenuColors, 
  getMenuColor,
  getContrastRatio,
  ensureContrast
} from '@/lib/colorUtils';

export interface MenuColorSettings {
  colors?: Record<string, string>;
  enableTransitions?: boolean;
  transitionDuration?: number;
  validateAccessibility?: boolean;
  defaultColor?: string;
  minContrastRatio?: number;
  autoAdjustOptOutModules?: string[];
}

export interface ColorState {
  backgroundColor: string;
  textColor: string;
  contrastRatio: number;
  accessibility: 'pass' | 'fail';
  isValid: boolean;
}

export function useDynamicMenuColor(
  activeModule: string,
  settings: MenuColorSettings = {}
) {
  const {
    colors = defaultMenuColors,
    enableTransitions = true,
    transitionDuration = 300,
    validateAccessibility = true,
    defaultColor = '#6B7280',
    minContrastRatio = 4.5,
    autoAdjustOptOutModules = []
  } = settings;

  const [colorState, setColorState] = useState<ColorState>({
    backgroundColor: defaultColor,
    textColor: '#FFFFFF',
    contrastRatio: 4.5,
    accessibility: 'pass',
    isValid: true
  });

  const updateColor = useCallback((moduleId: string) => {
    const colorValue = getMenuColor(moduleId, colors);
    
    // Validate color format
    const validation = validateColor(colorValue);
    
    if (!validation.valid) {
      console.warn(`Invalid color for module ${moduleId}: ${colorValue}`);
      setColorState({
        backgroundColor: defaultColor,
        textColor: getContrastingTextColor({ r: 107, g: 114, b: 128 }),
        contrastRatio: 4.5,
        accessibility: 'pass',
        isValid: false
      });
      return;
    }

    // Get contrasting text color
    const rgbColor = validation.color ? 
      { 
        r: parseInt(validation.color.slice(1, 3), 16),
        g: parseInt(validation.color.slice(3, 5), 16),
        b: parseInt(validation.color.slice(5, 7), 16)
      } : { r: 107, g: 114, b: 128 };
    
    const textColor = getContrastingTextColor(rgbColor);
    const textRgb = textColor.toLowerCase() === '#000000' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    const initialRatio = getContrastRatio(rgbColor, textRgb);
    const initialAccessibility = initialRatio >= minContrastRatio ? 'pass' : 'fail';
    let adjustedColor = validation.color || defaultColor;
    let ratio = initialRatio;
    let accessibility = initialAccessibility;
    const optOut = autoAdjustOptOutModules.includes(moduleId);
    if (validateAccessibility && initialAccessibility === 'fail') {
      console.warn(`Low contrast ratio for module ${moduleId}: ${initialRatio.toFixed(2)} (minimum ${minContrastRatio}:1 required)`);
      if (!optOut) {
        const res = ensureContrast(adjustedColor, textColor, minContrastRatio);
        adjustedColor = res.hex;
        ratio = res.ratio;
        accessibility = ratio >= minContrastRatio ? 'pass' : 'fail';
      }
    }

    setColorState({
      backgroundColor: adjustedColor,
      textColor,
      contrastRatio: ratio,
      accessibility,
      isValid: true
    });

    // Log accessibility warnings
    if (validateAccessibility && (ratio < minContrastRatio)) {
      console.warn(`Low contrast ratio for module ${moduleId}: ${ratio.toFixed(2)} (minimum ${minContrastRatio}:1 required)`);
    }
  }, [colors, defaultColor, validateAccessibility, minContrastRatio, autoAdjustOptOutModules]);

  useEffect(() => {
    if (activeModule) {
      updateColor(activeModule);
    } else {
      // Use default color when no module is selected
      setColorState({
        backgroundColor: defaultColor,
        textColor: getContrastingTextColor({ r: 107, g: 114, b: 128 }),
        contrastRatio: 4.5,
        accessibility: 'pass',
        isValid: true
      });
    }
  }, [activeModule, updateColor, defaultColor]);

  return {
    ...colorState,
    enableTransitions,
    transitionDuration,
    updateColor
  };
}

/**
 * CSS styles for dynamic background with transitions
 */
export function getDynamicBackgroundStyles(
  colorState: ColorState,
  settings: Pick<MenuColorSettings, 'enableTransitions' | 'transitionDuration'> = {}
) {
  const { enableTransitions = true, transitionDuration = 300 } = settings;
  
  return {
    backgroundColor: colorState.backgroundColor,
    color: colorState.textColor,
    transition: enableTransitions 
      ? `background-color ${transitionDuration}ms ease-in-out, color ${transitionDuration}ms ease-in-out`
      : 'none',
    '--dynamic-bg-color': colorState.backgroundColor,
    '--dynamic-text-color': colorState.textColor,
    '--contrast-ratio': colorState.contrastRatio.toString()
  } as React.CSSProperties;
}

/**
 * Hover and active state styles
 */
export function getInteractiveStyles(
  colorState: ColorState,
  settings: Pick<MenuColorSettings, 'enableTransitions' | 'transitionDuration'> = {}
) {
  const { enableTransitions = true, transitionDuration = 300 } = settings;
  
  return {
    '--hover-bg-color': colorState.backgroundColor + '20', // Add transparency
    '--active-bg-color': colorState.backgroundColor + '40', // More opaque
    '--hover-text-color': colorState.textColor,
    '--active-text-color': colorState.textColor,
    transition: enableTransitions 
      ? `background-color ${transitionDuration}ms ease-in-out, color ${transitionDuration}ms ease-in-out, transform 150ms ease-in-out`
      : 'none',
  } as React.CSSProperties;
}
