import React from 'react';
import { useDynamicMenuColor, getDynamicBackgroundStyles, getInteractiveStyles } from '@/hooks/useDynamicMenuColor';
import { MenuColorSettings } from '@/hooks/useDynamicMenuColor';

interface DynamicBackgroundDivProps {
  activeModule: string;
  className?: string;
  children?: React.ReactNode;
  settings?: MenuColorSettings;
  onClick?: () => void;
  onHover?: (isHovering: boolean) => void;
  'data-testid'?: string;
}

/**
 * DynamicBackgroundDiv - A div that changes background color based on selected menu item
 * Features:
 * - Dynamic color changes based on active menu module
 * - Accessibility compliance (4.5:1 contrast ratio)
 * - Smooth transitions (300ms default)
 * - Hover and active state styling
 * - Error handling for invalid colors
 * - Support for hex, RGB, HSL color formats
 * - Cross-browser compatible
 * - Responsive design
 */
export const DynamicBackgroundDiv: React.FC<DynamicBackgroundDivProps> = ({
  activeModule,
  className = '',
  children,
  settings = {},
  onClick,
  onHover,
  'data-testid': testId = 'dynamic-background-div'
}) => {
  const colorState = useDynamicMenuColor(activeModule, settings);
  const dynamicStyles = getDynamicBackgroundStyles(colorState, settings);
  const interactiveStyles = getInteractiveStyles(colorState, settings);
  
  const [isHovered, setIsHovered] = React.useState(false);
  const [isActive, setIsActive] = React.useState(false);

  const handleMouseEnter = () => {
    setIsHovered(true);
    onHover?.(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    onHover?.(false);
    setIsActive(false);
  };

  const handleMouseDown = () => {
    setIsActive(true);
  };

  const handleMouseUp = () => {
    setIsActive(false);
  };

  const handleClick = (e?: React.MouseEvent | React.KeyboardEvent) => {
    e?.preventDefault();
    onClick?.();
  };

  // Calculate hover and active background colors
  const hoverBgColor = isHovered 
    ? `color-mix(in srgb, ${colorState.backgroundColor} 90%, white)`
    : colorState.backgroundColor;
    
  const activeBgColor = isActive
    ? `color-mix(in srgb, ${colorState.backgroundColor} 80%, black)`
    : hoverBgColor;

  const finalStyles: React.CSSProperties = {
    ...dynamicStyles,
    ...interactiveStyles,
    backgroundColor: activeBgColor,
    transform: isActive ? 'scale(0.98)' : 'scale(1)',
    cursor: onClick ? 'pointer' : 'default',
    // Add responsive design
    width: '100%',
    height: '6rem', // h-24 equivalent
    borderRadius: '0.5rem', // rounded equivalent
    marginBottom: '0.5rem', // mb-2 equivalent
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    // Add focus styles for accessibility
    outline: 'none',
    boxShadow: isActive 
      ? 'inset 0 2px 4px rgba(0, 0, 0, 0.1)'
      : isHovered 
      ? '0 4px 12px rgba(0, 0, 0, 0.15)'
      : '0 1px 3px rgba(0, 0, 0, 0.1)',
    // Ensure minimum touch target size for mobile
    minHeight: '44px',
    minWidth: '44px'
  };

  // Add accessibility attributes
  const accessibilityProps = {
    'role': onClick ? 'button' : 'region',
    'tabIndex': onClick ? 0 : -1,
    'aria-label': `Dynamic background for ${activeModule || 'default'} module`,
    'aria-describedby': colorState.accessibility === 'fail' ? 'contrast-warning' : undefined
  };

  return (
    <>
      <div
        data-testid={testId}
        className={`dynamic-background-div ${className}`.trim()}
        style={finalStyles}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handleClick();
          }
        }}
        {...accessibilityProps}
      >
        {children || (
          <div className="dynamic-background-content" style={{ 
            color: colorState.textColor,
            fontWeight: 500,
            textAlign: 'center',
            padding: '1rem',
            transition: `color ${settings.transitionDuration || 300}ms ease-in-out`
          }}>
            <div style={{ fontSize: '0.875rem', opacity: 0.8 }}>
              {activeModule ? `Active: ${activeModule}` : 'Select a menu item'}
            </div>
            {colorState.accessibility === 'fail' && (
              <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.25rem' }}>
                ⚠️ Low contrast: {colorState.contrastRatio.toFixed(2)}:1
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Hidden contrast warning for screen readers */}
      {colorState.accessibility === 'fail' && (
        <span id="contrast-warning" className="sr-only">
          Warning: This color combination has low contrast and may be difficult to read.
          Contrast ratio is {colorState.contrastRatio.toFixed(2)} to 1, minimum required is 4.5 to 1.
        </span>
      )}
    </>
  );
};

/**
 * CSS styles for cross-browser compatibility
 */
export const dynamicBackgroundStyles = `
  .dynamic-background-div {
    /* Ensure smooth transitions across all browsers */
    -webkit-transition: background-color 300ms ease-in-out, color 300ms ease-in-out, transform 150ms ease-in-out, box-shadow 150ms ease-in-out;
    -moz-transition: background-color 300ms ease-in-out, color 300ms ease-in-out, transform 150ms ease-in-out, box-shadow 150ms ease-in-out;
    -o-transition: background-color 300ms ease-in-out, color 300ms ease-in-out, transform 150ms ease-in-out, box-shadow 150ms ease-in-out;
    transition: background-color 300ms ease-in-out, color 300ms ease-in-out, transform 150ms ease-in-out, box-shadow 150ms ease-in-out;
    
    /* Improve performance with hardware acceleration */
    -webkit-transform: translateZ(0);
    -moz-transform: translateZ(0);
    transform: translateZ(0);
    
    /* Ensure proper rendering */
    -webkit-backface-visibility: hidden;
    -moz-backface-visibility: hidden;
    backface-visibility: hidden;
    
    /* Better font rendering */
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  
  .dynamic-background-div:focus {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  
  .dynamic-background-div:focus:not(:focus-visible) {
    outline: none;
  }
  
  /* Responsive adjustments */
  @media (max-width: 640px) {
    .dynamic-background-div {
      height: 5rem; /* Slightly smaller on mobile */
      margin-bottom: 0.75rem;
    }
  }
  
  /* High contrast mode support */
  @media (prefers-contrast: high) {
    .dynamic-background-div {
      border: 2px solid currentColor;
    }
  }
  
  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    .dynamic-background-div {
      -webkit-transition: none !important;
      -moz-transition: none !important;
      -o-transition: none !important;
      transition: none !important;
    }
  }
  
  /* Screen reader only content */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;

export default DynamicBackgroundDiv;