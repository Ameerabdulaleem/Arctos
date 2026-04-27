import { useState } from 'react';

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  className?: string;
  fallbackBgColor?: string;
}

/**
 * ImageWithFallback Component
 * 
 * Displays an image with a graceful fallback to a placeholder color
 * if the image fails to load.
 */
export function ImageWithFallback({
  src,
  alt,
  className = '',
  fallbackBgColor = 'bg-zinc-800',
}: ImageWithFallbackProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  if (hasError) {
    return <div className={`${fallbackBgColor} ${className}`} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onLoad={handleLoad}
      onError={handleError}
      style={{ display: isLoading || hasError ? 'none' : 'block' }}
    />
  );
}
