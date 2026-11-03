import React from 'react';
import { AdminConsoleSection } from './AdminConsoleLayout';
import { OrganizationManagementModule } from './OrganizationManagementModule';

export interface AdminConfigDashboardProps {
  activeSection?: AdminConsoleSection;
}

export const AdminConfigDashboard: React.FC<AdminConfigDashboardProps> = ({
  activeSection = 'overview',
}) => {
  return (
    <OrganizationManagementModule
      initialTab={
        activeSection === 'branches'
          ? 'branches'
          : activeSection === 'terminals'
          ? 'terminals'
          : 'organizations'
      }
    />
  );
};
