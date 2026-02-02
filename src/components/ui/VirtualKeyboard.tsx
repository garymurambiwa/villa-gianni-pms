import React, { useState, useEffect, useRef } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import './VirtualKeyboard.css';

export const VirtualKeyboard: React.FC = () => {
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [size, setSize] = useState({ width: 850, scale: 1 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStart, setResizeStart] = useState({ x: 0, width: 0 });

    // Restoring missing state and refs
    const [show, setShow] = useState(false);
    const [layoutName, setLayoutName] = useState('default');
    const [input, setInput] = useState('');
    const activeInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const keyboardRef = useRef<any>(null);

    useEffect(() => {
        const handleFocus = (e: FocusEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                const type = (target as HTMLInputElement).type;
                if (type === 'file' || type === 'checkbox' || type === 'radio' || type === 'submit') return;

                activeInputRef.current = target as HTMLInputElement | HTMLTextAreaElement;
                setInput(activeInputRef.current.value);
                if (keyboardRef.current) {
                    keyboardRef.current.setInput(activeInputRef.current.value);
                }
                setShow(true);
            }
        };

        const handleBlur = (e: FocusEvent) => {
            setTimeout(() => {
                if (activeInputRef.current && document.activeElement !== activeInputRef.current) {
                    setShow(false);
                    activeInputRef.current = null;
                }
            }, 100);
        };

        document.addEventListener('focusin', handleFocus);
        return () => {
            document.removeEventListener('focusin', handleFocus);
        };
    }, []);

    const onChange = (input: string) => {
        setInput(input);
        if (activeInputRef.current) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;

            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(activeInputRef.current, input);
            } else {
                activeInputRef.current.value = input;
            }

            const event = new Event('input', { bubbles: true });
            activeInputRef.current.dispatchEvent(event);
        }
    };

    const onKeyPress = (button: string) => {
        if (button === '{shift}' || button === '{lock}') {
            setLayoutName(layoutName === 'default' ? 'shift' : 'default');
        }
        if (button === '{enter}') {
            setShow(false);
            activeInputRef.current?.blur();
        }
        if (button === '{close}') {
            setShow(false);
            activeInputRef.current?.blur();
        }
    };

    useEffect(() => {
        // Center horizontally on first show
        if (typeof window !== 'undefined') {
            const initialX = (window.innerWidth - size.width) / 2;
            setPosition({ x: Math.max(0, initialX), y: 0 }); // y:0 means fixed at bottom initially, or use logic
        }
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                const dx = e.clientX - dragStart.x;
                const dy = e.clientY - dragStart.y;
                setPosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
                setDragStart({ x: e.clientX, y: e.clientY });
            }
            if (isResizing) {
                const dw = e.clientX - resizeStart.x;
                const newWidth = Math.max(400, Math.min(1200, resizeStart.width + dw));
                // scale proportionally: 850px = scale 1
                const newScale = newWidth / 850;
                setSize({ width: newWidth, scale: newScale });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
        };

        if (isDragging || isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing, dragStart, resizeStart]);

    const startDrag = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
    };

    const startResize = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsResizing(true);
        setResizeStart({ x: e.clientX, width: size.width });
    };

    const handleFocus = (e: FocusEvent) => {
        const target = e.target as HTMLElement;
        // ... (existing focus logic)
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            const type = (target as HTMLInputElement).type;
            if (type === 'file' || type === 'checkbox' || type === 'radio' || type === 'submit') return;

            activeInputRef.current = target as HTMLInputElement | HTMLTextAreaElement;
            setInput(activeInputRef.current.value);
            if (keyboardRef.current) {
                keyboardRef.current.setInput(activeInputRef.current.value);
            }
            setShow(true);
            // Re-center if off-screen or first open? optional.
        }
    };

    // ... (keep usage of handleFocus in useEffect)

    if (!show) return null;

    return (
        <div
            className="fixed z-[9999] bg-gray-100 shadow-2xl border border-gray-300 rounded-lg overflow-hidden flex flex-col"
            style={{
                left: position.x,
                top: position.y || undefined,
                bottom: position.y ? undefined : 0, // Fallback to bottom if y is 0 (or handle y properly)
                width: size.width,
                transformOrigin: 'bottom left',
                // If using y, we set top/left. If y is 0 relative to something, careful.
                // Better strategy: Initialize y to standard position
            }}
            onMouseDown={(e) => e.preventDefault()}
        >
            {/* Drag Handle Header */}
            <div
                className="bg-gray-200 border-b border-gray-300 p-2 flex justify-between items-center cursor-move select-none"
                onMouseDown={startDrag}
            >
                <span className="text-xs font-bold text-gray-500 pl-2">Virtual Keyboard</span>
                <div className="flex gap-2">
                    <button onClick={() => setShow(false)} className="text-xs font-bold bg-gray-300 px-2 py-1 rounded hover:bg-gray-400">✕</button>
                </div>
            </div>

            <div className="p-2 relative">
                <Keyboard
                    keyboardRef={(r) => (keyboardRef.current = r)}
                    layoutName={layoutName}
                    onChange={onChange}
                    onKeyPress={onKeyPress}
                    display={{
                        '{bksp}': '⌫',
                        '{enter}': '↵',
                        '{shift}': '⇧',
                        '{space}': 'Space',
                        '{lock}': '⇪',
                        '{tab}': '⇥',
                        '{close}': '✕'
                    }}
                    layout={{
                        default: [
                            '` 1 2 3 4 5 6 7 8 9 0 - = {bksp}',
                            '{tab} q w e r t y u i o p [ ] \\',
                            '{lock} a s d f g h j k l ; \' {enter}',
                            '{shift} z x c v b n m , . / {shift}',
                            '.com @ {space} {close}'
                        ],
                        shift: [
                            '~ ! @ # $ % ^ & * ( ) _ + {bksp}',
                            '{tab} Q W E R T Y U I O P { } |',
                            '{lock} A S D F G H J K L : " {enter}',
                            '{shift} Z X C V B N M < > ? {shift}',
                            '.com @ {space} {close}'
                        ]
                    }}
                    theme={"hg-theme-default myTheme1"}
                    buttonTheme={[
                        {
                            class: "hg-red",
                            buttons: "{close}"
                        }
                    ]}
                />

                {/* Resize Handle */}
                <div
                    className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-1 select-none"
                    onMouseDown={startResize}
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="gray"><path d="M10 0L0 10V10H10V0Z" /></svg>
                </div>
            </div>
        </div>
    );
};
