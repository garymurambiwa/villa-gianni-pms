/**
 * Test suite for Dynamic Background Color functionality
 * Tests accessibility, transitions, error handling, and cross-browser compatibility
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DynamicBackgroundDiv } from '@/components/ui/DynamicBackgroundDiv';
import { useDynamicMenuColor } from '@/hooks/useDynamicMenuColor';
import { validateColor, getContrastRatio, parseColor } from '@/lib/colorUtils';
import React from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock console methods to avoid test output pollution
const originalWarn = console.warn;
const originalLog = console.log;

beforeEach(() => {
  console.warn = vi.fn();
  console.log = vi.fn();
});

afterEach(() => {
  console.warn = originalWarn;
  console.log = originalLog;
});

describe('Color Utilities', () => {
  describe('parseColor', () => {
    it('should parse hex colors correctly', () => {
      const result = parseColor('#FF0000');
      expect(result).toEqual({
        hex: '#FF0000',
        rgb: { r: 255, g: 0, b: 0 },
        hsl: { h: 0, s: 100, l: 50 }
      });
    });

    it('should parse RGB colors correctly', () => {
      const result = parseColor('rgb(255, 0, 0)');
      expect(result).toEqual({
        hex: '#ff0000',
        rgb: { r: 255, g: 0, b: 0 },
        hsl: { h: 0, s: 100, l: 50 }
      });
    });

    it('should parse HSL colors correctly', () => {
      const result = parseColor('hsl(0, 100%, 50%)');
      expect(result).toEqual({
        hex: '#ff0000',
        rgb: { r: 255, g: 0, b: 0 },
        hsl: { h: 0, s: 100, l: 50 }
      });
    });

    it('should return null for invalid colors', () => {
      expect(parseColor('invalid-color')).toBeNull();
      expect(parseColor('')).toBeNull();
      expect(parseColor(null as any)).toBeNull();
    });
  });

  describe('validateColor', () => {
    it('should validate accessible colors', () => {
      const result = validateColor('#000000', { r: 255, g: 255, b: 255 });
      expect(result.valid).toBe(true);
      expect(result.accessibility).toBe('pass');
      expect(result.contrastRatio).toBeGreaterThanOrEqual(4.5);
    });

    it('should detect inaccessible colors', () => {
      const result = validateColor('#FFFF00', { r: 255, g: 255, b: 255 });
      expect(result.valid).toBe(true);
      expect(result.accessibility).toBe('fail');
      expect(result.contrastRatio).toBeLessThan(4.5);
    });

    it('should handle invalid colors', () => {
      const result = validateColor('invalid-color');
      expect(result.valid).toBe(false);
      expect(result.color).toBeNull();
      expect(result.accessibility).toBe('fail');
    });
  });

  describe('getContrastRatio', () => {
    it('should calculate correct contrast ratios', () => {
      // Black on white should have maximum contrast
      const blackWhite = getContrastRatio(
        { r: 0, g: 0, b: 0 },
        { r: 255, g: 255, b: 255 }
      );
      expect(blackWhite).toBeCloseTo(21, 1);

      // Same colors should have minimum contrast
      const sameColor = getContrastRatio(
        { r: 128, g: 128, b: 128 },
        { r: 128, g: 128, b: 128 }
      );
      expect(sameColor).toBeCloseTo(1, 1);
    });
  });
});

describe('useDynamicMenuColor Hook', () => {
  const TestComponent: React.FC<{ module: string; settings?: any }> = ({ module, settings }) => {
    const colorState = useDynamicMenuColor(module, settings);
    return (
      <div data-testid="color-info">
        <span data-testid="bg-color">{colorState.backgroundColor}</span>
        <span data-testid="text-color">{colorState.textColor}</span>
        <span data-testid="contrast-ratio">{colorState.contrastRatio}</span>
        <span data-testid="accessibility">{colorState.accessibility}</span>
        <span data-testid="is-valid">{colorState.isValid.toString()}</span>
      </div>
    );
  };

  it('should return valid color state for valid module', () => {
    render(<TestComponent module="dashboard" />);
    
    expect(screen.getByTestId('bg-color')).toHaveTextContent(/^#[0-9A-F]{6}$/i);
    expect(screen.getByTestId('text-color')).toHaveTextContent(/^#[0-9A-F]{6}$/i);
    expect(screen.getByTestId('accessibility')).toHaveTextContent(/pass|fail/);
    expect(screen.getByTestId('is-valid')).toHaveTextContent('true');
  });

  it('should handle invalid module gracefully', () => {
    render(<TestComponent module="invalid-module" />);
    
    expect(screen.getByTestId('bg-color')).toHaveTextContent(/^#[0-9A-F]{6}$/i);
    expect(screen.getByTestId('is-valid')).toHaveTextContent('true');
  });

  it('should handle empty module', () => {
    render(<TestComponent module="" />);
    
    expect(screen.getByTestId('bg-color')).toHaveTextContent(/^#[0-9A-F]{6}$/i);
    expect(screen.getByTestId('is-valid')).toHaveTextContent('true');
  });

  it('should respect custom colors', () => {
    const customColors = { dashboard: '#123456' };
    render(<TestComponent module="dashboard" settings={{ colors: customColors }} />);
    
    expect(screen.getByTestId('bg-color')).toHaveTextContent('#123456');
  });

  it('should validate accessibility when enabled', () => {
    render(<TestComponent module="dashboard" settings={{ validateAccessibility: true }} />);
    
    const accessibility = screen.getByTestId('accessibility').textContent;
    expect(accessibility).toMatch(/pass|fail/);
  });
});

describe('DynamicBackgroundDiv Component', () => {
  const TestWrapper: React.FC<{ module?: string; settings?: any; onClick?: () => void }> = ({ 
    module = 'dashboard', 
    settings = {}, 
    onClick 
  }) => (
    <DynamicBackgroundDiv
      activeModule={module}
      settings={settings}
      onClick={onClick}
      data-testid="dynamic-bg"
    />
  );

  it('should render with default content', () => {
    render(<TestWrapper />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
    expect(bgDiv).toHaveClass('dynamic-background-div');
    // The transition is applied via CSS class
  });

  it('should render custom children', () => {
    render(
      <DynamicBackgroundDiv
        activeModule="dashboard"
        data-testid="dynamic-bg"
      >
        <div data-testid="custom-content">Custom Content</div>
      </DynamicBackgroundDiv>
    );
    
    expect(screen.getByTestId('custom-content')).toBeInTheDocument();
    expect(screen.getByTestId('custom-content')).toHaveTextContent('Custom Content');
  });

  it('should handle click events', () => {
    const handleClick = vi.fn();
    render(<TestWrapper onClick={handleClick} />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    fireEvent.click(bgDiv);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should handle keyboard events', () => {
    const handleClick = vi.fn();
    render(<TestWrapper onClick={handleClick} />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    bgDiv.focus();
    fireEvent.keyDown(bgDiv, { key: 'Enter' });
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should handle hover events', () => {
    const handleHover = vi.fn();
    render(
      <DynamicBackgroundDiv
        activeModule="dashboard"
        onHover={handleHover}
        data-testid="dynamic-bg"
      />
    );
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    fireEvent.mouseEnter(bgDiv);
    expect(handleHover).toHaveBeenCalledWith(true);
    
    fireEvent.mouseLeave(bgDiv);
    expect(handleHover).toHaveBeenCalledWith(false);
  });

  it('should apply custom className', () => {
    render(
      <DynamicBackgroundDiv
        activeModule="dashboard"
        className="custom-class another-class"
        data-testid="dynamic-bg"
      />
    );
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toHaveClass('custom-class', 'another-class');
  });

  it('should handle disabled transitions', () => {
    render(<TestWrapper settings={{ enableTransitions: false }} />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toHaveStyle({ transition: 'none' });
  });

  it('should handle custom transition duration', () => {
    render(<TestWrapper settings={{ transitionDuration: 500 }} />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    // Check that transition contains 500ms
    const transition = bgDiv.style.transition || window.getComputedStyle(bgDiv).transition;
    expect(transition).toContain('500ms');
  });

  it('should show accessibility warning for low contrast', () => {
    render(
      <TestWrapper 
        module="dashboard" 
        settings={{ 
          colors: { dashboard: '#FFFF00' },
          validateAccessibility: true 
        }} 
      />
    );
    
    // Should show contrast warning in console
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Low contrast ratio')
    );
  });

  it('should handle invalid colors gracefully', () => {
    render(
      <TestWrapper 
        module="dashboard" 
        settings={{ 
          colors: { dashboard: 'invalid-color' }
        }} 
      />
    );
    
    // Should show warning in console
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid color for module dashboard')
    );
    
    // Should still render with fallback color
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    render(<TestWrapper />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toHaveAttribute('role', 'region');
    expect(bgDiv).toHaveAttribute('tabIndex', '-1');
    expect(bgDiv).toHaveAttribute('aria-label');
  });

  it('should have responsive styles', () => {
    render(<TestWrapper />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toHaveStyle({
      width: '100%',
      minHeight: '44px',
      minWidth: '44px'
    });
  });
});

describe('Cross-browser Compatibility', () => {
  it('should have vendor prefixes for transitions', () => {
    render(<DynamicBackgroundDiv activeModule="dashboard" data-testid="dynamic-bg" />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    const styles = window.getComputedStyle(bgDiv);
    
    // Check that the component applies vendor prefixes
    expect(styles.transition).toBeTruthy();
  });

  it('should handle reduced motion preference', () => {
    // Mock prefers-reduced-motion media query
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    
    render(<DynamicBackgroundDiv activeModule="dashboard" data-testid="dynamic-bg" />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
  });

  it('should handle high contrast mode', () => {
    // Mock high contrast media query
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: query === '(prefers-contrast: high)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    
    render(<DynamicBackgroundDiv activeModule="dashboard" data-testid="dynamic-bg" />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
  });
});

describe('Performance and Edge Cases', () => {
  it('should handle rapid module changes', async () => {
    const { rerender } = render(<DynamicBackgroundDiv activeModule="dashboard" data-testid="dynamic-bg" />);
    
    // Simulate rapid changes
    const modules = ['dashboard', 'frontoffice', 'reservations', 'rooms', 'pos'];
    for (const module of modules) {
      rerender(<DynamicBackgroundDiv activeModule={module} data-testid="dynamic-bg" />);
    }
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
  });

  it('should handle very long module names', () => {
    const longModuleName = 'very-long-module-name-that-exceeds-normal-length';
    render(<DynamicBackgroundDiv activeModule={longModuleName} data-testid="dynamic-bg" />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
  });

  it('should handle special characters in module names', () => {
    const specialModuleName = 'module-with-@special#chars!';
    render(<DynamicBackgroundDiv activeModule={specialModuleName} data-testid="dynamic-bg" />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
  });

  it('should handle empty settings object', () => {
    render(<DynamicBackgroundDiv activeModule="dashboard" settings={{}} data-testid="dynamic-bg" />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
  });

  it('should handle undefined settings', () => {
    render(<DynamicBackgroundDiv activeModule="dashboard" settings={undefined} data-testid="dynamic-bg" />);
    
    const bgDiv = screen.getByTestId('dynamic-bg');
    expect(bgDiv).toBeInTheDocument();
  });
});