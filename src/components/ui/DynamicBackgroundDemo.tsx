import React, { useState } from 'react';
import { DynamicBackgroundDiv } from '@/components/ui/DynamicBackgroundDiv';
import { defaultMenuColors } from '@/lib/colorUtils';
import '@/styles/dynamic-background.css';

/**
 * Demo component showcasing dynamic background color functionality
 * This demonstrates all the features including accessibility, transitions, and error handling
 */
export const DynamicBackgroundDemo: React.FC = () => {
  const [activeModule, setActiveModule] = useState<string>('dashboard');
  const [customColors, setCustomColors] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [transitionDuration, setTransitionDuration] = useState(300);
  const [enableTransitions, setEnableTransitions] = useState(true);
  const [validateAccessibility, setValidateAccessibility] = useState(true);

  const menuItems = [
    { id: 'dashboard', name: 'Dashboard' },
    { id: 'frontoffice', name: 'Front Office' },
    { id: 'reservations', name: 'Reservations' },
    { id: 'rooms', name: 'Rooms' },
    { id: 'pos', name: 'POS System' },
    { id: 'inventory', name: 'Inventory' },
    { id: 'accounting', name: 'Accounting' },
    { id: 'reports', name: 'Reports' },
    { id: 'users', name: 'User Management' },
    { id: 'maintenance', name: 'Maintenance' }
  ];

  const handleColorChange = (moduleId: string, color: string) => {
    setCustomColors(prev => ({
      ...prev,
      [moduleId]: color
    }));
  };

  const handleResetColors = () => {
    setCustomColors({});
  };

  const handleTestInvalidColor = () => {
    setCustomColors(prev => ({
      ...prev,
      [activeModule]: 'invalid-color'
    }));
  };

  const handleTestLowContrast = () => {
    setCustomColors(prev => ({
      ...prev,
      [activeModule]: '#ffff00' // Yellow on white background (low contrast)
    }));
  };

  const settings = {
    colors: { ...defaultMenuColors, ...customColors },
    enableTransitions,
    transitionDuration,
    validateAccessibility,
    defaultColor: '#dddddd'
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">
          Dynamic Background Color Demo
        </h1>
        <p className="text-gray-600 mb-4">
          This demo showcases dynamic background color changes based on menu selection with accessibility compliance,
          smooth transitions, and error handling.
        </p>
        
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            {showSettings ? 'Hide' : 'Show'} Settings
          </button>
          <button
            onClick={handleResetColors}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Reset Colors
          </button>
          <button
            onClick={handleTestInvalidColor}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Test Invalid Color
          </button>
          <button
            onClick={handleTestLowContrast}
            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
          >
            Test Low Contrast
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Settings</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Transition Duration (ms)
              </label>
              <input
                type="range"
                min="0"
                max="1000"
                step="50"
                value={transitionDuration}
                onChange={(e) => setTransitionDuration(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-sm text-gray-500 mt-1">{transitionDuration}ms</div>
            </div>
            
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={enableTransitions}
                  onChange={(e) => setEnableTransitions(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700">Enable Transitions</span>
              </label>
            </div>
            
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={validateAccessibility}
                  onChange={(e) => setValidateAccessibility(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700">Validate Accessibility</span>
              </label>
            </div>
          </div>
          
          <div className="mt-6">
            <h3 className="text-lg font-medium text-gray-800 mb-3">Custom Colors</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {menuItems.map(item => (
                <div key={item.id} className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    {item.name}
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="color"
                      value={customColors[item.id] || defaultMenuColors[item.id as keyof typeof defaultMenuColors]}
                      onChange={(e) => handleColorChange(item.id, e.target.value)}
                      className="w-8 h-8 rounded border border-gray-300"
                    />
                    <input
                      type="text"
                      value={customColors[item.id] || defaultMenuColors[item.id as keyof typeof defaultMenuColors]}
                      onChange={(e) => handleColorChange(item.id, e.target.value)}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                      placeholder="#000000"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xl font-semibold mb-4">Menu Selection</h2>
          <div className="bg-white rounded-lg shadow-lg p-4 space-y-2">
            {menuItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveModule(item.id)}
                className={`w-full text-left px-4 py-3 rounded transition-colors ${
                  activeModule === item.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-4">Dynamic Background</h2>
          <div className="space-y-4">
            <DynamicBackgroundDiv
              activeModule={activeModule}
              settings={settings}
              onClick={() => console.log('Background clicked!')}
              onHover={(isHovering) => console.log('Hover state:', isHovering)}
              className="border border-gray-200"
            />
            
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-medium text-gray-800 mb-2">Current Status</h3>
              <div className="space-y-1 text-sm">
                <div>Module: <span className="font-mono">{activeModule}</span></div>
                <div>Background: <span className="font-mono">{settings.colors[activeModule as keyof typeof defaultMenuColors] || settings.defaultColor}</span></div>
                <div>Text Color: <span className="font-mono">{new DynamicBackgroundDiv({ activeModule, settings }).props.children?.props?.style?.color || 'auto'}</span></div>
                <div>Transitions: <span className="font-mono">{enableTransitions ? 'Enabled' : 'Disabled'}</span></div>
                <div>Duration: <span className="font-mono">{transitionDuration}ms</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Features Demonstrated</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="font-medium text-green-700">✅ Implemented Features</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Dynamic color changes based on menu selection</li>
              <li>• Smooth transitions (300ms default)</li>
              <li>• Accessibility compliance (4.5:1 contrast ratio)</li>
              <li>• Support for hex, RGB, HSL color formats</li>
              <li>• Hover and active state styling</li>
              <li>• Error handling for invalid colors</li>
              <li>• Default color when no menu is selected</li>
              <li>• Cross-browser compatibility</li>
              <li>• Responsive design</li>
              <li>• High contrast mode support</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h3 className="font-medium text-blue-700">🧪 Test Scenarios</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Click "Test Invalid Color" to see error handling</li>
              <li>• Click "Test Low Contrast" to see accessibility warnings</li>
              <li>• Adjust transition duration to test performance</li>
              <li>• Toggle accessibility validation</li>
              <li>• Use keyboard navigation (Tab + Enter)</li>
              <li>• Test on different screen sizes</li>
              <li>• Test with screen readers</li>
              <li>• Test with high contrast mode</li>
              <li>• Test with reduced motion preference</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DynamicBackgroundDemo;