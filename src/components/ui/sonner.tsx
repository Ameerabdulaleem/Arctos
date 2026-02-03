"use client";

import { Toaster as Sonner, ToasterProps } from "sonner";

interface CustomToasterProps extends ToasterProps {
  theme: 'dark' | 'light';
}

const Toaster = ({ theme, ...props }: CustomToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        style: {
          background: theme === 'dark' ? 'hsl(222.2 84% 4.9%)' : 'white',
          color: theme === 'dark' ? 'white' : 'hsl(222.2 84% 4.9%)',
          border: theme === 'dark' ? '1px solid hsl(217.2 32.6% 17.5%)' : '1px solid hsl(214.3 31.8% 91.4%)',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };