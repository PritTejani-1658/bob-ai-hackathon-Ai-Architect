import React from 'react';
import { Card } from './Card';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
  variant?: 'danger' | 'warning' | 'success' | 'default';
}

export const MetricCard: React.FC<MetricCardProps> = ({ title, value, subtitle, trend, icon, variant = 'default' }) => {
  const valueColors = {
    danger: 'text-red-400',
    warning: 'text-amber-400',
    success: 'text-emerald-400',
    default: 'text-white'
  };

  return (
    <Card className="flex flex-col relative overflow-hidden">
      <div className="flex justify-between items-start mb-2">
        <span className="text-sm font-medium text-gray-400 uppercase tracking-wider">{title}</span>
        {icon && <div className="text-gray-500">{icon}</div>}
      </div>
      <div className={`text-3xl font-bold ${valueColors[variant]}`}>
        {value}
      </div>
      {subtitle && (
        <div className="mt-2 text-sm text-gray-500 flex items-center">
          {trend === 'up' && <span className="text-red-400 mr-1">↑</span>}
          {trend === 'down' && <span className="text-emerald-400 mr-1">↓</span>}
          {subtitle}
        </div>
      )}
    </Card>
  );
};
