import React from 'react';
import logoImg from '../../assets/power2go-logo.png';

export const Logo: React.FC<{ className?: string; size?: 'sm' | 'md' | 'lg' }> = ({ className = '', size = 'md' }) => {
  const isSm = size === 'sm';
  const isLg = size === 'lg';
  const logoWidth = isSm ? 106 : isLg ? 176 : 138;
  const logoHeight = isSm ? 28 : isLg ? 44 : 36;

  return (
    <img
      src={logoImg}
      alt="Power2Go Logo"
      className={`shrink-0 object-contain ${className}`}
      style={{ width: logoWidth, height: logoHeight }}
    />
  );
};


