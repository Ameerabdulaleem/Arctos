import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Toasts styled as glass panels to match the rest of the app. */
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    toastOptions={{
      style: {
        background: 'rgba(10, 14, 23, 0.92)',
        color: '#F3F6FB',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '14px',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 20px 50px -20px rgba(0, 0, 0, 0.9)',
        fontFamily: 'inherit',
      },
    }}
    {...props}
  />
);

export { Toaster };
