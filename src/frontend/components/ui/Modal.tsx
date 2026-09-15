import React from 'react';

export const Modal: React.FC<{ isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode, footer?: React.ReactNode }> = ({ isOpen, onClose, title, children, footer }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-[500px] max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-4 border-b border-border bg-surface-hover shrink-0">
          <h2 className="text-lg font-bold text-white truncate pr-4">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-2xl leading-none w-8 h-8 flex items-center justify-center rounded bg-gray-800/50 hover:bg-gray-700 shrink-0">&times;</button>
        </div>
        <div className="p-5 overflow-y-auto custom-scrollbar flex-1">
          {children}
        </div>
        {footer && (
          <div className="p-4 border-t border-border bg-surface shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
