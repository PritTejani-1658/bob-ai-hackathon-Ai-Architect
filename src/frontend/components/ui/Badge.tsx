import React from 'react';

export const Badge: React.FC<{ children: React.ReactNode, variant?: 'success' | 'warning' | 'danger' | 'info' | 'default', className?: string }> = ({ children, variant = 'default', className = '' }) => {
  const colors = {
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    danger: 'bg-red-500/10 text-red-400 border-red-500/20',
    info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    default: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  };
  
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${colors[variant]} ${className}`}>
      {children}
    </span>
  );
};
