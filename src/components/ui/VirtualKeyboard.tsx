import React, { useState, useEffect, useRef } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import './VirtualKeyboard.css';

export const VirtualKeyboard: React.FC = () => {
    const [show, setShow] = useState(false);
    const [layoutName, setLayoutName] = useState('default');
    const [input, setInput] = useState('');
    const activeInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const keyboardRef = useRef<any>(null);

    useEffect(() => {
        const handleFocus = (e: FocusEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                // Ignore file inputs and others if needed
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
            // We delay hiding to check if the new focus is part of the keyboard
            // But since we use preventDefault onMouseDown for keyboard, focus shouldn't leave input ideally.
            // However, if user taps outside, we hide.
            setTimeout(() => {
                if (activeInputRef.current && document.activeElement !== activeInputRef.current) {
                    // If focus moved away from input
                    // Check if it moved to keyboard? (Not if we preventDefault)
                    // For now, simple logic: hide if active element is body or something else
                    setShow(false);
                    activeInputRef.current = null;
                }
            }, 100);
        };

        document.addEventListener('focusin', handleFocus);
        // document.addEventListener('focusout', handleBlur); 
        // Managing hide is tricky with click-outside. We can use a backdrop or just a close button.
        // Or a timeout on blur.

        return () => {
            document.removeEventListener('focusin', handleFocus);
            // document.removeEventListener('focusout', handleBlur);
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
            setShow(false); // Hide on enter
            activeInputRef.current?.blur();
        }
        if (button === '{close}') {
            setShow(false);
            activeInputRef.current?.blur();
        }
    };

    if (!show) return null;

    return (
        <div
            className="fixed bottom-0 left-0 right-0 z-[9999] bg-gray-100 shadow-2xl border-t border-gray-300 p-2 pb-6 animate-in slide-in-from-bottom"
            onMouseDown={(e) => e.preventDefault()} // Prevent focus loss from input
        >
            <div className="flex justify-end mb-1 px-2">
                <button onClick={() => setShow(false)} className="text-xs font-bold bg-gray-300 px-2 py-1 rounded hover:bg-gray-400">Close</button>
            </div>
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
            />
        </div>
    );
};
