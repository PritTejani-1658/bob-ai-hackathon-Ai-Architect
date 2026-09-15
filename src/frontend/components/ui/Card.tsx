import React from 'react';
export const Card: React.FC<{children: React.ReactNode, title?: string, className?: string}> = ({ children, title, className = '' }) => (
  <div className={`card p-4 ${className}`}>
    {title && <h3 className="text-lg font-semibold mb-4 text-gray-100">{title}</h3>}
    {children}
  </div>
);
